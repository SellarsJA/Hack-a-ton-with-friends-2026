import { afterEach, describe, expect, it, vi } from 'vitest'
import { DateTime } from 'luxon'
import { NextRequest } from 'next/server'
import { planTrip, type PlanDeps } from '@/src/plan/plan'
import { searchIndex } from '@/src/plan/search'
import { PlanResponse, SearchResponse } from '@/src/contract/schema'
import { makeTestDb } from '../helpers/pgliteDb'
import { __resetLiveCacheForTests, getLiveIndex } from '@/src/live/cache'
import { ZONE } from '@/src/time/edmonton'
import type { NearbyStop, Candidate } from '@/src/plan/query'
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

  it('skips null shape ids when loading shapes', async () => {
    const loadShapes = vi.fn(async () => new Map<string, [number, number][]>())
    await planTrip(from, to, deps({ loadShapes }))
    expect(loadShapes).toHaveBeenCalledWith(expect.anything(), [])
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
    const { loadShapes } = await import('@/src/plan/plan')
    const r = await planTrip(from, to, {
      db, findNearbyStops, findDirectCandidates, loadShapes, getLiveIndex: () => getLiveIndex(), now: () => now,
    })
    expect(PlanResponse.parse(r).options.length).toBeGreaterThanOrEqual(1)
    const s = SearchResponse.parse(await searchIndex(db, 'churchill'))
    expect(s.stops.map((x) => x.stopId)).toContain('1001')
  })
})
