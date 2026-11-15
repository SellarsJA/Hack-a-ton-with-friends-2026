import { describe, it, expect, vi, afterEach } from 'vitest'
import { mapTomTomResults, suggestAddresses } from '@/src/tomtom/suggest'

const sample = {
  summary: { query: 'chur', numResults: 3 },
  results: [
    { type: 'POI', poi: { name: 'Church Cafe' }, address: { freeformAddress: '1 Main St, Edmonton' }, position: { lat: 53.5, lon: -113.5 } },
    { type: 'Street', address: { freeformAddress: 'Church Rd, Edmonton' }, position: { lat: 53.6, lon: -113.4 } },
    { type: 'Street', address: {}, position: { lat: 1, lon: 2 } },
  ],
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('mapTomTomResults', () => {
  it('maps POI name and freeform address, drops unlabeled, caps at 5', () => {
    expect(mapTomTomResults(sample)).toEqual([
      { kind: 'address', label: 'Church Cafe', lat: 53.5, lon: -113.5 },
      { kind: 'address', label: 'Church Rd, Edmonton', lat: 53.6, lon: -113.4 },
    ])
    const many = {
      results: Array.from({ length: 9 }, (_, i) => ({
        address: { freeformAddress: `A${i}` },
        position: { lat: i, lon: i },
      })),
    }
    expect(mapTomTomResults(many)).toHaveLength(5)
  })
})

describe('suggestAddresses', () => {
  it('returns [] without fetching when key is missing', async () => {
    vi.stubEnv('NEXT_PUBLIC_TOMTOM_KEY', '')
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    expect(await suggestAddresses('church', new AbortController().signal)).toEqual([])
    expect(f).not.toHaveBeenCalled()
  })

  it('calls the typeahead endpoint with bias params and the signal', async () => {
    vi.stubEnv('NEXT_PUBLIC_TOMTOM_KEY', 'k')
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => sample })
    vi.stubGlobal('fetch', f)
    const ac = new AbortController()
    const out = await suggestAddresses('chur ch', ac.signal)
    const [url, init] = f.mock.calls[0]
    expect(url).toContain('/search/2/search/chur%20ch.json')
    for (const p of ['key=k', 'typeahead=true', 'limit=5', 'countrySet=CA', 'lat=53.5461', 'lon=-113.4938']) {
      expect(url).toContain(p)
    }
    expect(init.signal).toBe(ac.signal)
    expect(out).toHaveLength(2)
  })
})
