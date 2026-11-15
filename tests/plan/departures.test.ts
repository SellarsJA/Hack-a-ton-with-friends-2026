import { beforeAll, describe, expect, it } from 'vitest'
import type { Db } from '@/src/db/client'
import type { LiveIndex } from '@/src/live/decode'
import { nextDepartures } from '@/src/plan/departures'
import { toInstant } from '@/src/time/edmonton'
import { makeTestDb } from '../helpers/pgliteDb'

let db: Db
beforeAll(async () => {
  db = await makeTestDb()
})

const DATE = '2026-11-14'
const t = (h: number, m = 0, s = 0) => toInstant(DATE, h * 3600 + m * 60 + s).toSeconds()

describe('nextDepartures', () => {
  it('returns trip A first, 10 minutes before it leaves; D is outside the window', async () => {
    const r = await nextDepartures(db, { stopId: '1001', afterEpoch: t(18, 0), limit: 5, live: null })
    expect(r).toEqual([
      { tripId: 'A', serviceDate: DATE, routeId: 'R9', headsign: 'Southgate', departEpoch: t(18, 10), realtime: false },
    ])
  })

  it('returns [] after the last trip', async () => {
    const r = await nextDepartures(db, {
      stopId: '1001',
      afterEpoch: toInstant('2026-11-15', 3 * 3600).toSeconds(),
      limit: 5,
      live: null,
    })
    expect(r).toEqual([])
  })

  it('filters by route and sorts by departure', async () => {
    const r = await nextDepartures(db, { stopId: '1003', routeId: 'R4', afterEpoch: t(18, 0), limit: 10, live: null })
    expect(r.map((d) => d.tripId)).toEqual(['H', 'E', 'J'])
    expect(r.every((d) => d.routeId === 'R4')).toBe(true)
  })

  it('respects limit', async () => {
    const r = await nextDepartures(db, { stopId: '1003', afterEpoch: t(18, 0), limit: 2, live: null })
    expect(r.map((d) => d.tripId)).toEqual(['A', 'H'])
  })

  it('applies live delays', async () => {
    const live: LiveIndex = {
      feedTimestamp: 0,
      trips: new Map([
        [
          'A',
          {
            startDate: DATE,
            stops: [{ stopSequence: 1, stopId: '1001', arrival: null, departure: t(18, 10) + 240, delay: 240 }],
            vehicle: null,
          },
        ],
      ]),
      alerts: [],
    }
    const r = await nextDepartures(db, { stopId: '1001', afterEpoch: t(18, 0), limit: 5, live })
    expect(r[0]).toMatchObject({ tripId: 'A', departEpoch: t(18, 10) + 240, realtime: true })
  })

  const liveA = (dep: number): LiveIndex => ({
    feedTimestamp: 0,
    trips: new Map([
      ['A', { startDate: DATE, stops: [{ stopSequence: 1, stopId: '1001', arrival: null, departure: dep, delay: null }], vehicle: null }],
    ]),
    alerts: [],
  })

  it('keeps a late-but-coming bus scheduled before afterEpoch', async () => {
    const r = await nextDepartures(db, { stopId: '1001', afterEpoch: t(18, 15), limit: 5, live: liveA(t(18, 10) + 600) })
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ tripId: 'A', departEpoch: t(18, 20), realtime: true })
  })

  it('drops a trip whose live time moved before afterEpoch', async () => {
    const r = await nextDepartures(db, { stopId: '1001', afterEpoch: t(18, 15), limit: 5, live: liveA(t(18, 12)) })
    expect(r).toEqual([])
  })
})
