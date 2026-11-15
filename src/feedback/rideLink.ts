import { RideLink, type Option } from '@/src/contract/schema'

const MAX_LEN = 2048

export function rideLinkFor(option: Option, legIndex: number): RideLink {
  const leg = option.legs[legIndex]
  if (!leg || leg.mode === 'walk') throw new Error('not a transit leg')
  return {
    rideKey: `${leg.vehicleLabel ?? 'none'}:${leg.tripId}:${leg.serviceDate}`,
    vehicleLabel: leg.vehicleLabel,
    routeId: leg.route,
    routeShortName: leg.route,
    tripId: leg.tripId,
    serviceDate: leg.serviceDate,
    departAt: leg.departAt,
    arriveAt: leg.arriveAt,
    showed: {
      crowding: leg.occupancy !== null,
      transfer: option.transfer !== null,
      alerts: option.alerts.length > 0,
    },
  }
}

export function encodeRideLink(r: RideLink): string {
  const bytes = new TextEncoder().encode(JSON.stringify(r))
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function decodeRideLink(s: string): RideLink | null {
  try {
    if (!s || s.length > MAX_LEN) return null
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
    const parsed = RideLink.safeParse(JSON.parse(new TextDecoder().decode(bytes)))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
