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
  stops: StopLive[]
  vehicle: { label: string; lat: number; lon: number; occupancy: Occupancy | null } | null
}

export type AlertLive = {
  headline: string
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

function uniq(xs: (string | null | undefined)[]): string[] {
  return [...new Set(xs.filter((x): x is string => !!x))]
}

export function buildLiveIndex(bufs: {
  vehicles: Uint8Array
  tripUpdates: Uint8Array
  alerts: Uint8Array
}): LiveIndex {
  const trips = new Map<string, TripLive>()
  const ensure = (id: string): TripLive => {
    let t = trips.get(id)
    if (!t) {
      t = { stops: [], vehicle: null }
      trips.set(id, t)
    }
    return t
  }

  const tu = FeedMessage.decode(bufs.tripUpdates)
  for (const e of tu.entity) {
    const u = e.tripUpdate
    const tripId = u?.trip?.tripId
    if (!u || !tripId) continue
    const t = ensure(tripId)
    for (const s of u.stopTimeUpdate ?? []) {
      const arrival = num(s.arrival?.time)
      const departure = num(s.departure?.time)
      t.stops.push({
        stopSequence: s.stopSequence ?? 0,
        stopId: s.stopId ?? '',
        arrival: arrival || null,
        departure: departure || null,
        delay: num(s.departure?.delay) ?? num(s.arrival?.delay),
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
    const occ = v.occupancyStatus
    ensure(tripId).vehicle = {
      label,
      lat: v.position?.latitude ?? 0,
      lon: v.position?.longitude ?? 0,
      occupancy: occ === null || occ === undefined ? null : (OCCUPANCY[occ] ?? null),
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
      routeIds: uniq(ie.map((x) => x.routeId)),
      stopIds: uniq(ie.map((x) => x.stopId)),
      tripIds: uniq(ie.map((x) => x.trip?.tripId)),
    })
  }

  return { feedTimestamp: num(tu.header?.timestamp) ?? 0, trips, alerts }
}
