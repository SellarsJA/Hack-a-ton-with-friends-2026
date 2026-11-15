import { beforeAll, describe, expect, it } from 'vitest'
import { DateTime } from 'luxon'
import type { Db } from '@/src/db/client'
import { findDirectCandidates, findNearbyStops } from '@/src/plan/query'
import { activeServiceDays, ZONE } from '@/src/time/edmonton'
import { walkMinutes } from '@/src/geo/geo'
import { makeTestDb } from '../helpers/pgliteDb'

const CHURCHILL = { lat: 53.5444, lon: -113.4909 }
const SOUTHGATE = { lat: 53.4855, lon: -113.5137 }

let db: Db
beforeAll(async () => {
  db = await makeTestDb()
})

const at = (iso: string) => activeServiceDays(DateTime.fromISO(iso, { zone: ZONE }))

describe('findNearbyStops', () => {
  it('returns nearest stops first with walk times', async () => {
    const s = await findNearbyStops(db, CHURCHILL)
    expect(s[0].stopId).toBe('1001')
    expect(s[0].distanceM).toBeLessThan(5)
    expect(s[0].walkSeconds).toBe(walkMinutes(s[0].distanceM) * 60)
    const wide = await findNearbyStops(db, CHURCHILL, 5000)
    expect(wide.map((x) => x.stopId)).toEqual(['1001', '1004', '1003'])
    expect(wide[1].walkSeconds).toBeGreaterThan(wide[0].walkSeconds)
    expect(s.map((x) => x.stopId)).not.toContain('2001')
  })

  it('returns [] when no stops are in range', async () => {
    expect(await findNearbyStops(db, { lat: 53.4, lon: -113.3 })).toEqual([])
  })
})

describe('findDirectCandidates', () => {
  it('finds trip A between Churchill and Southgate at 18:00', async () => {
    const o = await findNearbyStops(db, CHURCHILL, 300)
    const d = await findNearbyStops(db, SOUTHGATE, 300)
    const c = await findDirectCandidates(db, o, d, at('2026-11-14T18:00:00'))
    expect(c).toHaveLength(1)
    expect(c[0]).toMatchObject({
      tripId: 'A', serviceDate: '2026-11-14', routeId: 'R9', agencyId: '1',
      routeShortName: '9', routeType: 3, headsign: 'Southgate', shapeId: 'SH9',
    })
    expect(c[0].board).toMatchObject({ stopId: '1001', seq: 1, dep: 18 * 3600 + 600 })
    expect(c[0].alight).toMatchObject({ stopId: '1002', seq: 3, arr: 18 * 3600 + 1800 })
  })

  it('finds after-midnight trip D via yesterday service day', async () => {
    const o = await findNearbyStops(db, CHURCHILL, 300)
    const d = await findNearbyStops(db, SOUTHGATE, 300)
    const days = at('2026-11-15T00:30:00')
    expect(days[1].nowSeconds).toBe(88200)
    const c = await findDirectCandidates(db, o, d, days)
    expect(c).toHaveLength(1)
    expect(c[0].tripId).toBe('D')
    expect(c[0].serviceDate).toBe('2026-11-14')
    expect(c[0].alight.arr).toBe(25 * 3600 + 600)
  })

  it('still finds trip A at 18:05 when the rider is at the stop', async () => {
    const o = await findNearbyStops(db, CHURCHILL, 300)
    const d = await findNearbyStops(db, SOUTHGATE, 300)
    const c = await findDirectCandidates(db, o, d, at('2026-11-14T18:05:00'))
    expect(c.map((x) => x.tripId)).toEqual(['A'])
  })

  it('excludes trip A when the rider cannot walk to the stop in time', async () => {
    const far = { lat: 53.5498, lon: -113.4909 } // ~600 m north of stop 1001
    const o = await findNearbyStops(db, far, 800)
    expect(o.map((x) => x.stopId)).toContain('1001')
    expect(o.find((x) => x.stopId === '1001')!.walkSeconds).toBeGreaterThanOrEqual(540)
    const d = await findNearbyStops(db, SOUTHGATE, 300)
    expect(await findDirectCandidates(db, o, d, at('2026-11-14T18:09:00'))).toEqual([])
  })

  it('excludes trips departing more than 5400 s ahead', async () => {
    const o = await findNearbyStops(db, CHURCHILL, 300)
    const d = await findNearbyStops(db, SOUTHGATE, 300)
    expect(await findDirectCandidates(db, o, d, at('2026-11-14T16:30:00'))).toEqual([])
  })

  it('returns [] without querying when origin or dest is empty', async () => {
    const boom: Db = {
      query: () => {
        throw new Error('should not query')
      },
    }
    expect(await findDirectCandidates(boom, [], [], at('2026-11-14T18:00:00'))).toEqual([])
  })
})
