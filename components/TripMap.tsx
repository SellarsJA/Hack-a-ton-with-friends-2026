'use client'

import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Option, Vehicle } from '@/src/contract/schema'
import {
  buildLineFeatures,
  buildVehicleFeatures,
  endpointMarkers,
  labelPoints,
  boundsFor,
  OPTION_COLORS,
} from '@/src/map/lines'
import { OCCUPANCY_TEXT } from '@/components/format'
import { tomtomRasterUrl, tomtomCopyrightUrl, attributionOptions } from '@/src/tomtom/tiles'

type Props = {
  options: Option[]
  selectedId: string | null
  showWalking: boolean
  onSelect: (optionId: string) => void
  fromLabel?: string
  toLabel?: string
  vehicles?: Vehicle[]
}

const SOURCE = 'lines'
const VEHICLE_SOURCE = 'vehicles'
const VEHICLE_LAYER = 'vehicles-dots'
const NO_VEHICLES: Vehicle[] = []

/** The selected option's transit trips mapped to its colour, plus the labels of its rail vehicles. */
function selectedTrips(options: Option[], selectedId: string | null) {
  const trips = new Map<string, string>()
  const railLabels = new Set<string>()
  const i = options.findIndex((o) => o.id === selectedId)
  if (i >= 0) {
    for (const leg of options[i].legs) {
      if (leg.mode === 'walk') continue
      trips.set(leg.tripId, OPTION_COLORS[i % OPTION_COLORS.length])
      if (leg.mode === 'rail' && leg.vehicleLabel) railLabels.add(leg.vehicleLabel)
    }
  }
  return { trips, railLabels }
}
const RIDE_FILTER: maplibregl.FilterSpecification = ['==', ['get', 'kind'], 'ride']
const FALLBACK_ATTRIBUTION = '© TomTom'
const FIT = { padding: 40, animate: false, maxZoom: 16 } as const

function fitRoute(map: maplibregl.Map, options: Option[]) {
  if (options.length === 0) return
  const [[west, south], [east, north]] = boundsFor(options)
  if (!Number.isFinite(west) || west === Infinity) return
  // The panel's percentage height can still be settling when the style loads.
  map.resize()
  map.fitBounds(
    [
      [west, south],
      [east, north],
    ],
    FIT,
  )
}

function placeTag(text: string, role: 'start' | 'destination') {
  const el = document.createElement('div')
  el.dataset.role = role
  el.setAttribute('aria-label', `${role}: ${text}`)
  el.style.cssText = 'display:flex;align-items:center;gap:4px;pointer-events:none;max-width:180px'
  const dot = document.createElement('span')
  dot.textContent = role === 'start' ? 'A' : 'B'
  const fill = role === 'start' ? '#15803D' : '#B91C1C'
  dot.style.cssText = `flex:none;display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:9999px;background:${fill};color:#fff;font:700 11px system-ui,sans-serif;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.45)`
  const name = document.createElement('span')
  name.textContent = text
  name.style.cssText =
    'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:#fff;color:#111827;border:1px solid #111827;border-radius:9999px;padding:1px 6px;font:600 11px system-ui,sans-serif'
  el.append(dot, name)
  return el
}

function styleFor(key: string): maplibregl.StyleSpecification {
  return {
    version: 8,
    sources: { base: { type: 'raster', tiles: [tomtomRasterUrl(key)], tileSize: 256, maxzoom: 22 } },
    layers: [{ id: 'base', type: 'raster', source: 'base' }],
  }
}

