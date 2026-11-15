'use client'

import { useEffect, useState } from 'react'
import { VehicleSummary as VehicleSummarySchema, type Issue } from '@/src/contract/schema'

type Summary = VehicleSummarySchema

const cache = new Map<string, Promise<Summary | null>>()

export function __resetVehicleSummaryCacheForTests() {
  cache.clear()
}

function load(label: string): Promise<Summary | null> {
  let p = cache.get(label)
  if (!p) {
    p = fetch(`/api/vehicles/${encodeURIComponent(label)}`)
      .then(async (res) => {
        if (!res.ok) return null
        const parsed = VehicleSummarySchema.safeParse(await res.json())
        return parsed.success ? parsed.data : null
      })
      .catch(() => null)
    cache.set(label, p)
  }
  return p
}

const ISSUE_TEXT: Record<Issue, string> = {
  cleanliness: 'cleanliness',
  safety: 'safety',
  disruption: 'disruption',
  too_full: 'too full',
}
const ISSUE_ORDER: Issue[] = ['cleanliness', 'safety', 'disruption', 'too_full']

export default function VehicleSummary({ label }: { label: string | null }) {
  const [state, setState] = useState<{ label: string; summary: Summary | null } | null>(null)

  useEffect(() => {
    if (label === null) return
    let live = true
    load(label).then((summary) => {
      if (live) setState({ label, summary })
    })
    return () => {
      live = false
    }
  }, [label])

  if (label === null || state === null || state.label !== label) return null
  const s = state.summary
  if (!s || s.ratingCount < 1 || s.averageStars === null) return null
  const issues = ISSUE_ORDER.filter((k) => s.issues[k] > 0).map((k) => `${s.issues[k]} ${ISSUE_TEXT[k]}`)
  const text = `★ ${s.averageStars.toFixed(1)} (${s.ratingCount})` + (issues.length ? ` · ${issues.join(' · ')} this month` : '')
  return <span className="text-sm text-zinc-700 dark:text-zinc-300">{text}</span>
}
