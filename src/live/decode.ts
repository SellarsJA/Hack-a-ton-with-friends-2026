import GtfsRealtimeBindings from 'gtfs-realtime-bindings'
import type { Occupancy } from '@/src/contract/schema'

export type StopLive = {
  stopSequence: number
  stopId: string
  arrival: number | null
  departure: number | null
  delay: number | null
}

export type TripLive = {
  /** Service day of this trip instance (from trip.start_date), YYYY-MM-DD; null when the feed omits it. */
  startDate: string | null
  stops: StopLive[]
  vehicle: { label: string; lat: number; lon: number; occupancy: Occupancy | null; routeId?: string | null } | null
}

export type ActivePeriod = { start: number | null; end: number | null }

export type AlertLive = {
  headline: string
  /** Empty means always active. */
  activePeriods: ActivePeriod[]
  routeIds: string[]
  stopIds: string[]
  tripIds: string[]
}

export type LiveIndex = {
  feedTimestamp: number
  trips: Map<string, TripLive>
  alerts: AlertLive[]
}

const { FeedMessage } = GtfsRealtimeBindings.transit_realtime
const OccStatus = GtfsRealtimeBindings.transit_realtime.VehiclePosition.OccupancyStatus

const OCCUPANCY: Record<number, Occupancy> = {
  [OccStatus.EMPTY]: 'not_crowded',
  [OccStatus.MANY_SEATS_AVAILABLE]: 'not_crowded',
  [OccStatus.FEW_SEATS_AVAILABLE]: 'not_crowded',
  [OccStatus.STANDING_ROOM_ONLY]: 'some_standing',
  [OccStatus.CRUSHED_STANDING_ROOM_ONLY]: 'some_standing',
  [OccStatus.FULL]: 'full',
  [OccStatus.NOT_ACCEPTING_PASSENGERS]: 'full',
}

/** Converts protobuf Long / number / null to a number or null. */
function num(v: unknown): number | null {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** protobufjs puts defaults on the prototype; only own properties were on the wire. */
function field(o: object | null | undefined, k: string): unknown {
  return o && Object.prototype.hasOwnProperty.call(o, k)
    ? (o as Record<string, unknown>)[k]
    : null
}

/** "20261114" -> "2026-11-14"; anything else -> null. */
function isoDate(v: string | null | undefined): string | null {
  return v && /^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : null
}

/** Active when it has no period, or at least one period contains `now` (epoch seconds). */
export function isAlertActive(a: AlertLive, now: number): boolean {
  if (a.activePeriods.length === 0) return true
  return a.activePeriods.some((p) => (p.start == null || p.start <= now) && (p.end == null || now <= p.end))
}

export function activeAlerts(alerts: AlertLive[], now: number): AlertLive[] {
  return alerts.filter((a) => isAlertActive(a, now))
}

function uniq(xs: (string | null | undefined)[]): string[] {
  return [...new Set(xs.filter((x): x is string => !!x))]
}

/**
 * Decodes the three feeds. With `opts.now` (epoch seconds), alerts outside their
 * active periods are dropped; without it every alert is kept (snapshot rebasing filters later).
 */
export function buildLiveIndex(
  bufs: {
    vehicles: Uint8Array
    tripUpdates: Uint8Array
    alerts: Uint8Array
  },
  opts: { now?: number } = {},
): LiveIndex {
  const trips = new Map<string, TripLive>()
  const ensure = (id: string, startDate: string | null): TripLive => {
    let t = trips.get(id)
    if (!t) {
      t = { startDate, stops: [], vehicle: null }
      trips.set(id, t)
    } else if (t.startDate == null) {
      t.startDate = startDate
    }
    return t
  }

  const tu = FeedMessage.decode(bufs.tripUpdates)
  for (const e of tu.entity) {
    const u = e.tripUpdate
    const tripId = u?.trip?.tripId
    if (!u || !tripId) continue
    const t = ensure(tripId, isoDate(u.trip?.startDate))
    for (const s of u.stopTimeUpdate ?? []) {
      const arrival = num(field(s.arrival, 'time'))
      const departure = num(field(s.departure, 'time'))
      t.stops.push({
        stopSequence: s.stopSequence ?? 0,
        stopId: s.stopId ?? '',
        arrival: arrival || null,
        departure: departure || null,
        delay: num(field(s.departure, 'delay')) ?? num(field(s.arrival, 'delay')),
      })
    }
    t.stops.sort((a, b) => a.stopSequence - b.stopSequence)
  }

  const vp = FeedMessage.decode(bufs.vehicles)
  for (const e of vp.entity) {
    const v = e.vehicle
    const tripId = v?.trip?.tripId
    if (!v || !tripId) continue
    const label = v.vehicle?.label || v.vehicle?.id || ''
    const occ = num(field(v, 'occupancyStatus'))
    const t = ensure(tripId, isoDate(v.trip?.startDate))
    // No position on the wire means no vehicle to draw; never invent 0,0.
    if (!field(v, 'position') || v.position?.latitude == null || v.position?.longitude == null) continue
    const routeId = field(v.trip, 'routeId')
    t.vehicle = {
      label,
      lat: v.position.latitude,
      lon: v.position.longitude,
      occupancy: occ === null ? null : (OCCUPANCY[occ] ?? null),
      routeId: typeof routeId === 'string' && routeId !== '' ? routeId : null,
    }
  }

  const al = FeedMessage.decode(bufs.alerts)
  const alerts: AlertLive[] = []
  for (const e of al.entity) {
    const a = e.alert
    if (!a) continue
    const ie = a.informedEntity ?? []
    alerts.push({
      headline: a.headerText?.translation?.[0]?.text ?? '',
      activePeriods: (a.activePeriod ?? []).map((p) => ({
        start: num(field(p, 'start')),
        end: num(field(p, 'end')),
      })),
      routeIds: uniq(ie.map((x) => x.routeId)),
      stopIds: uniq(ie.map((x) => x.stopId)),
      tripIds: uniq(ie.map((x) => x.trip?.tripId)),
    })
  }

  return {
    feedTimestamp: num(tu.header?.timestamp) ?? 0,
    trips,
    alerts: opts.now === undefined ? alerts : activeAlerts(alerts, opts.now),
  }
}
