'use client'

import { useEffect, useState } from 'react'
import { DateTime } from 'luxon'
import { LiveResponse, type LiveOption, type Option, type Vehicle } from '@/src/contract/schema'
import { ZONE } from '@/src/time/edmonton'

export const LIVE_POLL_MS = 30_000

type LiveState = {
  data: LiveOption | null
  vehicles: Vehicle[]
  /** Server-reported age plus the time since that response arrived, so it keeps growing through failed polls. */
  ageSeconds: number | null
  /** Epoch ms of the latest finished poll tick, successful or not; 0 before the first one. */
  now: number
}
const EMPTY: LiveState = { data: null, vehicles: [], ageSeconds: null, now: 0 }

type Received = { data: LiveOption; vehicles: Vehicle[]; serverAge: number | null; receivedAt: number }

/**
 * Polls /api/live for one option. Pauses while the page is hidden and fetches
 * at once when it becomes visible again. A failed poll keeps the previous data
 * but still re-renders, so the reported age keeps growing.
 */
export function useLiveOption(liveKey: string | null): LiveState {
  const [state, setState] = useState<{ key: string; value: Received } | null>(null)
  const [now, setNow] = useState(0)

  useEffect(() => {
    if (!liveKey) return
    const fixture = process.env.NEXT_PUBLIC_USE_FIXTURE === '1' ? '&fixture=1' : ''
    const url = `/api/live?keys=${encodeURIComponent(liveKey)}${fixture}`
    let controller: AbortController | null = null
    let timer: ReturnType<typeof setInterval> | null = null

    const load = async () => {
      controller?.abort()
      const mine = new AbortController()
      controller = mine
      try {
        const res = await fetch(url, { cache: 'no-store', signal: mine.signal })
        if (!res.ok) return
        const parsed = LiveResponse.safeParse(await res.json())
        if (!parsed.success || mine.signal.aborted) return
        const data = parsed.data.options.find((o) => o.liveKey === liveKey) ?? null
        if (!data) return
        setState({
          key: liveKey,
          value: { data, vehicles: parsed.data.vehicles, serverAge: parsed.data.liveDataAgeSeconds, receivedAt: Date.now() },
        })
      } catch {
        // A failed poll keeps what we already have.
      } finally {
        // Every finished tick re-renders, so age and expiry advance even when the poll failed.
        if (!mine.signal.aborted) setNow(Date.now())
      }
    }
    const stop = () => {
      if (timer !== null) clearInterval(timer)
      timer = null
    }
    const start = () => {
      stop()
      void load()
      timer = setInterval(() => void load(), LIVE_POLL_MS)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        stop()
        controller?.abort()
      } else {
        start()
      }
    }

    if (document.visibilityState !== 'hidden') start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      stop()
      controller?.abort()
    }
  }, [liveKey])

  if (!liveKey || !state) return EMPTY
  // Keep the last vehicles across a key change so the dots do not flicker off.
  if (state.key !== liveKey) return { data: null, vehicles: state.value.vehicles, ageSeconds: null, now }
  const { data, vehicles, serverAge, receivedAt } = state.value
  const ageSeconds = serverAge === null ? null : serverAge + Math.max(0, now - receivedAt) / 1000
  return { data, vehicles, ageSeconds, now }
}

/** True once the option's first transit leg has departed, judged on the client clock. */
export function hasLeft(option: Option, nowMs: number): boolean {
  const first = option.legs.find((l) => l.mode !== 'walk')
  return first !== undefined && DateTime.fromISO(first.departAt).toMillis() < nowMs
}

const shiftIso = (iso: string, ms: number) =>
  DateTime.fromISO(iso, { zone: ZONE }).plus({ milliseconds: ms }).toISO({ suppressMilliseconds: true }) ?? iso
const diffMs = (a: string, b: string) => DateTime.fromISO(a).toMillis() - DateTime.fromISO(b).toMillis()

/**
 * Overlays live times, vehicle info and transfer status onto a planned option.
 * The planned transfer.stop is kept: live carries a stop id there, not a name.
 */
export function mergeLive(option: Option, live: LiveOption): Option {
  const byTrip = new Map(live.legs.map((l) => [l.tripId, l]))
  let leaveShift = 0
  let arriveShift = 0
  let firstTransitIdx = -1
  let lastTransitIdx = -1
  option.legs.forEach((l, i) => {
    if (l.mode === 'walk') return
    if (firstTransitIdx < 0) firstTransitIdx = i
    lastTransitIdx = i
  })

  const legs = option.legs.map((leg, i) => {
    if (leg.mode === 'walk') return leg
    const l = byTrip.get(leg.tripId)
    if (!l) return leg
    if (i === firstTransitIdx) leaveShift = diffMs(l.departAt, leg.departAt)
    if (i === lastTransitIdx) arriveShift = diffMs(l.arriveAt, leg.arriveAt)
    return {
      ...leg,
      departAt: l.departAt,
      arriveAt: l.arriveAt,
      realtime: l.realtime,
      vehicleLabel: l.vehicleLabel,
      occupancy: l.occupancy,
      vehiclePosition: l.vehiclePosition,
    }
  })

  return {
    ...option,
    legs,
    leaveAt: shiftIso(option.leaveAt, leaveShift),
    arriveAt: shiftIso(option.arriveAt, arriveShift),
    durationMinutes: option.durationMinutes + Math.round((arriveShift - leaveShift) / 60000),
    transfer:
      option.transfer && live.transfer
        ? {
            ...option.transfer,
            spareMinutes: live.transfer.spareMinutes,
            status: live.transfer.status,
            basedOn: live.transfer.basedOn,
            fallbackDepartAt: live.transfer.fallbackDepartAt,
          }
        : option.transfer,
  }
}
