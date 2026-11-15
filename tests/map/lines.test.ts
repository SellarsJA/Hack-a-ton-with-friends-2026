import { describe, it, expect } from 'vitest'
import fixture from '@/fixtures/plan.json'
import { PlanResponse } from '@/src/contract/schema'
import {
  MODE_COLORS,
  MUTED_COLOR,
  buildLineFeatures,
  buildStopFeatures,
  endpointMarkers,
  labelPoints,
  boundsFor,
  routeName,
} from '@/src/map/lines'

const { options } = PlanResponse.parse(fixture)
const props = (fc: GeoJSON.FeatureCollection) => fc.features.map((f) => f.properties!)

describe('buildLineFeatures', () => {
  it('colours the selected option by mode and mutes the rest', () => {
    const p = props(buildLineFeatures(options, options[3].id, false))
    const sel = p.filter((x) => x.optionId === options[3].id)
    expect(sel.map((x) => x.color)).toEqual([MODE_COLORS.bus, MODE_COLORS.rail])
    expect(p.filter((x) => x.optionId !== options[3].id).every((x) => x.color === MUTED_COLOR)).toBe(true)
  })
  it('mutes every option when none is selected', () => {
    expect(props(buildLineFeatures(options, null, false)).every((x) => x.color === MUTED_COLOR)).toBe(true)
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
  it('draws walk legs only for the selected option, and only with showWalking', () => {
    expect(props(buildLineFeatures(options, options[0].id, false)).some((x) => x.kind === 'walk')).toBe(false)
    const walk = props(buildLineFeatures(options, options[0].id, true)).filter((x) => x.kind === 'walk')
    expect(walk.length).toBeGreaterThan(0)
    expect(walk.every((x) => x.optionId === options[0].id && x.color === MODE_COLORS.walk)).toBe(true)
  })
  it('uses [lon, lat] coordinates', () => {
    const f = buildLineFeatures(options, options[0].id, true).features[0]
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
  it('stacks a later option above the one before it', () => {
    const points = labelPoints(options)
    expect(points[0].offsetY).toBe(0)
    expect(points[1].offsetY).toBe(-28)
  })
})

describe('buildStopFeatures', () => {
  it('marks where each vehicle is boarded and left, in its mode colour', () => {
    const leg = options[0].legs.find((l) => l.mode === 'bus')!
    const fc = buildStopFeatures(options[0])
    expect(fc.features).toHaveLength(2)
    const [lat, lon] = leg.path[0]
    expect((fc.features[0].geometry as GeoJSON.Point).coordinates).toEqual([lon, lat])
    expect(fc.features.every((f) => f.properties!.color === MODE_COLORS.bus)).toBe(true)
  })
  it('merges a shared transfer stop into one point', () => {
    const transit = options[3].legs.flatMap((l) => (l.mode === 'walk' ? [] : [l]))
    const [bus, rail] = transit
    const joined = {
      ...options[3],
      legs: options[3].legs.map((l) => (l === rail ? { ...rail, fromStop: bus.toStop } : l)),
    }
    const fc = buildStopFeatures(joined)
    expect(fc.features).toHaveLength(3)
    expect(fc.features.filter((f) => f.properties!.transfer === 1)).toHaveLength(1)
  })
  it('is empty without an option', () => {
    expect(buildStopFeatures(undefined).features).toEqual([])
  })
})

describe('routeName', () => {
  it('drops GTFS zero padding but keeps names and a lone zero', () => {
    expect(routeName('004')).toBe('4')
    expect(routeName('Capital')).toBe('Capital')
    expect(routeName('0')).toBe('0')
  })
})

describe('endpointMarkers', () => {
  it('marks the first point and the last point as [lon, lat]', () => {
    const legs = options[0].legs.filter((l) => l.path.length > 0)
    const [lat0, lon0] = legs[0].path[0]
    const [lat1, lon1] = legs[legs.length - 1].path.at(-1)!
    expect(endpointMarkers(options[0])).toEqual([
      { role: 'start', lngLat: [lon0, lat0] },
      { role: 'destination', lngLat: [lon1, lat1] },
    ])
  })
  it('returns nothing when every leg has an empty path', () => {
    const empty = { ...options[0], legs: options[0].legs.map((l) => ({ ...l, path: [] as [number, number][] })) }
    expect(endpointMarkers(empty)).toEqual([])
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
