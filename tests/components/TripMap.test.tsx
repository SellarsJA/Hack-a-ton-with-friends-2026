import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import fixture from '@/fixtures/plan.json'
import { PlanResponse } from '@/src/contract/schema'

const fitBounds = vi.fn()

vi.mock('maplibre-gl', () => {
  class Map {
    fitBounds = fitBounds
    on() {}
    addControl() {}
    removeControl() {}
    remove() {}
    getSource() {
      return undefined
    }
    getCanvas() {
      return { style: {} }
    }
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
      return this
    }
    remove() {}
    getElement() {
      return this.el
    }
  }
  return { Map, AttributionControl, Marker }
})
vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}))

import TripMap from '@/components/TripMap'

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  fitBounds.mockReset()
})

describe('TripMap', () => {
  it('caps fitBounds at zoom 16 so a short trip is not zoomed in too far', () => {
    vi.stubEnv('NEXT_PUBLIC_TOMTOM_KEY', 'k1')
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    const plan = PlanResponse.parse(fixture)
    render(<TripMap options={plan.options} selectedId={plan.options[0].id} showWalking onSelect={() => {}} />)
    expect(fitBounds).toHaveBeenCalledTimes(1)
    expect(fitBounds.mock.calls[0][1]).toMatchObject({ maxZoom: 16, padding: 40, animate: false })
  })
})
