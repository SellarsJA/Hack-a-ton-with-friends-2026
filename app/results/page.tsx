'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { PlanResponse } from '@/src/contract/schema'
import { parseLatLng } from '@/src/geo/geo'
import { hasLeft, mergeLive, useLiveOption } from '@/src/hooks/useLiveOption'
import LiveBanner from '@/components/LiveBanner'
import OptionList from '@/components/OptionList'

const TripMap = dynamic(() => import('@/components/TripMap'), { ssr: false })

type State = { kind: 'loading' } | { kind: 'error' } | { kind: 'ok'; plan: PlanResponse }

const EMPTY_TEXT = {
  no_stops_near_start: 'No stops within walking distance of your start.',
  no_stops_near_end: 'No stops within walking distance of your destination.',
  no_trips_soon: 'No direct trips in the next 90 minutes.',
} as const

function Results() {
  const params = useSearchParams()
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''
  const fromLabel = params.get('fromLabel') || 'Start'
  const toLabel = params.get('toLabel') || 'Destination'
  const valid = parseLatLng(from) !== null && parseLatLng(to) !== null

  const [state, setState] = useState<State>({ kind: 'loading' })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showWalking, setShowWalking] = useState(true)
  const [attempt, setAttempt] = useState(0)

  const retry = useCallback(() => {
    setState({ kind: 'loading' })
    setAttempt((n) => n + 1)
  }, [])

  useEffect(() => {
    if (!valid) return
    let cancelled = false
    const q = new URLSearchParams({ from, to })
    const fixture = process.env.NEXT_PUBLIC_USE_FIXTURE === '1' ? '&fixture=1' : ''
    fetch(`/api/plan?${q}${fixture}`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((json) => {
        const parsed = PlanResponse.safeParse(json)
        if (!parsed.success) throw new Error('bad response')
        if (cancelled) return
        setSelectedId(parsed.data.options[0]?.id ?? null)
        setState({ kind: 'ok', plan: parsed.data })
      })
      .catch(() => {
        if (!cancelled) setState({ kind: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [valid, from, to, attempt])

  const plan = state.kind === 'ok' ? state.plan : null
  const selected = plan?.options.find((o) => o.id === selectedId) ?? null
  const live = useLiveOption(selected?.liveKey ?? null)
  const displayed = useMemo(
    () =>
      plan && selected && live.data
        ? plan.options.map((o) => (o.id === selected.id ? mergeLive(o, live.data!) : o))
        : (plan?.options ?? []),
    [plan, selected, live.data],
  )
  // Keep the last live vehicles while a new selection loads (R18), rather than jumping back to plan time.
  const mapVehicles = live.vehicles.length > 0 ? live.vehicles : (plan?.vehicles ?? [])
  // The server's expired flag can lag (failed polls), so also check the merged first departure locally.
  const mergedSelected = displayed.find((o) => o.id === selectedId) ?? null
  const expired = live.data !== null && (live.data.expired || (mergedSelected !== null && hasLeft(mergedSelected, live.now)))

  if (!valid) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <p>Missing start or destination.</p>
        <Link href="/" className="text-blue-700 underline">
          Back to search
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto flex h-[calc(100dvh-3rem-env(safe-area-inset-bottom))] w-full max-w-md flex-col">
      <header className="flex min-h-12 items-center gap-2 px-2 py-2">
        <Link
          href="/"
          aria-label="Back"
          className="flex h-12 w-12 flex-none items-center justify-center rounded-full text-xl hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          ←
        </Link>
        <h1 className="flex min-w-0 flex-1 flex-col gap-1 text-sm font-semibold leading-snug">
          <span className="flex min-w-0 items-center gap-2">
            <span aria-hidden className="h-2.5 w-2.5 flex-none rounded-full bg-green-700" />
            <span className="truncate">{fromLabel}</span>
          </span>
          <span className="flex min-w-0 items-center gap-2">
            <span aria-hidden className="h-2.5 w-2.5 flex-none rounded-full bg-red-700" />
            <span className="truncate">{`→ ${toLabel}`}</span>
          </span>
        </h1>
      </header>
      <div className="h-[45%] shrink-0 bg-zinc-200 dark:bg-zinc-800">
        {state.kind === 'ok' && state.plan.options.length > 0 && (
          <TripMap
            options={state.plan.options}
            selectedId={selectedId}
            showWalking={showWalking}
            onSelect={setSelectedId}
            vehicles={mapVehicles}
            fromLabel={fromLabel}
            toLabel={toLabel}
          />
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        {state.kind === 'loading' && <p role="status">Finding trips…</p>}
        {state.kind === 'error' && (
          <div className="flex flex-col gap-3">
            <p role="alert">Couldn&apos;t load trip options. Check your connection and try again.</p>
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
            <LiveBanner ageSeconds={live.data ? live.ageSeconds : state.plan.liveDataAgeSeconds} />
            {state.plan.options.length === 0 ? (
              <p>{state.plan.emptyReason ? EMPTY_TEXT[state.plan.emptyReason] : 'No trips found.'}</p>
            ) : (
              <>
                <div className="flex min-h-12 items-center justify-between gap-3">
                  <span className="text-sm text-zinc-600 dark:text-zinc-400">
                    {`${state.plan.options.length} ${state.plan.options.length === 1 ? 'option' : 'options'}`}
                  </span>
                  <label className="flex min-h-12 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={showWalking}
                      onChange={(e) => setShowWalking(e.target.checked)}
                      className="h-5 w-5 accent-blue-600"
                    />
                    Show walking
                  </label>
                </div>
                <OptionList
                  options={displayed}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  expired={expired}
                  onSearchAgain={retry}
                  now={live.now}
                />
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default function ResultsPage() {
  return (
    <Suspense fallback={<p className="p-4">Finding trips…</p>}>
      <Results />
    </Suspense>
  )
}
