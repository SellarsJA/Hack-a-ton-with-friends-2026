import { describe, it, expect } from 'vitest'
import { isStationName } from '@/src/plan/stationName'

describe('isStationName', () => {
  it('matches LRT stations, Valley Line stops and underground platforms', () => {
    for (const n of ['Churchill Station', 'Churchill Stop', 'Churchill Station Underground', 'southgate station '])
      expect(isStationName(n)).toBe(true)
  })
  it('does not match streets, transit centres or entrances', () => {
    for (const n of [
      'Clareview Station Drive & 143 Avenue',
      'Southgate Transit Centre',
      'Churchill Stop East Entrance',
      '101 Street & Jasper Avenue',
    ])
      expect(isStationName(n)).toBe(false)
  })
})
