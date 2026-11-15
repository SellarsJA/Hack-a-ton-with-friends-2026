import { describe, expect, it, vi } from 'vitest'
import { assembleDirectOptions, assembleTransferOptions, mergeAndRank } from '@/src/plan/assemble'
import type { Candidate } from '@/src/plan/query'
import type { TransferCandidate } from '@/src/plan/queryTransfer'
import type { Departure } from '@/src/plan/departures'
import type { LiveIndex, TripLive } from '@/src/live/decode'
import { PlanResponse } from '@/src/contract/schema'
import { decodeLiveKey } from '@/src/plan/liveKey'
import { toInstant } from '@/src/time/edmonton'

const DATE = '2026-11-14'
const from = { lat: 53.54, lon: -113.49 }
const to = { lat: 53.48, lon: -113.51 }
const base = 12 * 3600
const nowEpoch = toInstant(DATE, base - 600).toSeconds()

const stop = (id: string, lat: number, lon: number, walk: number) => ({
  stopId: id, name: `Stop ${id}`, lat, lon, zone: '1EDM', distanceM: 0, walkSeconds: walk,
})

type TOpts = { spare?: number; walk?: number; type2?: number; type1?: number; dep1?: number }

/** first: A -> X arriving base+600; second: Y -> B departing `spare` minutes after the walk is covered. */
function tc(o: TOpts = {}): TransferCandidate {
  const walk = o.walk ?? 0
  const dep1 = o.dep1 ?? base
  const arr1 = dep1 + 600
  const dep2 = arr1 + walk + (o.spare ?? 10) * 60
  const mk = (id: string, route: string, type: number) => ({
    tripId: id, serviceDate: DATE, routeId: route, agencyId: '1', routeShortName: route, routeType: type, headsign: 'H', shapeId: null,
  })
  return {
    first: { ...mk('t1', 'r1', o.type1 ?? 3), board: { ...stop('A', 53.541, -113.49, 150), seq: 1, dep: dep1 }, alight: { ...stop('X', 53.51, -113.5, 0), seq: 4, arr: arr1 } },
    second: { ...mk('t2', 'r2', o.type2 ?? 3), board: { ...stop('Y', 53.5105, -113.5, 0), seq: 2, dep: dep2 }, alight: { ...stop('B', 53.481, -113.51, 150), seq: 7, arr: dep2 + 900 } },
    transferWalkSeconds: walk,
  }
}

const ctx = (live: LiveIndex | null = null, nd: (a: never) => Promise<Departure[]> = async () => []) => ({
  from, to, live, nowEpoch, shapes: new Map<string, [number, number][]>(), nextDepartures: nd as never,
})

