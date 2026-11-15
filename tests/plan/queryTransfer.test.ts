import { beforeAll, describe, expect, it } from 'vitest'
import { DateTime } from 'luxon'
import type { Db } from '@/src/db/client'
import { findNearbyStops } from '@/src/plan/query'
import { findTransferCandidates } from '@/src/plan/queryTransfer'
import { activeServiceDays, ZONE } from '@/src/time/edmonton'
import { makeTestDb } from '../helpers/pgliteDb'

const CHURCHILL = { lat: 53.5444, lon: -113.4909 }
const MILL_WOODS = { lat: 53.457, lon: -113.428 }
const VALLEY_SOUTH = { lat: 53.462, lon: -113.45 }

let db: Db
beforeAll(async () => {
  db = await makeTestDb()
})

const at = (iso: string) => activeServiceDays(DateTime.fromISO(iso, { zone: ZONE }))
const pairs = (c: { first: { tripId: string }; second: { tripId: string } }[]) =>
  c.map((x) => `${x.first.tripId}>${x.second.tripId}`)

describe('findTransferCandidates', () => {
  it('connects A to E through the shared stop with no walk', async () => {
    const o = await findNearbyStops(db, CHURCHILL, 300)
    const d = await findNearbyStops(db, MILL_WOODS, 300)
    const c = await findTransferCandidates(db, o, d, at('2026-11-14T18:00:00'))
    // G (same route as A) and H (30 s after A arrives) must not appear
    expect(pairs(c)).toEqual(['A>E'])
    expect(c[0].transferWalkSeconds).toBe(0)
    expect(c[0].first).toMatchObject({ routeId: 'R9', serviceDate: '2026-11-14', headsign: 'Southgate', shapeId: 'SH9' })
    expect(c[0].first.board).toMatchObject({ stopId: '1001', seq: 1, dep: 18 * 3600 + 600 })
    expect(c[0].first.alight).toMatchObject({
      stopId: '1003', name: 'Whyte Ave & 104 St', zone: '1EDM', seq: 2, arr: 18 * 3600 + 1200, distanceM: 0, walkSeconds: 0,
    })
    expect(c[0].second).toMatchObject({ routeId: 'R4', routeShortName: '4', routeType: 3, headsign: 'Mill Woods', shapeId: null })
    expect(c[0].second.board).toMatchObject({
      stopId: '1003', name: 'Whyte Ave & 104 St', zone: '1EDM', seq: 1, dep: 18 * 3600 + 1500, distanceM: 0, walkSeconds: 0,
    })
    expect(c[0].second.alight).toMatchObject({ stopId: '1007', seq: 2, arr: 18 * 3600 + 2700 })
    expect(c[0].second.alight.walkSeconds).toBe(d.find((s) => s.stopId === '1007')!.walkSeconds)
  })

  it('connects A to the LRT through a linked stop with a 180 s walk', async () => {
    const o = await findNearbyStops(db, CHURCHILL, 300)
    const d = await findNearbyStops(db, VALLEY_SOUTH, 300)
    const c = await findTransferCandidates(db, o, d, at('2026-11-14T18:00:00'))
    expect(pairs(c)).toEqual(['A>F'])
    expect(c[0].transferWalkSeconds).toBe(180)
    expect(c[0].first.alight).toMatchObject({ stopId: '1002', name: 'Southgate Transit Centre' })
    expect(c[0].second.board).toMatchObject({ stopId: '1005', name: 'Southgate LRT Platform' })
    expect(c[0].second).toMatchObject({ routeId: 'RVL', routeType: 0 })
  })

  it('never offers two trips of the same route as a transfer', async () => {
    const o = await findNearbyStops(db, CHURCHILL, 300)
    const d = await findNearbyStops(db, MILL_WOODS, 300)
    const c = await findTransferCandidates(db, o, d, at('2026-11-14T18:00:00'))
    expect(pairs(c)).not.toContain('A>G')
    expect(c.every((x) => x.first.routeId !== x.second.routeId)).toBe(true)
  })

  it('excludes a second leg leaving 30 s after the first arrives', async () => {
    const o = await findNearbyStops(db, CHURCHILL, 300)
    const d = await findNearbyStops(db, MILL_WOODS, 300)
    const c = await findTransferCandidates(db, o, d, at('2026-11-14T18:00:00'))
    expect(pairs(c)).not.toContain('A>H')
  })

  it('ranks by door-to-door arrival before limiting, not by trip id', async () => {
    const o = await findNearbyStops(db, CHURCHILL, 300)
    const mw = await findNearbyStops(db, MILL_WOODS, 300)
    const vs = await findNearbyStops(db, VALLEY_SOUTH, 300)
    const days = at('2026-11-14T18:00:00')
    // sanity: with plain walks, E arrives first and is also lexically first
    expect(pairs(await findTransferCandidates(db, o, [...mw, ...vs], days))).toEqual(['A>E', 'A>F'])
    // a long walk from Mill Woods makes F (A>F) the fastest even though E sorts first
    const slowMw = mw.map((s) => ({ ...s, walkSeconds: 3000 }))
    const all = await findTransferCandidates(db, o, [...slowMw, ...vs], days)
    expect(pairs(all)).toEqual(['A>F', 'A>E'])
    expect(pairs(await findTransferCandidates(db, o, [...slowMw, ...vs], days, 1))).toEqual(['A>F'])
  })

  it('keeps the transfer point with more spare time for the same trip pair', async () => {
    const o = await findNearbyStops(db, CHURCHILL, 300)
    const d = await findNearbyStops(db, { lat: 53.4891, lon: -113.5137 }, 100) // Far Stop 1006
    expect(d.map((s) => s.stopId)).toEqual(['1006'])
    const c = await findTransferCandidates(db, o, d, at('2026-11-14T18:00:00'))
    // A>J can transfer at 1003 (spare 300 s) or 1002 (spare 600 s): same door-to-door time
    expect(pairs(c)).toEqual(['A>J'])
    expect(c[0].first.alight.stopId).toBe('1002')
    expect(c[0].second.board).toMatchObject({ stopId: '1002', dep: 18 * 3600 + 2400 })
    expect(c[0].transferWalkSeconds).toBe(0)
  })

  it('returns [] without querying when origin, dest or days is empty', async () => {
    const boom: Db = {
      query: () => {
        throw new Error('should not query')
      },
    }
    const o = await findNearbyStops(db, CHURCHILL, 300)
    const days = at('2026-11-14T18:00:00')
    expect(await findTransferCandidates(boom, [], o, days)).toEqual([])
    expect(await findTransferCandidates(boom, o, [], days)).toEqual([])
    expect(await findTransferCandidates(boom, o, o, [])).toEqual([])
  })
})
