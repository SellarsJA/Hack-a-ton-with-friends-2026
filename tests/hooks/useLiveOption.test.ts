// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import planFixture from '@/fixtures/plan.json'
import liveFixture from '@/fixtures/live.json'
import { PlanResponse, LiveResponse } from '@/src/contract/schema'
import { useLiveOption, mergeLive } from '@/src/hooks/useLiveOption'

const plan = PlanResponse.parse(planFixture)
const live = LiveResponse.parse(liveFixture)

let visibility: 'visible' | 'hidden' = 'visible'
function setVisibility(v: 'visible' | 'hidden') {
  visibility = v
  document.dispatchEvent(new Event('visibilitychange'))
}

const okRes = (body: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) })

beforeEach(() => {
  vi.useFakeTimers()
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('useLiveOption', () => {
  it('fetches at t=0 and every 30 s, with no-store', async () => {
    const f = vi.fn((..._a: unknown[]) => okRes(liveFixture))
    vi.stubGlobal('fetch', f)
    const { result } = renderHook(() => useLiveOption('k-opt-2'))
    await act(async () => {})
    expect(f).toHaveBeenCalledTimes(1)
    expect(f.mock.calls[0][0]).toBe('/api/live?keys=k-opt-2')
    expect((f.mock.calls[0][1] as RequestInit).cache).toBe('no-store')
    expect(result.current.data?.liveKey).toBe('k-opt-2')
    expect(result.current.ageSeconds).toBe(12)
    expect(result.current.vehicles).toHaveLength(3)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('adds fixture=1 from env', async () => {
    vi.stubEnv('NEXT_PUBLIC_USE_FIXTURE', '1')
    const f = vi.fn((..._a: unknown[]) => okRes(liveFixture))
    vi.stubGlobal('fetch', f)
    renderHook(() => useLiveOption('k-opt-2'))
    await act(async () => {})
    expect(f.mock.calls[0][0]).toBe('/api/live?keys=k-opt-2&fixture=1')
  })

  it('pauses while hidden and fetches at once when visible again', async () => {
    const f = vi.fn((..._a: unknown[]) => okRes(liveFixture))
    vi.stubGlobal('fetch', f)
    renderHook(() => useLiveOption('k-opt-2'))
    await act(async () => {})
    expect(f).toHaveBeenCalledTimes(1)
    act(() => setVisibility('hidden'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000)
    })
    expect(f).toHaveBeenCalledTimes(1)
    await act(async () => {
      setVisibility('visible')
    })
    expect(f).toHaveBeenCalledTimes(2)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(f).toHaveBeenCalledTimes(3)
  })

  it('does not fetch for a null or empty key', async () => {
    const f = vi.fn((..._a: unknown[]) => okRes(liveFixture))
    vi.stubGlobal('fetch', f)
    const a = renderHook(() => useLiveOption(null))
    const b = renderHook(() => useLiveOption(''))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(f).not.toHaveBeenCalled()
    expect(a.result.current.data).toBeNull()
    expect(b.result.current.vehicles).toEqual([])
  })

  it('keeps previous data when a poll fails or returns junk', async () => {
    const f = vi
      .fn((..._a: unknown[]) => okRes(liveFixture))
      .mockImplementationOnce(() => okRes(liveFixture))
      .mockImplementationOnce(() => Promise.reject(new Error('net')))
      .mockImplementationOnce(() => okRes({ nope: 1 }))
    vi.stubGlobal('fetch', f)
    const { result } = renderHook(() => useLiveOption('k-opt-2'))
    await act(async () => {})
    expect(result.current.data?.liveKey).toBe('k-opt-2')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(f).toHaveBeenCalledTimes(3)
    expect(result.current.data?.liveKey).toBe('k-opt-2')
  })

  it('ages the data through failed polls: 25 s then 4 failures is over 120 s', async () => {
    const f = vi
      .fn((): Promise<unknown> => Promise.reject(new Error('net')))
      .mockImplementationOnce(() => okRes({ ...liveFixture, liveDataAgeSeconds: 25 }))
      .mockImplementationOnce(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }))
    vi.stubGlobal('fetch', f)
    const { result } = renderHook(() => useLiveOption('k-opt-2'))
    await act(async () => {})
    expect(result.current.ageSeconds).toBe(25)
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000)
      })
    }
    expect(f).toHaveBeenCalledTimes(5)
    expect(result.current.data?.liveKey).toBe('k-opt-2')
    expect(result.current.ageSeconds).toBe(145)
  })

  it('keeps the previous vehicles after a key change until the new response lands', async () => {
    const vehA = [{ ...live.vehicles[0], label: 'A1' }]
    const vehB = [{ ...live.vehicles[1], label: 'B1' }]
    let resolveB: (v: { ok: boolean; json: () => Promise<unknown> }) => void = () => {}
    const f = vi
      .fn((..._a: unknown[]) => okRes({ ...liveFixture, vehicles: vehA }))
      .mockImplementationOnce(() => okRes({ ...liveFixture, vehicles: vehA }))
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolveB = r
          }),
      )
    vi.stubGlobal('fetch', f)
    const { result, rerender } = renderHook(({ k }) => useLiveOption(k), { initialProps: { k: 'k-opt-1' } })
    await act(async () => {})
    expect(result.current.vehicles[0].label).toBe('A1')
    rerender({ k: 'k-opt-2' })
    await act(async () => {})
    expect(result.current.data).toBeNull()
    expect(result.current.vehicles[0].label).toBe('A1')
    await act(async () => {
      resolveB({ ok: true, json: () => Promise.resolve({ ...liveFixture, vehicles: vehB }) })
    })
    expect(result.current.data?.liveKey).toBe('k-opt-2')
    expect(result.current.vehicles[0].label).toBe('B1')
  })

  it('aborts the in-flight fetch on key change and unmount', async () => {
    const signals: AbortSignal[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((_u: unknown, init: RequestInit) => {
        signals.push(init.signal as AbortSignal)
        return new Promise(() => {})
      }),
    )
    const { rerender, unmount } = renderHook(({ k }) => useLiveOption(k), { initialProps: { k: 'k-opt-1' } })
    await act(async () => {})
    rerender({ k: 'k-opt-2' })
    await act(async () => {})
    expect(signals[0].aborted).toBe(true)
    expect(signals[1].aborted).toBe(false)
    unmount()
    expect(signals[1].aborted).toBe(true)
  })
})

