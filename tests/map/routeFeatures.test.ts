import { describe, it, expect } from 'vitest'
import fixture from '@/fixtures/route-detail.json'
import { RouteDetail } from '@/src/contract/schema'
import { buildRouteFeatures, ROUTE_FALLBACK_COLOR } from '@/src/map/lines'

const detail = RouteDetail.parse(fixture)

describe('buildRouteFeatures', () => {
  it('draws each pattern path as [lon, lat] in the fallback colour', () => {
    const fc = buildRouteFeatures(detail, null, 0)
    const lines = fc.features.filter((f) => f.properties?.kind === 'line')
    expect(lines).toHaveLength(2)
    expect(lines[0].properties?.color).toBe(ROUTE_FALLBACK_COLOR)
    expect(lines[0].properties?.on).toBe(1)
    expect(lines[1].properties?.on).toBe(0)
    expect((lines[0].geometry as GeoJSON.LineString).coordinates[0]).toEqual([-113.4909, 53.5444])
  })
  it('prefixes # to the route colour', () => {
    const d = { ...detail, route: { ...detail.route, color: '0EA5E9' } }
    const fc = buildRouteFeatures(d, null, 0)
    expect(fc.features[0].properties?.color).toBe('#0EA5E9')
  })
  it('emits stops of the selected pattern and flags the selected stop', () => {
    const fc = buildRouteFeatures(detail, '1003', 0)
    const stops = fc.features.filter((f) => f.properties?.kind === 'stop')
    expect(stops.map((s) => s.properties?.stopId)).toEqual(['1001', '1003', '1002'])
    expect(stops.find((s) => s.properties?.stopId === '1003')?.properties?.selected).toBe(1)
    expect(stops.find((s) => s.properties?.stopId === '1001')?.properties?.selected).toBe(0)
  })
})
