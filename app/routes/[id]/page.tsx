'use client'

import { Suspense, use, useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { RouteDetail } from '@/src/contract/schema'
import { clock } from '@/components/format'

const RouteMap = dynamic(() => import('@/components/RouteMap'), { ssr: false })

type State =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'missing' }
  | { kind: 'ok'; detail: RouteDetail }

export default function RoutePage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<p role="status" className="p-4">Loading route…</p>}>
      <RouteScreen params={params} />
    </Suspense>
  )
}

function RouteScreen({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [stopId, setStopId] = useState<string | null>(null)
  const [patternIndex, setPatternIndex] = useState(0)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    const q = new URLSearchParams()
    if (stopId) q.set('stop', stopId)
    if (process.env.NEXT_PUBLIC_USE_FIXTURE === '1') q.set('fixture', '1')
    const qs = q.toString()
    fetch(`/api/routes/${encodeURIComponent(id)}${qs ? `?${qs}` : ''}`, { cache: 'no-store' })
      .then((res) => {
        if (res.status === 404) return null
        return res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))
      })
      .then((json) => {
        if (cancelled) return
        if (json === null) return setState({ kind: 'missing' })
        const parsed = RouteDetail.safeParse(json)
        if (!parsed.success) throw new Error('bad response')
        setState({ kind: 'ok', detail: parsed.data })
      })
      .catch(() => {
        // Keep showing what we have when only a stop refetch fails.
        if (!cancelled) setState((s) => (s.kind === 'ok' ? s : { kind: 'error' }))
      })
    return () => {
      cancelled = true
    }
  }, [id, stopId, attempt])

  if (state.kind === 'missing') {
    return (
      <main className="flex flex-col gap-3 p-4">
        <p>Route not found.</p>
        <Link href="/routes" className="text-blue-700 underline">
          Back to routes
        </Link>
      </main>
    )
  }
  if (state.kind === 'loading') return <p role="status" className="p-4">Loading route…</p>
  if (state.kind === 'error') {
    return (
      <main className="flex flex-col gap-3 p-4">
        <p role="alert">Couldn&apos;t load this route. Check your connection and try again.</p>
        <button
          type="button"
          onClick={() => {
            setState({ kind: 'loading' })
            setAttempt((n) => n + 1)
          }}
          className="h-12 rounded-lg bg-blue-700 px-4 font-semibold text-white"
        >
          Try again
        </button>
      </main>
    )
  }

  const { detail } = state
  const pattern = detail.patterns[Math.min(patternIndex, detail.patterns.length - 1)]
  const current = pattern ? detail.patterns.indexOf(pattern) : 0

  return (
    <main className="mx-auto flex w-full max-w-md flex-col">
      <header className="flex min-h-12 items-center gap-3 px-4 py-2">
        <Link href="/routes" aria-label="Back to routes" className="flex h-12 w-12 items-center justify-center text-xl">
          ←
        </Link>
        <h1 className="min-w-0 flex-1 text-sm font-semibold leading-snug">
          {`${detail.route.shortName} · ${detail.route.longName}`}
        </h1>
      </header>
      {detail.alerts.length > 0 && (
        <ul className="flex flex-col gap-1 px-4 pb-2 text-sm">
          {detail.alerts.map((a, i) => (
            <li key={i}>{`⚠️ ${a.headline}`}</li>
          ))}
        </ul>
      )}
      <div className="h-[40dvh] shrink-0 bg-zinc-200 dark:bg-zinc-800">
        <RouteMap detail={detail} selectedStopId={stopId} onSelectStop={setStopId} patternIndex={current} />
      </div>
      <div className="flex flex-col gap-4 p-4">
        {detail.patterns.length >= 2 && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Direction">
            {detail.patterns.map((p, i) => (
              <button
                key={`${p.headsign}-${i}`}
                type="button"
                aria-pressed={i === current}
                onClick={() => setPatternIndex(i)}
                className={`min-h-12 rounded-lg border px-4 text-sm font-semibold ${
                  i === current ? 'border-blue-700 bg-blue-700 text-white' : 'border-zinc-400'
                }`}
              >
                {p.headsign}
              </button>
            ))}
          </div>
        )}
        <section>
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">Stops</h2>
          <ul>
            {(pattern?.stops ?? []).map((s) => (
              <li key={s.stopId}>
                <button
                  type="button"
                  aria-pressed={s.stopId === stopId}
                  onClick={() => setStopId(s.stopId)}
                  className={`flex min-h-12 w-full items-center border-b border-zinc-200 py-2 text-left dark:border-zinc-800 ${
                    s.stopId === stopId ? 'font-bold' : ''
                  }`}
                >
                  {s.name}
                </button>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
            Next departures
          </h2>
          {detail.departures.length === 0 ? (
            <p>No more trips today from this stop.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {detail.departures.map((d) => (
                <li key={d.tripId} className="flex flex-wrap items-center gap-2">
                  <span>{`${clock(d.departAt)} · ${d.realtime ? 'Live' : 'Scheduled'}`}</span>
                  <span className="text-sm text-zinc-600 dark:text-zinc-400">{d.headsign}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  )
}
