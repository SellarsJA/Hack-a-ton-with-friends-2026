import { describe, expect, it } from 'vitest'
import { applyRealtime, type RealtimeLegInput } from '@/src/plan/realtime'
import type { LiveIndex, TripLive } from '@/src/live/decode'
import { toInstant } from '@/src/time/edmonton'

const DATE = '2026-11-14'
const DEP = 12 * 3600
const ARR = DEP + 600
const depEpoch = toInstant(DATE, DEP).toSeconds()
const arrEpoch = toInstant(DATE, ARR).toSeconds()

const leg: RealtimeLegInput = {
  tripId: 't1',
  serviceDate: DATE,
  board: { stopId: 'A', seq: 5, dep: DEP },
  alight: { stopId: 'B', seq: 9, arr: ARR },
}

const liveWith = (trip: TripLive): LiveIndex => ({
  feedTimestamp: 0,
  trips: new Map([['t1', trip]]),
  alerts: [],
})

describe('applyRealtime', () => {
  it('uses exact stop predictions', () => {
    const live = liveWith({
      stops: [
        { stopSequence: 5, stopId: 'A', arrival: null, departure: depEpoch + 90, delay: 90 },
        { stopSequence: 9, stopId: 'B', arrival: arrEpoch + 200, departure: null, delay: 200 },
      ],
      vehicle: { label: 'V1', lat: 0, lon: 0, occupancy: 'some_standing' },
    })
    expect(applyRealtime(leg, live)).toEqual({
      departEpoch: depEpoch + 90,
      arriveEpoch: arrEpoch + 200,
      realtime: true,
      vehicleLabel: 'V1',
      occupancy: 'some_standing',
    })
  })

  it('matches by stopId when the sequence differs', () => {
    const live = liveWith({
      stops: [{ stopSequence: 6, stopId: 'A', arrival: null, departure: depEpoch + 45, delay: 45 }],
      vehicle: null,
    })
    expect(applyRealtime(leg, live).departEpoch).toBe(depEpoch + 45)
  })

  it('propagates an upstream delay', () => {
    const live = liveWith({
      stops: [{ stopSequence: 3, stopId: 'X', arrival: null, departure: null, delay: 120 }],
      vehicle: null,
    })
    const r = applyRealtime(leg, live)
    expect(r.departEpoch).toBe(depEpoch + 120)
    expect(r.arriveEpoch).toBe(arrEpoch + 120)
    expect(r.realtime).toBe(true)
    expect(r.vehicleLabel).toBeNull()
  })

  it('falls back to schedule when the trip is absent', () => {
    const live: LiveIndex = { feedTimestamp: 0, trips: new Map(), alerts: [] }
    expect(applyRealtime(leg, live)).toEqual({
      departEpoch: depEpoch,
      arriveEpoch: arrEpoch,
      realtime: false,
      vehicleLabel: null,
      occupancy: null,
    })
  })

  it('uses schedule when live is null', () => {
    const r = applyRealtime(leg, null)
    expect(r.departEpoch).toBe(depEpoch)
    expect(r.realtime).toBe(false)
  })
})
