'use client'

import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Option } from '@/src/contract/schema'
import { buildLineFeatures, labelPoints, boundsFor } from '@/src/map/lines'
import { tomtomRasterUrl, tomtomCopyrightUrl } from '@/src/tomtom/tiles'

type Props = {
  options: Option[]
  selectedId: string | null
  showWalking: boolean
  onSelect: (optionId: string) => void
}

const SOURCE = 'lines'
const FALLBACK_ATTRIBUTION = '© TomTom'

function styleFor(key: string): maplibregl.StyleSpecification {
  return {
    version: 8,
    sources: { base: { type: 'raster', tiles: [tomtomRasterUrl(key)], tileSize: 256, maxzoom: 22 } },
    layers: [{ id: 'base', type: 'raster', source: 'base' }],
  }
}

export default function TripMap({ options, selectedId, showWalking, onSelect }: Props) {
  const key = process.env.NEXT_PUBLIC_TOMTOM_KEY
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const loadedRef = useRef(false)
  const markersRef = useRef<maplibregl.Marker[]>([])
  const onSelectRef = useRef(onSelect)
  const latest = useRef({ options, selectedId, showWalking })

  useEffect(() => {
    onSelectRef.current = onSelect
    latest.current = { options, selectedId, showWalking }
  })

  // Create the map once.
  useEffect(() => {
    if (!key || !container.current) return
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
      attribution = new maplibregl.AttributionControl({ customAttribution: text })
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
      const paint: maplibregl.LineLayerSpecification['paint'] = {
        'line-color': ['get', 'color'],
        'line-width': ['get', 'width'],
      }
      const layout: maplibregl.LineLayerSpecification['layout'] = { 'line-cap': 'round', 'line-join': 'round' }
      map.addLayer({
        id: 'lines-solid',
        type: 'line',
        source: SOURCE,
        filter: ['!=', ['get', 'dashed'], true],
        layout,
        paint: { ...paint },
      })
      map.addLayer({
        id: 'lines-dashed',
        type: 'line',
        source: SOURCE,
        filter: ['==', ['get', 'dashed'], true],
        layout: { 'line-join': 'round' },
        paint: { ...paint, 'line-dasharray': [2, 2] },
      })
      for (const id of ['lines-solid', 'lines-dashed']) {
        map.on('click', id, (e: maplibregl.MapLayerMouseEvent) => {
          const optionId = e.features?.[0]?.properties?.optionId
          if (typeof optionId === 'string') onSelectRef.current(optionId)
        })
        map.on('mouseenter', id, () => (map.getCanvas().style.cursor = 'pointer'))
        map.on('mouseleave', id, () => (map.getCanvas().style.cursor = ''))
      }
      loadedRef.current = true
    })

    return () => {
      cancelled = true
      loadedRef.current = false
      markersRef.current.forEach((m) => m.remove())
      markersRef.current = []
      map.remove()
      mapRef.current = null
    }
  }, [key])

  // Fit bounds when options change.
  useEffect(() => {
    const map = mapRef.current
    if (!map || options.length === 0) return
    const [[a, b], [c, d]] = boundsFor(options)
    if (!Number.isFinite(a)) return
    map.fitBounds(
      [
        [a, b],
        [c, d],
      ],
      { padding: 40, animate: false },
    )
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
      return new maplibregl.Marker({ element: el }).setLngLat(p.lngLat).addTo(map)
    })
  }, [options, key])

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
