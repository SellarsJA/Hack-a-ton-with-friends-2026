import { DateTime } from 'luxon'
import type { Leg } from '@/src/contract/schema'
import type { ZoneId } from '@/src/fares/fare'
import { sliceShape } from '@/src/geo/geo'
import type { Candidate } from '@/src/plan/query'
import type { RealtimeResult } from '@/src/plan/realtime'
import { ZONE } from '@/src/time/edmonton'

export type Shapes = Map<string, [number, number][]>

const ZONES = new Set<string>(['1EDM', '1AIR', '2STA', '4SCT', '5SGT', '6FST', '7BT', '9LT'])
export const zoneOf = (z: string | null): ZoneId => (z != null && ZONES.has(z) ? (z as ZoneId) : '1EDM')

export const iso = (epoch: number): string =>
  DateTime.fromSeconds(epoch, { zone: ZONE }).toISO({ suppressMilliseconds: true }) as string

export const isRail = (c: Candidate): boolean => c.routeType === 0 || c.routeType === 1

/** The board-to-alight path: the shape sliced between the stops when known, else a straight line. */
export function transitPath(c: Candidate, shapes: Shapes): [number, number][] {
  const boardPt = { lat: c.board.lat, lon: c.board.lon }
  const alightPt = { lat: c.alight.lat, lon: c.alight.lon }
  const shape = c.shapeId ? shapes.get(c.shapeId) : undefined
  return shape ? sliceShape(shape, boardPt, alightPt) : [[boardPt.lat, boardPt.lon], [alightPt.lat, alightPt.lon]]
}

/** A transit leg from a candidate and its realtime result; the path follows the shape when known. */
export function transitLeg(
  c: Candidate,
  rt: RealtimeResult,
  shapes: Shapes,
  transferWalkMinutesBefore: number | null = null,
): Leg {
  return {
    mode: isRail(c) ? 'rail' : 'bus',
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
    vehiclePosition: null,
    transferWalkMinutesBefore,
    path: transitPath(c, shapes),
  }
}
