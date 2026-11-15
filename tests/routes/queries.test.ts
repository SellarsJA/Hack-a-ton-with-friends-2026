import { beforeAll, describe, expect, it } from 'vitest'
import { DateTime } from 'luxon'
import type { Db } from '@/src/db/client'
import { compareRoutes, listRoutes, routeDetail } from '@/src/routes/queries'
import { RouteDetail } from '@/src/contract/schema'
import type { LiveIndex } from '@/src/live/decode'
import { makeTestDb } from '../helpers/pgliteDb'

const at = (iso: string) => DateTime.fromISO(iso, { zone: 'America/Edmonton' }).toSeconds()
const NOW = at('2026-11-14T18:00:00') // gtfs-mini service date 2026-11-14
const noLive = { getLiveIndex: async () => null }

let db: Db
beforeAll(async () => {
  db = await makeTestDb()
}, 60000)

describe('compareRoutes', () => {
  const sorted = (names: string[]) =>
    names.map((shortName) => ({ shortName })).sort(compareRoutes).map((r) => r.shortName)
  it('sorts numeric names numerically, then the rest alphabetically', () => {
    expect(sorted(['Valley', '10', 'Capital', '2', '9'])).toEqual(['2', '9', '10', 'Capital', 'Valley'])
  })
})

describe('listRoutes', () => {
  it('groups rail, regional and bus, and sorts', async () => {
    const routes = await listRoutes(db)
    const byId = Object.fromEntries(routes.map((r) => [r.routeId, r]))
    expect(byId.RVL.group).toBe('rail')
    expect(byId.RVL.color).toBe('#005DAA')
    expect(byId.R201.group).toBe('regional')
    expect(byId.R9.group).toBe('bus')
    expect(byId.R9.color).toBeNull()
    expect(routes.map((r) => r.shortName)).toEqual(['4', '9', '201', 'Valley'])
  })
})

describe('routeDetail', () => {
  it('returns null for an unknown route', async () => {
    expect(await routeDetail(db, 'NOPE', null, NOW, noLive)).toBeNull()
  })

  it('returns one pattern per headsign with stops in sequence and the shape as path', async () => {
    const d = (await routeDetail(db, 'R9', null, NOW, noLive))!
    expect(RouteDetail.safeParse(d).success).toBe(true)
    expect(d.patterns).toHaveLength(1)
    expect(d.patterns[0].headsign).toBe('Southgate')
    expect(d.patterns[0].stops.map((s) => s.stopId)).toEqual(['1001', '1003', '1002'])
    expect(d.patterns[0].path.length).toBeGreaterThan(2)
    expect(d.departures).toEqual([])
  })

  it('falls back to a straight line through the stops when there is no shape', async () => {
    const d = (await routeDetail(db, 'R4', null, NOW, noLive))!
    const far = d.patterns.find((p) => p.headsign === 'Far Stop')!
    expect(far.path).toEqual(far.stops.map((s) => [s.lat, s.lon]))
    expect(d.patterns.filter((p) => p.headsign === 'Mill Woods')).toHaveLength(1)
  })

  it('returns empty patterns for a route with no trips today (not null)', async () => {
    const d = (await routeDetail(db, 'R201', '1001', NOW, noLive))!
    expect(d.route.group).toBe('regional')
    expect(d.patterns).toEqual([])
    expect(d.departures).toEqual([])
  })

  it('lists departures at the stop and none after the last trip', async () => {
    const d = (await routeDetail(db, 'R9', '1001', NOW, noLive))!
    expect(d.departures.map((x) => x.tripId)).toEqual(['A'])
    expect(d.departures[0]).toMatchObject({ headsign: 'Southgate', realtime: false })
    expect(d.departures[0].departAt).toBe('2026-11-14T18:10:00-07:00')
    const late = (await routeDetail(db, 'R9', '1001', at('2026-11-15T03:00:00'), noLive))!
    expect(late.departures).toEqual([])
    const elsewhere = (await routeDetail(db, 'R9', '2001', NOW, noLive))!
    expect(elsewhere.departures).toEqual([])
  })

  it('degrades to empty departures and vehicles on lookup failures, with alerts filtered by route', async () => {
    const live = {
      feedTimestamp: NOW,
      trips: new Map(),
      alerts: [
        { headline: 'R9 detour', activePeriods: [], routeIds: ['R9'], stopIds: [], tripIds: [] },
        { headline: 'Other', activePeriods: [], routeIds: ['R4'], stopIds: [], tripIds: [] },
      ],
    } as unknown as LiveIndex
    const boom = async () => {
      throw new Error('boom')
    }
    const d = (await routeDetail(db, 'R9', '1001', NOW, {
      getLiveIndex: async () => live,
      nextDepartures: boom,
      vehiclesForRoutes: boom,
    }))!
    expect(d.departures).toEqual([])
    expect(d.vehicles).toEqual([])
    expect(d.alerts).toEqual([{ headline: 'R9 detour' }])
  })

  it('throws when the route lookup fails', async () => {
    const bad: Db = { query: async () => Promise.reject(new Error('db down')) }
    await expect(routeDetail(bad, 'R9', null, NOW, noLive)).rejects.toThrow()
  })
})
