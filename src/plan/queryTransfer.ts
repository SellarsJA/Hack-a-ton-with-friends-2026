import type { Db } from '@/src/db/client'
import type { Candidate, NearbyStop } from '@/src/plan/query'

export type TransferCandidate = {
  first: Candidate
  second: Candidate
  transferWalkSeconds: number
}

// Two-trip journeys: leg 1 from an origin stop to x, a stop link x -> y (same stop
// or walkable), leg 2 from y to a destination stop. Both legs run on the same service
// date. Leg 1 allows a bus up to 30 minutes late (lower bound now + walk - 1800).
const TRANSFER_SQL = `
with o(stop_id, walk_s) as (select * from unnest($1::text[], $2::int[])),
     d(stop_id, walk_s) as (select * from unnest($3::text[], $4::int[])),
     days(service_date, now_s) as (select * from unnest($5::date[], $6::int[])),
leg1 as (
  select t.trip_id, t.route_id, days.service_date, so.stop_id b_stop, so.stop_sequence b_seq, so.dep b_dep, o.walk_s b_walk,
         sx.stop_id x_stop, sx.stop_sequence x_seq, sx.arr x_arr
  from days join service_dates sd on sd.date = days.service_date
  join trips t on t.service_id = sd.service_id
  join stop_times so on so.trip_id = t.trip_id
  join o on o.stop_id = so.stop_id and so.dep between days.now_s + o.walk_s - 1800 and days.now_s + 5400
  join stop_times sx on sx.trip_id = t.trip_id and sx.stop_sequence > so.stop_sequence),
leg2 as (
  select t.trip_id, t.route_id, days.service_date, sy.stop_id y_stop, sy.stop_sequence y_seq, sy.dep y_dep,
         sa.stop_id a_stop, sa.stop_sequence a_seq, sa.arr a_arr, d.walk_s a_walk
  from days join service_dates sd on sd.date = days.service_date
  join trips t on t.service_id = sd.service_id
  join stop_times sa on sa.trip_id = t.trip_id
  join d on d.stop_id = sa.stop_id and sa.arr between days.now_s and days.now_s + 10800
  join stop_times sy on sy.trip_id = t.trip_id and sy.stop_sequence < sa.stop_sequence)
select distinct on (leg1.trip_id, leg1.service_date, leg2.trip_id)
  leg1.trip_id t1_trip, leg1.service_date::text service_date,
  leg1.b_stop, leg1.b_seq, leg1.b_dep, leg1.x_stop, leg1.x_seq, leg1.x_arr,
  leg2.trip_id t2_trip, leg2.y_stop, leg2.y_seq, leg2.y_dep, leg2.a_stop, leg2.a_seq, leg2.a_arr,
  l.walk_s x_walk
from leg1
join stop_links l on l.from_stop = leg1.x_stop
join leg2 on leg2.y_stop = l.to_stop and leg2.service_date = leg1.service_date
  and leg2.route_id <> leg1.route_id
  and leg2.y_dep between leg1.x_arr + l.walk_s + 60 and leg1.x_arr + 5400
order by leg1.trip_id, leg1.service_date, leg2.trip_id, (leg2.a_arr + leg2.a_walk) - (leg1.b_dep - leg1.b_walk)
limit 300`

const TRIPS_SQL = `
select t.trip_id, t.route_id, r.agency_id, r.short_name, r.route_type, t.headsign, t.shape_id
from trips t join routes r on r.route_id = t.route_id
where t.trip_id = any($1::text[])`

const STOPS_SQL = 'select stop_id, name, lat, lon, zone from stops where stop_id = any($1::text[])'

type Row = {
  t1_trip: string
  service_date: string
  b_stop: string
  b_seq: number
  b_dep: number
  x_stop: string
  x_seq: number
  x_arr: number
  t2_trip: string
  y_stop: string
  y_seq: number
  y_dep: number
  a_stop: string
  a_seq: number
  a_arr: number
  x_walk: number
}

type TripRow = {
  trip_id: string
  route_id: string
  agency_id: string
  short_name: string | null
  route_type: number
  headsign: string | null
  shape_id: string | null
}

type StopRow = { stop_id: string; name: string; lat: number; lon: number; zone: string | null }

export async function findTransferCandidates(
  db: Db,
  origin: NearbyStop[],
  dest: NearbyStop[],
  days: { serviceDate: string; nowSeconds: number }[],
): Promise<TransferCandidate[]> {
  if (origin.length === 0 || dest.length === 0 || days.length === 0) return []
  const rows = await db.query<Row>(TRANSFER_SQL, [
    origin.map((s) => s.stopId),
    origin.map((s) => s.walkSeconds),
    dest.map((s) => s.stopId),
    dest.map((s) => s.walkSeconds),
    days.map((d) => d.serviceDate),
    days.map((d) => d.nowSeconds),
  ])
  if (rows.length === 0) return []

  const tripIds = [...new Set(rows.flatMap((r) => [r.t1_trip, r.t2_trip]))]
  const xStopIds = [...new Set(rows.flatMap((r) => [r.x_stop, r.y_stop]))]
  const [tripRows, stopRows] = await Promise.all([
    db.query<TripRow>(TRIPS_SQL, [tripIds]),
    db.query<StopRow>(STOPS_SQL, [xStopIds]),
  ])
  const trips = new Map(tripRows.map((t) => [t.trip_id, t]))
  const stops = new Map(stopRows.map((s) => [s.stop_id, s]))
  const o = new Map(origin.map((s) => [s.stopId, s]))
  const d = new Map(dest.map((s) => [s.stopId, s]))

  const transferStop = (id: string): NearbyStop => {
    const s = stops.get(id)!
    return { stopId: s.stop_id, name: s.name, lat: Number(s.lat), lon: Number(s.lon), zone: s.zone ?? null, distanceM: 0, walkSeconds: 0 }
  }
  const base = (tripId: string, serviceDate: string) => {
    const t = trips.get(tripId)!
    return {
      tripId,
      serviceDate,
      routeId: t.route_id,
      agencyId: t.agency_id,
      routeShortName: t.short_name,
      routeType: Number(t.route_type),
      headsign: t.headsign,
      shapeId: t.shape_id,
    }
  }

  return rows.map((r) => ({
    first: {
      ...base(r.t1_trip, r.service_date),
      board: { ...o.get(r.b_stop)!, seq: Number(r.b_seq), dep: Number(r.b_dep) },
      alight: { ...transferStop(r.x_stop), seq: Number(r.x_seq), arr: Number(r.x_arr) },
    },
    second: {
      ...base(r.t2_trip, r.service_date),
      board: { ...transferStop(r.y_stop), seq: Number(r.y_seq), dep: Number(r.y_dep) },
      alight: { ...d.get(r.a_stop)!, seq: Number(r.a_seq), arr: Number(r.a_arr) },
    },
    transferWalkSeconds: Number(r.x_walk),
  }))
}
