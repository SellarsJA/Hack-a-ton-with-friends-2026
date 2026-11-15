import type { Option } from '@/src/contract/schema'
import { getDb, type Db } from '@/src/db/client'
import { decodeLiveKey } from '@/src/plan/liveKey'
import { toInstant } from '@/src/time/edmonton'

/** Records what we told riders for each option's first transit leg, for later comparison with the feed. */
export async function recordPredictions(options: Option[], nowEpoch: number, db: Db = getDb()): Promise<void> {
  const predictedAt = Math.floor(nowEpoch)
  const rows: unknown[][] = []
  for (const o of options) {
    const leg = decodeLiveKey(o.liveKey)?.legs[0]
    const transit = o.legs.find((l) => l.mode !== 'walk')
    if (!leg || !transit) continue
    const predicted = Math.round(new Date(transit.departAt).getTime() / 1000)
    if (!Number.isFinite(predicted)) continue
    rows.push([
      leg.t,
      leg.d,
      leg.bs,
      leg.bq,
      Math.round(toInstant(leg.d, leg.bt).toSeconds()),
      predicted,
      predictedAt,
      transit.realtime,
    ])
  }
  if (rows.length === 0) return
  const cols = 8
  const values = rows.map((_, r) => `(${Array.from({ length: cols }, (_, c) => `$${r * cols + c + 1}`).join(',')})`).join(',')
  await db.query(
    `insert into predictions (trip_id, service_date, stop_id, stop_sequence, scheduled_epoch, predicted_epoch, predicted_at, realtime)
     values ${values} on conflict do nothing`,
    rows.flat(),
  )
}
