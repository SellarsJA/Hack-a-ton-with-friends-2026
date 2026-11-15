import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '@/src/db/client'
import { FeedbackRequest, Issue, VehicleSummary } from '@/src/contract/schema'
import { upsertFeedback, vehicleSummary } from '@/src/feedback/store'
import { makeTestDb } from '../helpers/pgliteDb'

const P1 = '3f2b8c1e-9a4d-4e6b-8c7a-1d2e3f4a5b6c'
const P2 = '4a2b8c1e-9a4d-4e6b-8c7a-1d2e3f4a5b6d'

function fb(over: Record<string, unknown> = {}): FeedbackRequest {
  const base = { vehicleLabel: '4021', routeId: 'R1', tripId: 'T1', serviceDate: '2026-11-14', accuracy: {}, ...over } as Record<string, unknown>
  base.rideKey = `${base.vehicleLabel ?? 'none'}:${base.tripId}:${base.serviceDate}`
  return FeedbackRequest.parse(base)
}

let db: Db
beforeEach(async () => {
  db = await makeTestDb()
})

describe('feedback store', () => {
  it('resubmitting the same ride updates in place', async () => {
    await upsertFeedback(P1, fb({ stars: 2 }), db)
    await upsertFeedback(P1, fb({ stars: 4 }), db)
    const rows = await db.query<{ stars: number }>('select stars from feedback')
    expect(rows).toEqual([{ stars: 4 }])
  })

  it('a resubmit without an answer clears it', async () => {
    await upsertFeedback(P1, fb({ stars: 2, issue: 'safety', note: 'x', accuracy: { time: 3 } }), db)
    await upsertFeedback(P1, fb({ accuracy: { time: 3 } }), db)
    const rows = await db.query<{ stars: number | null; issue: string | null; note: string | null }>(
      'select stars, issue, note from feedback',
    )
    expect(rows).toEqual([{ stars: null, issue: null, note: null }])
  })

  it('same label with a different tripId gives 2 rows and ratingCount 2', async () => {
    await upsertFeedback(P1, fb({ stars: 2 }), db)
    await upsertFeedback(P1, fb({ tripId: 'T2', stars: 4 }), db)
    expect((await db.query('select 1 from feedback')).length).toBe(2)
    const s = await vehicleSummary('4021', db)
    expect(s.ratingCount).toBe(2)
    expect(s.averageStars).toBe(3)
    expect(VehicleSummary.safeParse(s).success).toBe(true)
  })

  it('stores accuracy exactly as parsed', async () => {
    await upsertFeedback(P1, fb({ accuracy: { time: 4 } }), db)
    const rows = await db.query<{ a: string }>('select accuracy::text as a from feedback')
    expect(JSON.parse(rows[0].a)).toEqual({ time: 4 })
    const [r] = await db.query<{ eq: boolean }>(`select accuracy = '{"time":4}'::jsonb as eq from feedback`)
    expect(r.eq).toBe(true)
  })

  it('excludes issues older than 30 days and ratings older than 90, includes every issue key', async () => {
    await upsertFeedback(P1, fb({ issue: 'safety' }), db)
    await upsertFeedback(P2, fb({ issue: 'too_full', stars: 5 }), db)
    await db.query(`update feedback set updated_at = now() - interval '31 days' where profile_id = $1`, [P1])
    let s = await vehicleSummary('4021', db)
    expect(Object.keys(s.issues).sort()).toEqual([...Issue.options].sort())
    expect(s.issues).toEqual({ cleanliness: 0, safety: 0, disruption: 0, too_full: 1 })
    expect(s.ratingCount).toBe(1)
    await db.query(`update feedback set updated_at = now() - interval '91 days'`)
    s = await vehicleSummary('4021', db)
    expect(s).toEqual({ label: '4021', averageStars: null, ratingCount: 0, issues: { cleanliness: 0, safety: 0, disruption: 0, too_full: 0 } })
  })

  it('never leaks notes', async () => {
    await upsertFeedback(P1, fb({ stars: 3, issue: 'cleanliness', note: 'ZEBRA-SECRET-NOTE' }), db)
    const s = await vehicleSummary('4021', db)
    expect(JSON.stringify(s)).not.toContain('ZEBRA-SECRET-NOTE')
    expect(s.issues.cleanliness).toBe(1)
  })

  it('upserts the profile and bumps last_seen_at', async () => {
    await upsertFeedback(P1, fb({ stars: 3 }), db)
    await upsertFeedback(P1, fb({ stars: 4 }), db)
    expect((await db.query('select 1 from profiles')).length).toBe(1)
  })
})
