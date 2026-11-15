'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import PlaceField from './PlaceField'
import type { Place } from '@/src/tomtom/place'

type Locating = 'pending' | 'done' | 'denied'

export default function SearchForm() {
  const router = useRouter()
  const [start, setStart] = useState<Place | null>(null)
  const [dest, setDest] = useState<Place | null>(null)
  // No geolocation support is known up front, so it starts as 'denied' instead of being set in the effect.
  const [locating, setLocating] = useState<Locating>(() =>
    typeof navigator !== 'undefined' && !navigator.geolocation ? 'denied' : 'pending',
  )
  // Once the rider types or picks a start, a late GPS fix must not overwrite it.
  const touchedStart = useRef(false)

  useEffect(() => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (touchedStart.current) return
        setStart({
          kind: 'current',
          label: 'Your location',
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
        })
        setLocating('done')
      },
      // Denial, unavailability and timeout all take the same path.
      () => {
        if (!touchedStart.current) setLocating('denied')
      },
      { timeout: 10000, maximumAge: 60000 },
    )
  }, [])

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!start || !dest) return
    const params = new URLSearchParams({
      from: `${start.lat},${start.lon}`,
      to: `${dest.lat},${dest.lon}`,
      fromLabel: start.label,
      toLabel: dest.label,
    })
    router.push(`/results?${params}`)
  }

  return (
    <form onSubmit={submit} className="flex w-full flex-col gap-4">
      <PlaceField
        label="Start"
        placeholder="Start"
        value={start}
        onChange={(p) => {
          touchedStart.current = true
          setStart(p)
          setLocating((l) => (l === 'pending' ? 'done' : l))
        }}
        allowCurrentLocation
        pendingLabel={locating === 'pending' ? 'Your location' : undefined}
        hint={locating === 'pending' ? 'Locating…' : undefined}
      />
      {locating === 'denied' && !start && (
        <p role="status" className="text-sm text-zinc-600 dark:text-zinc-400">
          Location unavailable. Type a start.
        </p>
      )}
      <PlaceField label="Destination" placeholder="Where to?" value={dest} onChange={setDest} />
      <button
        type="submit"
        disabled={!start || !dest}
        className="h-12 w-full rounded-lg bg-blue-700 px-4 text-base font-semibold text-white disabled:opacity-50"
      >
        See options
      </button>
    </form>
  )
}
