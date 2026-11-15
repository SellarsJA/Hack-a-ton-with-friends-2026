import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getLiveIndex, __resetLiveCacheForTests } from '@/src/live/cache'

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
})
