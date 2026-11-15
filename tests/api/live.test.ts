import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { LiveResponse } from '@/src/contract/schema'
import { encodeLiveKey, type LiveKeyLeg } from '@/src/plan/liveKey'
import type { LiveIndex } from '@/src/live/decode'

const getLiveIndex = vi.fn<() => Promise<LiveIndex | null>>()
vi.mock('@/src/live/cache', () => ({ getLiveIndex: () => getLiveIndex() }))
vi.mock('@/src/db/client', () => ({ getDb: () => ({ query: async () => [] }) }))

const leg: LiveKeyLeg = { t: 'A', d: '2026-11-14', bs: 'S1', bq: 1, bt: 65400, as: 'S2', aq: 2, at: 66000, r: 'R9', rail: false }
const key = encodeLiveKey({ legs: [leg], tw: null })
const call = async (qs: string) => {
  const { GET } = await import('@/app/api/live/route')
  return GET(new NextRequest(`http://localhost/api/live${qs}`))
}

beforeEach(() => {
  getLiveIndex.mockReset()
  getLiveIndex.mockResolvedValue(null)
})

describe('GET /api/live', () => {
  it('rejects undecodable keys with bad_key', async () => {
    for (const qs of ['?keys=%%%', '?keys=', '', `?keys=${key},xyz`]) {
      const res = await call(qs)
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'bad_key' })
    }
  })

  it('rejects more than 5 keys', async () => {
    const res = await call(`?keys=${Array(6).fill(key).join(',')}`)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'too_many_keys' })
  })

  it('happy path matches the contract and is no-store', async () => {
    const live: LiveIndex = {
      feedTimestamp: Date.now() / 1000 - 20,
      alerts: [],
      trips: new Map([['V1', { startDate: null, stops: [], vehicle: { label: '4393', lat: 53.5, lon: -113.5, occupancy: null, routeId: 'R9' } }]]),
    }
    getLiveIndex.mockResolvedValue(live)
    const res = await call(`?keys=${key}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    const body = LiveResponse.parse(await res.json())
    expect(body.options).toHaveLength(1)
    expect(body.options[0].expired).toBe(true)
    expect(body.vehicles.map((v) => v.label)).toEqual(['4393'])
    expect(body.liveDataAgeSeconds).toBeGreaterThanOrEqual(20)
  })

  it('degrades to a null live index when the feed throws', async () => {
    getLiveIndex.mockRejectedValue(new Error('down'))
    const res = await call(`?keys=${key}`)
    expect(res.status).toBe(200)
    const body = LiveResponse.parse(await res.json())
    expect(body.liveDataAgeSeconds).toBeNull()
    expect(body.vehicles).toEqual([])
  })

  it('serves the fixture', async () => {
    const res = await call('?fixture=1')
    LiveResponse.parse(await res.json())
  })
})
