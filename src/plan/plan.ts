import type { DateTime } from 'luxon'
import type { LatLng, PlanResponse } from '@/src/contract/schema'
import { getDb, type Db } from '@/src/db/client'
import { getLiveIndex } from '@/src/live/cache'
import type { LiveIndex } from '@/src/live/decode'
import { assembleDirectOptions, assembleTransferOptions, mergeAndRank } from '@/src/plan/assemble'
import { nextDepartures } from '@/src/plan/departures'
import { findDirectCandidates, findNearbyStops } from '@/src/plan/query'
import { findTransferCandidates } from '@/src/plan/queryTransfer'
import { activeServiceDays, nowInEdmonton } from '@/src/time/edmonton'

type Shapes = Map<string, [number, number][]>

export type PlanDeps = {
  db: Db
  findNearbyStops: typeof findNearbyStops
  findDirectCandidates: typeof findDirectCandidates
  findTransferCandidates: typeof findTransferCandidates
  nextDepartures: typeof nextDepartures
  loadShapes: (db: Db, ids: string[]) => Promise<Shapes>
  getLiveIndex: () => Promise<LiveIndex | null>
  now: () => DateTime
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
    deps.findTransferCandidates(deps.db, origin, dest, days),
  ])
  const shapeIds = [
    ...new Set(
      [...direct, ...transfers.flatMap((t) => [t.first, t.second])]
        .map((c) => c.shapeId)
        .filter((s): s is string => s != null),
    ),
  ]
  const shapes = await deps.loadShapes(deps.db, shapeIds)
  const ctx = { from, to, live, nowEpoch, shapes }
  const directOptions = assembleDirectOptions(direct, ctx)
  const transferOptions = await assembleTransferOptions(transfers, {
    ...ctx,
    nextDepartures: (args) => deps.nextDepartures(deps.db, args),
  })
  const options = mergeAndRank(directOptions, transferOptions)
  if (options.length === 0) return empty('no_trips_soon')
  return { generatedAt, liveDataAgeSeconds, emptyReason: null, options, vehicles: [] }
}
