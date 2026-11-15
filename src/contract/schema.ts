import { z } from 'zod';

const Timestamp = z.iso.datetime({ offset: true });

export const Occupancy = z.enum(['not_crowded', 'some_standing', 'full']);
export type Occupancy = z.infer<typeof Occupancy>;

export const LatLng = z.object({ lat: z.number(), lon: z.number() });
export type LatLng = z.infer<typeof LatLng>;

/** [lat, lon] pairs */
const Path = z.array(z.tuple([z.number(), z.number()]));

export const Fare = z.object({
  amount: z.number(),
  cashAmount: z.number().nullable(),
  estimated: z.boolean(),
  label: z.string(),
});
export type Fare = z.infer<typeof Fare>;

const WalkLeg = z.object({
  mode: z.literal('walk'),
  minutes: z.number(),
  path: Path,
});

const TransitLeg = z.object({
  mode: z.enum(['bus', 'rail']),
  route: z.string(),
  headsign: z.string(),
  tripId: z.string(),
  serviceDate: z.string(),
  departAt: Timestamp,
  arriveAt: Timestamp,
  realtime: z.boolean(),
  fromStop: z.string(),
  toStop: z.string(),
  vehicleLabel: z.string().nullable(),
  occupancy: Occupancy.nullable(),
  vehiclePosition: LatLng.nullable(),
  transferWalkMinutesBefore: z.number().nullable(),
  path: Path,
});

export const Leg = z.discriminatedUnion('mode', [WalkLeg, TransitLeg]);
export type Leg = z.infer<typeof Leg>;

export const Transfer = z.object({
  stop: z.string(),
  spareMinutes: z.number(),
  status: z.enum(['on_track', 'tight', 'at_risk']),
  basedOn: z.enum(['live', 'scheduled']),
  fallbackDepartAt: Timestamp.nullable(),
});
export type Transfer = z.infer<typeof Transfer>;

export const Option = z.object({
  id: z.string(),
  liveKey: z.string(),
  leaveAt: Timestamp,
  arriveAt: Timestamp,
  durationMinutes: z.number(),
  fare: Fare,
  alerts: z.array(z.object({ headline: z.string() })),
  transfer: Transfer.nullable(),
  snow: z.array(z.string()),
  legs: z.array(Leg),
});
export type Option = z.infer<typeof Option>;

export const Vehicle = z.object({
  label: z.string(),
  tripId: z.string(),
  routeShortName: z.string(),
  lat: z.number(),
  lon: z.number(),
  occupancy: Occupancy.nullable(),
});
export type Vehicle = z.infer<typeof Vehicle>;

export const PlanResponse = z.object({
  generatedAt: Timestamp,
  liveDataAgeSeconds: z.number().nullable(),
  emptyReason: z.enum(['no_stops_near_start', 'no_stops_near_end', 'no_trips_soon']).nullable(),
  options: z.array(Option),
  vehicles: z.array(Vehicle),
});
export type PlanResponse = z.infer<typeof PlanResponse>;

export const SearchResponse = z.object({
  stops: z.array(z.object({ stopId: z.string(), name: z.string(), lat: z.number(), lon: z.number() })),
  routes: z.array(z.object({ routeId: z.string(), shortName: z.string(), longName: z.string() })),
});
export type SearchResponse = z.infer<typeof SearchResponse>;

export const LiveOption = z.object({
  liveKey: z.string(),
  expired: z.boolean(),
  legs: z.array(
    z.object({
      tripId: z.string(),
      departAt: Timestamp,
      arriveAt: Timestamp,
      realtime: z.boolean(),
      vehicleLabel: z.string().nullable(),
      occupancy: Occupancy.nullable(),
      vehiclePosition: LatLng.nullable(),
    }),
  ),
  transfer: Transfer.nullable(),
});
export type LiveOption = z.infer<typeof LiveOption>;

export const LiveResponse = z.object({
  liveDataAgeSeconds: z.number().nullable(),
  options: z.array(LiveOption),
  vehicles: z.array(Vehicle),
});
export type LiveResponse = z.infer<typeof LiveResponse>;

export const RouteSummary = z.object({
  routeId: z.string(),
  shortName: z.string(),
  longName: z.string(),
  group: z.enum(['bus', 'rail', 'regional']),
  color: z.string().nullable(),
});
export type RouteSummary = z.infer<typeof RouteSummary>;

export const RoutesResponse = z.object({ routes: z.array(RouteSummary) });
export type RoutesResponse = z.infer<typeof RoutesResponse>;

export const RouteDetail = z.object({
  route: RouteSummary,
  patterns: z.array(
    z.object({
      headsign: z.string(),
      path: Path,
      stops: z.array(z.object({ stopId: z.string(), name: z.string(), lat: z.number(), lon: z.number() })),
    }),
  ),
  departures: z.array(
    z.object({ tripId: z.string(), headsign: z.string(), departAt: Timestamp, realtime: z.boolean() }),
  ),
  vehicles: z.array(Vehicle),
  alerts: z.array(z.object({ headline: z.string() })),
});
export type RouteDetail = z.infer<typeof RouteDetail>;