describe('assembleTransferOptions', () => {
  it('builds legs, transfer, fare and a 2-leg live key; skips nextDepartures when not at risk', async () => {
    const nd = vi.fn(async () => [])
    const [o] = await assembleTransferOptions([tc({ walk: 180 })], ctx(null, nd))
    expect(o.legs.map((l) => l.mode)).toEqual(['walk', 'bus', 'walk', 'bus', 'walk'])
    const before = o.legs.flatMap((l) => (l.mode === 'walk' ? [] : [l.transferWalkMinutesBefore]))
    expect(before).toEqual([null, 3])
    expect(o.legs[2]).toMatchObject({ mode: 'walk', minutes: 3 })
    expect(o.transfer).toEqual({ stop: 'Stop Y', spareMinutes: 10, status: 'on_track', basedOn: 'scheduled', fallbackDepartAt: null })
    expect(nd).not.toHaveBeenCalled()
    expect(o.fare.amount).toBeGreaterThan(0)
    const key = decodeLiveKey(o.liveKey)!
    expect(key.tw).toBe(180)
    expect(key.legs.map((l) => l.t)).toEqual(['t1', 't2'])
    expect(key.legs[0]).toMatchObject({ bs: 'A', bq: 1, bt: base, as: 'X', aq: 4, at: base + 600, r: 'r1', rail: false })
    expect(PlanResponse.parse({ generatedAt: '2026-11-14T11:50:00-07:00', liveDataAgeSeconds: null, emptyReason: null, options: [o], vehicles: [] }).options).toHaveLength(1)
  })

  it('omits the walk-between leg when tw is 0 and the first walk when 0', async () => {
    const c = tc()
    c.first.board.walkSeconds = 0
    const [o] = await assembleTransferOptions([c], ctx())
    expect(o.legs.map((l) => l.mode)).toEqual(['bus', 'bus', 'walk'])
  })

  it('sets fallbackDepartAt only for at-risk, from nextDepartures', async () => {
    const fb = toInstant(DATE, base + 3000).toSeconds()
    const nd = vi.fn(async () => [{ tripId: 't3', serviceDate: DATE, routeId: 'r2', headsign: 'H', departEpoch: fb, realtime: false }])
    const [o] = await assembleTransferOptions([tc({ spare: -2 })], ctx(null, nd))
    expect(o.transfer!.status).toBe('at_risk')
    expect(o.transfer!.fallbackDepartAt).toBe('2026-11-14T12:50:00-07:00')
    expect(nd).toHaveBeenCalledWith({ stopId: 'Y', routeId: 'r2', afterEpoch: toInstant(DATE, base + 600).toSeconds(), limit: 1, live: null })
  })

  it('at-risk with no later departure gets a null fallback', async () => {
    const [o] = await assembleTransferOptions([tc({ spare: -2 })], ctx())
    expect(o.transfer!.fallbackDepartAt).toBeNull()
  })

  it('a rail leg forces basedOn scheduled even when the bus is live', async () => {
    const c = tc({ type2: 0 })
    const live: LiveIndex = {
      feedTimestamp: 0, alerts: [],
      trips: new Map([['t1', { startDate: DATE, stops: [{ stopId: 'A', stopSequence: 1, arrival: null, departure: null, delay: 0 }], vehicle: null }]]),
    }
    const [o] = await assembleTransferOptions([c], ctx(live))
    expect(o.transfer!.basedOn).toBe('scheduled')
    expect(o.legs.filter((l) => l.mode === 'rail')).toHaveLength(1)
  })

  it('basedOn is live when both bus legs are realtime', async () => {
    const c = tc()
    const mkTrip = (id: string, seq: number, stopId: string): [string, TripLive] => [id, { startDate: DATE, stops: [{ stopId, stopSequence: seq, arrival: null, departure: null, delay: 0 }], vehicle: null }]
    const live: LiveIndex = { feedTimestamp: 0, alerts: [], trips: new Map([mkTrip('t1', 1, 'A'), mkTrip('t2', 2, 'Y')]) }
    const [o] = await assembleTransferOptions([c], ctx(live))
    expect(o.transfer!.basedOn).toBe('live')
  })

  it('drops options whose first bus cannot be reached', async () => {
    const out = await assembleTransferOptions([tc({ dep1: base - 600 - 100 })], ctx())
    expect(out).toEqual([])
  })
})

describe('mergeAndRank', () => {
  const direct = async (route: string, dep: number, arr: number) => {
    const c: Candidate = {
      tripId: `d-${route}`, serviceDate: DATE, routeId: route, agencyId: '1', routeShortName: route, routeType: 3, headsign: 'H', shapeId: null,
      board: { ...stop('A', 53.541, -113.49, 150), seq: 1, dep },
      alight: { ...stop('B', 53.481, -113.51, 150), seq: 9, arr },
    }
    return assembleDirectOptions([c], ctx())
  }

  it('a tight transfer arriving 60 s earlier ranks after the direct option (60 < 120)', async () => {
    // direct: arrives base+1500+150 ; transfer: tight (spare 1), arrives 60 s earlier
    const d = await direct('9', base + 60, base + 1500)
    const t = await assembleTransferOptions([tc({ spare: 1 })], ctx())
    const directArrive = Date.parse(d[0].arriveAt) / 1000
    const tArrive = Date.parse(t[0].arriveAt) / 1000
    // adjust the transfer so it lands exactly 60 s before the direct one
    expect(t[0].transfer!.status).toBe('tight')
    const shifted = { ...t[0], arriveAt: new Date((directArrive - 60) * 1000).toISOString().replace('.000Z', 'Z') }
    expect(tArrive).not.toBeNaN()
    const merged = mergeAndRank(d, [shifted])
    expect(merged.map((o) => o.transfer?.status ?? 'direct')).toEqual(['direct', 'tight'])
  })

  const seqOf = (o: { legs: { mode: string; route?: string }[] }) =>
    o.legs.filter((l) => l.mode !== 'walk').map((l) => l.route).join('+')

  it('dedupes by route sequence, keeping the best', async () => {
    const t = await assembleTransferOptions([tc({ spare: 10 }), tc({ spare: 20 })], ctx())
    const d = await direct('9', base + 60, base + 1500)
    const merged = mergeAndRank(d, t)
    expect(merged.map(seqOf).sort()).toEqual(['9', 'r1+r2'])
    const kept = merged.find((o) => o.transfer)!
    expect(kept.transfer!.spareMinutes).toBe(10)
  })

  it('caps at 5 and re-ids', async () => {
    const ds = await Promise.all([1, 2, 3, 4, 5, 6].map((n) => direct(`r${n + 10}`, base + n * 60, base + n * 60 + 900)))
    const merged = mergeAndRank(ds.flat(), [])
    expect(merged.map((o) => o.id)).toEqual(['opt-1', 'opt-2', 'opt-3', 'opt-4', 'opt-5'])
  })
})
