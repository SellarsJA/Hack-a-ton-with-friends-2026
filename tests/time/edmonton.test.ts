import { describe, expect, it } from 'vitest'
import { DateTime } from 'luxon'
import {
  ZONE,
  parseGtfsTime,
  toInstant,
  activeServiceDays,
  formatClock,
} from '@/src/time/edmonton'

describe('edmonton time helpers', () => {
  it('parses GTFS times past midnight', () => {
    expect(parseGtfsTime('25:10:00')).toBe(90600)
  })

  it('converts service date + seconds to an Edmonton instant', () => {
    expect(toInstant('2026-11-14', 90600).toISO()).toBe('2026-11-15T01:10:00.000-07:00')
  })

  it('handles DST start: 03:00 service time is 03:00 MDT', () => {
    expect(toInstant('2027-03-14', 10800).toISO()).toBe('2027-03-14T03:00:00.000-06:00')
  })

  it('lists active service days with yesterday offset by 86400', () => {
    const now = DateTime.fromISO('2026-11-15T00:30:00', { zone: ZONE })
    expect(activeServiceDays(now)).toEqual([
      { serviceDate: '2026-11-15', nowSeconds: 1800 },
      { serviceDate: '2026-11-14', nowSeconds: 88200 },
    ])
  })

  it('formats a clock time', () => {
    expect(formatClock(toInstant('2026-11-14', 65220))).toBe('6:07 PM')
  })
})
