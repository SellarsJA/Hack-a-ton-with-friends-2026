import { describe, expect, it } from 'vitest'
import { assembleDirectOptions } from '@/src/plan/assemble'
import type { Candidate } from '@/src/plan/query'
import type { LiveIndex } from '@/src/live/decode'
import { Option } from '@/src/contract/schema'
import { toInstant } from '@/src/time/edmonton'

const DATE = '2026-11-14'
const from = { lat: 53.54, lon: -113.49 }
const to = { lat: 53.48, lon: -113.51 }
const base = 12 * 3600
const nowEpoch = toInstant(DATE, base - 600).toSeconds()

const stop = (id: string, lat: number, lon: number) => ({
  stopId: id, name: `Stop ${id}`, lat, lon, zone: '1EDM', distanceM: 200, walkSeconds: 150,
})

function cand(n: number, o: { route?: string; dep?: number; arr?: number; type?: number } = {}): Candidate {
  const dep = o.dep ?? base + n * 60
  return {
    tripId: `t${n}`,
    serviceDate: DATE,
    routeId: o.route ?? `r${n}`,
    agencyId: '1',
    routeShortName: o.route ?? `r${n}`,
    routeType: o.type ?? 3,
    headsign: 'Downtown',
    shapeId: null,
    board: { ...stop('A', 53.541, -113.49), seq: 2, dep },
    alight: { ...stop('B', 53.481, -113.51), seq: 8, arr: o.arr ?? dep + 900 },
  }
}

const ctx = (live: LiveIndex | null = null) => ({ from, to, live, nowEpoch, shapes: new Map<string, [number, number][]>() })

describe('assembleDirectOptions', () => {
  it('drops candidates whose live departure is already past', () => {
    const c = cand(1)
    const live: LiveIndex = {
      feedTimestamp: 0,
      trips: new Map([[c.tripId, {
        stops: [{ stopSequence: 2, stopId: 'A', arrival: null, departure: nowEpoch - 60, delay: null }],
        vehicle: null,
      }]]),
      alerts: [],
    }
    // scheduled departure is in the future, so only the live time drops it
    expect(assembleDirectOptions([c], ctx(null))).toHaveLength(1)
    expect(assembleDirectOptions([c], ctx(live))).toEqual([])
  })

  it('keeps the best option per route/headsign, best first', () => {
    const cands = [
      cand(1, { route: 'a', arr: base + 2000 }),
      cand(2, { route: 'a', arr: base + 1500 }),
      cand(3, { route: 'a', arr: base + 1800 }),
      cand(4, { route: 'b', arr: base + 1000 }),
      cand(5, { route: 'b', arr: base + 1900 }),
      cand(6, { route: 'c', arr: base + 1700 }),
      cand(7, { route: 'c', arr: base + 2500 }),
    ]
    const opts = assembleDirectOptions(cands, ctx())
    expect(opts.map((o) => o.id)).toEqual(['opt-1', 'opt-2', 'opt-3'])
    const routes = opts.map((o) => (o.legs[1] as { route: string }).route)
    expect(routes).toEqual(['b', 'a', 'c'])
  })

  it('caps at 5 options', () => {
    const cands = Array.from({ length: 10 }, (_, i) => cand(i + 1))
    expect(assembleDirectOptions(cands, ctx())).toHaveLength(5)
  })

  it('produces schema-valid options with walk, transit, walk legs', () => {
    const [o] = assembleDirectOptions([cand(1)], ctx())
    expect(() => Option.parse(o)).not.toThrow()
    expect(o.legs.map((l) => l.mode)).toEqual(['walk', 'bus', 'walk'])
    // dep = 12:01:00, minus 150 s walk
    expect(o.leaveAt).toBe('2026-11-14T11:58:30-07:00')
    expect(o.durationMinutes).toBe(Math.ceil((150 + 900 + 150) / 60))
    expect(o.fare.amount).toBeGreaterThan(0)
  })

  it('maps routeType 0 to rail', () => {
    const [o] = assembleDirectOptions([cand(1, { type: 0 })], ctx())
    expect(o.legs[1].mode).toBe('rail')
  })

  it('attaches alerts for the route, deduplicated', () => {
    const live: LiveIndex = {
      feedTimestamp: 0,
      trips: new Map(),
      alerts: [
        { headline: 'Detour', routeIds: ['r1'], stopIds: [], tripIds: [] },
        { headline: 'Detour', routeIds: [], stopIds: ['B'], tripIds: [] },
        { headline: 'Other', routeIds: ['zzz'], stopIds: [], tripIds: [] },
      ],
    }
    const [o] = assembleDirectOptions([cand(1)], ctx(live))
    expect(o.alerts).toEqual([{ headline: 'Detour' }])
  })
})
