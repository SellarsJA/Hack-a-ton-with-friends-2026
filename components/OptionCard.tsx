import type { Option } from '@/src/contract/schema'
import { MODE_COLORS } from '@/src/map/lines'
import { Badge, OCCUPANCY_TEXT, clock, duration, routeName } from './format'
import ModeIcon from './ModeIcon'
import TransferBadge from './TransferBadge'

export const EXPIRED_TEXT = 'This option has left. Search again.'

const MODE_WORD = { bus: 'Bus', rail: 'Train', walk: 'Walk' } as const

/** Walk 5 › [bus 9] › [train Capital] › Walk 5, as icons and coloured route chips. */
export function LegStrip({ legs }: { legs: Option['legs'] }) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      {legs.map((leg, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && (
            <span aria-hidden className="text-zinc-400 dark:text-zinc-500">
              ›
            </span>
          )}
          {leg.mode === 'walk' ? (
            <span className="flex items-center gap-0.5 text-sm text-zinc-600 dark:text-zinc-400">
              <ModeIcon mode="walk" />
              <span className="sr-only">Walk</span>
              <span className="text-xs tabular-nums">{leg.minutes}</span>
              <span className="sr-only">min</span>
            </span>
          ) : (
            <span
              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-sm font-semibold text-white"
              style={{ backgroundColor: MODE_COLORS[leg.mode] }}
            >
              <ModeIcon mode={leg.mode} className="h-4 w-4" />
              <span className="sr-only">{MODE_WORD[leg.mode]}</span>
              <span>{routeName(leg.route)}</span>
            </span>
          )}
        </span>
      ))}
    </span>
  )
}

export default function OptionCard({
  option,
  selected,
  expired = false,
}: {
  option: Option
  selected: boolean
  expired?: boolean
}) {
  const { fare } = option
  const transit = option.legs.flatMap((l) => (l.mode === 'walk' ? [] : [l]))
  const trainSide = transit.some((l) => l.mode === 'rail')
  // The leave time comes from the first vehicle, so its source is the card's source.
  const realtime = transit[0]?.realtime ?? false
  const occupancy = transit.find((l) => l.occupancy)?.occupancy ?? null
  return (
    <div
      className={`flex flex-col gap-2 rounded-2xl border px-4 py-3 text-left transition-colors ${
        selected
          ? 'border-blue-500 bg-white shadow-md ring-1 ring-blue-500 dark:border-blue-400 dark:bg-zinc-900 dark:ring-blue-400'
          : 'border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900/60 dark:hover:border-zinc-700'
      }`}
    >
      <span className="flex items-baseline justify-between gap-3">
        <span className="text-lg font-semibold tabular-nums">{`Leave ${clock(option.leaveAt)}`}</span>
        <span className="text-lg font-semibold tabular-nums">{duration(option.durationMinutes)}</span>
      </span>
      <span className="flex items-baseline justify-between gap-3 text-sm text-zinc-600 dark:text-zinc-400">
        <span className="tabular-nums">{`Arrive ${clock(option.arriveAt)}`}</span>
        <span className="flex items-baseline gap-2 tabular-nums">
          <span className="font-medium text-zinc-900 dark:text-zinc-100">
            {`$${fare.amount.toFixed(2)}${fare.estimated ? ' (estimated)' : ''}`}
          </span>
          {fare.cashAmount !== null && <span>{`Cash $${fare.cashAmount.toFixed(2)}`}</span>}
        </span>
      </span>
      <LegStrip legs={option.legs} />
      <span className="flex flex-wrap items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
        <Badge realtime={realtime} />
        {occupancy && <span>{OCCUPANCY_TEXT[occupancy]}</span>}
      </span>
      {option.transfer && <TransferBadge transfer={option.transfer} trainSide={trainSide} />}
      {option.alerts.map((a, i) => (
        <span
          key={i}
          className="rounded-lg bg-amber-50 px-2 py-1 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-300"
        >{`⚠️ ${a.headline}`}</span>
      ))}
      {expired && <span className="text-sm font-semibold text-red-700 dark:text-red-400">{EXPIRED_TEXT}</span>}
    </div>
  )
}
