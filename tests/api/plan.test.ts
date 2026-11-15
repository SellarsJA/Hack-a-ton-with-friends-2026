import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DateTime } from 'luxon'
import { NextRequest } from 'next/server'
import { planTrip, type PlanDeps } from '@/src/plan/plan'
import { searchIndex } from '@/src/plan/search'
import { PlanResponse, SearchResponse } from '@/src/contract/schema'
import { decodeLiveKey } from '@/src/plan/liveKey'
import { makeTestDb } from '../helpers/pgliteDb'
import { __resetLiveCacheForTests, getLiveIndex } from '@/src/live/cache'
import { ZONE } from '@/src/time/edmonton'
import type { NearbyStop, Candidate } from '@/src/plan/query'
import type { TransferCandidate } from '@/src/plan/queryTransfer'
import type { LiveIndex } from '@/src/live/decode'

const from = { lat: 53.5444, lon: -113.4909 }
const to = { lat: 53.4855, lon: -113.5137 }
const now = DateTime.fromISO('2026-11-14T18:00:00', { zone: ZONE })

const stop = (id: string, lat: number, lon: number): NearbyStop => ({
  stopId: id, name: `Stop ${id}`, lat, lon, zone: '1EDM', distanceM: 100, walkSeconds: 120,
})
const cand: Candidate = {
  tripId: 't1', serviceDate: '2026-11-14', routeId: 'R9', agencyId: '1', routeShortName: '9', routeType: 3,
  headsign: 'Downtown', shapeId: null,
  board: { ...stop('A', from.lat, from.lon), seq: 1, dep: 18 * 3600 + 600 },
  alight: { ...stop('B', to.lat, to.lon), seq: 5, arr: 18 * 3600 + 1500 },
}

function deps(o: Partial<PlanDeps> = {}): PlanDeps {
  return {
    db: { query: async () => [] },
    findNearbyStops: async (_db, p) => [stop(p === from ? 'A' : 'B', p.lat, p.lon)],
    findDirectCandidates: async () => [cand],
    findTransferCandidates: async () => [],
    nextDepartures: async () => [],
    loadShapes: async () => new Map(),
    getLiveIndex: async () => null,
    now: () => now,
    ...o,
  }
}

describe('planTrip', () => {
  it('happy path matches contract', async () => {
    const r = await planTrip(from, to, deps())
    expect(PlanResponse.parse(r).options.length).toBeGreaterThan(0)
    expect(r.emptyReason).toBeNull()
  })

  it('no destination stops -> no_stops_near_end', async () => {
    const r = await planTrip(from, to, deps({
      findNearbyStops: async (_db, p) => (p === from ? [stop('A', p.lat, p.lon)] : []),
    }))
    expect(r.emptyReason).toBe('no_stops_near_end')
    expect(r.options).toEqual([])
  })

  it('no origin stops -> no_stops_near_start', async () => {
    const r = await planTrip(from, to, deps({
      findNearbyStops: async (_db, p) => (p === to ? [stop('B', p.lat, p.lon)] : []),
    }))
    expect(r.emptyReason).toBe('no_stops_near_start')
  })

  it('no candidates -> no_trips_soon', async () => {
    const r = await planTrip(from, to, deps({ findDirectCandidates: async () => [] }))
    expect(r.emptyReason).toBe('no_trips_soon')
  })

  it('null live index still returns scheduled options', async () => {
    const r = await planTrip(from, to, deps({ getLiveIndex: async () => null }))
    expect(r.liveDataAgeSeconds).toBeNull()
    expect(r.options.length).toBeGreaterThan(0)
    for (const o of r.options) for (const l of o.legs) if (l.mode !== 'walk') expect(l.realtime).toBe(false)
  })

  it('rejecting live index degrades to scheduled options', async () => {
    const r = await planTrip(from, to, deps({ getLiveIndex: async () => { throw new Error('feed down') } }))
    expect(PlanResponse.parse(r).options.length).toBeGreaterThan(0)
    expect(r.liveDataAgeSeconds).toBeNull()
    for (const o of r.options) for (const l of o.legs) if (l.mode !== 'walk') expect(l.realtime).toBe(false)
  })

  it('computes live data age from feed timestamp', async () => {
    const live: LiveIndex = { feedTimestamp: now.toSeconds() - 30, trips: new Map(), alerts: [] }
    const r = await planTrip(from, to, deps({ getLiveIndex: async () => live }))
    expect(r.liveDataAgeSeconds).toBe(30)
  })

  it('returns route vehicles and each transit leg vehiclePosition', async () => {
    const live: LiveIndex = {
      feedTimestamp: now.toSeconds() - 5,
      alerts: [],
      trips: new Map([
        ['t1', { startDate: '2026-11-14', stops: [], vehicle: { label: '4393', lat: 53.5, lon: -113.5, occupancy: null, routeId: 'R9' } }],
        ['other', { startDate: '2026-11-14', stops: [], vehicle: { label: '9', lat: 1, lon: 2, occupancy: null, routeId: 'R77' } }],
      ]),
    }
    const r = PlanResponse.parse(await planTrip(from, to, deps({ getLiveIndex: async () => live })))
    expect(r.vehicles.map((v) => v.label)).toEqual(['4393'])
    for (const l of r.options[0].legs) {
      if (l.mode !== 'walk') expect(l.vehiclePosition).toEqual({ lat: 53.5, lon: -113.5 })
    }
  })

  it('skips null shape ids when loading shapes', async () => {
    const loadShapes = vi.fn(async () => new Map<string, [number, number][]>())
    await planTrip(from, to, deps({ loadShapes }))
    expect(loadShapes).toHaveBeenCalledWith(expect.anything(), [])
  })
})

