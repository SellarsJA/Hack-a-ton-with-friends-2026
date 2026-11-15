import { DateTime } from 'luxon'
import type { LiveIndex, TripLive } from '@/src/live/decode'
import { ZONE } from '@/src/time/edmonton'

const DAY_SECONDS = 86400

/** The snapshot's service day: the most common trip-update startDate, else the header timestamp's Edmonton date. */
export function snapshotServiceDate(index: LiveIndex): string {
  const counts = new Map<string, number>()
  for (const t of index.trips.values()) {
    if (t.stops.length === 0 || t.startDate == null) continue
    counts.set(t.startDate, (counts.get(t.startDate) ?? 0) + 1)
  }
  let best: string | null = null
  let bestN = 0
  for (const [d, n] of counts) {
    if (n > bestN) {
      best = d
      bestN = n
    }
  }
  return best ?? DateTime.fromSeconds(index.feedTimestamp, { zone: ZONE }).toISODate()!
}

const shiftDate = (d: string | null, days: number): string | null =>
  d == null ? null : DateTime.fromISO(d, { zone: ZONE }).plus({ days }).toISODate()

/**
 * Moves a recorded snapshot onto `today` (YYYY-MM-DD, Edmonton): every epoch time shifts
 * by whole days (N x 86400 s) and every startDate moves by the same N days, so the
 * snapshot's service day becomes today. Pure: the input is not modified.
 */
export function rebaseSnapshot(index: LiveIndex, today: string): LiveIndex {
  const from = DateTime.fromISO(snapshotServiceDate(index), { zone: ZONE })
  const days = Math.round(DateTime.fromISO(today, { zone: ZONE }).diff(from, 'days').days)
  const dt = days * DAY_SECONDS
  const add = (v: number | null) => (v == null ? null : v + dt)

  const trips = new Map<string, TripLive>()
  for (const [id, t] of index.trips) {
    trips.set(id, {
      ...t,
      startDate: shiftDate(t.startDate, days),
      stops: t.stops.map((s) => ({ ...s, arrival: add(s.arrival), departure: add(s.departure) })),
    })
  }
  return {
    feedTimestamp: index.feedTimestamp + dt,
    trips,
    alerts: index.alerts.map((a) => ({
      ...a,
      activePeriods: a.activePeriods.map((p) => ({ start: add(p.start), end: add(p.end) })),
    })),
  }
}
