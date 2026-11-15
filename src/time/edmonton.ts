import { DateTime } from 'luxon'

export const ZONE = 'America/Edmonton'

export function nowInEdmonton(): DateTime {
  return DateTime.now().setZone(ZONE)
}

/** "25:10:00" -> 90600 (seconds; hours may exceed 24). */
export function parseGtfsTime(s: string): number {
  const [h, m, sec] = s.trim().split(':').map(Number)
  return h * 3600 + m * 60 + (sec || 0)
}

/**
 * GTFS times are seconds from "noon minus 12 hours" on the service date,
 * which differs from midnight only on DST changeover days.
 */
export function toInstant(serviceDate: string, seconds: number): DateTime {
  return DateTime.fromISO(serviceDate, { zone: ZONE })
    .set({ hour: 12, minute: 0, second: 0, millisecond: 0 })
    .minus({ hours: 12 })
    .plus({ seconds })
}

/** Today, then yesterday with nowSeconds + 86400 (for trips running past midnight). */
export function activeServiceDays(
  now: DateTime,
): { serviceDate: string; nowSeconds: number }[] {
  const local = now.setZone(ZONE)
  const today = local.startOf('day')
  const yesterday = today.minus({ days: 1 })
  const nowSeconds = Math.round(local.diff(today.set({ hour: 12 }).minus({ hours: 12 }), 'seconds').seconds)
  return [
    { serviceDate: today.toISODate()!, nowSeconds },
    { serviceDate: yesterday.toISODate()!, nowSeconds: nowSeconds + 86400 },
  ]
}

/** "6:07 PM" */
export function formatClock(dt: DateTime): string {
  return dt.setZone(ZONE).toFormat('h:mm a')
}
