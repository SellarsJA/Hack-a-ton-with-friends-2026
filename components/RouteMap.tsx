'use client'

import { useEffect, useRef } from 'react'
import type * as maplibregl from 'maplibre-gl'
import type { RouteDetail } from '@/src/contract/schema'
import { buildRouteFeatures, buildVehicleFeatures, patternBounds, routeColor } from '@/src/map/lines'
import { useMaplibre } from '@/src/map/useMaplibre'

type Props = {
  detail: RouteDetail
  selectedStopId: string | null
  onSelectStop: (stopId: string) => void
  /** Index into detail.patterns; the map fits to and shows the stops of this pattern. */
  patternIndex?: number
}

const SOURCE = 'route'
const VEHICLE_SOURCE = 'route-vehicles'
const FIT = { padding: 40, animate: false, maxZoom: 16 } as const

function vehicleData(detail: RouteDetail) {
  const color = routeColor(detail.route.color)
  const trips = new Map(detail.vehicles.map((v) => [v.tripId, color]))
  return buildVehicleFeatures(detail.vehicles, trips)
}

function fit(map: maplibregl.Map, detail: RouteDetail, patternIndex: number) {
  const b = patternBounds(detail, patternIndex)
  if (!b) return
  map.resize()
  map.fitBounds(b, FIT)
}

export default function RouteMap({ detail, selectedStopId, onSelectStop, patternIndex = 0 }: Props) {
  const key = process.env.NEXT_PUBLIC_TOMTOM_KEY
  const container = useRef<HTMLDivElement>(null)
  const map = useMaplibre(container)
  const onSelectRef = useRef(onSelectStop)
  const latest = useRef({ detail, selectedStopId, patternIndex })

  useEffect(() => {
    onSelectRef.current = onSelectStop
    latest.current = { detail, selectedStopId, patternIndex }
  })

  // Sources and layers, once the map has loaded.
  useEffect(() => {
    if (!map) return
    const { detail, selectedStopId, patternIndex } = latest.current
    map.addSource(SOURCE, { type: 'geojson', data: buildRouteFeatures(detail, selectedStopId, patternIndex) })
    const line = ['==', ['get', 'kind'], 'line'] as maplibregl.FilterSpecification
    const stop = ['==', ['get', 'kind'], 'stop'] as maplibregl.FilterSpecification
    map.addLayer({
      id: 'route-casing',
      type: 'line',
      source: SOURCE,
      filter: line,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#111827', 'line-width': 9 },
    })
    map.addLayer({
      id: 'route-line',
      type: 'line',
      source: SOURCE,
      filter: line,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['to-color', ['get', 'color']],
        'line-width': ['case', ['==', ['get', 'on'], 1], 6, 3],
        'line-opacity': ['case', ['==', ['get', 'on'], 1], 1, 0.6],
      },
    })
    map.addLayer({
      id: 'route-stops',
      type: 'circle',
      source: SOURCE,
      filter: stop,
      paint: {
        'circle-radius': ['case', ['==', ['get', 'selected'], 1], 9, 5],
        'circle-color': ['case', ['==', ['get', 'selected'], 1], '#111827', '#FFFFFF'],
        'circle-stroke-color': ['case', ['==', ['get', 'selected'], 1], '#FFFFFF', '#111827'],
        'circle-stroke-width': 2,
      },
    })
    map.addSource(VEHICLE_SOURCE, { type: 'geojson', data: vehicleData(detail) })
    map.addLayer({
      id: 'route-vehicles',
      type: 'circle',
      source: VEHICLE_SOURCE,
      paint: {
        'circle-radius': 6,
        'circle-color': ['to-color', ['get', 'color']],
        'circle-stroke-color': '#FFFFFF',
        'circle-stroke-width': 2,
      },
    })
    map.on('click', 'route-stops', (e: maplibregl.MapLayerMouseEvent) => {
      const id = e.features?.[0]?.properties?.stopId
      if (typeof id === 'string') onSelectRef.current(id)
    })
    map.on('mouseenter', 'route-stops', () => (map.getCanvas().style.cursor = 'pointer'))
    map.on('mouseleave', 'route-stops', () => (map.getCanvas().style.cursor = ''))
    fit(map, detail, patternIndex)
  }, [map])

  // Data follows the selection and the poll.
  useEffect(() => {
    if (!map) return
    const src = map.getSource(SOURCE) as maplibregl.GeoJSONSource | undefined
    src?.setData(buildRouteFeatures(detail, selectedStopId, patternIndex))
    const veh = map.getSource(VEHICLE_SOURCE) as maplibregl.GeoJSONSource | undefined
    veh?.setData(vehicleData(detail))
  }, [map, detail, selectedStopId, patternIndex])

  // Refit only when the pattern changes (not on every stop tap).
  const lastPattern = useRef(patternIndex)
  useEffect(() => {
    if (!map || lastPattern.current === patternIndex) return
    lastPattern.current = patternIndex
    fit(map, latest.current.detail, patternIndex)
  }, [map, patternIndex])

  if (!key) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-zinc-200 text-sm dark:bg-zinc-800">
        Map unavailable
      </div>
    )
  }
  return <div ref={container} className="h-full w-full" />
}
