import type { LiveIndex, StopLive } from '@/src/live/decode'
import type { Occupancy } from '@/src/contract/schema'
import { toInstant } from '@/src/time/edmonton'

export type RealtimeLegInput = {
  tripId: string
  serviceDate: string
  board: { stopId: string; seq: number; dep: number }
  alight: { stopId: string; seq: number; arr: number }
}

export type RealtimeResult = {
  departEpoch: number
  arriveEpoch: number
  realtime: boolean
  vehicleLabel: string | null
  occupancy: Occupancy | null
}

function resolve(
  stops: StopLive[],
  stop: { stopId: string; seq: number },
  scheduled: number,
  pick: (s: StopLive) => number | null,
): { epoch: number; live: boolean } {
  const exact = stops.find((s) => s.stopSequence === stop.seq) ?? stops.find((s) => s.stopId === stop.stopId)
  if (exact) {
    const t = pick(exact)
    if (t != null) return { epoch: t, live: true }
    if (exact.delay != null) return { epoch: scheduled + exact.delay, live: true }
  }
  let upstream: StopLive | undefined
  for (const s of stops) {
    if (s.stopSequence > 0 && s.stopSequence < stop.seq && s.delay != null) upstream = s
  }
  if (upstream && upstream.delay != null) return { epoch: scheduled + upstream.delay, live: true }
  return { epoch: scheduled, live: false }
}

export function applyRealtime(c: RealtimeLegInput, live: LiveIndex | null): RealtimeResult {
  const schedDep = toInstant(c.serviceDate, c.board.dep).toSeconds()
  const schedArr = toInstant(c.serviceDate, c.alight.arr).toSeconds()
  const trip = live?.trips.get(c.tripId)
  if (!trip) {
    return { departEpoch: schedDep, arriveEpoch: schedArr, realtime: false, vehicleLabel: null, occupancy: null }
  }
  const stops = [...trip.stops].sort((a, b) => a.stopSequence - b.stopSequence)
  const dep = resolve(stops, c.board, schedDep, (s) => s.departure ?? s.arrival)
  const arr = resolve(stops, c.alight, schedArr, (s) => s.arrival ?? s.departure)
  return {
    departEpoch: dep.epoch,
    arriveEpoch: arr.epoch,
    realtime: dep.live,
    vehicleLabel: trip.vehicle?.label ?? null,
    occupancy: trip.vehicle?.occupancy ?? null,
  }
}
