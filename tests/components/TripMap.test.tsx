import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import fixture from '@/fixtures/plan.json'
import { PlanResponse } from '@/src/contract/schema'

const fitBounds = vi.fn()
const addLayer = vi.fn()
const setLayoutProperty = vi.fn()

vi.mock('maplibre-gl', () => {
  class Map {
    fitBounds = fitBounds
    resize() {}
    on(type: string, cb: () => void) {
      if (type === 'load') cb()
    }
    addSource() {}
    addLayer = addLayer
    setLayoutProperty = setLayoutProperty
    getLayer(id: string) {
      return addLayer.mock.calls.some(([l]) => l.id === id) ? {} : undefined
    }
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
  function setWorkerUrl() {}
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
    getElement() {
      return this.el
    }
  }
  return { Map, AttributionControl, Marker, setWorkerUrl }
})
vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}))

import TripMap from '@/components/TripMap'

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  fitBounds.mockReset()
  addLayer.mockReset()
  setLayoutProperty.mockReset()
})

describe('TripMap', () => {
  it('caps fitBounds at zoom 16 so a short trip is not zoomed in too far', () => {
    vi.stubEnv('NEXT_PUBLIC_TOMTOM_KEY', 'k1')
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    const plan = PlanResponse.parse(fixture)
    render(<TripMap options={plan.options} selectedId={plan.options[0].id} showWalking onSelect={() => {}} />)
    expect(fitBounds).toHaveBeenCalled()
    expect(fitBounds.mock.calls.at(-1)?.[1]).toMatchObject({ maxZoom: 16, padding: 40, animate: false })
  })

  it('tags both the start and the destination, not only the route pill', () => {
    vi.stubEnv('NEXT_PUBLIC_TOMTOM_KEY', 'k1')
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    const plan = PlanResponse.parse(fixture)
    render(
      <TripMap
        options={plan.options}
        selectedId={plan.options[0].id}
        showWalking
        onSelect={() => {}}
        fromLabel="Churchill Square"
        toLabel="Southgate Station"
      />,
    )
    expect(document.body.textContent).toContain('Churchill Square')
    expect(document.body.textContent).toContain('Southgate Station')
    expect(document.querySelector('[data-role="start"]')?.getAttribute('aria-label')).toBe('start: Churchill Square')
    expect(document.querySelector('[data-role="destination"]')?.getAttribute('aria-label')).toBe(
      'destination: Southgate Station',
    )
  })

  it('adds live traffic under the trip lines, hidden until the Traffic button is pressed', async () => {
    vi.stubEnv('NEXT_PUBLIC_TOMTOM_KEY', 'k1')
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    const plan = PlanResponse.parse(fixture)
    render(<TripMap options={plan.options} selectedId={plan.options[0].id} showWalking onSelect={() => {}} />)
    const ids = addLayer.mock.calls.map(([l]) => l.id)
    expect(ids.indexOf('traffic-flow')).toBeGreaterThanOrEqual(0)
    expect(ids.indexOf('traffic-flow')).toBeLessThan(ids.indexOf('lines-solid'))
    const traffic = addLayer.mock.calls.find(([l]) => l.id === 'traffic-flow')![0]
    expect(traffic.layout.visibility).toBe('none')
    expect(screen.queryByTestId('traffic-legend')).toBeNull()

    const button = screen.getByRole('button', { name: 'Traffic' })
    expect(button.getAttribute('aria-pressed')).toBe('false')
    await userEvent.click(button)
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(setLayoutProperty).toHaveBeenLastCalledWith('traffic-flow', 'visibility', 'visible')
    expect(screen.getByTestId('traffic-legend').textContent).toContain('Slow')
    await userEvent.click(button)
    expect(setLayoutProperty).toHaveBeenLastCalledWith('traffic-flow', 'visibility', 'none')
  })
})
