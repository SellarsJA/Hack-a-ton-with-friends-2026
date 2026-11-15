import { describe, it, expect } from 'vitest'
import { DateTime } from 'luxon'
import { SCHEDULE_TABLES, importWindow } from '../../scripts/import-gtfs/index'

describe('import-gtfs index', () => {
  it('exports exactly the schedule tables without running the CLI', () => {
    expect([...SCHEDULE_TABLES]).toEqual([
      'stops',
      'routes',
      'trips',
      'service_dates',
      'stop_times',
      'shapes',
      'feed_meta',
    ])
  })
})

describe('importWindow', () => {
  it('starts at yesterday in Edmonton and spans 8 days', () => {
    // 07:30Z = 00:30 MST on Nov 15, so Edmonton's yesterday is Nov 14
    expect(importWindow(DateTime.fromISO('2026-11-15T07:30:00Z'))).toEqual({ startDate: '2026-11-14', days: 8 })
    // 06:30Z = 23:30 MST on Nov 14, so yesterday is Nov 13 (not the UTC date)
    expect(importWindow(DateTime.fromISO('2026-11-15T06:30:00Z'))).toEqual({ startDate: '2026-11-13', days: 8 })
  })
})
