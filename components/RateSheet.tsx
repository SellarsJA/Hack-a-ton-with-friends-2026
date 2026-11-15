'use client'

import { useEffect, useState } from 'react'
import type { Option } from '@/src/contract/schema'
import { rideLinkFor } from '@/src/feedback/rideLink'
import { MODE_COLORS } from '@/src/map/lines'
import FeedbackForm from './FeedbackForm'
import ModeIcon from './ModeIcon'
import { routeName } from './format'

/**
 * Slide-up sheet to rate a trip whenever the rider is ready, with no time window, so a ride can be
 * reviewed in a demo or after getting off. A trip with a transfer rates one ride at a time.
 */
export default function RateSheet({
  option,
  onClose,
  onSaved,
}: {
  option: Option
  onClose: () => void
  /** A ride's feedback was saved; the cards behind refresh their route reviews. */
  onSaved: () => void
}) {
  const rides = option.legs.flatMap((l, i) => (l.mode === 'walk' ? [] : [{ leg: l, index: i }]))
  const [pick, setPick] = useState(0)
  const [saved, setSaved] = useState<Set<number>>(() => new Set())
  const current = rides[Math.min(pick, rides.length - 1)]

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!current) return null
  const done = saved.has(current.index)
  const next = rides.find((r) => !saved.has(r.index) && r.index !== current.index)

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/50" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="rate-sheet-title"
        className="sheet-up relative flex max-h-[88dvh] w-full max-w-md flex-col rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl dark:bg-zinc-900"
      >
        <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <h2 id="rate-sheet-title" className="text-base font-semibold">
            Rate your trip
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 rounded-full px-3 text-sm font-semibold text-blue-700 dark:text-blue-300"
          >
            Close
          </button>
        </div>
        {rides.length > 1 && (
          <div role="tablist" aria-label="Which ride" className="flex gap-2 overflow-x-auto px-4 pt-3">
            {rides.map((r, i) => (
              <button
                key={r.index}
                type="button"
                role="tab"
                aria-selected={i === pick}
                onClick={() => setPick(i)}
                className={`flex min-h-10 flex-none items-center gap-1.5 rounded-full border px-3 text-sm font-semibold ${
                  i === pick
                    ? 'border-transparent text-white'
                    : 'border-zinc-300 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300'
                }`}
                style={i === pick ? { backgroundColor: MODE_COLORS[r.leg.mode] } : undefined}
              >
                <ModeIcon mode={r.leg.mode} />
                {routeName(r.leg.route)}
                {saved.has(r.index) && <span aria-label="rated">✓</span>}
              </button>
            ))}
          </div>
        )}
        <div className="overflow-y-auto px-4 py-4">
          {done ? (
            <div className="flex flex-col gap-4">
              <p role="status">Thanks! Your feedback is saved. Riders will see it next time they pick this route.</p>
              {next ? (
                <button
                  type="button"
                  onClick={() => setPick(rides.indexOf(next))}
                  className="h-12 rounded-lg bg-blue-700 px-4 font-semibold text-white"
                >
                  {`Rate ${routeName(next.leg.route)} next`}
                </button>
              ) : (
                <button type="button" onClick={onClose} className="h-12 rounded-lg bg-blue-700 px-4 font-semibold text-white">
                  Done
                </button>
              )}
            </div>
          ) : (
            <FeedbackForm
              key={current.index}
              ride={rideLinkFor(option, current.index)}
              onDone={() => {
                setSaved((s) => new Set(s).add(current.index))
                onSaved()
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}
