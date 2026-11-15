import type { DateTime } from 'luxon'
import type { LatLng, Leg, PlanResponse } from '@/src/contract/schema'
import { getDb, type Db } from '@/src/db/client'
import { getLiveIndex } from '@/src/live/cache'
import type { LiveIndex } from '@/src/live/decode'
import {
  assembleDirectOptions,
  assembleTransferOptions,
  fillFallbacks,
  mergeAndRank,
  shapeIdsFor,
  withShapes,
  type Sources,
} from '@/src/plan/assemble'
import { decodeLiveKey } from '@/src/plan/liveKey'
import { nextDepartures } from '@/src/plan/departures'
import { dbVehicleLookups, vehiclesForRoutes, type RouteNamesFn, type TripRouteFn } from '@/src/plan/vehicles'
import { findDirectCandidates, findNearbyStops } from '@/src/plan/query'
import { findTransferCandidates } from '@/src/plan/queryTransfer'
import { activeServiceDays, nowInEdmonton } from '@/src/time/edmonton'

type Shapes = Map<string, [number, number][]>

let warnedTransfers = false

export type PlanDeps = {
  db: Db
  findNearbyStops: typeof findNearbyStops
  findDirectCandidates: typeof findDirectCandidates
  findTransferCandidates: typeof findTransferCandidates
  nextDepartures: typeof nextDepartures
  loadShapes: (db: Db, ids: string[]) => Promise<Shapes>
  getLiveIndex: () => Promise<LiveIndex | null>
  now: () => DateTime
  /** Vehicle lookups; defaults to queries on `db`. */
  tripRoute?: TripRouteFn
  routeNames?: RouteNamesFn
}

export async function loadShapes(db: Db, ids: string[]): Promise<Shapes> {
  const out: Shapes = new Map()
  if (ids.length === 0) return out
  const rows = await db.query<{ shape_id: string; points: unknown }>(
    'select shape_id, points from shapes where shape_id = any($1::text[])',
    [ids],
  )
  for (const r of rows) {
    const pts = typeof r.points === 'string' ? JSON.parse(r.points) : r.points
    if (Array.isArray(pts)) out.set(r.shape_id, pts as [number, number][])
  }
  return out
}

/** Built lazily so importing this module never touches DATABASE_URL. */
export function defaultDeps(): PlanDeps {
  return {
    db: getDb(),
    findNearbyStops,
    findDirectCandidates,
    findTransferCandidates,
    nextDepartures,
    loadShapes,
    getLiveIndex: () => getLiveIndex(),
    now: nowInEdmonton,
  }
}

function vehicleAt(live: LiveIndex | null, tripId: string, serviceDate: string): { lat: number; lon: number } | null {
  const t = live?.trips.get(tripId)
  if (!t?.vehicle || (t.startDate != null && t.startDate !== serviceDate)) return null
  return { lat: t.vehicle.lat, lon: t.vehicle.lon }
}

export async function planTrip(
  from: LatLng,
  to: LatLng,
  deps: PlanDeps = defaultDeps(),
): Promise<PlanResponse> {
  const now = deps.now()
  const nowEpoch = now.toSeconds()
  const generatedAt = now.toISO({ suppressMilliseconds: true }) as string

  const [[origin, dest], live] = await Promise.all([
    Promise.all([deps.findNearbyStops(deps.db, from), deps.findNearbyStops(deps.db, to)]),
    // A live-feed failure must degrade to schedule-only, never fail the plan.
    Promise.resolve()
      .then(() => deps.getLiveIndex())
      .catch(() => null),
  ])
  const liveDataAgeSeconds = live ? Math.max(0, Math.round(nowEpoch - live.feedTimestamp)) : null
  const empty = (emptyReason: NonNullable<PlanResponse['emptyReason']>): PlanResponse => ({
    generatedAt, liveDataAgeSeconds, emptyReason, options: [], vehicles: [],
  })
  if (origin.length === 0) return empty('no_stops_near_start')
  if (dest.length === 0) return empty('no_stops_near_end')

  const days = activeServiceDays(now)
  const [direct, transfers] = await Promise.all([
    deps.findDirectCandidates(deps.db, origin, dest, days),
    // A transfer-side failure (e.g. stop_links missing) must still leave the direct options.
    Promise.resolve()
      .then(() => deps.findTransferCandidates(deps.db, origin, dest, days))
      .catch((err: unknown) => {
        if (!warnedTransfers) {
          warnedTransfers = true
          console.warn('[plan] transfer query failed; returning direct options only:', err)
        }
        return []
      }),
  ])
  // Assemble and rank on straight-line paths with null fallbacks; finish only the survivors.
  const sources: Sources = new Map()
  const ctx = { from, to, live, nowEpoch }
  const ranked = mergeAndRank(
    assembleDirectOptions(direct, ctx, sources),
    assembleTransferOptions(transfers, ctx, sources),
  )
  if (ranked.length === 0) return empty('no_trips_soon')
  const [shapes, withFallbacks] = await Promise.all([
    deps.loadShapes(deps.db, shapeIdsFor(ranked, sources)),
    fillFallbacks(ranked, sources, { live, nextDepartures: (args) => deps.nextDepartures(deps.db, args) }),
  ])
  const options = withShapes(withFallbacks, sources, shapes).map((o) => ({
    ...o,
    legs: o.legs.map((l): Leg => (l.mode === 'walk' ? l : { ...l, vehiclePosition: vehicleAt(live, l.tripId, l.serviceDate) })),
  }))
  const routeIds = [
    ...new Set(options.flatMap((o) => decodeLiveKey(o.liveKey)?.legs.map((l) => l.r) ?? [])),
  ]
  const lookups = dbVehicleLookups(deps.db)
  const vehicles = await vehiclesForRoutes(
    routeIds,
    live,
    deps.tripRoute ?? lookups.tripRoute,
    deps.routeNames ?? lookups.routeNames,
  ).catch(() => [])
  return { generatedAt, liveDataAgeSeconds, emptyReason: null, options, vehicles }
}