/** Ten at-risk transfers, each on its own route pair, all ranked after `cand` (the direct trip). */
const atRisk = (n = 10): TransferCandidate[] =>
  Array.from({ length: n }, (_, i) => {
    const dep1 = 18 * 3600 + 600 + i * 60
    const arr1 = dep1 + 600
    const dep2 = arr1 - 60
    const mk = (id: string) => ({
      tripId: id, serviceDate: '2026-11-14', routeId: id.toUpperCase(), agencyId: '1', routeShortName: id.toUpperCase(),
      routeType: 3, headsign: 'H', shapeId: `sh-${id}`,
    })
    return {
      first: { ...mk(`f${i}`), board: { ...stop('A', from.lat, from.lon), seq: 1, dep: dep1 }, alight: { ...stop('X', 53.51, -113.5), walkSeconds: 0, seq: 4, arr: arr1 } },
      second: { ...mk(`s${i}`), board: { ...stop('Y', 53.5101, -113.5), walkSeconds: 0, seq: 2, dep: dep2 }, alight: { ...stop('B', to.lat, to.lon), seq: 7, arr: dep2 + 900 } },
      transferWalkSeconds: 0,
    }
  })

const tripsOf = (o: PlanResponse['options'][number]) => decodeLiveKey(o.liveKey)!.legs.map((l) => l.t)

describe('planTrip transfer path', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('a rejecting transfer query still returns the direct options', async () => {
    const r = await planTrip(from, to, deps({ findTransferCandidates: async () => { throw new Error('stop_links missing') } }))
    expect(PlanResponse.parse(r).options.map(tripsOf)).toEqual([['t1']])
    expect(r.emptyReason).toBeNull()
  })

  it('a rejecting fallback lookup keeps the at-risk option with a null fallback', async () => {
    const r = PlanResponse.parse(await planTrip(from, to, deps({
      findDirectCandidates: async () => [],
      findTransferCandidates: async () => atRisk(1),
      nextDepartures: async () => { throw new Error('db down') },
    })))
    expect(r.options).toHaveLength(1)
    expect(r.options[0].transfer).toMatchObject({ status: 'at_risk', fallbackDepartAt: null })
  })

  it('looks up fallbacks only for at-risk options that survive ranking', async () => {
    const nextDepartures = vi.fn(async () => [])
    const r = PlanResponse.parse(await planTrip(from, to, deps({ findTransferCandidates: async () => atRisk(10), nextDepartures })))
    expect(r.options).toHaveLength(5)
    const survivors = r.options.filter((o) => o.transfer?.status === 'at_risk').length
    expect(survivors).toBe(4)
    expect(nextDepartures).toHaveBeenCalledTimes(survivors)
  })

  it('loads shapes once, only for the final options', async () => {
    const loadShapes = vi.fn(async () => new Map<string, [number, number][]>())
    const direct = { ...cand, shapeId: 'sh-t1' }
    const r = PlanResponse.parse(await planTrip(from, to, deps({
      findDirectCandidates: async () => [direct],
      findTransferCandidates: async () => atRisk(10),
      loadShapes,
    })))
    expect(loadShapes).toHaveBeenCalledTimes(1)
    const want = r.options.flatMap(tripsOf).map((t) => `sh-${t}`)
    expect(want).toHaveLength(9)
    const calls = loadShapes.mock.calls as unknown as [unknown, string[]][]
    expect([...calls[0][1]].sort()).toEqual([...want].sort())
  })
})

describe('route handlers', () => {
  it('plan returns 400 for bad coordinates', async () => {
    const { GET } = await import('@/app/api/plan/route')
    const res = await GET(new NextRequest('http://localhost/api/plan?from=abc&to=53.5,-113.5'))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'bad_coordinates' })
  })

  it('plan returns fixture with fixture=1', async () => {
    const { GET } = await import('@/app/api/plan/route')
    const res = await GET(new NextRequest('http://localhost/api/plan?fixture=1'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    PlanResponse.parse(await res.json())
  })
})

