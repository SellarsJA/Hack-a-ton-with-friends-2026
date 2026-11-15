import { PGlite } from '@electric-sql/pglite'
import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Db } from '../../src/db/client'
import { transformFeed } from '../../scripts/import-gtfs/transform'

const ROOT = join(__dirname, '../..')
const FIXTURE = join(ROOT, 'tests/fixtures/gtfs-mini')

async function insertRows(pg: PGlite, table: string, cols: string[], rows: unknown[][]) {
  const CHUNK = 500
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK)
    const params = chunk.flat()
    const values = chunk
      .map((_, r) => `(${cols.map((_, c) => `$${r * cols.length + c + 1}`).join(',')})`)
      .join(',')
    await pg.query(`insert into ${table} (${cols.join(',')}) values ${values}`, params)
  }
}

/** Fresh in-process Postgres loaded with tests/fixtures/gtfs-mini (window 2026-11-14 + 7 days). */
export async function makeTestDb(): Promise<Db> {
  const pg = new PGlite()
  await pg.exec(readFileSync(join(ROOT, 'db/schema.sql'), 'utf8'))
  const f = await transformFeed(
    async (name) => {
      const p = join(FIXTURE, name)
      return existsSync(p) ? createReadStream(p) : null
    },
    { startDate: '2026-11-14', days: 7 },
  )
  await insertRows(pg, 'stops', ['stop_id', 'name', 'lat', 'lon', 'zone'], f.stops.map((s) => [s.stopId, s.name, s.lat, s.lon, s.zone]))
  await insertRows(pg, 'routes', ['route_id', 'agency_id', 'short_name', 'long_name', 'route_type', 'color'], f.routes.map((r) => [r.routeId, r.agencyId, r.shortName, r.longName, r.routeType, r.color]))
  await insertRows(pg, 'trips', ['trip_id', 'route_id', 'service_id', 'headsign', 'shape_id'], f.trips.map((t) => [t.tripId, t.routeId, t.serviceId, t.headsign, t.shapeId]))
  await insertRows(pg, 'service_dates', ['service_id', 'date'], f.serviceDates.map((s) => [s.serviceId, s.date]))
  await insertRows(pg, 'stop_times', ['trip_id', 'stop_sequence', 'stop_id', 'arr', 'dep'], f.stopTimes.map((s) => [s.tripId, s.stopSequence, s.stopId, s.arr, s.dep]))
  await insertRows(pg, 'shapes', ['shape_id', 'points'], f.shapes.map((s) => [s.shapeId, JSON.stringify(s.points)]))
  await insertRows(pg, 'feed_meta', ['feed_version', 'window_start', 'window_end'], [[f.feedMeta.feedVersion, f.feedMeta.windowStart, f.feedMeta.windowEnd]])
  return {
    async query<T = Record<string, unknown>>(text: string, params?: unknown[]) {
      return (await pg.query<T>(text, params)).rows
    },
  }
}
