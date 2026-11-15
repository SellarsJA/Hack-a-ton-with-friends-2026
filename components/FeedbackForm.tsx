'use client'

import { useState } from 'react'
import type { Accuracy, FeedbackRequest, Issue, RideLink } from '@/src/contract/schema'
import Slider from './Slider'
import { invalidateVehicleSummary } from './VehicleSummary'

type Key = keyof Accuracy
const ISSUES: { value: Issue | 'none'; label: string }[] = [
  { value: 'none', label: 'No issues' },
  { value: 'cleanliness', label: 'Cleanliness' },
  { value: 'safety', label: 'Safety' },
  { value: 'disruption', label: 'Disruption' },
  { value: 'too_full', label: 'Too full' },
]

type Status = 'idle' | 'sending' | 'done' | 'invalid' | 'failed' | 'empty' | 'network'

export default function FeedbackForm({ ride }: { ride: RideLink }) {
  const [stars, setStars] = useState<number | undefined>()
  const [acc, setAcc] = useState<Accuracy>({})
  const [issue, setIssue] = useState<Issue | 'none'>('none')
  const [note, setNote] = useState('')
  const [status, setStatus] = useState<Status>('idle')

  const set = (k: Key) => (v: number | undefined) => setAcc((a) => ({ ...a, [k]: v }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const accuracy: Accuracy = {}
    for (const k of Object.keys(acc) as Key[]) if (acc[k] !== undefined) accuracy[k] = acc[k]
    const trimmed = note.trim()
    const body: FeedbackRequest = {
      rideKey: ride.rideKey,
      vehicleLabel: ride.vehicleLabel,
      routeId: ride.routeId,
      tripId: ride.tripId,
      serviceDate: ride.serviceDate,
      accuracy,
    }
    if (stars !== undefined && ride.vehicleLabel !== null) body.stars = stars
    if (issue !== 'none') body.issue = issue
    if (trimmed) body.note = trimmed
    const answered =
      body.stars !== undefined || body.issue !== undefined || body.note !== undefined || Object.keys(accuracy).length > 0
    if (!answered) {
      setStatus('empty')
      return
    }
    setStatus('sending')
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        if (ride.vehicleLabel !== null) invalidateVehicleSummary(ride.vehicleLabel)
        setStatus('done')
      } else {
        let code: unknown
        if (res.status === 400) code = await res.json().then((j: { error?: unknown }) => j?.error).catch(() => undefined)
        setStatus(res.status === 400 && code === 'invalid' ? 'invalid' : 'failed')
      }
    } catch {
      setStatus('network')
    }
  }

  if (status === 'done') {
    return <p role="status">Thanks! Your feedback is saved. You can change it until the end of the day.</p>
  }

  const title = `Route ${ride.routeShortName} · ${ride.vehicleLabel ? `Bus ${ride.vehicleLabel}` : 'this ride'}`
  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <h1 className="text-lg font-semibold">{title}</h1>

      {ride.vehicleLabel && (
        <div className="flex flex-col gap-1">
          <span id="stars-label" className="text-sm font-medium">
            How was this bus?
          </span>
          <div className="flex gap-1" role="radiogroup" aria-labelledby="stars-label">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={stars === n}
                aria-label={`${n} stars`}
                onClick={() => setStars(n)}
                className={`h-11 min-w-11 flex-1 rounded-lg border text-lg ${
                  stars !== undefined && n <= stars ? 'bg-yellow-300 text-black' : 'bg-transparent'
                }`}
              >
                ★
              </button>
            ))}
          </div>
        </div>
      )}

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold">How accurate was our information?</h2>
        <Slider name="time" label="Departure and arrival times" value={acc.time} onChange={set('time')} />
        <Slider name="position" label="Bus position on the map" value={acc.position} onChange={set('position')} />
        {ride.showed.crowding && <Slider name="crowding" label="Crowding" value={acc.crowding} onChange={set('crowding')} />}
        {ride.showed.transfer && (
          <Slider name="transfer" label="Transfer timing" value={acc.transfer} onChange={set('transfer')} />
        )}
        {ride.showed.alerts && <Slider name="alerts" label="Alerts" value={acc.alerts} onChange={set('alerts')} />}
      </section>

      <fieldset className="flex flex-col">
        <legend className="mb-1 text-sm font-semibold">Anything wrong?</legend>
        {ISSUES.map((i) => (
          <label key={i.value} className="flex min-h-11 items-center gap-3 text-sm">
            <input
              type="radio"
              name="issue"
              value={i.value}
              checked={issue === i.value}
              onChange={() => setIssue(i.value)}
              className="h-5 w-5"
            />
            {i.label}
          </label>
        ))}
      </fieldset>

      <label className="flex flex-col gap-1 text-sm font-medium">
        Anything else? (only our team sees this)
        <textarea
          value={note}
          maxLength={500}
          rows={3}
          onChange={(e) => setNote(e.target.value)}
          className="rounded-lg border p-2 font-normal"
        />
      </label>

      {status === 'empty' && <p role="alert">Add at least one answer.</p>}
      {status === 'invalid' && (
        <p role="alert">Something&apos;s not right with that answer. Please check and try again.</p>
      )}
      {status === 'failed' && <p role="alert">Couldn&apos;t save your feedback. Please try again in a moment.</p>}
      {status === 'network' && <p role="alert">Couldn&apos;t send. Check your connection and try again.</p>}

      <button
        type="submit"
        disabled={status === 'sending'}
        className="h-12 rounded-lg bg-blue-700 px-4 font-semibold text-white disabled:opacity-60"
      >
        Send feedback
      </button>
    </form>
  )
}
