import { DateTime } from 'luxon'
import { ZONE, formatClock } from '@/src/time/edmonton'
import type { Occupancy } from '@/src/contract/schema'

export const clock = (iso: string) => formatClock(DateTime.fromISO(iso, { zone: ZONE }))

/** "34 min", or "1 h 5 min" past the hour. */
export const duration = (minutes: number) => {
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h} h ${m} min` : `${h} h`
}

export { routeName } from '@/src/map/lines'

export const OCCUPANCY_TEXT: Record<Occupancy, string> = {
  not_crowded: 'Not crowded',
  some_standing: 'Some standing',
  full: 'Full',
}

export function Badge({ realtime }: { realtime: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
        realtime
          ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-300'
          : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
      }`}
    >
      {realtime && (
        <span aria-hidden className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75 motion-reduce:hidden" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
        </span>
      )}
      {realtime ? 'Live' : 'Scheduled'}
    </span>
  )
}
