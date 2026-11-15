'use client'

import { useEffect, useId, useRef, useState } from 'react'
import type { Place } from '@/src/tomtom/place'
import { suggestAddresses } from '@/src/tomtom/suggest'
import type { SearchResponse } from '@/src/contract/schema'
import { MODE_COLORS } from '@/src/map/lines'
import { isStationName } from '@/src/plan/stationName'
import ModeIcon from './ModeIcon'

const DEBOUNCE_MS = 300

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
      <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </svg>
  )
}

/** Icon and word for a suggestion: stations get the train, other stops the bus, addresses a pin. */
function SuggestionKind({ place }: { place: Place }) {
  const station = place.kind === 'stop' && isStationName(place.label)
  const mode = station ? 'rail' : place.kind === 'stop' ? 'bus' : null
  return (
    <span className="flex w-16 flex-none items-center gap-1.5 text-xs font-medium uppercase text-zinc-500 dark:text-zinc-400">
      <span
        className={`flex h-6 w-6 flex-none items-center justify-center rounded-full ${
          mode ? 'text-white' : 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200'
        }`}
        style={mode ? { backgroundColor: MODE_COLORS[mode] } : undefined}
      >
        {mode ? <ModeIcon mode={mode} className="h-3.5 w-3.5" /> : <PinIcon />}
      </span>
      {station ? 'Station' : place.kind === 'stop' ? 'Stop' : 'Place'}
    </span>
  )
}

type Props = {
  label: string
  placeholder: string
  value: Place | null
  onChange: (place: Place | null) => void
  allowCurrentLocation?: boolean
  /** Text shown while value is null and a location is still being resolved. */
  pendingLabel?: string
  hint?: string
}

async function ownStops(q: string, signal: AbortSignal): Promise<Place[]> {
  const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal })
  if (!res.ok) return []
  const data = (await res.json()) as SearchResponse
  return data.stops.map((s) => ({ kind: 'stop', label: s.name, lat: s.lat, lon: s.lon }))
}

export default function PlaceField({
  label,
  placeholder,
  value,
  onChange,
  allowCurrentLocation = false,
  pendingLabel,
  hint,
}: Props) {
  const id = useId()
  const listId = `${id}-list`
  const [draft, setDraft] = useState<string | null>(null)
  const [results, setResults] = useState<Place[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  // A debounced lookup that lands after blur must not reopen the list.
  const focused = useRef(false)

  const text = draft ?? value?.label ?? pendingLabel ?? ''
  const query = draft?.trim() ?? ''

  useEffect(() => {
    if (query.length === 0) return
    const ctrl = new AbortController()
    const timer = setTimeout(async () => {
      const [stops, addresses] = await Promise.allSettled([
        ownStops(query, ctrl.signal),
        query.length >= 3 ? suggestAddresses(query, ctrl.signal) : Promise.resolve([]),
      ])
      if (ctrl.signal.aborted) return
      setResults([
        ...(stops.status === 'fulfilled' ? stops.value : []),
        ...(addresses.status === 'fulfilled' ? addresses.value : []),
      ])
      setActive(-1)
      if (focused.current) setOpen(true)
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [query])

  function type(raw: string) {
    // Typing over non-draft text ("Your location" or a picked label) replaces it.
    const next = draft === null && text && raw.startsWith(text) ? raw.slice(text.length) : raw
    setDraft(next)
    onChange(null)
    if (next.trim().length === 0) {
      setResults([])
      setOpen(false)
    }
  }

  function pick(place: Place) {
    setDraft(null)
    setOpen(false)
    setResults([])
    onChange(place)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => (a + 1) % results.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => (a <= 0 ? results.length - 1 : a - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      pick(results[active >= 0 ? active : 0])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  const listVisible = open && results.length > 0

  return (
    <div className="relative w-full">
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={listVisible}
        aria-controls={listVisible ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${id}-opt-${active}` : undefined}
        aria-describedby={hint ? `${id}-hint` : undefined}
        autoComplete="off"
        placeholder={placeholder}
        value={text}
        data-current-location={allowCurrentLocation && value?.kind === 'current' ? 'true' : undefined}
        onChange={(e) => type(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={(e) => {
          focused.current = true
          if (draft === null) e.target.select()
        }}
        onBlur={() => {
          // Options use onMouseDown preventDefault, so clicking one does not blur first.
          focused.current = false
          setOpen(false)
          setActive(-1)
        }}
        className="h-12 w-full rounded-lg border border-zinc-300 bg-white px-3 text-base text-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
      />
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-zinc-500">
          {hint}
        </p>
      )}
      {listVisible && (
        <ul
          id={listId}
          role="listbox"
          aria-label={`${label} suggestions`}
          className="absolute z-10 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-zinc-300 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        >
          {results.map((p, i) => (
            <li
              key={`${p.kind}-${p.label}-${p.lat}-${p.lon}`}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(p)}
              className={`flex min-h-12 cursor-pointer items-center gap-2 px-3 py-2 text-base ${
                i === active ? 'bg-zinc-100 dark:bg-zinc-800' : ''
              }`}
            >
              <SuggestionKind place={p} />
              <span className="min-w-0 break-words">{p.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
