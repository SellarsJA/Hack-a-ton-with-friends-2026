import type { LiveOption } from '@/src/contract/schema'
import type { LiveIndex } from '@/src/live/decode'
import type { NextDeparturesFn } from '@/src/plan/assemble'
import { iso } from '@/src/plan/legs'
import { decodeLiveKey, type LiveKeyLeg } from '@/src/plan/liveKey'
import { applyRealtime, type RealtimeResult } from '@/src/plan/realtime'
import { transferStatus } from '@/src/plan/transfer'

export class BadLiveKeyError extends Error {}

let warnedFallback = false

export type RefreshDeps = { nextDepartures: NextDeparturesFn }

function legInput(l: LiveKeyLeg) {
  return {
    tripId: l.t,
    serviceDate: l.d,
    board: { stopId: l.bs, seq: l.bq, dep: l.bt },
    alight: { stopId: l.as, seq: l.aq, arr: l.at },
  }
}

/**
 * Recomputes each option's predictions and transfer status from its liveKey and the live index.
 * Keys must already have passed decodeLiveKey; an undecodable key throws.
 */
export async function refreshOptions(
  keys: string[],
  live: LiveIndex | null,
  nowEpoch: number,
  deps: RefreshDeps,
): Promise<LiveOption[]> {
  return Promise.all(
    keys.map(async (liveKey): Promise<LiveOption> => {
      const payload = decodeLiveKey(liveKey)
      if (!payload) throw new BadLiveKeyError('bad live key')
      const rts: RealtimeResult[] = payload.legs.map((l) => applyRealtime(legInput(l), live))
      // Defence in depth: a non-finite epoch would serialise as null and poison transfer maths.
      if (rts.some((rt) => !Number.isFinite(rt.departEpoch) || !Number.isFinite(rt.arriveEpoch))) {
        throw new BadLiveKeyError('non-finite epoch')
      }
      const legs = rts.map((rt, i) => ({
        tripId: payload.legs[i].t,
        departAt: iso(rt.departEpoch),
        arriveAt: iso(rt.arriveEpoch),
        realtime: rt.realtime,
        vehicleLabel: rt.vehicleLabel,
        occupancy: rt.occupancy,
        vehiclePosition: positionOf(live, payload.legs[i]),
      }))

      let transfer: LiveOption['transfer'] = null
      if (payload.legs.length === 2 && payload.tw !== null) {
        const [a, b] = payload.legs
        const [r1, r2] = rts
        const bothLive = r1.realtime && r2.realtime && !a.rail && !b.rail
        const status = transferStatus(r1.arriveEpoch, r2.departEpoch, payload.tw, bothLive)
        let fallbackDepartAt: string | null = null
        if (status.status === 'at_risk') {
          try {
            const next = await deps.nextDepartures({
              stopId: b.bs,
              routeId: b.r,
              afterEpoch: r1.arriveEpoch + payload.tw,
              limit: 1,
              live,
            })
            fallbackDepartAt = next.length > 0 ? iso(next[0].departEpoch) : null
          } catch (err) {
            if (!warnedFallback) {
              warnedFallback = true
              console.warn('[live] fallback departure lookup failed:', err)
            }
          }
        }
        transfer = { stop: b.bs, ...status, fallbackDepartAt }
      }

      return { liveKey, expired: rts[0].departEpoch < nowEpoch, legs, transfer }
    }),
  )
}

function positionOf(live: LiveIndex | null, l: LiveKeyLeg): { lat: number; lon: number } | null {
  const trip = live?.trips.get(l.t)
  if (!trip || (trip.startDate != null && trip.startDate !== l.d) || !trip.vehicle) return null
  return { lat: trip.vehicle.lat, lon: trip.vehicle.lon }
}
