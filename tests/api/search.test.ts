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

  it('lists each name once, stations first, then transit centres, then prefix matches', async () => {
    const db = await makeTestDb()
    const rows: [string, string][] = [
      ['z1', 'Aaa Zed Road'],
      ['z2', 'Zed Station Drive & 1 Avenue'],
      ['z3', 'Zed Station'],
      ['z4', 'Zed Station'],
      ['z5', 'Zed Transit Centre'],
      ['z6', 'Zed Stop'],
    ]
    for (const [id, name] of rows)
      await db.query(`insert into stops (stop_id, name, lat, lon) values ($1, $2, 53.5, -113.5)`, [id, name])
    const r = await searchIndex(db, 'zed')
    expect(r.stops.map((s) => s.name)).toEqual([
      'Zed Station',
      'Zed Stop',
      'Zed Transit Centre',
      'Zed Station Drive & 1 Avenue',
      'Aaa Zed Road',
    ])
    expect(r.stops[0].stopId).toBe('z3')
  })
})
