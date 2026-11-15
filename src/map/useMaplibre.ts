'use client'

import { useEffect, useState, type RefObject } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { tomtomRasterUrl, tomtomCopyrightUrl, attributionOptions } from '@/src/tomtom/tiles'

const FALLBACK_ATTRIBUTION = '© TomTom'

function styleFor(key: string): maplibregl.StyleSpecification {
  return {
    version: 8,
    sources: { base: { type: 'raster', tiles: [tomtomRasterUrl(key)], tileSize: 256, maxzoom: 22 } },
    layers: [{ id: 'base', type: 'raster', source: 'base' }],
  }
}

/**
 * Creates the TomTom-backed map in `container` and returns it once its style has loaded
 * (null before that, or when NEXT_PUBLIC_TOMTOM_KEY is missing). Removes the map on teardown.
 */
export function useMaplibre(container: RefObject<HTMLDivElement | null>): maplibregl.Map | null {
  const key = process.env.NEXT_PUBLIC_TOMTOM_KEY
  const [map, setMap] = useState<maplibregl.Map | null>(null)

  useEffect(() => {
    if (!key || !container.current) return
    // The bundled chunk's default worker URL 404s, so GeoJSON lines are never drawn.
    maplibregl.setWorkerUrl?.('/maplibre-gl-worker.js')
    const created = new maplibregl.Map({
      container: container.current,
      style: styleFor(key),
      attributionControl: false,
      center: [-113.4909, 53.5444],
      zoom: 11,
    })
    let attribution: maplibregl.AttributionControl | null = null
    const setAttribution = (text: string) => {
      if (attribution) created.removeControl(attribution)
      attribution = new maplibregl.AttributionControl(attributionOptions(text))
      created.addControl(attribution, 'bottom-right')
    }
    setAttribution(FALLBACK_ATTRIBUTION)

    let cancelled = false
    fetch(tomtomCopyrightUrl(key))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j: { copyrightsCaption?: string }) => {
        if (!cancelled && j.copyrightsCaption) setAttribution(j.copyrightsCaption)
      })
      .catch(() => {})

    created.on('load', () => {
      if (!cancelled) setMap(created)
    })

    return () => {
      cancelled = true
      created.remove()
    }
  }, [key, container])

  return map
}
