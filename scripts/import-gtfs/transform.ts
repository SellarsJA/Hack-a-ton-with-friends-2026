import { parse } from 'csv-parse'
import { DateTime } from 'luxon'
import { parseGtfsTime } from '../../src/time/edmonton'

export type OpenFn = (name: string) => Promise<NodeJS.ReadableStream | null>

export interface FeedRows {
  stops: { stopId: string; name: string; lat: number; lon: number; zone: string | null }[]
  routes: {
    routeId: string
    agencyId: string
    shortName: string | null
    longName: string | null
    routeType: number
    color: string | null
  }[]
  trips: {
    tripId: string
    routeId: string
    serviceId: string
    headsign: string | null
    shapeId: string | null
  }[]
  serviceDates: { serviceId: string; date: string }[]
  stopTimes: { tripId: string; stopSequence: number; stopId: string; arr: number; dep: number }[]
  shapes: { shapeId: string; points: [number, number][] }[]
  feedMeta: { feedVersion: string | null; windowStart: string; windowEnd: string }
}

type Rec = Record<string, string>

async function* records(stream: NodeJS.ReadableStream): AsyncGenerator<Rec> {
  const parser = stream.pipe(
    parse({ columns: true, bom: true, trim: true, skip_empty_lines: true, relax_column_count: true }),
  )
  for await (const r of parser) yield r as Rec
}

async function required(open: OpenFn, name: string): Promise<NodeJS.ReadableStream> {
  const s = await open(name)
  if (!s) throw new Error(`GTFS feed is missing required file ${name}`)
  return s
}

const orNull = (v: string | undefined) => (v === undefined || v === '' ? null : v)
const round5 = (n: number) => Math.round(n * 1e5) / 1e5

function isoDate(yyyymmdd: string): string {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`
}

export async function transformFeed(
  open: OpenFn,
  opts: { startDate: string; days: number },
): Promise<FeedRows> {
  const start = DateTime.fromISO(opts.startDate, { zone: 'utc' })
  const windowStart = start.toISODate()!
  const windowEnd = start.plus({ days: opts.days - 1 }).toISODate()!
  const inWindow = (d: string) => d >= windowStart && d <= windowEnd

  // 1. service dates (adds minus removes, window only)
  const active = new Map<string, Set<string>>()
  for await (const r of records(await required(open, 'calendar_dates.txt'))) {
    const date = isoDate(r.date)
    if (!inWindow(date)) continue
    let set = active.get(r.service_id)
    if (!set) active.set(r.service_id, (set = new Set()))
    if (r.exception_type === '1') set.add(date)
    else if (r.exception_type === '2') set.delete(date)
  }
  const serviceDates: FeedRows['serviceDates'] = []
  for (const [serviceId, dates] of active) {
    for (const date of [...dates].sort()) serviceDates.push({ serviceId, date })
  }
  const keptServices = new Set(serviceDates.map((s) => s.serviceId))

  // 2. trips
  const trips: FeedRows['trips'] = []
  const keptTrips = new Set<string>()
  const keptShapes = new Set<string>()
  for await (const r of records(await required(open, 'trips.txt'))) {
    if (!keptServices.has(r.service_id)) continue
    keptTrips.add(r.trip_id)
    const shapeId = orNull(r.shape_id)
    if (shapeId) keptShapes.add(shapeId)
    trips.push({
      tripId: r.trip_id,
      routeId: r.route_id,
      serviceId: r.service_id,
      headsign: orNull(r.trip_headsign),
      shapeId,
    })
  }

  // 3. stop_times, streamed, kept trips only
  const stopTimes: FeedRows['stopTimes'] = []
  for await (const r of records(await required(open, 'stop_times.txt'))) {
    if (!keptTrips.has(r.trip_id)) continue
    const a = r.arrival_time || r.departure_time
    const d = r.departure_time || r.arrival_time
    if (!a || !d) continue
    stopTimes.push({
      tripId: r.trip_id,
      stopSequence: Number(r.stop_sequence),
      stopId: r.stop_id,
      arr: parseGtfsTime(a),
      dep: parseGtfsTime(d),
    })
  }

  // 4. stops + zones (first area per stop)
  const zones = new Map<string, string>()
  const sa = await open('stop_areas.txt')
  if (sa) {
    for await (const r of records(sa)) if (!zones.has(r.stop_id)) zones.set(r.stop_id, r.area_id)
  }
  const stops: FeedRows['stops'] = []
  for await (const r of records(await required(open, 'stops.txt'))) {
    stops.push({
      stopId: r.stop_id,
      name: r.stop_name,
      lat: Number(r.stop_lat),
      lon: Number(r.stop_lon),
      zone: zones.get(r.stop_id) ?? null,
    })
  }

  // 5. routes
  const routes: FeedRows['routes'] = []
  for await (const r of records(await required(open, 'routes.txt'))) {
    routes.push({
      routeId: r.route_id,
      agencyId: r.agency_id,
      shortName: orNull(r.route_short_name),
      longName: orNull(r.route_long_name),
      routeType: Number(r.route_type),
      color: orNull(r.route_color),
    })
  }

  // 6. shapes for kept trips
  const pts = new Map<string, { seq: number; p: [number, number] }[]>()
  const sh = keptShapes.size ? await open('shapes.txt') : null
  if (sh) {
    for await (const r of records(sh)) {
      if (!keptShapes.has(r.shape_id)) continue
      let list = pts.get(r.shape_id)
      if (!list) pts.set(r.shape_id, (list = []))
      list.push({
        seq: Number(r.shape_pt_sequence),
        p: [round5(Number(r.shape_pt_lat)), round5(Number(r.shape_pt_lon))],
      })
    }
  }
  const shapes: FeedRows['shapes'] = [...pts].map(([shapeId, list]) => ({
    shapeId,
    points: list.sort((a, b) => a.seq - b.seq).map((x) => x.p),
  }))

  // 7. feed meta
  let feedVersion: string | null = null
  const fi = await open('feed_info.txt')
  if (fi) {
    for await (const r of records(fi)) {
      feedVersion = orNull(r.feed_version)
      break
    }
  }

  return {
    stops,
    routes,
    trips,
    serviceDates,
    stopTimes,
    shapes,
    feedMeta: { feedVersion, windowStart, windowEnd },
  }
}
