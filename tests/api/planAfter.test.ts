import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const afterCbs: (() => unknown)[] = []
vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: (cb: () => unknown) => {
    afterCbs.push(cb)
  },
}))
const options = [{ liveKey: 'k' }]
vi.mock('@/src/plan/plan', () => ({ planTrip: async () => ({ options }) }))
const recordPredictions = vi.fn(async (..._a: unknown[]) => {})
const trackActuals = vi.fn(async (..._a: unknown[]) => {})
vi.mock('@/src/accuracy/record', () => ({ recordPredictions: (...a: unknown[]) => recordPredictions(...a) }))
vi.mock('@/src/accuracy/track', () => ({ trackActuals: (...a: unknown[]) => trackActuals(...a) }))
const live = { feedTimestamp: 1, trips: new Map(), alerts: [] }
vi.mock('@/src/live/cache', () => ({ getLiveIndex: async () => live }))

const call = async (qs = '?from=53.5,-113.5&to=53.4,-113.5') => {
  const { GET } = await import('@/app/api/plan/route')
  return GET(new NextRequest(`http://localhost/api/plan${qs}`))
}
const prev = process.env.LIVE_SOURCE
beforeEach(() => {
  afterCbs.length = 0
  recordPredictions.mockClear()
  trackActuals.mockClear()
  delete process.env.LIVE_SOURCE
})
afterEach(() => {
  if (prev === undefined) delete process.env.LIVE_SOURCE
  else process.env.LIVE_SOURCE = prev
})

describe('plan route after()', () => {
  it('schedules recording then tracking', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(afterCbs).toHaveLength(1)
    await afterCbs[0]()
    expect(recordPredictions).toHaveBeenCalledWith(options, expect.any(Number))
    expect(trackActuals).toHaveBeenCalledWith(live, expect.any(Number))
  })

  it('swallows errors from after work', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    recordPredictions.mockRejectedValueOnce(new Error('db down'))
    await call()
    await expect(afterCbs[0]()).resolves.toBeUndefined()
  })

  it('schedules nothing for snapshot mode or fixture', async () => {
    process.env.LIVE_SOURCE = 'snapshot'
    await call()
    delete process.env.LIVE_SOURCE
    await call('?fixture=1')
    expect(afterCbs).toHaveLength(0)
  })
})
