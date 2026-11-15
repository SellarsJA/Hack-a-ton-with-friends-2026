import type { Place } from './place'

export type { Place }

const MAX_RESULTS = 5
/** Downtown Edmonton, and a radius that covers the ETS service area (St. Albert, Leduc, Spruce Grove, airport). */
export const SEARCH_CENTER = { lat: 53.5461, lon: -113.4938 }
export const SEARCH_RADIUS_M = 40000

type TomTomResult = {
  poi?: { name?: string }
  address?: { freeformAddress?: string }
  position?: { lat?: number; lon?: number }
}

/** Map a TomTom Search API response to address places (no storage, pure). */
export function mapTomTomResults(json: unknown): Place[] {
  const results = (json as { results?: TomTomResult[] } | null)?.results
  if (!Array.isArray(results)) return []
  const out: Place[] = []
  for (const r of results) {
    const label = r.poi?.name || r.address?.freeformAddress
    const lat = r.position?.lat
    const lon = r.position?.lon
    if (!label || typeof lat !== 'number' || typeof lon !== 'number') continue
    out.push({ kind: 'address', label, lat, lon })
    if (out.length === MAX_RESULTS) break
  }
  return out
}

/**
 * Browser-only autocomplete via TomTom Search API fuzzy search with typeahead=true.
 * Results are never cached or stored.
 */
export async function suggestAddresses(q: string, signal: AbortSignal): Promise<Place[]> {
  const key = process.env.NEXT_PUBLIC_TOMTOM_KEY
  if (!key) return []
  const params = new URLSearchParams({
    key,
    typeahead: 'true',
    limit: String(MAX_RESULTS),
    countrySet: 'CA',
    lat: String(SEARCH_CENTER.lat),
    lon: String(SEARCH_CENTER.lon),
    // Restrict, not just bias: a place 300 km away has no transit trip to plan.
    radius: String(SEARCH_RADIUS_M),
  })
  const url = `https://api.tomtom.com/search/2/search/${encodeURIComponent(q)}.json?${params}`
  const res = await fetch(url, { signal })
  if (!res.ok) return []
  return mapTomTomResults(await res.json())
}
