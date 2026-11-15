import { createWriteStream } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { pathToFileURL } from 'node:url'
import type { DateTime } from 'luxon'
import postgres from 'postgres'
import { Open } from 'unzipper'
import { nowInEdmonton, ZONE } from '../../src/time/edmonton'
import { transformFeed, type FeedRows } from './transform'

export const GTFS_URL = 'https://gtfs.edmonton.ca/TMGTFSRealTimeWebService/GTFS/gtfs.zip'

/** Exactly these tables are truncated on import. Never truncate by pattern: feedback tables must survive. */
export const SCHEDULE_TABLES = [
  'stops',
  'routes',
  'trips',
  'service_dates',
  'stop_times',
  'shapes',
  'feed_meta',
  'stop_links',
] as const

/**
 * Import window: starts yesterday (Edmonton) so trips from yesterday's service that run
 * past midnight survive an import, then covers today plus the next 6 days.
 */
export function importWindow(now: DateTime): { startDate: string; days: number } {
  return { startDate: now.setZone(ZONE).minus({ days: 1 }).toISODate()!, days: 8 }
}

function field(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return `"${s.replace(/"/g, '""')}"`
}

type Sql = postgres.Sql

async function copyRows(sql: Sql, table: string, cols: string[], rows: unknown[][]) {
  const w = await sql
    .unsafe(`copy ${table} (${cols.join(', ')}) from stdin with (format csv)`)
    .writable()
  const done = new Promise<void>((resolve, reject) => {
    w.on('finish', resolve)
    w.on('error', reject)
  })
  for (const row of rows) {
    if (!w.write(row.map(field).join(',') + '\n')) await new Promise((r) => w.once('drain', r))
  }
  w.end()
  await done
}

export async function load(sql: Sql, f: FeedRows): Promise<Record<string, number>> {
  const tables: Record<string, [string[], unknown[][]]> = {
    stops: [['stop_id', 'name', 'lat', 'lon', 'zone'], f.stops.map((s) => [s.stopId, s.name, s.lat, s.lon, s.zone])],
    routes: [
      ['route_id', 'agency_id', 'short_name', 'long_name', 'route_type', 'color'],
      f.routes.map((r) => [r.routeId, r.agencyId, r.shortName, r.longName, r.routeType, r.color]),
    ],
    trips: [
      ['trip_id', 'route_id', 'service_id', 'headsign', 'shape_id'],
      f.trips.map((t) => [t.tripId, t.routeId, t.serviceId, t.headsign, t.shapeId]),
    ],
    service_dates: [['service_id', 'date'], f.serviceDates.map((s) => [s.serviceId, s.date])],
    stop_times: [
      ['trip_id', 'stop_sequence', 'stop_id', 'arr', 'dep'],
      f.stopTimes.map((s) => [s.tripId, s.stopSequence, s.stopId, s.arr, s.dep]),
    ],
    shapes: [['shape_id', 'points'], f.shapes.map((s) => [s.shapeId, s.points])],
    stop_links: [['from_stop', 'to_stop', 'walk_s'], f.stopLinks.map((l) => [l.fromStop, l.toStop, l.walkS])],
    feed_meta: [
      ['feed_version', 'window_start', 'window_end'],
      [[f.feedMeta.feedVersion, f.feedMeta.windowStart, f.feedMeta.windowEnd]],
    ],
  }
  const counts: Record<string, number> = {}
  await sql.begin(async (tx) => {
    await tx.unsafe(`truncate ${SCHEDULE_TABLES.join(', ')}`)
    for (const t of SCHEDULE_TABLES) {
      const [cols, rows] = tables[t]
      await copyRows(tx as unknown as Sql, t, cols, rows)
      counts[t] = rows.length
    }
  })
  return counts
}

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  const zipPath = join(tmpdir(), `ets-gtfs-${process.pid}.zip`)
  try {
    console.log(`Downloading ${GTFS_URL}`)
    const res = await fetch(GTFS_URL)
    if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`)
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(zipPath))

    const dir = await Open.file(zipPath)
    const feed = await transformFeed(
      async (name) => {
        const entry = dir.files.find((e) => e.path === name)
        return entry ? entry.stream() : null
      },
      importWindow(nowInEdmonton()),
    )

    const sql = postgres(url, { onnotice: () => {} })
    try {
      const counts = await load(sql, feed)
      console.log('Imported rows:', counts)
    } finally {
      await sql.end()
    }
  } finally {
    await rm(zipPath, { force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
