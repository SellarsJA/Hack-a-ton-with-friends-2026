import { describe, expect, it } from 'vitest'
import { decodeLiveKey, encodeLiveKey, liveKeyFor, type LiveKeyLeg, type LiveKeyPayload } from '@/src/plan/liveKey'
import type { Candidate } from '@/src/plan/query'

const leg: LiveKeyLeg = { t: 'A', d: '2026-11-14', bs: '1001', bq: 1, bt: 65400, as: '1003', aq: 2, at: 66000, r: 'R9', rail: false }

describe('liveKey', () => {
  it('round-trips', () => {
    const p: LiveKeyPayload = { legs: [leg, { ...leg, t: 'E', rail: true }], tw: 180 }
    expect(decodeLiveKey(encodeLiveKey(p))).toEqual(p)
    const one: LiveKeyPayload = { legs: [leg], tw: null }
    expect(decodeLiveKey(encodeLiveKey(one))).toEqual(one)
  })

  it('rejects garbage, 3 legs, 0 legs and wrong types', () => {
    expect(decodeLiveKey('xyz')).toBeNull()
    expect(decodeLiveKey('')).toBeNull()
    expect(decodeLiveKey(encodeLiveKey({ legs: [leg, leg, leg], tw: 0 }))).toBeNull()
    expect(decodeLiveKey(encodeLiveKey({ legs: [], tw: null }))).toBeNull()
    expect(decodeLiveKey(encodeLiveKey({ legs: [{ ...leg, bq: '1' as unknown as number }], tw: null }))).toBeNull()
  })

  it('builds a leg from a candidate', () => {
    const stop = (id: string) => ({ stopId: id, name: id, lat: 0, lon: 0, zone: '1EDM', distanceM: 0, walkSeconds: 0 })
    const c: Candidate = {
      tripId: 'F', serviceDate: '2026-11-14', routeId: 'LRT', agencyId: '1', routeShortName: 'Valley', routeType: 0,
      headsign: 'x', shapeId: null,
      board: { ...stop('1005'), seq: 1, dep: 100 },
      alight: { ...stop('1008'), seq: 2, arr: 200 },
    }
    expect(liveKeyFor(c)).toEqual({ t: 'F', d: '2026-11-14', bs: '1005', bq: 1, bt: 100, as: '1008', aq: 2, at: 200, r: 'LRT', rail: true })
  })
})
