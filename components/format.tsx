import { DateTime } from 'luxon'
import { ZONE, formatClock } from '@/src/time/edmonton'
import type { Occupancy } from '@/src/contract/schema'

export const clock = (iso: string) => formatClock(DateTime.fromISO(iso, { zone: ZONE }))

export const OCCUPANCY_TEXT: Record<Occupancy, string> = {
  not_crowded: 'Not crowded',
  some_standing: 'Some standing',
  full: 'Full',
}

export function Badge({ realtime }: { realtime: boolean }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-xs font-medium ${
        realtime ? 'bg-green-100 text-green-900' : 'bg-zinc-200 text-zinc-800'
      }`}
    >
      {realtime ? 'Live' : 'Scheduled'}
    </span>
  )
}
