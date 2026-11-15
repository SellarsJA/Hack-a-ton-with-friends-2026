import { DateTime } from 'luxon'
import type { LatLng, Leg, Option } from '@/src/contract/schema'
import { fareFor, type ZoneId } from '@/src/fares/fare'
import { sliceShape } from '@/src/geo/geo'
import type { LiveIndex } from '@/src/live/decode'
import type { Candidate } from '@/src/plan/query'
import { applyRealtime } from '@/src/plan/realtime'
import { ZONE } from '@/src/time/edmonton'

export type AssembleCtx = {
  from: LatLng
  to: LatLng
  live: LiveIndex | null
  nowEpoch: number
  shapes: Map<string, [number, number][]>
}

const ZONES = new Set<string>(['1EDM', '1AIR', '2STA', '4SCT', '5SGT', '6FST', '7BT', '9LT'])
const zoneOf = (z: string | null): ZoneId => (z != null && ZONES.has(z) ? (z as ZoneId) : '1EDM')

const iso = (epoch: number): string =>
  DateTime.fromSeconds(epoch, { zone: ZONE }).toISO({ suppressMilliseconds: true }) as string

export function assembleDirectOptions(cands: Candidate[], ctx: AssembleCtx): Option[] {
  const timed = cands
    .map((c) => ({ c, rt: applyRealtime(c, ctx.live) }))
    // Keep only buses the rider can still walk to: live time when known, schedule otherwise.
    .filter((x) => x.rt.departEpoch - x.c.board.walkSeconds >= ctx.nowEpoch)
    .map((x) => ({ ...x, finalArrive: x.rt.arriveEpoch + x.c.alight.walkSeconds }))
    .sort((a, b) => a.finalArrive - b.finalArrive)

  const seen = new Set<string>()
  const best: typeof timed = []
  for (const x of timed) {
    const key = `${x.c.routeId}|${x.c.headsign ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    best.push(x)
  }

  return best.slice(0, 5).map(({ c, rt, finalArrive }, i) => {
    const leaveAt = rt.departEpoch - c.board.walkSeconds
    const boardPt = { lat: c.board.lat, lon: c.board.lon }
    const alightPt = { lat: c.alight.lat, lon: c.alight.lon }
    const shape = c.shapeId ? ctx.shapes.get(c.shapeId) : undefined
    const legs: Leg[] = []
    if (c.board.walkSeconds > 0) {
      legs.push({
        mode: 'walk',
        minutes: c.board.walkSeconds / 60,
        path: [[ctx.from.lat, ctx.from.lon], [boardPt.lat, boardPt.lon]],
      })
    }
    legs.push({
      mode: c.routeType === 0 || c.routeType === 1 ? 'rail' : 'bus',
      route: c.routeShortName ?? c.routeId,
      headsign: c.headsign ?? '',
      tripId: c.tripId,
      serviceDate: c.serviceDate,
      departAt: iso(rt.departEpoch),
      arriveAt: iso(rt.arriveEpoch),
      realtime: rt.realtime,
      fromStop: c.board.name,
      toStop: c.alight.name,
      vehicleLabel: rt.vehicleLabel,
      occupancy: rt.occupancy,
      path: shape ? sliceShape(shape, boardPt, alightPt) : [[boardPt.lat, boardPt.lon], [alightPt.lat, alightPt.lon]],
    })
    if (c.alight.walkSeconds > 0) {
      legs.push({
        mode: 'walk',
        minutes: c.alight.walkSeconds / 60,
        path: [[alightPt.lat, alightPt.lon], [ctx.to.lat, ctx.to.lon]],
      })
    }
    const headlines = new Set<string>()
    for (const a of ctx.live?.alerts ?? []) {
      if (
        a.routeIds.includes(c.routeId) ||
        a.stopIds.includes(c.board.stopId) ||
        a.stopIds.includes(c.alight.stopId) ||
        a.tripIds.includes(c.tripId)
      ) {
        headlines.add(a.headline)
      }
    }
    return {
      id: `opt-${i + 1}`,
      leaveAt: iso(leaveAt),
      arriveAt: iso(finalArrive),
      durationMinutes: Math.ceil((finalArrive - leaveAt) / 60),
      fare: fareFor({
        firstZone: zoneOf(c.board.zone),
        lastZone: zoneOf(c.alight.zone),
        legs: [{ agencyId: c.agencyId, routeShortName: c.routeShortName ?? '' }],
      }),
      alerts: [...headlines].map((headline) => ({ headline })),
      transfer: null,
      snow: [],
      legs,
    }
  })
}
