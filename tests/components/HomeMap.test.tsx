import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'

const easeTo = vi.fn()
const fitBounds = vi.fn()

vi.mock('maplibre-gl', () => {
  class Map {
    easeTo = easeTo
    fitBounds = fitBounds
    on(type: string, cb: () => void) {
      if (type === 'load') cb()
    }
    addControl() {}
    removeControl() {}
    remove() {}
  }
  class AttributionControl {}
  class Marker {
    el: HTMLElement
    constructor(o: { element: HTMLElement }) {
      this.el = o.element
    }
    setLngLat() {
      return this
    }
    addTo() {
      document.body.appendChild(this.el)
      return this
    }
    remove() {
      this.el.remove()
    }
  }
  return { Map, AttributionControl, Marker, setWorkerUrl() {} }
})
vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}))

import HomeMap from '@/components/HomeMap'

const start = { kind: 'stop' as const, label: 'Churchill Station', lat: 53.544, lon: -113.489 }
const dest = { kind: 'address' as const, label: 'Southgate Centre', lat: 53.486, lon: -113.517 }

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  easeTo.mockReset()
  fitBounds.mockReset()
})

describe('HomeMap', () => {
  it('renders nothing without a TomTom key', () => {
    vi.stubEnv('NEXT_PUBLIC_TOMTOM_KEY', '')
    const { container } = render(<HomeMap start={start} dest={dest} />)
    expect(container.innerHTML).toBe('')
  })

  it('zooms to a single picked place and tags it', () => {
    vi.stubEnv('NEXT_PUBLIC_TOMTOM_KEY', 'k1')
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    render(<HomeMap start={start} dest={null} />)
    expect(easeTo).toHaveBeenCalledWith(expect.objectContaining({ center: [start.lon, start.lat], zoom: 15 }))
    expect(document.querySelector('[data-role="start"]')?.getAttribute('aria-label')).toBe('start: Churchill Station')
    expect(document.querySelector('[data-role="destination"]')).toBeNull()
  })

  it('frames both places once both are picked', () => {
    vi.stubEnv('NEXT_PUBLIC_TOMTOM_KEY', 'k1')
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    render(<HomeMap start={start} dest={dest} />)
    expect(fitBounds).toHaveBeenCalledWith(
      [
        [dest.lon, dest.lat],
        [start.lon, start.lat],
      ],
      expect.objectContaining({ maxZoom: 16 }),
    )
    expect(document.querySelector('[data-role="destination"]')).not.toBeNull()
  })
})
