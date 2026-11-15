import type { Vehicle } from '@/src/contract/schema'
import type { Db } from '@/src/db/client'
import type { LiveIndex, TripLive } from '@/src/live/decode'

type LiveVehicle = NonNullable<TripLive['vehicle']>

export type TripRouteFn = (tripIds: string[]) => Promise<Map<string, string>>
export type RouteNamesFn = (routeIds: string[]) => Promise<Map<string, string>>

/** DB-backed lookups: trip id -> route id, and route id -> short name. */
export function dbVehicleLookups(db: Db): { tripRoute: TripRouteFn; routeNames: RouteNamesFn } {
  return {
    async tripRoute(tripIds) {
      const out = new Map<string, string>()
      if (tripIds.length === 0) return out
      const rows = await db.query<{ trip_id: string; route_id: string }>(
        'select trip_id, route_id from trips where trip_id = any($1::text[])',
        [tripIds],
      )
      for (const r of rows) out.set(r.trip_id, r.route_id)
      return out
    },
    async routeNames(routeIds) {
      const out = new Map<string, string>()
      if (routeIds.length === 0) return out
      const rows = await db.query<{ route_id: string; short_name: string | null }>(
        'select route_id, short_name from routes where route_id = any($1::text[])',
        [routeIds],
      )
      for (const r of rows) if (r.short_name) out.set(r.route_id, r.short_name)
      return out
    },
  }
}

/**
 * Live vehicles currently serving any of `routeIds`. A vehicle's own route id is used when the feed
 * carries one; otherwise `tripRoute` resolves it from the trips table.
 */
export async function vehiclesForRoutes(
  routeIds: string[],
  live: LiveIndex | null,
  tripRoute: TripRouteFn,
  routeNames: RouteNamesFn = async () => new Map(),
): Promise<Vehicle[]> {
  const wanted = new Set(routeIds)
  if (!live || wanted.size === 0) return []

  const found: { tripId: string; routeId: string; v: LiveVehicle }[] = []
  const unknown: [string, LiveVehicle][] = []
  for (const [tripId, t] of live.trips) {
    if (!t.vehicle) continue
    if (t.vehicle.routeId) {
      if (wanted.has(t.vehicle.routeId)) found.push({ tripId, routeId: t.vehicle.routeId, v: t.vehicle })
    } else {
      unknown.push([tripId, t.vehicle])
    }
  }
  if (unknown.length > 0) {
    const lookup = await tripRoute(unknown.map(([id]) => id))
    for (const [tripId, v] of unknown) {
      const routeId = lookup.get(tripId)
      if (routeId && wanted.has(routeId)) found.push({ tripId, routeId, v })
    }
  }
  if (found.length === 0) return []

  const names = await routeNames([...new Set(found.map((f) => f.routeId))])
  const seen = new Set<string>()
  const out: Vehicle[] = []
  for (const { tripId, routeId, v } of found) {
    const key = `${tripId}|${v.label}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      label: v.label,
      tripId,
      routeShortName: names.get(routeId) ?? routeId,
      lat: v.lat,
      lon: v.lon,
      occupancy: v.occupancy,
    })
  }
  return out
}
