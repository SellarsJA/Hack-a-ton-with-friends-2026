import { describe, it, expect } from 'vitest'
import { SCHEDULE_TABLES } from '../../scripts/import-gtfs/index'

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
