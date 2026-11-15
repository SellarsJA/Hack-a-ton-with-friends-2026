'use client'

import { useEffect, useId, useState } from 'react'
import type { Place } from '@/src/tomtom/place'
import { suggestAddresses } from '@/src/tomtom/suggest'
import type { SearchResponse } from '@/src/contract/schema'

const DEBOUNCE_MS = 300

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
      setOpen(true)
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

  return (
    <div className="relative w-full">
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
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
          if (draft === null) e.target.select()
        }}
        className="h-12 w-full rounded-lg border border-zinc-300 bg-white px-3 text-base text-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
      />
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-zinc-500">
          {hint}
        </p>
      )}
      {open && results.length > 0 && (
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
              <span className="text-xs uppercase text-zinc-500">{p.kind === 'stop' ? 'Stop' : 'Place'}</span>
              <span className="min-w-0 break-words">{p.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
