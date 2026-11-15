import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildLiveIndex } from '@/src/live/decode'

const read = (f: string) => new Uint8Array(readFileSync(join(process.cwd(), 'data/snapshot', f)))
const idx = buildLiveIndex({
  vehicles: read('VehiclePositions.pb'),
  tripUpdates: read('TripUpdates.pb'),
  alerts: read('Alerts.pb'),
})

describe('buildLiveIndex (snapshot)', () => {
  it('indexes many trips with no empty key', () => {
    expect(idx.trips.size).toBeGreaterThan(500)
    expect(idx.trips.has('')).toBe(false)
    expect(idx.feedTimestamp).toBeGreaterThan(1_700_000_000)
  })
  it('attaches vehicles with labels', () => {
    const vs = [...idx.trips.values()].map((t) => t.vehicle).filter((v) => v !== null)
    expect(vs.some((v) => v.label !== '')).toBe(true)
  })
  it('maps occupancy', () => {
    const vs = [...idx.trips.values()].map((t) => t.vehicle).filter((v) => v !== null)
    expect(vs.some((v) => v.occupancy !== null)).toBe(true)
  })
  it('sorts stops by sequence', () => {
    for (const t of idx.trips.values()) {
      for (let i = 1; i < t.stops.length; i++) {
        expect(t.stops[i].stopSequence).toBeGreaterThanOrEqual(t.stops[i - 1].stopSequence)
      }
    }
  })
  it('decodes alerts', () => {
    expect(idx.alerts.length).toBeGreaterThan(10)
    for (const a of idx.alerts) expect(a.routeIds.length + a.stopIds.length).toBeGreaterThan(0)
  })
})
