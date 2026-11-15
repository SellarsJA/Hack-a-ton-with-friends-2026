import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { buildLiveIndex, type LiveIndex } from '@/src/live/decode'
import { dbVehicleLookups, vehiclesForRoutes } from '@/src/plan/vehicles'
import { refreshOptions } from '@/src/plan/live'
import { encodeLiveKey, type LiveKeyLeg } from '@/src/plan/liveKey'
import { toInstant } from '@/src/time/edmonton'
import { makeTestDb } from '../helpers/pgliteDb'

const read = (f: string) => new Uint8Array(readFileSync(join(process.cwd(), 'data/snapshot', f)))
const snapshot = buildLiveIndex({
  vehicles: read('VehiclePositions.pb'),
  tripUpdates: read('TripUpdates.pb'),
  alerts: read('Alerts.pb'),
})

describe('vehiclesForRoutes', () => {
  it('returns labelled vehicles for a route seen in the snapshot', async () => {
    const first = [...snapshot.trips.values()].find((t) => t.vehicle?.routeId)!.vehicle!
    const tripRoute = vi.fn(async () => new Map<string, string>())
    const out = await vehiclesForRoutes([first.routeId!], snapshot, tripRoute)
    expect(out.length).toBeGreaterThanOrEqual(1)
    for (const v of out) expect(v.label).not.toBe('')
    expect(new Set(out.map((v) => v.tripId)).size).toBe(out.length)
  })

  it('falls back to tripRoute only for vehicles without a routeId', async () => {
    const live: LiveIndex = {
      feedTimestamp: 0,
      alerts: [],
      trips: new Map([
        ['T1', { startDate: null, stops: [], vehicle: { label: '1', lat: 1, lon: 2, occupancy: null, routeId: 'R9' } }],
        ['T2', { startDate: null, stops: [], vehicle: { label: '2', lat: 3, lon: 4, occupancy: null, routeId: null } }],
        ['T3', { startDate: null, stops: [], vehicle: { label: '3', lat: 5, lon: 6, occupancy: null, routeId: null } }],
        ['T4', { startDate: null, stops: [], vehicle: null }],
      ]),
    }
    const tripRoute = vi.fn(async () => new Map([['T2', 'R9'], ['T3', 'R4']]))
    const routeNames = async () => new Map([['R9', '9']])
    const out = await vehiclesForRoutes(['R9'], live, tripRoute, routeNames)
    expect(tripRoute).toHaveBeenCalledWith(['T2', 'T3'])
    expect(out.map((v) => v.label).sort()).toEqual(['1', '2'])
    expect(out.every((v) => v.routeShortName === '9')).toBe(true)
  })

  it('returns nothing without a live index or routes', async () => {
    const tripRoute = vi.fn(async () => new Map<string, string>())
    expect(await vehiclesForRoutes(['R9'], null, tripRoute)).toEqual([])
    expect(await vehiclesForRoutes([], snapshot, tripRoute)).toEqual([])
  })

  it('default DB lookups resolve trip routes and short names', async () => {
    const db = await makeTestDb()
    const l = dbVehicleLookups(db)
    expect((await l.tripRoute(['A', 'nope'])).get('A')).toBe('R9')
    expect((await l.routeNames(['R9'])).get('R9')).toBe('9')
    expect((await l.tripRoute([])).size).toBe(0)
  })
})

const D = '2026-11-14'
const leg = (o: Partial<LiveKeyLeg> = {}): LiveKeyLeg => ({
  t: 'A', d: D, bs: 'S1', bq: 1, bt: 65400, as: 'S2', aq: 2, at: 66000, r: 'R9', rail: false, ...o,
})
const at = (s: number) => toInstant(D, s).toSeconds()

describe('refreshOptions', () => {
  const none = { nextDepartures: vi.fn(async () => []) }

  it('marks an option whose first departure was an hour ago as expired', async () => {
    const key = encodeLiveKey({ legs: [leg()], tw: null })
    const [o] = await refreshOptions([key], null, at(65400) + 3600, none)
    expect(o.expired).toBe(true)
    expect(o.transfer).toBeNull()
    expect(o.legs[0]).toMatchObject({ tripId: 'A', realtime: false, vehiclePosition: null })
  })

  it('is not expired before the first departure and uses live time and vehicle', async () => {
    const live: LiveIndex = {
      feedTimestamp: 0,
      alerts: [],
      trips: new Map([
        ['A', {
          startDate: D,
          stops: [{ stopSequence: 1, stopId: 'S1', arrival: null, departure: at(65400) + 300, delay: 300 }],
          vehicle: { label: '4393', lat: 53.5, lon: -113.5, occupancy: 'some_standing' as const, routeId: 'R9' },
        }],
      ]),
    }
    const key = encodeLiveKey({ legs: [leg()], tw: null })
    const [o] = await refreshOptions([key], live, at(65400) - 60, none)
    expect(o.expired).toBe(false)
    expect(o.legs[0]).toMatchObject({
      realtime: true, vehicleLabel: '4393', occupancy: 'some_standing', vehiclePosition: { lat: 53.5, lon: -113.5 },
    })
  })

  it('at-risk two-leg key fetches the fallback departure; on-track does not', async () => {
    const next = vi.fn(async () => [
      { tripId: 'Z', serviceDate: D, routeId: 'R4', headsign: '', departEpoch: at(67200), realtime: false },
    ])
    // leg 1 arrives 66000, leg 2 departs 66100, walk 180 s -> spare < 0
    const risky = encodeLiveKey({
      legs: [leg(), leg({ t: 'B', bs: 'S3', bt: 66100, as: 'S4', at: 67000, r: 'R4' })],
      tw: 180,
    })
    const [o] = await refreshOptions([risky], null, at(65400) - 600, { nextDepartures: next })
    expect(o.transfer).toMatchObject({ stop: 'S3', status: 'at_risk', basedOn: 'scheduled' })
    expect(o.transfer!.fallbackDepartAt).toContain('T')
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ stopId: 'S3', routeId: 'R4', limit: 1 }))

    next.mockClear()
    const fine = encodeLiveKey({
      legs: [leg(), leg({ t: 'B', bs: 'S3', bt: 66900, as: 'S4', at: 67500, r: 'R4' })],
      tw: 180,
    })
    const [p] = await refreshOptions([fine], null, at(65400) - 600, { nextDepartures: next })
    expect(p.transfer).toMatchObject({ status: 'on_track', fallbackDepartAt: null })
    expect(next).not.toHaveBeenCalled()
  })

  it('never reports a rail transfer as live', async () => {
    const live: LiveIndex = {
      feedTimestamp: 0,
      alerts: [],
      trips: new Map(
        ['A', 'B'].map((t) => [t, {
          startDate: D,
          stops: [
            { stopSequence: 1, stopId: 'S1', arrival: null, departure: at(65400), delay: 0 },
            { stopSequence: 2, stopId: 'S2', arrival: at(66000), departure: null, delay: 0 },
          ],
          vehicle: null,
        }]),
      ),
    }
    const key = encodeLiveKey({
      legs: [leg(), leg({ t: 'B', bt: 66900, bq: 1, aq: 2, at: 67500, rail: true })],
      tw: 180,
    })
    const [o] = await refreshOptions([key], live, at(65400) - 600, none)
    expect(o.transfer!.basedOn).toBe('scheduled')
  })
})
