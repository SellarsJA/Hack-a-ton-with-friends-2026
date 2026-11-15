import { DateTime } from 'luxon'
import type { RouteDetail, RouteSummary, Vehicle } from '@/src/contract/schema'
import type { Db } from '@/src/db/client'
import { activeAlerts, type LiveIndex } from '@/src/live/decode'
import { getLiveIndex } from '@/src/live/cache'
import { nextDepartures } from '@/src/plan/departures'
import { loadShapes } from '@/src/plan/plan'
import { dbVehicleLookups, vehiclesForRoutes } from '@/src/plan/vehicles'
import { activeServiceDays, ZONE } from '@/src/time/edmonton'

type RouteRow = {
  route_id: string
  agency_id: string | null
  short_name: string | null
  long_name: string | null
  route_type: number | null
  color: string | null
}

const ROUTE_COLUMNS = 'route_id, agency_id, short_name, long_name, route_type, color'

const isNumeric = (s: string) => /^\d+$/.test(s)

/** Numeric short names first in numeric order, then the rest alphabetically. */
export function compareRoutes(a: { shortName: string }, b: { shortName: string }): number {
  const an = isNumeric(a.shortName)
  const bn = isNumeric(b.shortName)
  if (an && bn) return Number(a.shortName) - Number(b.shortName)
  if (an) return -1
  if (bn) return 1
  return a.shortName.localeCompare(b.shortName)
}

function toSummary(r: RouteRow): RouteSummary {
  const group = r.route_type === 0 || r.route_type === 1 ? 'rail' : r.agency_id !== '1' ? 'regional' : 'bus'
  const color = r.color ? (r.color.startsWith('#') ? r.color : `#${r.color}`) : null
  return {
    routeId: r.route_id,
    shortName: r.short_name ?? r.route_id,
    longName: r.long_name ?? '',
    group,
    color,
  }
}

export async function listRoutes(db: Db): Promise<RouteSummary[]> {
  const rows = await db.query<RouteRow>(`select ${ROUTE_COLUMNS} from routes`)
  return rows.map(toSummary).sort(compareRoutes)
}

// Per headsign, the trip with the most stops among trips running today (or yesterday's late service).
const PATTERN_TRIPS_SQL = `
select distinct on (headsign) trip_id, headsign, shape_id from (
  select t.trip_id, coalesce(t.headsign, '') headsign, t.shape_id,
         (select count(*) from stop_times st where st.trip_id = t.trip_id) n,
         min(d.ord) ord
  from trips t
  join service_dates sd on sd.service_id = t.service_id
  join unnest($2::date[]) with ordinality as d(service_date, ord) on d.service_date = sd.date
  where t.route_id = $1
  group by t.trip_id, t.headsign, t.shape_id) x
order by headsign, n desc, ord, trip_id`

const PATTERN_STOPS_SQL = `
select st.trip_id, st.stop_id, s.name, s.lat, s.lon
from stop_times st join stops s on s.stop_id = st.stop_id
where st.trip_id = any($1::text[])
order by st.trip_id, st.stop_sequence`

export type RouteDetailDeps = {
  getLiveIndex: () => Promise<LiveIndex | null>
  nextDepartures: typeof nextDepartures
  vehiclesForRoutes: (routeIds: string[], live: LiveIndex | null) => Promise<Vehicle[]>
}

const iso = (epoch: number) =>
  DateTime.fromSeconds(epoch, { zone: ZONE }).toISO({ suppressMilliseconds: true }) as string

export async function routeDetail(
  db: Db,
  routeId: string,
  stopId: string | null,
  nowEpoch: number,
  deps: Partial<RouteDetailDeps> = {},
): Promise<RouteDetail | null> {
  const routeRows = await db.query<RouteRow>(`select ${ROUTE_COLUMNS} from routes where route_id = $1`, [routeId])
  if (routeRows.length === 0) return null
  const route = toSummary(routeRows[0])

  const getLive = deps.getLiveIndex ?? (() => getLiveIndex())
  const departuresFn = deps.nextDepartures ?? nextDepartures
  const vehiclesFn =
    deps.vehiclesForRoutes ??
    ((ids, live) => {
      const l = dbVehicleLookups(db)
      return vehiclesForRoutes(ids, live, l.tripRoute, l.routeNames)
    })

  const days = activeServiceDays(DateTime.fromSeconds(nowEpoch, { zone: ZONE }))
  const trips = await db.query<{ trip_id: string; headsign: string; shape_id: string | null }>(PATTERN_TRIPS_SQL, [
    routeId,
    days.map((d) => d.serviceDate),
  ])
  const tripIds = trips.map((t) => t.trip_id)
  const stopRows = tripIds.length
    ? await db.query<{ trip_id: string; stop_id: string; name: string; lat: number; lon: number }>(
        PATTERN_STOPS_SQL,
        [tripIds],
      )
    : []
  const shapes = await loadShapes(
    db,
    trips.map((t) => t.shape_id).filter((s): s is string => !!s),
  )
  const patterns = trips.map((t) => {
    const stops = stopRows
      .filter((s) => s.trip_id === t.trip_id)
      .map((s) => ({ stopId: s.stop_id, name: s.name, lat: Number(s.lat), lon: Number(s.lon) }))
    const shape = t.shape_id ? shapes.get(t.shape_id) : undefined
    const path: [number, number][] = shape && shape.length >= 2 ? shape : stops.map((s) => [s.lat, s.lon])
    return { headsign: t.headsign, path, stops }
  })

  // The live feed is optional; a failure degrades to schedule-only.
  const live = await Promise.resolve()
    .then(() => getLive())
    .catch(() => null)

  const departures =
    stopId === null
      ? []
      : await Promise.resolve()
          .then(() => departuresFn(db, { stopId, routeId, afterEpoch: nowEpoch, limit: 5, live }))
          .then((ds) =>
            ds.map((d) => ({ tripId: d.tripId, headsign: d.headsign, departAt: iso(d.departEpoch), realtime: d.realtime })),
          )
          .catch((err) => {
            console.warn('route departures failed:', err)
            return []
          })

  const vehicles = await Promise.resolve()
    .then(() => vehiclesFn([routeId], live))
    .catch((err) => {
      console.warn('route vehicles failed:', err)
      return [] as Vehicle[]
    })

  const alerts = live
    ? activeAlerts(live.alerts, nowEpoch)
        .filter((a) => a.routeIds.includes(routeId))
        .map((a) => ({ headline: a.headline }))
    : []

  return { route, patterns, departures, vehicles, alerts }
}
