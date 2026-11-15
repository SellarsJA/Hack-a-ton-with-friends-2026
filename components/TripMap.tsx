'use client'

import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { Option, Vehicle } from '@/src/contract/schema'
import {
  buildLineFeatures,
  buildVehicleFeatures,
  endpointMarkers,
  labelPoints,
  boundsFor,
  buildStopFeatures,
  MODE_COLORS,
  OTHER_VEHICLE_COLOR,
} from '@/src/map/lines'
import { OCCUPANCY_TEXT } from '@/components/format'
import { useMaplibre } from '@/src/map/useMaplibre'
import { placeTag } from '@/src/map/placeTag'
import { tomtomTrafficFlowUrl } from '@/src/tomtom/tiles'

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
const STOP_SOURCE = 'stops'
const TRAFFIC_LAYER = 'traffic-flow'
const NO_VEHICLES: Vehicle[] = []

/** The selected option's transit trips mapped to their mode colour, plus the labels of its rail vehicles. */
function selectedTrips(options: Option[], selectedId: string | null) {
  const trips = new Map<string, string>()
  const railLabels = new Set<string>()
  const option = options.find((o) => o.id === selectedId)
  if (option) {
    for (const leg of option.legs) {
      if (leg.mode === 'walk') continue
      trips.set(leg.tripId, MODE_COLORS[leg.mode])
      if (leg.mode === 'rail' && leg.vehicleLabel) railLabels.add(leg.vehicleLabel)
    }
  }
  return { trips, railLabels }
}
const RIDE_FILTER: maplibregl.FilterSpecification = ['==', ['get', 'kind'], 'ride']
const SELECTED_RIDE_FILTER: maplibregl.FilterSpecification = ['all', RIDE_FILTER, ['==', ['get', 'on'], 1]]
const selectedOf = (options: Option[], selectedId: string | null) =>
  options.find((o) => o.id === selectedId) ?? options[0]
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
  const map = useMaplibre(container)
  const markersRef = useRef<maplibregl.Marker[]>([])
  const endsRef = useRef<maplibregl.Marker[]>([])
  const onSelectRef = useRef(onSelect)
  const latest = useRef({ options, selectedId, showWalking, vehicles })
  const [showTraffic, setShowTraffic] = useState(false)
  const trafficRef = useRef(showTraffic)

  useEffect(() => {
    onSelectRef.current = onSelect
    latest.current = { options, selectedId, showWalking, vehicles }
    trafficRef.current = showTraffic
  })

  // Add the sources, layers and handlers once the map has loaded.
  useEffect(() => {
    if (!map) return
    {
      const { options, selectedId, showWalking } = latest.current
      // Live traffic goes first so it draws under the trip lines. Hidden until the rider turns it on;
      // a hidden layer requests no tiles.
      if (key) {
        map.addSource(TRAFFIC_LAYER, { type: 'raster', tiles: [tomtomTrafficFlowUrl(key)], tileSize: 256 })
        map.addLayer({
          id: TRAFFIC_LAYER,
          type: 'raster',
          source: TRAFFIC_LAYER,
          layout: { visibility: trafficRef.current ? 'visible' : 'none' },
          paint: { 'raster-opacity': 0.85 },
        })
      }
      map.addSource(SOURCE, { type: 'geojson', data: buildLineFeatures(options, selectedId, showWalking) })
      // Literal widths. A data-driven width was collapsing the stroke to a hairline on the basemap.
      // Only the selected option gets a casing; the others are thin, faded and still tappable.
      map.addLayer({
        id: 'lines-casing',
        type: 'line',
        source: SOURCE,
        filter: SELECTED_RIDE_FILTER,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#FFFFFF', 'line-width': 11 },
      })
      map.addLayer({
        id: 'lines-solid',
        type: 'line',
        source: SOURCE,
        filter: RIDE_FILTER,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['to-color', ['get', 'color']],
          'line-width': ['case', ['==', ['get', 'on'], 1], 7, 4],
          'line-opacity': ['case', ['==', ['get', 'on'], 1], 1, 0.6],
        },
      })
      map.addLayer({
        id: 'lines-dashed',
        type: 'line',
        source: SOURCE,
        filter: ['==', ['get', 'kind'], 'walk'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#475569', 'line-width': 4, 'line-dasharray': [0.1, 1.8] },
      })
      // Where the selected trip boards, transfers and gets off.
      map.addSource(STOP_SOURCE, {
        type: 'geojson',
        data: buildStopFeatures(selectedOf(latest.current.options, latest.current.selectedId)),
      })
      map.addLayer({
        id: 'stops-dots',
        type: 'circle',
        source: STOP_SOURCE,
        paint: {
          'circle-radius': ['case', ['==', ['get', 'transfer'], 1], 6, 5],
          'circle-color': '#FFFFFF',
          'circle-stroke-color': ['to-color', ['get', 'color']],
          'circle-stroke-width': 3,
        },
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
          // Vehicles on the selected trip stand out; other buses on those routes stay small and faint.
          'circle-radius': ['case', ['==', ['get', 'color'], OTHER_VEHICLE_COLOR], 4, 7],
          'circle-opacity': ['case', ['==', ['get', 'color'], OTHER_VEHICLE_COLOR], 0.55, 1],
          'circle-color': ['to-color', ['get', 'color']],
          'circle-stroke-color': '#FFFFFF',
          'circle-stroke-width': ['case', ['==', ['get', 'color'], OTHER_VEHICLE_COLOR], 1, 2.5],
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
      // Style load resets the camera to the constructor center and zoom.
      // Fit after that, or the route stays a short stroke on a city-wide map.
      fitRoute(map, latest.current.options)
    }
    return () => {
      markersRef.current.forEach((m) => m.remove())
      markersRef.current = []
      endsRef.current.forEach((m) => m.remove())
      endsRef.current = []
    }
  }, [map, key])

  // Fit again when a later search replaces the options. Before 'load', this is a no-op.
  useEffect(() => {
    if (!map) return
    fitRoute(map, options)
  }, [options, map])

  useEffect(() => {
    if (!map?.getLayer?.(TRAFFIC_LAYER)) return
    map.setLayoutProperty(TRAFFIC_LAYER, 'visibility', showTraffic ? 'visible' : 'none')
  }, [showTraffic, map])

  // Line data follows options/selection/walking.
  useEffect(() => {
    if (!map) return
    const src = map.getSource(SOURCE) as maplibregl.GeoJSONSource | undefined
    src?.setData(buildLineFeatures(options, selectedId, showWalking))
    const stops = map.getSource(STOP_SOURCE) as maplibregl.GeoJSONSource | undefined
    stops?.setData(buildStopFeatures(selectedOf(options, selectedId)))
  }, [options, selectedId, showWalking, map])

  // Vehicle dots follow the live poll and the selection (which sets their colour).
  useEffect(() => {
    if (!map) return
    const src = map.getSource(VEHICLE_SOURCE) as maplibregl.GeoJSONSource | undefined
    src?.setData(buildVehicleFeatures(vehicles, selectedTrips(options, selectedId).trips))
  }, [vehicles, options, selectedId, map])

  // One pill, on the selected option. Stacked pills for every option overlapped on a shared corridor;
  // the other options are tapped on their faded line or their card instead.
  useEffect(() => {
    if (!map) return
    markersRef.current.forEach((m) => m.remove())
    const option = selectedOf(options, selectedId)
    markersRef.current = labelPoints(option ? [option] : []).map((p) => {
      const el = document.createElement('div')
      el.dataset.optionId = p.optionId
      el.textContent = p.text
      el.style.cssText =
        'background:#111827;color:#fff;border-radius:9999px;padding:3px 10px;font:600 12px system-ui,sans-serif;white-space:nowrap;pointer-events:none;box-shadow:0 2px 6px rgba(0,0,0,.35);z-index:2'
      return new maplibregl.Marker({ element: el, offset: [0, -18] }).setLngLat(p.lngLat).addTo(map)
    })
  }, [options, selectedId, map])

  // Start and destination sit on the ends of the selected trip. The route pill is only the middle label.
  useEffect(() => {
    if (!map) return
    endsRef.current.forEach((m) => m.remove())
    const option = selectedOf(options, selectedId)
    endsRef.current = endpointMarkers(option).map((p) => {
      const text = p.role === 'start' ? fromLabel : toLabel
      const el = placeTag(text, p.role)
      return new maplibregl.Marker({ element: el, anchor: 'left', offset: [4, 0] }).setLngLat(p.lngLat).addTo(map)
    })
  }, [options, selectedId, fromLabel, toLabel, map])

  if (!key) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-zinc-200 text-sm dark:bg-zinc-800">
        Map unavailable
      </div>
    )
  }
  return (
    <div className="relative h-full w-full">
      <div ref={container} className="h-full w-full" />
      <button
        type="button"
        aria-pressed={showTraffic}
        onClick={() => setShowTraffic((t) => !t)}
        className={`absolute right-2 top-2 z-10 flex min-h-9 items-center gap-1.5 rounded-full px-3 text-sm font-semibold shadow-md ${
          showTraffic ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-900'
        }`}
      >
        <span aria-hidden className={`h-2 w-2 rounded-full ${showTraffic ? 'bg-emerald-400' : 'bg-zinc-400'}`} />
        Traffic
      </button>
      {showTraffic && (
        <div
          data-testid="traffic-legend"
          className="absolute bottom-7 left-2 z-10 flex items-center gap-1.5 rounded-md bg-white/95 px-2 py-1 text-xs font-medium text-zinc-900 shadow"
        >
          <span>Fast</span>
          <span aria-hidden className="h-1.5 w-14 rounded-full bg-gradient-to-r from-green-500 via-orange-400 to-red-600" />
          <span>Slow</span>
        </div>
      )}
    </div>
  )
}
