import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { DateTime } from 'luxon'
import type { Db } from '@/src/db/client'
import { RouteDetail, RoutesResponse } from '@/src/contract/schema'
import { makeTestDb } from '../helpers/pgliteDb'

let db: Db
vi.mock('@/src/db/client', () => ({ getDb: () => db }))
vi.mock('@/src/live/cache', () => ({ getLiveIndex: async () => null }))

beforeAll(async () => {
  db = await makeTestDb()
}, 60000)
afterEach(() => vi.restoreAllMocks())

describe('routes handlers end to end on gtfs-mini', () => {
  it('GET /api/routes lists the 4 routes with the cache header', async () => {
    const { GET } = await import('@/app/api/routes/route')
    const res = await GET(new NextRequest('http://localhost/api/routes'))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600')
    const body = RoutesResponse.parse(await res.json())
    expect(body.routes).toHaveLength(4)
  })

  it('GET /api/routes/R9?stop=1001 returns the pattern and trip A departure', async () => {
    const now = DateTime.fromISO('2026-11-14T18:00:00', { zone: 'America/Edmonton' }).toMillis()
    vi.spyOn(Date, 'now').mockReturnValue(now)
    const { GET } = await import('@/app/api/routes/[id]/route')
    const res = await GET(new NextRequest('http://localhost/api/routes/R9?stop=1001'), {
      params: Promise.resolve({ id: 'R9' }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = RouteDetail.parse(await res.json())
    expect(body.patterns).toHaveLength(1)
    expect(body.departures.map((d) => d.tripId)).toContain('A')
  })
})
