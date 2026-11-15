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

  it('rejects tampered keys', () => {
    const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
    const ok = (l: Record<string, unknown> = {}, tw: unknown = null) => enc({ legs: [{ ...leg, ...l }], tw })
    expect(decodeLiveKey(ok())).not.toBeNull()
    expect(decodeLiveKey(ok({ extra: 1 }))).toBeNull()
    expect(decodeLiveKey(enc({ legs: [leg], tw: null, x: 1 }))).toBeNull()
    for (const k of ['bq', 'aq', 'bt', 'at']) {
      expect(decodeLiveKey(ok({ [k]: -1 }))).toBeNull()
      expect(decodeLiveKey(ok({ [k]: 1.5 }))).toBeNull()
    }
    expect(decodeLiveKey(ok({ d: '2026-1-14' }))).toBeNull()
    expect(decodeLiveKey(ok({ d: '2026-11-14x' }))).toBeNull()
    for (const k of ['t', 'bs', 'as', 'r']) {
      expect(decodeLiveKey(ok({ [k]: '' }))).toBeNull()
      expect(decodeLiveKey(ok({ [k]: 'x'.repeat(65) }))).toBeNull()
      expect(decodeLiveKey(ok({ [k]: 'x'.repeat(64) }))).not.toBeNull()
    }
    expect(decodeLiveKey(ok({}, -1))).toBeNull()
    expect(decodeLiveKey(ok({}, 1.5))).toBeNull()
    // leg count must agree with tw
    expect(decodeLiveKey(ok({}, 120))).toBeNull()
    expect(decodeLiveKey(enc({ legs: [leg, leg], tw: null }))).toBeNull()
    expect(decodeLiveKey(enc({ legs: [leg, leg], tw: 120 }))).not.toBeNull()
  })

  it('rejects impossible dates, huge or inverted times and huge walks', () => {
    const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
    const one = (l: Record<string, unknown>) => enc({ legs: [{ ...leg, ...l }], tw: null })
    expect(decodeLiveKey(one({ d: '2026-99-99' }))).toBeNull()
    expect(decodeLiveKey(one({ d: '2026-02-30' }))).toBeNull()
    expect(decodeLiveKey(one({ bt: 1e13, at: 1e13 }))).toBeNull()
    expect(decodeLiveKey(one({ at: 172801 }))).toBeNull()
    expect(decodeLiveKey(one({ bt: 172800, at: 172800 }))).not.toBeNull()
    expect(decodeLiveKey(one({ bt: 66000, at: 65400 }))).toBeNull()
    expect(decodeLiveKey(enc({ legs: [leg, leg], tw: 99999 }))).toBeNull()
    expect(decodeLiveKey(enc({ legs: [leg, leg], tw: 3600 }))).not.toBeNull()
  })

  it('rejects keys longer than 1024 characters before decoding', () => {
    expect(decodeLiveKey('A'.repeat(1025))).toBeNull()
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
