import { DateTime } from 'luxon'
import type { LatLng, Leg, Option } from '@/src/contract/schema'
import { fareFor } from '@/src/fares/fare'
import type { LiveIndex } from '@/src/live/decode'
import { iso, isRail, transitLeg, transitPath, zoneOf, type Shapes } from '@/src/plan/legs'
import { encodeLiveKey, liveKeyFor } from '@/src/plan/liveKey'
import type { Departure } from '@/src/plan/departures'
import type { Candidate } from '@/src/plan/query'
import type { TransferCandidate } from '@/src/plan/queryTransfer'
import { applyRealtime, type RealtimeResult } from '@/src/plan/realtime'
import { rankKey, transferStatus } from '@/src/plan/transfer'
import { ZONE } from '@/src/time/edmonton'

export type AssembleCtx = {
  from: LatLng
  to: LatLng
  live: LiveIndex | null
  nowEpoch: number
  /** Shapes for the transit-leg paths; without them the paths are straight lines (see withShapes). */
  shapes?: Shapes
}

/** Where an assembled option came from: its candidates and their realtime results, in leg order. */
export type OptionSource = { cands: Candidate[]; rts: RealtimeResult[]; tw: number | null }

/**
 * Side map from an option's liveKey to its source, so the survivors of mergeAndRank can be finished
 * (shapes, fallbacks) without adding fields to the contract. A liveKey names the trips, stops and
 * transfer walk, so it identifies the option.
 */
export type Sources = Map<string, OptionSource>

const NO_SHAPES: Shapes = new Map()

function alertsFor(live: LiveIndex | null, cands: Candidate[]): { headline: string }[] {
  const headlines = new Set<string>()
  for (const a of live?.alerts ?? []) {
    for (const c of cands) {
      if (
        a.routeIds.includes(c.routeId) ||
        a.stopIds.includes(c.board.stopId) ||
        a.stopIds.includes(c.alight.stopId) ||
        a.tripIds.includes(c.tripId)
      ) {
        headlines.add(a.headline)
      }
    }
  }
  return [...headlines].map((headline) => ({ headline }))
}

const pt = (s: { lat: number; lon: number }): [number, number] => [s.lat, s.lon]

