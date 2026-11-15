'use client'

import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { Place } from '@/src/tomtom/place'
import { useMaplibre } from '@/src/map/useMaplibre'
import { placeTag } from '@/src/map/placeTag'

type Props = { start: Place | null; dest: Place | null }

const ONE_PLACE_ZOOM = 15
const FIT = { padding: 60, maxZoom: 16 } as const

/** The picked start and destination on a map, so riders can check them before searching. */
export default function HomeMap({ start, dest }: Props) {
  const key = process.env.NEXT_PUBLIC_TOMTOM_KEY
  const container = useRef<HTMLDivElement>(null)
  const map = useMaplibre(container)
  const markers = useRef<maplibregl.Marker[]>([])

  useEffect(() => {
    if (!map) return
    markers.current.forEach((m) => m.remove())
    const places = [
      start && { place: start, role: 'start' as const },
      dest && { place: dest, role: 'destination' as const },
    ].filter((p) => p !== null)
    markers.current = places.map(({ place, role }) =>
      new maplibregl.Marker({ element: placeTag(place.label, role), anchor: 'left', offset: [-11, 0] })
        .setLngLat([place.lon, place.lat])
        .addTo(map),
    )
    const animate = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (places.length === 1) {
      const { lon, lat } = places[0].place
      map.easeTo({ center: [lon, lat], zoom: ONE_PLACE_ZOOM, animate })
    } else if (places.length === 2) {
      const lons = places.map((p) => p.place.lon)
      const lats = places.map((p) => p.place.lat)
      map.fitBounds(
        [
          [Math.min(...lons), Math.min(...lats)],
          [Math.max(...lons), Math.max(...lats)],
        ],
        { ...FIT, animate },
      )
    }
  }, [map, start, dest])

  useEffect(
    () => () => {
      markers.current.forEach((m) => m.remove())
      markers.current = []
    },
    [],
  )

  // Without a key the home page simply has no map; the form still works.
  if (!key) return null
  return (
    <div
      data-testid="home-map"
      className="isolate h-64 w-full overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-200 dark:border-zinc-800 dark:bg-zinc-800"
    >
      <div ref={container} className="h-full w-full" />
    </div>
  )
}
