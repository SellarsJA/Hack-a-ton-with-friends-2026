import { beforeEach, describe, expect, it } from 'vitest'
import { makeTestDb } from '../helpers/pgliteDb'
import type { Db } from '@/src/db/client'
import type { LiveIndex, TripLive } from '@/src/live/decode'
import { trackActuals, __resetTrackForTests } from '@/src/accuracy/track'
import { recordPredictions } from '@/src/accuracy/record'
import { encodeLiveKey } from '@/src/plan/liveKey'
import { toInstant } from '@/src/time/edmonton'
import type { Option } from '@/src/contract/schema'

const NOW = 1_800_000_000
const D = '2026-11-14'

function counting(db: Db) {
  const calls: string[] = []
  const wrapped: Db = {
    query: (text, params) => {
      calls.push(text)
      return db.query(text, params)
    },
  }
  return { db: wrapped, updates: () => calls.filter((c) => /update\s+predictions/i.test(c)).length }
}

async function seed(db: Db, o: { trip?: string; seq?: number; stop?: string; predictedAt?: number; pred?: number; sched?: number }) {
  await db.query(
    `insert into predictions (trip_id, service_date, stop_id, stop_sequence, scheduled_epoch, predicted_epoch, predicted_at, realtime)
     values ($1,$2,$3,$4,$5,$6,$7,true)`,
    [o.trip ?? 'T1', D, o.stop ?? 'S1', o.seq ?? 3, o.sched ?? NOW + 600, o.pred ?? 5000, o.predictedAt ?? NOW - 60],
  )
}
const row = async (db: Db) =>
  (await db.query<{ latest_epoch: string | null; latest_at: string | null; final: boolean }>(
    'select latest_epoch::text, latest_at::text, final from predictions order by predicted_at'))[0]

const trip = (stops: TripLive['stops'], startDate: string | null = D): TripLive => ({ startDate, stops, vehicle: null })
const stop = (seq: number, id: string, arrival: number | null, departure: number | null) => ({ stopSequence: seq, stopId: id, arrival, departure, delay: null })
const live = (ts: number, trips: [string, TripLive][]): LiveIndex => ({ feedTimestamp: ts, trips: new Map(trips), alerts: [] })

beforeEach(() => __resetTrackForTests())

