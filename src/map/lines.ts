import type { Option, Vehicle, RouteDetail } from '@/src/contract/schema'

export const ROUTE_FALLBACK_COLOR = '#2563EB'

export const routeColor = (color: string | null): string =>
  color ? (color.startsWith('#') ? color : `#${color}`) : ROUTE_FALLBACK_COLOR

/**
 * Route page features. Every pattern's path is a 'line' (the pattern at `patternIndex` has on=1);
 * the stops of that pattern are 'stop' points, with the selected one flagged. [lon, lat].
 */
export function buildRouteFeatures(
  detail: RouteDetail,
  selectedStopId: string | null,
  patternIndex: number,
): GeoJSON.FeatureCollection {
  const color = routeColor(detail.route.color)
  const features: GeoJSON.Feature[] = []
  detail.patterns.forEach((p, i) => {
    if (p.path.length < 2) return
    features.push({
      type: 'Feature',
      properties: { kind: 'line', color, on: i === patternIndex ? 1 : 0, headsign: p.headsign },
      geometry: { type: 'LineString', coordinates: p.path.map(([lat, lon]) => [lon, lat]) },
    })
  })
  const current = detail.patterns[patternIndex]
  for (const s of current?.stops ?? []) {
    features.push({
      type: 'Feature',
      properties: { kind: 'stop', stopId: s.stopId, name: s.name, color, selected: s.stopId === selectedStopId ? 1 : 0 },
      geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
    })
  }
  return { type: 'FeatureCollection', features }
}

/** [[west, south], [east, north]] of one pattern's path and stops, or null when empty. */
export function patternBounds(
  detail: RouteDetail,
  patternIndex: number,
): [[number, number], [number, number]] | null {
  const p = detail.patterns[patternIndex]
  if (!p) return null
  const pts: [number, number][] = [
    ...p.path.map(([lat, lon]): [number, number] => [lon, lat]),
    ...p.stops.map((s): [number, number] => [s.lon, s.lat]),
  ]
  if (pts.length === 0) return null
  const lons = pts.map((q) => q[0])
  const lats = pts.map((q) => q[1])
  return [
    [Math.min(...lons), Math.min(...lats)],
    [Math.max(...lons), Math.max(...lats)],
  ]
}

export const OPTION_COLORS = ['#2563EB', '#7C3AED', '#0891B2', '#DB2777', '#4B5563'] as const
const WALK_COLOR = '#9CA3AF'

const colorFor = (i: number) => OPTION_COLORS[i % OPTION_COLORS.length]

export function buildLineFeatures(
  options: Option[],
  selectedId: string | null,
  showWalking: boolean,
): GeoJSON.FeatureCollection {
  // Unselected first so the selected option draws on top.
  const ordered = options
    .map((o, i) => ({ o, i }))
    .sort((a, b) => Number(a.o.id === selectedId) - Number(b.o.id === selectedId))
  const features: GeoJSON.Feature[] = []
  for (const { o, i } of ordered) {
    const selected = o.id === selectedId
    for (const leg of o.legs) {
      const walk = leg.mode === 'walk'
      if (walk && !showWalking) continue
      if (leg.path.length < 2) continue
      features.push({
        type: 'Feature',
        properties: {
          optionId: o.id,
          color: walk ? WALK_COLOR : colorFor(i),
          // Strings, not booleans: a false property can be dropped when the line is tiled.
          kind: walk ? 'walk' : 'ride',
          on: selected ? 1 : 0,
        },
        geometry: { type: 'LineString', coordinates: leg.path.map(([lat, lon]) => [lon, lat]) },
      })
    }
  }
  return { type: 'FeatureCollection', features }
}

export type MapEndpoint = { role: 'start' | 'destination'; lngLat: [number, number] }

/** First point of the first leg, and last point of the last leg. [lon, lat]. */
export function endpointMarkers(option: Option | undefined): MapEndpoint[] {
  if (!option) return []
  let first: [number, number] | null = null
  let last: [number, number] | null = null
  for (const leg of option.legs) {
    if (leg.path.length === 0) continue
    if (!first) first = leg.path[0]
    last = leg.path[leg.path.length - 1]
  }
  if (!first || !last) return []
  return [
    { role: 'start', lngLat: [first[1], first[0]] },
    { role: 'destination', lngLat: [last[1], last[0]] },
  ]
}

export function labelPoints(
  options: Option[],
): { optionId: string; lngLat: [number, number]; text: string; offsetY: number }[] {
  const out: { optionId: string; lngLat: [number, number]; text: string; offsetY: number }[] = []
  for (const o of options) {
    const transit = o.legs.filter((l) => l.mode !== 'walk')
    const first = transit[0]
    if (!first || first.path.length === 0) continue
    const [lat, lon] = first.path[Math.floor(first.path.length / 2)]
    const routes = transit.map((l) => l.route).join('+')
    // Stack pills that sit on the same corridor so the second route stays readable.
    out.push({
      optionId: o.id,
      lngLat: [lon, lat],
      text: `${routes} · ${o.durationMinutes} min`,
      offsetY: -28 * out.length || 0,
    })
  }
  return out
}

export const OTHER_VEHICLE_COLOR = '#374151'

/** Vehicle points. Vehicles on the option's trips take its colour; others are grey. [lon, lat]. */
export function buildVehicleFeatures(
  vehicles: Vehicle[],
  optionTrips: Map<string, string>,
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: vehicles.map((v) => ({
      type: 'Feature',
      properties: {
        label: v.label,
        color: optionTrips.get(v.tripId) ?? OTHER_VEHICLE_COLOR,
        occupancy: v.occupancy,
      },
      geometry: { type: 'Point', coordinates: [v.lon, v.lat] },
    })),
  }
}

export function boundsFor(options: Option[]): [[number, number], [number, number]] {
  let minLon = Infinity
  let minLat = Infinity
  let maxLon = -Infinity
  let maxLat = -Infinity
  for (const o of options)
    for (const l of o.legs)
      for (const [lat, lon] of l.path) {
        minLon = Math.min(minLon, lon)
        maxLon = Math.max(maxLon, lon)
        minLat = Math.min(minLat, lat)
        maxLat = Math.max(maxLat, lat)
      }
  return [
    [minLon, minLat],
    [maxLon, maxLat],
  ]
}
