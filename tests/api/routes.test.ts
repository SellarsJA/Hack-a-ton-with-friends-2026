import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { RouteDetail, RoutesResponse } from '@/src/contract/schema'

const getDb = vi.fn<() => unknown>()
vi.mock('@/src/db/client', () => ({ getDb: () => getDb() }))
vi.mock('@/src/live/cache', () => ({ getLiveIndex: async () => null }))

const list = async (qs = '') => {
  const { GET } = await import('@/app/api/routes/route')
  return GET(new NextRequest(`http://localhost/api/routes${qs}`))
}
const detail = async (id: string, qs = '') => {
  const { GET } = await import('@/app/api/routes/[id]/route')
  return GET(new NextRequest(`http://localhost/api/routes/${id}${qs}`), { params: Promise.resolve({ id }) })
}

const routeRows = [{ route_id: 'R9', agency_id: '1', short_name: '9', long_name: 'L', route_type: 3, color: null }]

beforeEach(() => {
  getDb.mockReset()
  getDb.mockReturnValue({ query: async () => routeRows })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('GET /api/routes', () => {
  it('lists routes with a 1 hour cache header', async () => {
    const res = await list()
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600')
    const body = RoutesResponse.parse(await res.json())
    expect(body.routes[0]).toMatchObject({ routeId: 'R9', group: 'bus' })
  })
  it('serves the fixture', async () => {
    const res = await list('?fixture=1')
    expect(RoutesResponse.safeParse(await res.json()).success).toBe(true)
    expect(getDb).not.toHaveBeenCalled()
  })
  it('returns 500 server_error on DB failure', async () => {
    getDb.mockReturnValue({ query: async () => Promise.reject(new Error('x')) })
    const res = await list()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'server_error' })
  })
})

describe('GET /api/routes/:id', () => {
  it('serves the fixture with no-store', async () => {
    const res = await detail('9', '?fixture=1')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(RouteDetail.safeParse(await res.json()).success).toBe(true)
  })
  it('404s an unknown route', async () => {
    getDb.mockReturnValue({ query: async () => [] })
    const res = await detail('NOPE')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'unknown_route' })
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
  it('404s a malformed id and 400s a malformed stop', async () => {
    expect((await detail('a b')).status).toBe(404)
    expect((await detail('x'.repeat(65))).status).toBe(404)
    const bad = await detail('R9', '?stop=' + encodeURIComponent('1;drop'))
    expect(bad.status).toBe(400)
    expect(await bad.json()).toEqual({ error: 'bad_stop' })
    expect((await detail('R9', '?stop=')).status).toBe(400)
  })
  it('returns 500 server_error when the route lookup fails', async () => {
    getDb.mockReturnValue({ query: async () => Promise.reject(new Error('x')) })
    const res = await detail('R9')
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'server_error' })
  })
})
