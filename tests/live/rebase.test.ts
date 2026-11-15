import { describe, it, expect } from 'vitest'
import { DateTime } from 'luxon'
import type { LiveIndex, TripLive } from '@/src/live/decode'
import { rebaseSnapshot, snapshotServiceDate } from '@/src/live/rebase'
import { ZONE } from '@/src/time/edmonton'

const DAY = 86400
const t0 = DateTime.fromISO('2026-11-10T17:31:00', { zone: ZONE }).toSeconds()

const trip = (startDate: string | null, withStops = true): TripLive => ({
  startDate,
  stops: withStops ? [{ stopSequence: 1, stopId: 'S', arrival: t0 + 60, departure: null, delay: 30 }] : [],
  vehicle: { label: '4393', lat: 53.5, lon: -113.5, occupancy: null },
})

const index = (): LiveIndex => ({
  feedTimestamp: t0,
  trips: new Map([
    ['a', trip('2026-11-10')],
    ['b', trip('2026-11-10')],
    ['c', trip('2026-11-09')], // after-midnight trip from the previous service day
    ['d', trip(null)],
    ['v', trip('2026-11-01', false)], // vehicle-only entries do not vote
    ['w', trip('2026-11-01', false)],
    ['x', trip('2026-11-01', false)],
  ]),
  alerts: [{ headline: 'h', routeIds: ['R'], stopIds: [], tripIds: [], activePeriods: [{ start: t0 - 100, end: null }] }],
})

describe('snapshotServiceDate', () => {
  it('uses the most common trip-update startDate', () => {
    expect(snapshotServiceDate(index())).toBe('2026-11-10')
  })
  it('falls back to the header timestamp date in Edmonton', () => {
    // 2026-11-11T00:31Z is still Nov 10 in Edmonton
    const ts = DateTime.fromISO('2026-11-11T00:31:00Z').toSeconds()
    expect(snapshotServiceDate({ feedTimestamp: ts, trips: new Map([['d', trip(null)]]), alerts: [] })).toBe('2026-11-10')
  })
})

describe('rebaseSnapshot', () => {
  it('shifts every epoch by whole days and moves startDate to today', () => {
    const src = index()
    const r = rebaseSnapshot(src, '2026-11-14')
    const n = 4 * DAY
    expect(r.feedTimestamp).toBe(t0 + n)
    expect(DateTime.fromSeconds(r.feedTimestamp, { zone: ZONE }).toFormat('yyyy-MM-dd HH:mm')).toBe('2026-11-14 17:31')
    expect(r.trips.get('a')).toEqual({
      ...src.trips.get('a'),
      startDate: '2026-11-14',
      stops: [{ stopSequence: 1, stopId: 'S', arrival: t0 + 60 + n, departure: null, delay: 30 }],
    })
    expect(r.trips.get('c')!.startDate).toBe('2026-11-13')
    expect(r.trips.get('d')!.startDate).toBeNull()
    expect(r.trips.get('d')!.stops[0].arrival).toBe(t0 + 60 + n)
    expect(r.alerts[0].activePeriods).toEqual([{ start: t0 - 100 + n, end: null }])
    // pure: the input is untouched
    expect(src.feedTimestamp).toBe(t0)
    expect(src.trips.get('a')!.stops[0].arrival).toBe(t0 + 60)
    expect(src.trips.get('a')!.startDate).toBe('2026-11-10')
  })

  it('is a no-op shift when the snapshot is from today', () => {
    const r = rebaseSnapshot(index(), '2026-11-10')
    expect(r.feedTimestamp).toBe(t0)
    expect(r.trips.get('a')!.startDate).toBe('2026-11-10')
  })
})