describe('trackActuals', () => {
  it('updates latest_epoch when the stop is still in the live trip', async () => {
    const db = await makeTestDb()
    await seed(db, {})
    await trackActuals(live(1, [['T1', trip([stop(3, 'S1', 4900, 4950)])]]), NOW, db)
    const r = await row(db)
    expect(Number(r.latest_epoch)).toBe(4950)
    expect(Number(r.latest_at)).toBe(NOW)
    expect(r.final).toBe(false)
  })

  it('falls back to arrival, and to stop id when the sequence differs', async () => {
    const db = await makeTestDb()
    await seed(db, {})
    await trackActuals(live(1, [['T1', trip([stop(9, 'S1', 4900, null)])]]), NOW, db)
    expect(Number((await row(db)).latest_epoch)).toBe(4900)
  })

  it('skips the row when both times are null', async () => {
    const db = await makeTestDb()
    await seed(db, {})
    await trackActuals(live(1, [['T1', trip([stop(3, 'S1', null, null)])]]), NOW, db)
    expect(await row(db)).toMatchObject({ latest_epoch: null, final: false })
  })

  it('marks final when the trip is present but the stop dropped out', async () => {
    const db = await makeTestDb()
    await seed(db, {})
    await trackActuals(live(1, [['T1', trip([stop(4, 'S2', 6000, 6000)])]]), NOW, db)
    expect(await row(db)).toMatchObject({ final: true, latest_epoch: null })
  })

  it('ignores a trip instance from another service date', async () => {
    const db = await makeTestDb()
    await seed(db, {})
    await trackActuals(live(1, [['T1', trip([stop(3, 'S1', 1, 1)], '2026-11-13')]]), NOW, db)
    expect(await row(db)).toMatchObject({ latest_epoch: null, final: false })
  })

  it('treats a null startDate as present', async () => {
    const db = await makeTestDb()
    await seed(db, {})
    await trackActuals(live(1, [['T1', trip([stop(3, 'S1', 7, 8)], null)]]), NOW, db)
    expect(Number((await row(db)).latest_epoch)).toBe(8)
  })

  it('finalises rows older than 6 hours, leaving latest_epoch alone', async () => {
    const db = await makeTestDb()
    await seed(db, { trip: 'GONE', predictedAt: NOW - 21601 })
    await db.query('update predictions set latest_epoch = 4000')
    await trackActuals(live(1, []), NOW, db)
    expect(await row(db)).toMatchObject({ final: true, latest_epoch: '4000' })
  })

  it('finalises rows of a trip absent from the feed once 30 minutes past schedule', async () => {
    const db = await makeTestDb()
    await seed(db, { trip: 'OLD', sched: NOW - 31 * 60 })
    await seed(db, { trip: 'NEW', sched: NOW - 29 * 60 })
    await db.query("update predictions set latest_epoch = 4000 where trip_id = 'OLD'")
    await trackActuals(live(1, []), NOW, db)
    const rows = await db.query<{ trip_id: string; final: boolean; latest_epoch: string | null }>(
      'select trip_id, final, latest_epoch::text from predictions order by trip_id')
    expect(rows).toEqual([
      { trip_id: 'NEW', final: false, latest_epoch: null },
      { trip_id: 'OLD', final: true, latest_epoch: '4000' },
    ])
  })

  it('makes one update for a repeated feedTimestamp', async () => {
    const c = counting(await makeTestDb())
    await seed(c.db, {})
    const l = live(5, [['T1', trip([stop(3, 'S1', 1, 2)])]])
    await trackActuals(l, NOW, c.db)
    const first = c.updates()
    await trackActuals(l, NOW + 1, c.db)
    expect(c.updates()).toBe(first)
    expect(first).toBeGreaterThanOrEqual(1)
    expect(first).toBeLessThanOrEqual(2)
  })

  it('does not touch final rows', async () => {
    const db = await makeTestDb()
    await seed(db, {})
    await db.query('update predictions set final = true')
    await trackActuals(live(1, [['T1', trip([stop(3, 'S1', 1, 2)])]]), NOW, db)
    expect((await row(db)).latest_epoch).toBeNull()
  })
})

describe('recordPredictions', () => {
  const mkOption = (tripId: string): Option => {
    const liveKey = encodeLiveKey({ legs: [{ t: tripId, d: D, bs: 'S1', bq: 3, bt: 65400, as: 'S2', aq: 5, at: 66000, r: 'R9', rail: false }], tw: null })
    return {
      liveKey,
      legs: [
        { mode: 'walk', minutes: 2 },
        { mode: 'bus', departAt: '2026-11-14T18:15:00-07:00', realtime: true },
      ],
    } as unknown as Option
  }

  it('inserts one row per option, idempotently, and skips bad keys', async () => {
    const db = await makeTestDb()
    const opts = [mkOption('T1'), { ...mkOption('T2'), liveKey: 'garbage' } as Option]
    await recordPredictions(opts, NOW + 0.7, db)
    await recordPredictions(opts, NOW + 0.7, db)
    const rows = await db.query<{ trip_id: string; stop_id: string; stop_sequence: number; scheduled_epoch: string; predicted_epoch: string; predicted_at: string; realtime: boolean }>(
      'select trip_id, stop_id, stop_sequence, scheduled_epoch::text, predicted_epoch::text, predicted_at::text, realtime from predictions')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ trip_id: 'T1', stop_id: 'S1', stop_sequence: 3, realtime: true, predicted_at: String(NOW) })
    expect(Number(rows[0].scheduled_epoch)).toBe(Math.round(toInstant(D, 65400).toSeconds()))
    expect(Number(rows[0].predicted_epoch)).toBe(Date.parse('2026-11-14T18:15:00-07:00') / 1000)
  })

  it('does nothing for no options', async () => {
    const db = await makeTestDb()
    await recordPredictions([], NOW, db)
    expect(await db.query('select 1 from predictions')).toHaveLength(0)
  })
})
