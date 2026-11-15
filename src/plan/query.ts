import type { Db } from '@/src/db/client'
import type { LatLng } from '@/src/contract/schema'
import { boundingBox, distanceMeters, walkMinutes } from '@/src/geo/geo'

export type NearbyStop = {
  stopId: string
  name: string
  lat: number
  lon: number
  zone: string | null
  distanceM: number
  walkSeconds: number
}

export type Candidate = {
  tripId: string
  serviceDate: string
  routeId: string
  agencyId: string
  routeShortName: string | null
  routeType: number
  headsign: string | null
  shapeId: string | null
  board: NearbyStop & { seq: number; dep: number }
  alight: NearbyStop & { seq: number; arr: number }
}

const MAX_NEARBY = 30

export async function findNearbyStops(db: Db, p: LatLng, radiusM = 800): Promise<NearbyStop[]> {
  const b = boundingBox(p, radiusM)
  const rows = await db.query<{
    stop_id: string
    name: string
    lat: number
    lon: number
    zone: string | null
  }>(
    'select stop_id, name, lat, lon, zone from stops where lat between $1 and $2 and lon between $3 and $4',
    [b.minLat, b.maxLat, b.minLon, b.maxLon],
  )
  return rows
    .map((r) => {
      const lat = Number(r.lat)
      const lon = Number(r.lon)
      const distanceM = distanceMeters(p, { lat, lon })
      return {
        stopId: r.stop_id,
        name: r.name,
        lat,
        lon,
        zone: r.zone ?? null,
        distanceM,
        walkSeconds: walkMinutes(distanceM) * 60,
      }
    })
    .filter((s) => s.distanceM <= radiusM)
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, MAX_NEARBY)
}

const DIRECT_SQL = `
select * from (
  with o(stop_id, walk_s) as (select * from unnest($1::text[], $2::int[])),
       d(stop_id, walk_s) as (select * from unnest($3::text[], $4::int[])),
       days(service_date, now_s) as (select * from unnest($5::date[], $6::int[]))
  select distinct on (so.trip_id, days.service_date)
    so.trip_id, days.service_date::text service_date, t.route_id, r.agency_id, r.short_name, r.route_type, t.headsign, t.shape_id,
    so.stop_id board_stop, so.stop_sequence board_seq, so.dep board_dep,
    sd2.stop_id alight_stop, sd2.stop_sequence alight_seq, sd2.arr alight_arr, d.walk_s dest_walk_s
  from days
  join service_dates sd on sd.date = days.service_date
  join trips t on t.service_id = sd.service_id
  join routes r on r.route_id = t.route_id
  join stop_times so on so.trip_id = t.trip_id
  join o on o.stop_id = so.stop_id and so.dep between days.now_s + o.walk_s and days.now_s + 5400
  join stop_times sd2 on sd2.trip_id = t.trip_id and sd2.stop_sequence > so.stop_sequence
  join d on d.stop_id = sd2.stop_id
  order by so.trip_id, days.service_date, (sd2.arr + d.walk_s) - (so.dep - o.walk_s), so.dep desc
) best
order by alight_arr + dest_walk_s, trip_id
limit 300`

type Row = {
  trip_id: string
  service_date: string
  route_id: string
  agency_id: string
  short_name: string | null
  route_type: number
  headsign: string | null
  shape_id: string | null
  board_stop: string
  board_seq: number
  board_dep: number
  alight_stop: string
  alight_seq: number
  alight_arr: number
}

export async function findDirectCandidates(
  db: Db,
  origin: NearbyStop[],
  dest: NearbyStop[],
  days: { serviceDate: string; nowSeconds: number }[],
): Promise<Candidate[]> {
  if (origin.length === 0 || dest.length === 0 || days.length === 0) return []
  const rows = await db.query<Row>(DIRECT_SQL, [
    origin.map((s) => s.stopId),
    origin.map((s) => s.walkSeconds),
    dest.map((s) => s.stopId),
    dest.map((s) => s.walkSeconds),
    days.map((d) => d.serviceDate),
    days.map((d) => d.nowSeconds),
  ])
  const o = new Map(origin.map((s) => [s.stopId, s]))
  const d = new Map(dest.map((s) => [s.stopId, s]))
  return rows.map((r) => ({
    tripId: r.trip_id,
    serviceDate: r.service_date,
    routeId: r.route_id,
    agencyId: r.agency_id,
    routeShortName: r.short_name,
    routeType: Number(r.route_type),
    headsign: r.headsign,
    shapeId: r.shape_id,
    board: { ...o.get(r.board_stop)!, seq: Number(r.board_seq), dep: Number(r.board_dep) },
    alight: { ...d.get(r.alight_stop)!, seq: Number(r.alight_seq), arr: Number(r.alight_arr) },
  }))
}
