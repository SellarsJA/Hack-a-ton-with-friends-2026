import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { createElement } from 'react'
import { makeTestDb } from '../helpers/pgliteDb'
import type { Db } from '@/src/db/client'
import { accuracyStats } from '@/src/accuracy/stats'
import StatsView from '@/components/StatsView'

const PID = '11111111-1111-1111-1111-111111111111'

async function seedPred(db: Db, i: number, errMin: number, o: { realtime?: boolean; final?: boolean; latest?: boolean } = {}) {
  const { realtime = true, final = true, latest = true } = o
  await db.query(
    `insert into predictions (trip_id, service_date, stop_id, stop_sequence, scheduled_epoch, predicted_epoch, predicted_at, realtime, latest_epoch, final)
     values ($1,'2026-11-14','S',1,0,10000,1,$2,$3,$4)`,
    [`T${i}`, realtime, latest ? 10000 + errMin * 60 : null, final],
  )
}

describe('accuracyStats', () => {
  it('computes the true median and within-2-min share', async () => {
    const db = await makeTestDb()
    for (const [i, e] of [0, 1, 3, 5].entries()) await seedPred(db, i, e)
    await seedPred(db, 10, 9, { final: false }) // open: excluded
    await seedPred(db, 11, 9, { latest: false }) // no latest: excluded
    const s = await accuracyStats(db)
    expect(s.measured.count).toBe(4)
    expect(s.measured.medianErrorMinutes).toBe(2)
    expect(s.measured.within2MinPct).toBe(50)
    expect(s.measured.byRealtime.live).toBe(2)
    expect(s.measured.byRealtime.scheduled).toBeNull()
  })

  it('splits realtime vs scheduled', async () => {
    const db = await makeTestDb()
    await seedPred(db, 1, 1, { realtime: true })
    await seedPred(db, 2, 4, { realtime: false })
    expect((await accuracyStats(db)).measured.byRealtime).toEqual({ live: 1, scheduled: 4 })
  })

  it('returns nulls when empty', async () => {
    const s = await accuracyStats(await makeTestDb())
    expect(s.measured).toEqual({ count: 0, medianErrorMinutes: null, within2MinPct: null, byRealtime: { live: null, scheduled: null } })
    expect(s.sliders.time).toEqual({ average: null, count: 0 })
  })

  it('averages sliders per key to 1 decimal', async () => {
    const db = await makeTestDb()
    await db.query('insert into profiles (id) values ($1)', [PID])
    for (const [i, t] of [4, 5, 5].entries()) {
      await db.query(
        `insert into feedback (profile_id, ride_key, route_id, trip_id, service_date, accuracy) values ($1,$2,'R','T','2026-11-14',$3)`,
        [PID, `k${i}`, JSON.stringify({ time: t })],
      )
    }
    const s = await accuracyStats(db)
    expect(s.sliders.time).toEqual({ average: 4.7, count: 3 })
    expect(s.sliders.crowding).toEqual({ average: null, count: 0 })
  })

  it('never leaks a rider note', async () => {
    const db = await makeTestDb()
    await db.query('insert into profiles (id) values ($1)', [PID])
    await db.query(
      `insert into feedback (profile_id, ride_key, route_id, trip_id, service_date, accuracy, note) values ($1,'k','R','T','2026-11-14','{"time":3}','secret-note')`,
      [PID],
    )
    const s = await accuracyStats(db)
    expect(JSON.stringify(s)).not.toContain('secret-note')
    const html = renderToString(createElement(StatsView, { stats: s }))
    expect(html).not.toContain('secret-note')
    expect(html).toContain('What riders told us')
    expect(html).toContain('What we measured')
    expect(html).toMatch(/&quot;Actual&quot; time is the feed(&#x27;|')s last prediction before the bus reached the stop\./)
  })
})
