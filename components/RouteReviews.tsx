'use client'

import { useEffect, useState } from 'react'
import { RouteFeedbackResponse, type Issue, type RouteFeedbackSummary } from '@/src/contract/schema'
import { routeName } from './format'

type Summary = RouteFeedbackSummary

const cache = new Map<string, Promise<Summary | null>>()

export function __resetRouteReviewsCacheForTests() {
  cache.clear()
}

/** Forget a route's cached reviews so the next render refetches (call after the rider submits feedback). */
export function invalidateRouteReviews(routeId: string) {
  cache.delete(routeId)
}

/** One request for every route not cached yet; each route gets its own promise in the cache. */
function load(routeIds: string[]): Promise<(Summary | null)[]> {
  const missing = routeIds.filter((id) => !cache.has(id))
  if (missing.length > 0) {
    const batch = fetch(`/api/feedback/routes?ids=${encodeURIComponent(missing.join(','))}`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) return null
        const parsed = RouteFeedbackResponse.safeParse(await res.json())
        return parsed.success ? parsed.data.routes : null
      })
      .catch(() => null)
    for (const id of missing) cache.set(id, batch.then((routes) => routes?.find((r) => r.routeId === id) ?? null))
  }
  return Promise.all(routeIds.map((id) => cache.get(id)!))
}

const ISSUE_TEXT: Record<Issue, string> = {
  cleanliness: 'cleanliness',
  safety: 'safety',
  disruption: 'disruption',
  too_full: 'too full',
}
const ISSUE_ORDER: Issue[] = ['cleanliness', 'safety', 'disruption', 'too_full']

/** "★ 4.0 (3) · 2 cleanliness · 1 too full", or null when riders have said nothing yet. */
export function reviewText(s: Summary): string | null {
  const parts: string[] = []
  if (s.ratingCount > 0 && s.averageStars !== null) parts.push(`★ ${s.averageStars.toFixed(1)} (${s.ratingCount})`)
  for (const k of ISSUE_ORDER) if (s.issues[k] > 0) parts.push(`${s.issues[k]} ${ISSUE_TEXT[k]}`)
  return parts.length ? parts.join(' · ') : null
}

/** What riders said about each route an option uses. Renders nothing until there is something to say. */
export default function RouteReviews({ routeIds, version = 0 }: { routeIds: string[]; version?: number }) {
  const key = [...new Set(routeIds)].join(',')
  const [state, setState] = useState<{ key: string; version: number; summaries: (Summary | null)[] } | null>(null)

  useEffect(() => {
    if (!key) return
    let live = true
    load(key.split(',')).then((summaries) => {
      if (live) setState({ key, version, summaries })
    })
    return () => {
      live = false
    }
  }, [key, version])

  if (!state || state.key !== key) return null
  const lines = state.summaries.flatMap((s) => {
    const text = s && reviewText(s)
    return text ? [{ routeId: s.routeId, text }] : []
  })
  if (lines.length === 0) return null
  return (
    <span data-testid="route-reviews" className="flex flex-col gap-0.5 text-xs text-zinc-600 dark:text-zinc-400">
      {lines.map((l) => (
        <span key={l.routeId}>
          <span className="font-semibold text-zinc-800 dark:text-zinc-200">{`${routeName(l.routeId)} riders: `}</span>
          {l.text}
        </span>
      ))}
    </span>
  )
}
