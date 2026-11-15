'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { RoutesResponse, type RouteSummary } from '@/src/contract/schema'

type State = { kind: 'loading' } | { kind: 'error' } | { kind: 'ok'; routes: RouteSummary[] }

const SECTIONS = [
  { group: 'bus', title: 'Bus' },
  { group: 'rail', title: 'LRT' },
  { group: 'regional', title: 'Regional' },
] as const

export default function RoutesPage() {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [query, setQuery] = useState('')
  const [attempt, setAttempt] = useState(0)

  const retry = useCallback(() => {
    setState({ kind: 'loading' })
    setAttempt((n) => n + 1)
  }, [])

  useEffect(() => {
    let cancelled = false
    const fixture = process.env.NEXT_PUBLIC_USE_FIXTURE === '1' ? '?fixture=1' : ''
    fetch(`/api/routes${fixture}`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((json) => {
        const parsed = RoutesResponse.safeParse(json)
        if (!parsed.success) throw new Error('bad response')
        if (!cancelled) setState({ kind: 'ok', routes: parsed.data.routes })
      })
      .catch(() => {
        if (!cancelled) setState({ kind: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [attempt])

  const q = query.trim().toLowerCase()
  const routes = useMemo(() => {
    if (state.kind !== 'ok') return []
    if (!q) return state.routes
    return state.routes.filter(
      (r) => r.shortName.toLowerCase().includes(q) || r.longName.toLowerCase().includes(q),
    )
  }, [state, q])

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 py-6">
      <h1 className="text-2xl font-semibold tracking-tight">Routes</h1>
      {state.kind === 'loading' && <p role="status">Loading routes…</p>}
      {state.kind === 'error' && (
        <div className="flex flex-col gap-3">
          <p role="alert">Couldn&apos;t load routes. Check your connection and try again.</p>
          <button
            type="button"
            onClick={retry}
            className="h-12 rounded-lg bg-blue-700 px-4 font-semibold text-white"
          >
            Try again
          </button>
        </div>
      )}
      {state.kind === 'ok' && (
        <>
          <label className="flex flex-col gap-1 text-sm font-medium">
            <span className="sr-only">Search routes</span>
            <input
              type="search"
              aria-label="Search routes"
              placeholder="Search routes"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-12 rounded-lg border border-zinc-400 bg-white px-3 text-base text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100"
            />
          </label>
          {SECTIONS.map(({ group, title }) => {
            const rows = routes.filter((r) => r.group === group)
            if (rows.length === 0) return null
            return (
              <section key={group} className="flex flex-col gap-1">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
                  {title}
                </h2>
                <ul className="flex flex-col">
                  {rows.map((r) => (
                    <li key={r.routeId}>
                      <Link
                        href={`/routes/${encodeURIComponent(r.routeId)}`}
                        className="flex min-h-12 items-center border-b border-zinc-200 py-2 dark:border-zinc-800"
                      >
                        {`${r.shortName} · ${r.longName}`}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
          {routes.length === 0 && <p>No routes match.</p>}
        </>
      )}
    </main>
  )
}