export default function TripMap({
  options,
  selectedId,
  showWalking,
  onSelect,
  fromLabel = 'Start',
  toLabel = 'Destination',
  vehicles = NO_VEHICLES,
}: Props) {
  const key = process.env.NEXT_PUBLIC_TOMTOM_KEY
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const loadedRef = useRef(false)
  const markersRef = useRef<maplibregl.Marker[]>([])
  const endsRef = useRef<maplibregl.Marker[]>([])
  const onSelectRef = useRef(onSelect)
  const latest = useRef({ options, selectedId, showWalking, vehicles })

  useEffect(() => {
    onSelectRef.current = onSelect
    latest.current = { options, selectedId, showWalking, vehicles }
  })

  // Create the map once.
  useEffect(() => {
    if (!key || !container.current) return
    // The bundled chunk's default worker URL 404s, so GeoJSON lines are never drawn.
    maplibregl.setWorkerUrl?.('/maplibre-gl-worker.js')
    const map = new maplibregl.Map({
      container: container.current,
      style: styleFor(key),
      attributionControl: false,
      center: [-113.4909, 53.5444],
      zoom: 11,
    })
    mapRef.current = map
    let attribution: maplibregl.AttributionControl | null = null
    const setAttribution = (text: string) => {
      if (attribution) map.removeControl(attribution)
      attribution = new maplibregl.AttributionControl(attributionOptions(text))
      map.addControl(attribution, 'bottom-right')
    }
    setAttribution(FALLBACK_ATTRIBUTION)

    let cancelled = false
    fetch(tomtomCopyrightUrl(key))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j: { copyrightsCaption?: string }) => {
        if (!cancelled && j.copyrightsCaption) setAttribution(j.copyrightsCaption)
      })
      .catch(() => {})

    map.on('load', () => {
      const { options, selectedId, showWalking } = latest.current
      map.addSource(SOURCE, { type: 'geojson', data: buildLineFeatures(options, selectedId, showWalking) })
      // Literal widths. A data-driven width was collapsing the stroke to a hairline on the basemap.
      map.addLayer({
        id: 'lines-casing',
        type: 'line',
        source: SOURCE,
        filter: RIDE_FILTER,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#111827', 'line-width': 12 },
      })
      map.addLayer({
        id: 'lines-solid',
        type: 'line',
        source: SOURCE,
        filter: RIDE_FILTER,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['to-color', ['get', 'color']],
          'line-width': ['case', ['==', ['get', 'on'], 1], 8, 5],
        },
      })
      map.addLayer({
        id: 'lines-dashed',
        type: 'line',
        source: SOURCE,
        filter: ['==', ['get', 'kind'], 'walk'],
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: { 'line-color': '#374151', 'line-width': 4, 'line-dasharray': [2, 2] },
      })
      for (const id of ['lines-casing', 'lines-solid', 'lines-dashed']) {
        map.on('click', id, (e: maplibregl.MapLayerMouseEvent) => {
          const optionId = e.features?.[0]?.properties?.optionId
          if (typeof optionId === 'string') onSelectRef.current(optionId)
        })
        map.on('mouseenter', id, () => (map.getCanvas().style.cursor = 'pointer'))
        map.on('mouseleave', id, () => (map.getCanvas().style.cursor = ''))
      }
      // Vehicle dots go last so they draw above the route lines.
      const sel = selectedTrips(latest.current.options, latest.current.selectedId)
      map.addSource(VEHICLE_SOURCE, {
        type: 'geojson',
        data: buildVehicleFeatures(latest.current.vehicles, sel.trips),
      })
      map.addLayer({
        id: VEHICLE_LAYER,
        type: 'circle',
        source: VEHICLE_SOURCE,
        paint: {
          'circle-radius': 6,
          'circle-color': ['to-color', ['get', 'color']],
          'circle-stroke-color': '#FFFFFF',
          'circle-stroke-width': 2,
        },
      })
      map.on('click', VEHICLE_LAYER, (e: maplibregl.MapLayerMouseEvent) => {
        const f = e.features?.[0]
        if (!f || f.geometry.type !== 'Point') return
        const label = String(f.properties?.label ?? '')
        const occ = f.properties?.occupancy
        const rail = selectedTrips(latest.current.options, latest.current.selectedId).railLabels.has(label)
        const occText = typeof occ === 'string' && occ in OCCUPANCY_TEXT ? ` · ${OCCUPANCY_TEXT[occ as keyof typeof OCCUPANCY_TEXT]}` : ''
        const [lon, lat] = f.geometry.coordinates
        new maplibregl.Popup({ closeButton: false })
          .setLngLat([lon, lat])
          .setText(`${rail ? 'Train' : 'Bus'} ${label}${occText}`)
          .addTo(map)
      })
      map.on('mouseenter', VEHICLE_LAYER, () => (map.getCanvas().style.cursor = 'pointer'))
      map.on('mouseleave', VEHICLE_LAYER, () => (map.getCanvas().style.cursor = ''))
      loadedRef.current = true
      // Style load resets the camera to the constructor center and zoom.
      // Fit after that, or the route stays a short stroke on a city-wide map.
      fitRoute(map, latest.current.options)
    })

    return () => {
      cancelled = true
      loadedRef.current = false
      markersRef.current.forEach((m) => m.remove())
      markersRef.current = []
      endsRef.current.forEach((m) => m.remove())
      endsRef.current = []
      map.remove()
      mapRef.current = null
    }
  }, [key])

  // Fit again when a later search replaces the options. Before 'load', this is a no-op.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !loadedRef.current) return
    fitRoute(map, options)
  }, [options, key])

  // Line data follows options/selection/walking.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    // Before 'load', the load handler reads the latest props itself.
    if (!loadedRef.current) return
    const src = map.getSource(SOURCE) as maplibregl.GeoJSONSource | undefined
    src?.setData(buildLineFeatures(options, selectedId, showWalking))
  }, [options, selectedId, showWalking, key])

  // Vehicle dots follow the live poll and the selection (which sets their colour).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !loadedRef.current) return
    const src = map.getSource(VEHICLE_SOURCE) as maplibregl.GeoJSONSource | undefined
    src?.setData(buildVehicleFeatures(vehicles, selectedTrips(options, selectedId).trips))
  }, [vehicles, options, selectedId, key])

  // Label markers rebuilt when options change; selection only restyles them.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    markersRef.current.forEach((m) => m.remove())
    markersRef.current = labelPoints(options).map((p) => {
      const el = document.createElement('button')
      el.type = 'button'
      el.dataset.optionId = p.optionId
      el.textContent = p.text
      el.style.cssText =
        'background:#fff;color:#111827;border:2px solid #111827;border-radius:9999px;padding:2px 8px;font:600 12px system-ui,sans-serif;white-space:nowrap;cursor:pointer;min-height:24px'
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        onSelectRef.current(p.optionId)
      })
      return new maplibregl.Marker({ element: el, offset: [0, p.offsetY] }).setLngLat(p.lngLat).addTo(map)
    })
  }, [options, key])

  // Start and destination sit on the ends of the selected trip. The route pill is only the middle label.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    endsRef.current.forEach((m) => m.remove())
    const option = options.find((o) => o.id === selectedId) ?? options[0]
    endsRef.current = endpointMarkers(option).map((p) => {
      const text = p.role === 'start' ? fromLabel : toLabel
      const el = placeTag(text, p.role)
      return new maplibregl.Marker({ element: el, anchor: 'left', offset: [4, 0] }).setLngLat(p.lngLat).addTo(map)
    })
  }, [options, selectedId, fromLabel, toLabel, key])

  useEffect(() => {
    for (const m of markersRef.current) {
      const el = m.getElement()
      const on = el.dataset.optionId === selectedId
      el.style.zIndex = on ? '2' : '1'
      el.style.boxShadow = on ? '0 2px 8px rgba(0,0,0,.5)' : 'none'
      el.style.fontSize = on ? '14px' : '12px'
      el.style.borderWidth = on ? '3px' : '2px'
    }
  }, [selectedId, options, key])

  if (!key) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-zinc-200 text-sm dark:bg-zinc-800">
        Map unavailable
      </div>
    )
  }
  return <div ref={container} className="h-full w-full" />
}
