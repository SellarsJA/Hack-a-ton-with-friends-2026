import type { Option } from '@/src/contract/schema'

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

export function labelPoints(
  options: Option[],
): { optionId: string; lngLat: [number, number]; text: string }[] {
  const out: { optionId: string; lngLat: [number, number]; text: string }[] = []
  for (const o of options) {
    const transit = o.legs.filter((l) => l.mode !== 'walk')
    const first = transit[0]
    if (!first || first.path.length === 0) continue
    const [lat, lon] = first.path[Math.floor(first.path.length / 2)]
    const routes = transit.map((l) => l.route).join('+')
    out.push({ optionId: o.id, lngLat: [lon, lat], text: `${routes} · ${o.durationMinutes} min` })
  }
  return out
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
