import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DateTime } from 'luxon'
import { getLiveIndex, __resetLiveCacheForTests } from '@/src/live/cache'
import { buildLiveIndex } from '@/src/live/decode'
import { ZONE } from '@/src/time/edmonton'

const ok = (f: string) =>
  new Response(new Uint8Array(readFileSync(join(process.cwd(), 'data/snapshot', f))), { status: 200 })
const respond = (url: string) =>
  url.includes('VehiclePositions')
    ? ok('VehiclePositions.pb')
    : url.includes('TripUpdates')
      ? ok('TripUpdates.pb')
      : ok('Alerts.pb')

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  __resetLiveCacheForTests()
  delete process.env.LIVE_SOURCE
  fetchMock = vi.fn(async (url: string) => respond(url))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  delete process.env.LIVE_SOURCE
})

describe('getLiveIndex', () => {
  it('shares one refresh between concurrent calls', async () => {
    const [a, b] = await Promise.all([getLiveIndex(1_000), getLiveIndex(1_000)])
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(a).toBe(b)
    expect(a!.trips.size).toBeGreaterThan(500)
  })
  it('serves from cache within the TTL, refetches after', async () => {
    await getLiveIndex(1_000)
    await getLiveIndex(20_000)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    await getLiveIndex(32_000)
    expect(fetchMock).toHaveBeenCalledTimes(6)
  })
  it('keeps the previous index when a refetch fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const first = await getLiveIndex(1_000)
    fetchMock.mockImplementation(async () => {
      throw new Error('boom')
    })
    const second = await getLiveIndex(40_000)
    expect(second).toBe(first)
    expect(warn).toHaveBeenCalledTimes(1)
  })
  it('treats non-2xx as failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    fetchMock.mockImplementation(async () => new Response('x', { status: 503 }))
    expect(await getLiveIndex(1_000)).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
  })
  it('returns null when the first load rejects', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    fetchMock.mockImplementation(async () => {
      throw new Error('down')
    })
    expect(await getLiveIndex(1_000)).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
  })
  it('backs off after a failure: no fetch within 30s, retries after', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const first = await getLiveIndex(1_000)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    fetchMock.mockImplementation(async () => {
      throw new Error('boom')
    })
    expect(await getLiveIndex(40_000)).toBe(first)
    const afterFail = fetchMock.mock.calls.length
    expect(await getLiveIndex(50_000)).toBe(first)
    expect(fetchMock).toHaveBeenCalledTimes(afterFail)
    await getLiveIndex(71_000)
    expect(fetchMock.mock.calls.length).toBeGreaterThan(afterFail)
    expect(warn).toHaveBeenCalledTimes(2)
  })
  it('backs off when nothing has ever loaded', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    fetchMock.mockImplementation(async () => {
      throw new Error('down')
    })
    expect(await getLiveIndex(1_000)).toBeNull()
    const n = fetchMock.mock.calls.length
    expect(await getLiveIndex(11_000)).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(n)
  })
  it('aborts a hung fetch (5s timeout) and returns the previous index', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const first = await getLiveIndex(1_000)
    const ctl = new AbortController()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(ctl.signal)
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_res, rej) => {
          init.signal!.addEventListener('abort', () => rej(new Error('aborted')))
        }),
    )
    const p = getLiveIndex(40_000)
    ctl.abort()
    expect(await p).toBe(first)
    expect(timeout).toHaveBeenCalledWith(5000)
    expect(warn).toHaveBeenCalledTimes(1)
  })
  it('reads snapshot files when LIVE_SOURCE=snapshot', async () => {
    process.env.LIVE_SOURCE = 'snapshot'
    const idx = await getLiveIndex(1_000)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(idx!.trips.size).toBeGreaterThan(500)
  })
  it('rebases snapshot data to today (Edmonton) when LIVE_SOURCE=snapshot', async () => {
    process.env.LIVE_SOURCE = 'snapshot'
    const raw = buildLiveIndex({
      vehicles: new Uint8Array(readFileSync(join(process.cwd(), 'data/snapshot/VehiclePositions.pb'))),
      tripUpdates: new Uint8Array(readFileSync(join(process.cwd(), 'data/snapshot/TripUpdates.pb'))),
      alerts: new Uint8Array(readFileSync(join(process.cwd(), 'data/snapshot/Alerts.pb'))),
    })
    const now = DateTime.fromISO('2026-11-20T09:00:00', { zone: ZONE })
    const idx = (await getLiveIndex(now.toMillis()))!
    const before = DateTime.fromSeconds(raw.feedTimestamp, { zone: ZONE })
    const after = DateTime.fromSeconds(idx.feedTimestamp, { zone: ZONE })
    expect(after.toISODate()).toBe('2026-11-20')
    expect(after.toFormat('HH:mm:ss')).toBe(before.toFormat('HH:mm:ss'))
    const dates = new Set([...idx.trips.values()].map((t) => t.startDate).filter((d) => d !== null))
    expect([...dates]).toEqual(['2026-11-20'])
    const [id, t] = [...raw.trips].find(([, v]) => v.stops.some((s) => s.arrival !== null))!
    const s = t.stops.findIndex((x) => x.arrival !== null)
    expect(idx.trips.get(id)!.stops[s].arrival).toBe(t.stops[s].arrival! + (idx.feedTimestamp - raw.feedTimestamp))
    expect((idx.feedTimestamp - raw.feedTimestamp) % 86400).toBe(0)
  })
})
