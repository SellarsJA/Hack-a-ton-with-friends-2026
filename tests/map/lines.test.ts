import { describe, it, expect } from 'vitest'
import fixture from '@/fixtures/plan.json'
import { PlanResponse } from '@/src/contract/schema'
import { OPTION_COLORS, buildLineFeatures, labelPoints, boundsFor } from '@/src/map/lines'

const { options } = PlanResponse.parse(fixture)
const props = (fc: GeoJSON.FeatureCollection) => fc.features.map((f) => f.properties!)

describe('buildLineFeatures', () => {
  it('colours options in order', () => {
    const p = props(buildLineFeatures(options, null, false))
    expect(p.find((x) => x.optionId === options[0].id)!.color).toBe('#2563EB')
    expect(p.find((x) => x.optionId === options[1].id)!.color).toBe('#7C3AED')
    expect(OPTION_COLORS).toHaveLength(5)
  })
  it('marks only the selected option', () => {
    const p = props(buildLineFeatures(options, options[1].id, false))
    expect(p.filter((x) => x.optionId === options[1].id).every((x) => x.on === 1)).toBe(true)
    expect(p.filter((x) => x.optionId !== options[1].id).every((x) => x.on === 0)).toBe(true)
  })
  it('draws the selected option last', () => {
    const p = props(buildLineFeatures(options, options[0].id, false))
    expect(p[p.length - 1].optionId).toBe(options[0].id)
  })
  it('omits walk legs unless showWalking', () => {
    expect(props(buildLineFeatures(options, null, false)).some((x) => x.kind === 'walk')).toBe(false)
    const walk = props(buildLineFeatures(options, null, true)).filter((x) => x.kind === 'walk')
    expect(walk.length).toBeGreaterThan(0)
    expect(walk.every((x) => x.color === '#9CA3AF')).toBe(true)
  })
  it('uses [lon, lat] coordinates', () => {
    const f = buildLineFeatures(options, null, true).features[0]
    const c = (f.geometry as GeoJSON.LineString).coordinates[0]
    expect(c[0]).toBeCloseTo(-113.49, 1)
    expect(c[1]).toBeGreaterThan(50)
  })
})

describe('labelPoints', () => {
  it('formats text', () => {
    expect(labelPoints(options)[0].text).toBe('9 · 34 min')
  })
  it('uses the middle point of the first transit leg as [lon, lat]', () => {
    const leg = options[0].legs.find((l) => l.mode !== 'walk')!
    const [lat, lon] = leg.path[Math.floor(leg.path.length / 2)]
    expect(labelPoints(options)[0].lngLat).toEqual([lon, lat])
  })
})

describe('boundsFor', () => {
  it('contains every path point', () => {
    const [[minLon, minLat], [maxLon, maxLat]] = boundsFor(options)
    for (const o of options)
      for (const l of o.legs)
        for (const [lat, lon] of l.path) {
          expect(lon).toBeGreaterThanOrEqual(minLon)
          expect(lon).toBeLessThanOrEqual(maxLon)
          expect(lat).toBeGreaterThanOrEqual(minLat)
          expect(lat).toBeLessThanOrEqual(maxLat)
        }
  })
})