type Timed = { tripId: string; departAt: string; arriveAt: string }
const transitOf = (o: { legs: unknown[] }) => (o.legs as { mode: string }[]).filter((l) => l.mode !== 'walk') as unknown as Timed[]
const shift = (iso: string, mins: number) => new Date(new Date(iso).getTime() + mins * 60000).toISOString()

describe('mergeLive', () => {
  const opt4 = plan.options[3]
  const liveOpt4 = live.options[3]

  it('overlays leg times, realtime, vehicle info and transfer, but keeps the planned stop name', () => {
    const merged = mergeLive(opt4, liveOpt4)
    const first = merged.legs.find((l) => l.mode !== 'walk')
    if (!first) throw new Error('no transit leg')
    expect(first.departAt).toBe('2026-11-14T18:12:00-07:00')
    expect(first.realtime).toBe(true)
    expect(first.vehicleLabel).toBe('4401')
    expect(first.occupancy).toBe('not_crowded')
    expect(first.vehiclePosition).toEqual({ lat: 53.5309, lon: -113.4962 })
    expect(merged.transfer).toEqual({
      stop: 'Whyte Ave & 104 St',
      spareMinutes: -1,
      status: 'at_risk',
      basedOn: 'scheduled',
      fallbackDepartAt: '2026-11-14T18:50:00-07:00',
    })
  })

  it('shifts leaveAt, arriveAt and duration with the live times', () => {
    const t = transitOf(opt4)
    const firstTrip = t[0].tripId
    const lastTrip = t[t.length - 1].tripId
    const fake = {
      ...liveOpt4,
      legs: liveOpt4.legs.map((l) =>
        l.tripId === firstTrip
          ? { ...l, departAt: shift(t[0].departAt, 5) }
          : l.tripId === lastTrip
            ? { ...l, arriveAt: shift(t[t.length - 1].arriveAt, 7) }
            : l,
      ),
    }
    const merged = mergeLive(opt4, fake)
    expect(new Date(merged.leaveAt).getTime() - new Date(opt4.leaveAt).getTime()).toBe(5 * 60000)
    expect(new Date(merged.arriveAt).getTime() - new Date(opt4.arriveAt).getTime()).toBe(7 * 60000)
    expect(merged.durationMinutes).toBe(opt4.durationMinutes + 2)
  })

  const ceilMins = (o: { leaveAt: string; arriveAt: string }) =>
    Math.ceil((new Date(o.arriveAt).getTime() - new Date(o.leaveAt).getTime()) / 60000)

  it('leg 1 unmatched, last leg matched +5: leaveAt unchanged, arriveAt shifts', () => {
    const t = transitOf(opt4)
    const last = t[t.length - 1]
    const only = liveOpt4.legs.find((l) => l.tripId === last.tripId)!
    const merged = mergeLive(opt4, { ...liveOpt4, legs: [{ ...only, departAt: shift(last.departAt, 5), arriveAt: shift(last.arriveAt, 5) }],
    })
    expect(merged.leaveAt).toBe(opt4.leaveAt)
    expect(new Date(merged.arriveAt).getTime() - new Date(opt4.arriveAt).getTime()).toBe(5 * 60000)
    expect(merged.durationMinutes).toBe(ceilMins(merged))
  })

  it('leg 1 matched +3, last leg unmatched: leaveAt shifts, arriveAt unchanged', () => {
    const t = transitOf(opt4)
    const only = liveOpt4.legs.find((l) => l.tripId === t[0].tripId)!
    const merged = mergeLive(opt4, { ...liveOpt4, legs: [{ ...only, departAt: shift(t[0].departAt, 3) }] })
    expect(new Date(merged.leaveAt).getTime() - new Date(opt4.leaveAt).getTime()).toBe(3 * 60000)
    expect(merged.arriveAt).toBe(opt4.arriveAt)
    expect(merged.durationMinutes).toBe(ceilMins(merged))
  })

  it('leaves legs without a live match untouched', () => {
    const merged = mergeLive(opt4, { ...liveOpt4, legs: [] })
    expect(merged.legs).toEqual(opt4.legs)
    expect(merged.leaveAt).toBe(opt4.leaveAt)
    expect(merged.durationMinutes).toBe(opt4.durationMinutes)
  })
})
