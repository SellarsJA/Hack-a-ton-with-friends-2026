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
