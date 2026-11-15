import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/src/plan/plan', () => ({
  planTrip: vi.fn(async () => {
    throw new Error('boom')
  }),
}))
vi.mock('@/src/plan/search', async (orig) => ({
  ...(await orig<typeof import('@/src/plan/search')>()),
  searchIndex: vi.fn(async () => {
    throw new Error('boom')
  }),
}))
vi.mock('@/src/db/client', () => ({ getDb: () => ({ query: async () => [] }) }))

import { GET as planGet } from '@/app/api/plan/route'
import { GET as searchGet } from '@/app/api/search/route'

describe('500 paths', () => {
  let spy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    spy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => spy.mockRestore())

  it('plan returns 500 server_error', async () => {
    const res = await planGet(new NextRequest('http://localhost/api/plan?from=53.54,-113.49&to=53.48,-113.51'))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'server_error' })
    expect(spy).toHaveBeenCalled()
  })

  it('search returns 500 server_error', async () => {
    const res = await searchGet(new NextRequest('http://localhost/api/search?q=abc'))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'server_error' })
    expect(spy).toHaveBeenCalled()
  })
})
