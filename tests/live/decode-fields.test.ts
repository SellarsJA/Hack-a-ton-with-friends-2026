import { describe, it, expect } from 'vitest'
import GtfsRealtimeBindings from 'gtfs-realtime-bindings'
import { buildLiveIndex } from '@/src/live/decode'

const { FeedMessage, VehiclePosition } = GtfsRealtimeBindings.transit_realtime

const enc = (entity: object[]) =>
  FeedMessage.encode(
    FeedMessage.fromObject({
      header: { gtfsRealtimeVersion: '2.0', timestamp: 1000 },
      entity,
    }),
  ).finish()

const empty = enc([])

function vehicles(extra: object) {
  return enc([
    {
      id: 'v1',
      vehicle: {
        trip: { tripId: 'T1' },
        vehicle: { id: '1', label: '4393' },
        position: { latitude: 53.5, longitude: -113.5 },
        ...extra,
      },
    },
  ])
}

describe('absent protobuf fields', () => {
  it('vehicle without a position decodes to vehicle null, never 0,0', () => {
    const buf = enc([{ id: 'v1', vehicle: { trip: { tripId: 'T1' }, vehicle: { id: '1', label: '4393' } } }])
    const i = buildLiveIndex({ vehicles: buf, tripUpdates: empty, alerts: empty })
    expect(i.trips.get('T1')!.vehicle).toBeNull()
  })
  it('vehicle carries routeId from trip.route_id only when present', () => {
    const withRoute = vehicles({ trip: { tripId: 'T1', routeId: 'R9' } })
    expect(buildLiveIndex({ vehicles: withRoute, tripUpdates: empty, alerts: empty }).trips.get('T1')!.vehicle!.routeId).toBe('R9')
    expect(buildLiveIndex({ vehicles: vehicles({}), tripUpdates: empty, alerts: empty }).trips.get('T1')!.vehicle!.routeId).toBeNull()
  })
  it('vehicle without occupancy decodes to null', () => {
    const i = buildLiveIndex({ vehicles: vehicles({}), tripUpdates: empty, alerts: empty })
    expect(i.trips.get('T1')!.vehicle!.occupancy).toBeNull()
  })
  it('vehicle with STANDING_ROOM_ONLY maps to some_standing', () => {
    const i = buildLiveIndex({
      vehicles: vehicles({ occupancyStatus: VehiclePosition.OccupancyStatus.STANDING_ROOM_ONLY }),
      tripUpdates: empty,
      alerts: empty,
    })
    expect(i.trips.get('T1')!.vehicle!.occupancy).toBe('some_standing')
  })
  it('explicit EMPTY maps to not_crowded', () => {
    const i = buildLiveIndex({
      vehicles: vehicles({ occupancyStatus: VehiclePosition.OccupancyStatus.EMPTY }),
      tripUpdates: empty,
      alerts: empty,
    })
    expect(i.trips.get('T1')!.vehicle!.occupancy).toBe('not_crowded')
  })

  const tu = (stu: object) =>
    enc([{ id: 'e', tripUpdate: { trip: { tripId: 'T1' }, stopTimeUpdate: [stu] } }])

  it('falls back to arrival delay when departure has only time', () => {
    const i = buildLiveIndex({
      vehicles: empty,
      tripUpdates: tu({
        stopSequence: 1,
        stopId: 'S',
        departure: { time: 2000 },
        arrival: { delay: 120 },
      }),
      alerts: empty,
    })
    const s = i.trips.get('T1')!.stops[0]
    expect(s.delay).toBe(120)
    expect(s.departure).toBe(2000)
    expect(s.arrival).toBeNull()
  })
  it('decodes trip start_date as YYYY-MM-DD, null when absent', () => {
    const withDate = buildLiveIndex({
      vehicles: empty,
      tripUpdates: enc([
        { id: 'a', tripUpdate: { trip: { tripId: 'T1', startDate: '20261114' }, stopTimeUpdate: [] } },
        { id: 'b', tripUpdate: { trip: { tripId: 'T2' }, stopTimeUpdate: [] } },
      ]),
      alerts: empty,
    })
    expect(withDate.trips.get('T1')!.startDate).toBe('2026-11-14')
    expect(withDate.trips.get('T2')!.startDate).toBeNull()
    const vehicleOnly = buildLiveIndex({
      vehicles: enc([{ id: 'v', vehicle: { trip: { tripId: 'T3', startDate: '20261115' }, vehicle: { label: '1' } } }]),
      tripUpdates: empty,
      alerts: empty,
    })
    expect(vehicleOnly.trips.get('T3')!.startDate).toBe('2026-11-15')
  })

  it('keeps only alerts active at `now` when now is given', () => {
    const alert = (id: string, activePeriod: object[]) => ({
      id,
      alert: {
        activePeriod,
        informedEntity: [{ routeId: 'R' }],
        headerText: { translation: [{ text: id }] },
      },
    })
    const alerts = enc([
      alert('none', []),
      alert('future', [{ start: 5000, end: 6000 }]),
      alert('current', [{ start: 500, end: 1500 }]),
      alert('open-ended', [{ start: 900 }]),
      alert('past', [{ end: 999 }]),
      alert('second-period', [{ start: 100, end: 200 }, { start: 900, end: 1100 }]),
    ])
    const i = buildLiveIndex({ vehicles: empty, tripUpdates: empty, alerts }, { now: 1000 })
    expect(i.alerts.map((a) => a.headline)).toEqual(['none', 'current', 'open-ended', 'second-period'])
    const all = buildLiveIndex({ vehicles: empty, tripUpdates: empty, alerts })
    expect(all.alerts).toHaveLength(6)
    expect(all.alerts[1].activePeriods).toEqual([{ start: 5000, end: 6000 }])
    expect(all.alerts[3].activePeriods).toEqual([{ start: 900, end: null }])
  })

  it('delay is null when absent everywhere, 0 kept when explicit', () => {
    const none = buildLiveIndex({
      vehicles: empty,
      tripUpdates: tu({ stopSequence: 1, departure: { time: 2000 } }),
      alerts: empty,
    })
    expect(none.trips.get('T1')!.stops[0].delay).toBeNull()
    const zero = buildLiveIndex({
      vehicles: empty,
      tripUpdates: tu({ stopSequence: 1, departure: { delay: 0 } }),
      alerts: empty,
    })
    expect(zero.trips.get('T1')!.stops[0].delay).toBe(0)
  })
})