describe('smoke (gtfs-mini)', () => {
  const prev = process.env.LIVE_SOURCE
  afterEach(() => {
    if (prev === undefined) delete process.env.LIVE_SOURCE
    else process.env.LIVE_SOURCE = prev
    __resetLiveCacheForTests()
  })

  it('plans a real trip and searches stops', async () => {
    process.env.LIVE_SOURCE = 'snapshot'
    __resetLiveCacheForTests()
    const db = await makeTestDb()
    const { findNearbyStops, findDirectCandidates } = await import('@/src/plan/query')
    const { findTransferCandidates } = await import('@/src/plan/queryTransfer')
    const { nextDepartures } = await import('@/src/plan/departures')
    const { loadShapes } = await import('@/src/plan/plan')
    const r = await planTrip(from, to, {
      db, findNearbyStops, findDirectCandidates, findTransferCandidates, nextDepartures, loadShapes,
      getLiveIndex: () => getLiveIndex(), now: () => now,
    })
    expect(PlanResponse.parse(r).options.length).toBeGreaterThanOrEqual(1)
    const s = SearchResponse.parse(await searchIndex(db, 'churchill'))
    expect(s.stops.map((x) => x.stopId)).toContain('1001')
  })

  it('drops trip A at 18:09 from ~600 m away when it is not late (excluded in assembly)', async () => {
    const db = await makeTestDb()
    const { findNearbyStops, findDirectCandidates } = await import('@/src/plan/query')
    const { findTransferCandidates } = await import('@/src/plan/queryTransfer')
    const { nextDepartures } = await import('@/src/plan/departures')
    const { loadShapes } = await import('@/src/plan/plan')
    const far = { lat: 53.5498, lon: -113.4909 }
    const base = { db, findNearbyStops, findDirectCandidates, findTransferCandidates, nextDepartures, loadShapes, getLiveIndex: async () => null }
    const at = (iso: string) => () => DateTime.fromISO(iso, { zone: ZONE })
    const missed = await planTrip(far, to, { ...base, now: at('2026-11-14T18:09:00') })
    expect(PlanResponse.parse(missed).emptyReason).toBe('no_trips_soon')
    const caught = await planTrip(far, to, { ...base, now: at('2026-11-14T17:59:00') })
    expect(PlanResponse.parse(caught).options.filter((o) => o.transfer === null).map((o) => o.legs.find((l) => l.mode !== 'walk')!.tripId)).toEqual(['A'])
  })

  async function realDeps() {
    const db = await makeTestDb()
    const { findNearbyStops, findDirectCandidates } = await import('@/src/plan/query')
    const { findTransferCandidates } = await import('@/src/plan/queryTransfer')
    const { nextDepartures } = await import('@/src/plan/departures')
    const { loadShapes } = await import('@/src/plan/plan')
    return { db, findNearbyStops, findDirectCandidates, findTransferCandidates, nextDepartures, loadShapes, getLiveIndex: async () => null, now: () => now }
  }

  it('slices the fixture shape into each route 9 leg (Southgate, Mill Woods, Valley Line South)', async () => {
    const d = await realDeps()
    for (const dest of [to, { lat: 53.457, lon: -113.428 }, { lat: 53.462, lon: -113.45 }]) {
      const r = PlanResponse.parse(await planTrip(from, dest, d))
      const nine = r.options.flatMap((o) => o.legs).filter((l) => l.mode !== 'walk' && l.route === '9')
      expect(nine.length).toBeGreaterThan(0)
      for (const l of nine) expect(l.path.length).toBeGreaterThan(2)
    }
  })

  it('offers the A>E transfer from Churchill to Mill Woods', async () => {
    const r = PlanResponse.parse(await planTrip(from, { lat: 53.457, lon: -113.428 }, await realDeps()))
    const o = r.options.find((x) => x.legs.some((l) => l.mode !== 'walk' && l.tripId === 'E'))!
    expect(o.transfer).not.toBeNull()
    const key = decodeLiveKey(o.liveKey)!
    expect(key.legs.map((l) => l.t)).toEqual(['A', 'E'])
  })

  it('offers the A>F transfer with a 3 minute walk and a scheduled rail leg', async () => {
    const r = PlanResponse.parse(await planTrip(from, { lat: 53.462, lon: -113.45 }, await realDeps()))
    const o = r.options.find((x) => x.legs.some((l) => l.mode !== 'walk' && l.tripId === 'F'))!
    expect(o.legs.map((l) => l.mode)).toContain('rail')
    const walkBetween = o.legs.find((l, i) => l.mode === 'walk' && i > 0 && i < o.legs.length - 1)!
    expect(walkBetween).toMatchObject({ mode: 'walk', minutes: 3 })
    expect(o.legs.filter((l) => l.mode !== 'walk').at(-1)).toMatchObject({ mode: 'rail', transferWalkMinutesBefore: 3 })
    expect(o.transfer!.basedOn).toBe('scheduled')
  })
})