export function assembleDirectOptions(cands: Candidate[], ctx: AssembleCtx, sources?: Sources): Option[] {
  const timed = cands
    .map((c) => ({ c, rt: applyRealtime(c, ctx.live) }))
    // Keep only buses the rider can still walk to: live time when known, schedule otherwise.
    .filter((x) => x.rt.departEpoch - x.c.board.walkSeconds >= ctx.nowEpoch)
    .map((x) => ({ ...x, finalArrive: x.rt.arriveEpoch + x.c.alight.walkSeconds }))
    .sort((a, b) => a.finalArrive - b.finalArrive)

  const seen = new Set<string>()
  const best: typeof timed = []
  for (const x of timed) {
    const key = `${x.c.routeId}|${x.c.headsign ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    best.push(x)
  }

  return best.slice(0, 5).map(({ c, rt, finalArrive }, i) => {
    const leaveAt = rt.departEpoch - c.board.walkSeconds
    const boardPt = { lat: c.board.lat, lon: c.board.lon }
    const alightPt = { lat: c.alight.lat, lon: c.alight.lon }
    const legs: Leg[] = []
    if (c.board.walkSeconds > 0) {
      legs.push({ mode: 'walk', minutes: c.board.walkSeconds / 60, path: [[ctx.from.lat, ctx.from.lon], pt(boardPt)] })
    }
    legs.push(transitLeg(c, rt, ctx.shapes ?? NO_SHAPES))
    if (c.alight.walkSeconds > 0) {
      legs.push({ mode: 'walk', minutes: c.alight.walkSeconds / 60, path: [pt(alightPt), [ctx.to.lat, ctx.to.lon]] })
    }
    const liveKey = encodeLiveKey({ legs: [liveKeyFor(c)], tw: null })
    sources?.set(liveKey, { cands: [c], rts: [rt], tw: null })
    return {
      id: `opt-${i + 1}`,
      liveKey,
      leaveAt: iso(leaveAt),
      arriveAt: iso(finalArrive),
      durationMinutes: Math.ceil((finalArrive - leaveAt) / 60),
      fare: fareFor({
        firstZone: zoneOf(c.board.zone),
        lastZone: zoneOf(c.alight.zone),
        legs: [{ agencyId: c.agencyId, routeShortName: c.routeShortName ?? '' }],
      }),
      alerts: alertsFor(ctx.live, [c]),
      transfer: null,
      snow: [],
      legs,
    }
  })
}

export type NextDeparturesFn = (args: {
  stopId: string
  routeId?: string
  afterEpoch: number
  limit: number
  live: LiveIndex | null
}) => Promise<Departure[]>

/**
 * Every option comes back with `fallbackDepartAt: null`; ranking needs only the status, so the
 * fallback is looked up afterwards for the survivors (fillFallbacks).
 */
export function assembleTransferOptions(cands: TransferCandidate[], ctx: AssembleCtx, sources?: Sources): Option[] {
  const shapes = ctx.shapes ?? NO_SHAPES
  return cands
    .map((tc) => ({ tc, rt1: applyRealtime(tc.first, ctx.live), rt2: applyRealtime(tc.second, ctx.live) }))
    // Same catchability rule as direct options: the first bus must still be reachable on foot.
    .filter((x) => x.rt1.departEpoch - x.tc.first.board.walkSeconds >= ctx.nowEpoch)
    .map(({ tc, rt1, rt2 }): Option => {
      const { first, second, transferWalkSeconds: tw } = tc
      const bothLive = rt1.realtime && rt2.realtime && !isRail(first) && !isRail(second)
      const status = transferStatus(rt1.arriveEpoch, rt2.departEpoch, tw, bothLive)

      const leaveAt = rt1.departEpoch - first.board.walkSeconds
      const finalArrive = rt2.arriveEpoch + second.alight.walkSeconds
      const legs: Leg[] = []
      if (first.board.walkSeconds > 0) {
        legs.push({ mode: 'walk', minutes: first.board.walkSeconds / 60, path: [[ctx.from.lat, ctx.from.lon], pt(first.board)] })
      }
      legs.push(transitLeg(first, rt1, shapes))
      if (tw > 0) legs.push({ mode: 'walk', minutes: tw / 60, path: [pt(first.alight), pt(second.board)] })
      legs.push(transitLeg(second, rt2, shapes, tw / 60))
      if (second.alight.walkSeconds > 0) {
        legs.push({ mode: 'walk', minutes: second.alight.walkSeconds / 60, path: [pt(second.alight), [ctx.to.lat, ctx.to.lon]] })
      }

      const liveKey = encodeLiveKey({ legs: [liveKeyFor(first), liveKeyFor(second)], tw })
      sources?.set(liveKey, { cands: [first, second], rts: [rt1, rt2], tw })
      return {
        id: '',
        liveKey,
        leaveAt: iso(leaveAt),
        arriveAt: iso(finalArrive),
        durationMinutes: Math.ceil((finalArrive - leaveAt) / 60),
        fare: fareFor({
          firstZone: zoneOf(first.board.zone),
          lastZone: zoneOf(second.alight.zone),
          legs: [first, second].map((c) => ({ agencyId: c.agencyId, routeShortName: c.routeShortName ?? '' })),
        }),
        alerts: alertsFor(ctx.live, [first, second]),
        transfer: { stop: second.board.name, ...status, fallbackDepartAt: null },
        snow: [],
        legs,
      }
    })
}

/** The shape ids the given options' transit legs use. */
export function shapeIdsFor(options: Option[], sources: Sources): string[] {
  const ids = options.flatMap((o) => sources.get(o.liveKey)?.cands.map((c) => c.shapeId) ?? [])
  return [...new Set(ids.filter((s): s is string => s != null))]
}

/** Rebuilds each option's transit-leg paths from the loaded shapes. */
export function withShapes(options: Option[], sources: Sources, shapes: Shapes): Option[] {
  return options.map((o) => {
    const src = sources.get(o.liveKey)
    if (!src) return o
    let k = 0
    const legs = o.legs.map((l): Leg => {
      if (l.mode === 'walk') return l
      const c = src.cands[k++]
      return c ? { ...l, path: transitPath(c, shapes) } : l
    })
    return { ...o, legs }
  })
}

let warnedFallback = false

/**
 * Looks up the next departure after the transfer for each at-risk option, in parallel.
 * A failed lookup leaves that option's fallbackDepartAt null.
 */
export async function fillFallbacks(
  options: Option[],
  sources: Sources,
  ctx: { live: LiveIndex | null; nextDepartures: NextDeparturesFn },
): Promise<Option[]> {
  return Promise.all(
    options.map(async (o): Promise<Option> => {
      const src = sources.get(o.liveKey)
      if (o.transfer?.status !== 'at_risk' || !src || src.cands.length !== 2 || src.tw === null) return o
      const second = src.cands[1]
      let fallbackDepartAt: string | null = null
      try {
        const next = await ctx.nextDepartures({
          stopId: second.board.stopId,
          routeId: second.routeId,
          afterEpoch: src.rts[0].arriveEpoch + src.tw,
          limit: 1,
          live: ctx.live,
        })
        fallbackDepartAt = next.length > 0 ? iso(next[0].departEpoch) : null
      } catch (err) {
        if (!warnedFallback) {
          warnedFallback = true
          console.warn('[plan] fallback departure lookup failed:', err)
        }
      }
      return { ...o, transfer: { ...o.transfer, fallbackDepartAt } }
    }),
  )
}

const epochOf = (s: string): number => DateTime.fromISO(s, { zone: ZONE }).toSeconds()

const routeSequence = (o: Option): string =>
  o.legs.flatMap((l) => (l.mode === 'walk' ? [] : [l.route])).join('+')

/** One ranked list: best per route sequence, at most 5, re-numbered opt-1..opt-5. */
export function mergeAndRank(direct: Option[], transfer: Option[]): Option[] {
  const ranked = [...direct, ...transfer]
    .map((o) => ({
      o,
      key: rankKey(epochOf(o.arriveAt), o.transfer),
      leave: epochOf(o.leaveAt),
      transit: o.legs.filter((l) => l.mode !== 'walk').length,
    }))
    // On a tie, the later departure, then fewer transit legs (direct before transfer), then id.
    .sort((a, b) => a.key - b.key || b.leave - a.leave || a.transit - b.transit || a.o.id.localeCompare(b.o.id))
  const seen = new Set<string>()
  const out: Option[] = []
  for (const { o } of ranked) {
    const seq = routeSequence(o)
    if (seen.has(seq)) continue
    seen.add(seq)
    out.push(o)
    if (out.length === 5) break
  }
  return out.map((o, i) => ({ ...o, id: `opt-${i + 1}` }))
}
