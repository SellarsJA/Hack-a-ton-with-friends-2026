import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { searchIndex } from '@/src/plan/search'
import { GET } from '@/app/api/search/route'
import { makeTestDb } from '../helpers/pgliteDb'

describe('search', () => {
  it('route returns empty for q=a', async () => {
    const res = await GET(new NextRequest('http://localhost/api/search?q=a'))
    expect(await res.json()).toEqual({ stops: [], routes: [] })
  })

  it('short query does not hit db', async () => {
    const query = vi.fn()
    expect(await searchIndex({ query }, ' a ')).toEqual({ stops: [], routes: [] })
    expect(query).not.toHaveBeenCalled()
  })

  it('finds stops and routes; escapes wildcards', async () => {
    const db = await makeTestDb()
    const r = await searchIndex(db, 'southgate')
    expect(r.stops.map((s) => s.stopId)).toContain('1002')
    expect(r.routes.map((x) => x.routeId)).toContain('R9')
    expect(await searchIndex(db, '%%')).toEqual({ stops: [], routes: [] })
  })
})
