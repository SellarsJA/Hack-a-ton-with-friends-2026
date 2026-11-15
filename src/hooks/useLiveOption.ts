'use client'

import { useEffect, useState } from 'react'
import { DateTime } from 'luxon'
import { LiveResponse, type LiveOption, type Option, type Vehicle } from '@/src/contract/schema'
import { ZONE } from '@/src/time/edmonton'

export const LIVE_POLL_MS = 30_000

type LiveState = { data: LiveOption | null; vehicles: Vehicle[]; ageSeconds: number | null }
const EMPTY: LiveState = { data: null, vehicles: [], ageSeconds: null }

/**
 * Polls /api/live for one option. Pauses while the page is hidden and fetches
 * at once when it becomes visible again. A failed poll keeps the previous data.
 */
export function useLiveOption(liveKey: string | null): LiveState {
  const [state, setState] = useState<{ key: string; value: LiveState } | null>(null)

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
          value: { data, vehicles: parsed.data.vehicles, ageSeconds: parsed.data.liveDataAgeSeconds },
        })
      } catch {
        // A failed poll keeps what we already have.
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

  return liveKey && state && state.key === liveKey ? state.value : EMPTY
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
  let seenFirst = false
  let lastTransitIdx = -1
  option.legs.forEach((l, i) => {
    if (l.mode !== 'walk') lastTransitIdx = i
  })

  const legs = option.legs.map((leg, i) => {
    if (leg.mode === 'walk') return leg
    const l = byTrip.get(leg.tripId)
    if (!l) return leg
    if (!seenFirst) {
      leaveShift = diffMs(l.departAt, leg.departAt)
      seenFirst = true
    }
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
