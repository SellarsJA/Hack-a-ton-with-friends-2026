import { getDb, type Db } from '@/src/db/client'
import type { LiveIndex } from '@/src/live/decode'

const STALE_SECONDS = 6 * 3600
const ABSENT_SECONDS = 1800

let lastTrackedFeedTimestamp: number | null = null

/** Test-only: forgets the last tracked feed timestamp. */
export function __resetTrackForTests(): void {
  lastTrackedFeedTimestamp = null
}

type OpenRow = { trip_id: string; service_date: string; stop_id: string; stop_sequence: number }

/**
 * Updates open predictions from the live index: one batched update for rows whose
 * trip is in the feed, plus one small statement finalising rows older than 6 hours.
 * Runs at most once per feed refresh.
 */
export async function trackActuals(live: LiveIndex, nowEpoch: number, db: Db = getDb()): Promise<void> {
  if (live.feedTimestamp === lastTrackedFeedTimestamp) return
  lastTrackedFeedTimestamp = live.feedTimestamp
  try {
    const now = Math.floor(nowEpoch)
    const open = await db.query<OpenRow>(
      'select trip_id, service_date::text as service_date, stop_id, stop_sequence::int as stop_sequence from predictions where not final',
    )
    const presentKeys: string[] = []
    const keyed = new Map<string, { latest: number; fin: boolean; row: OpenRow }>()
    for (const row of open) {
      const trip = live.trips.get(row.trip_id)
      if (!trip || (trip.startDate !== null && trip.startDate !== row.service_date)) continue
      presentKeys.push(`${row.trip_id}|${row.service_date}`)
      const stop =
        trip.stops.find((s) => s.stopSequence === Number(row.stop_sequence)) ??
        trip.stops.find((s) => s.stopId === row.stop_id)
      if (!stop) {
        keyed.set(`${row.trip_id}|${row.service_date}|${row.stop_sequence}`, { latest: 0, fin: true, row })
        continue
      }
      const latest = stop.departure ?? stop.arrival
      if (latest === null) continue
      keyed.set(`${row.trip_id}|${row.service_date}|${row.stop_sequence}`, { latest, fin: false, row })
    }
    if (keyed.size > 0) {
      const items = [...keyed.values()]
      // latest = 0 is the "no value" sentinel for rows that only become final.
      await db.query(
        `update predictions p set
           latest_epoch = case when u.latest > 0 then u.latest else p.latest_epoch end,
           latest_at = case when u.latest > 0 then $6::bigint else p.latest_at end,
           final = p.final or u.fin
         from unnest($1::text[], $2::text[], $3::int[], $4::bigint[], $5::boolean[]) as u(trip_id, service_date, stop_sequence, latest, fin)
         where p.trip_id = u.trip_id and p.service_date = u.service_date::date
           and p.stop_sequence = u.stop_sequence and not p.final`,
        [
          items.map((i) => i.row.trip_id),
          items.map((i) => i.row.service_date),
          items.map((i) => Number(i.row.stop_sequence)),
          items.map((i) => i.latest),
          items.map((i) => i.fin),
          now,
        ],
      )
    }
    // Also finalise rows whose trip has left the feed and whose scheduled time is over 30 minutes past.
    await db.query(
      `update predictions set final = true
        where not final
          and (predicted_at < $1
               or (scheduled_epoch < $2 and (trip_id || '|' || service_date::text) <> all($3::text[])))`,
      [now - STALE_SECONDS, now - ABSENT_SECONDS, presentKeys],
    )
  } catch (err) {
    lastTrackedFeedTimestamp = null
    throw err
  }
}
