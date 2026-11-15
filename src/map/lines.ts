import type { Option, Vehicle, RouteDetail } from '@/src/contract/schema'

/** Display form of a route short name: GTFS pads some numbers ("004"), riders say "4". */
export const routeName = (route: string) => route.replace(/^0+(?=\d)/, '')

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

/** One colour per way of travelling, shared by the map lines and the option cards. */
export const MODE_COLORS = { bus: '#2563EB', rail: '#7C3AED', walk: '#9CA3AF' } as const
/** Lines of the options that are not selected: present and tappable, but quiet. */
export const MUTED_COLOR = '#94A3B8'

/**
 * Trip lines. The selected option's legs take their mode colour and on=1; every other option is muted.
 * Walk legs are only drawn for the selected option, and only with showWalking.
 */
export function buildLineFeatures(
  options: Option[],
  selectedId: string | null,
  showWalking: boolean,
): GeoJSON.FeatureCollection {
  // Unselected first so the selected option draws on top.
  const ordered = [...options].sort((a, b) => Number(a.id === selectedId) - Number(b.id === selectedId))
  const features: GeoJSON.Feature[] = []
  for (const o of ordered) {
    const selected = o.id === selectedId
    for (const leg of o.legs) {
      const walk = leg.mode === 'walk'
      if (walk && (!showWalking || !selected)) continue
      if (leg.path.length < 2) continue
      features.push({
        type: 'Feature',
        properties: {
          optionId: o.id,
          color: selected ? MODE_COLORS[leg.mode] : MUTED_COLOR,
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

/**
 * Where the selected option boards and leaves each vehicle, as [lon, lat] points.
 * A stop shared by two legs (a transfer) is one point, flagged transfer=1.
 */
export function buildStopFeatures(option: Option | undefined): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []
  if (!option) return { type: 'FeatureCollection', features }
  const seen = new Map<string, GeoJSON.Feature>()
  for (const leg of option.legs) {
    if (leg.mode === 'walk' || leg.path.length === 0) continue
    const ends: [[number, number], string][] = [
      [leg.path[0], leg.fromStop],
      [leg.path[leg.path.length - 1], leg.toStop],
    ]
    for (const [[lat, lon], name] of ends) {
      const key = name
      const prev = seen.get(key)
      if (prev) {
        prev.properties!.transfer = 1
        continue
      }
      const f: GeoJSON.Feature = {
        type: 'Feature',
        properties: { name, color: MODE_COLORS[leg.mode], transfer: 0 },
        geometry: { type: 'Point', coordinates: [lon, lat] },
      }
      seen.set(key, f)
      features.push(f)
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
    const routes = transit.map((l) => routeName(l.route)).join(' + ')
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
