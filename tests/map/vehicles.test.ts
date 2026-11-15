import { describe, it, expect } from 'vitest'
import { buildVehicleFeatures } from '@/src/map/lines'
import type { Vehicle } from '@/src/contract/schema'

const v = (label: string, tripId: string, occupancy: Vehicle['occupancy'] = null): Vehicle => ({
  label,
  tripId,
  routeShortName: '9',
  lat: 53.5,
  lon: -113.5,
  occupancy,
})

describe('buildVehicleFeatures', () => {
  it("colours an option trip's vehicle with the option colour and others #374151", () => {
    const fc = buildVehicleFeatures(
      [v('4393', 't1', 'some_standing'), v('4000', 'other')],
      new Map([['t1', '#7C3AED']]),
    )
    expect(fc.type).toBe('FeatureCollection')
    expect(fc.features).toHaveLength(2)
    expect(fc.features[0].properties).toEqual({ label: '4393', color: '#7C3AED', occupancy: 'some_standing' })
    expect(fc.features[1].properties).toEqual({ label: '4000', color: '#374151', occupancy: null })
  })

  it('uses [lon, lat] coordinates', () => {
    const fc = buildVehicleFeatures([{ ...v('1', 't'), lat: 53.1, lon: -113.2 }], new Map())
    expect(fc.features[0].geometry).toEqual({ type: 'Point', coordinates: [-113.2, 53.1] })
  })
})
