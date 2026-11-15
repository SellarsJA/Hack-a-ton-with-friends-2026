import type { Option } from '@/src/contract/schema'
import { MODE_COLORS } from '@/src/map/lines'
import { Badge, OCCUPANCY_TEXT, clock, routeName } from './format'
import ModeIcon from './ModeIcon'

/** The selected option's steps as a vertical timeline: one icon per leg, joined by its line. */
export default function OptionDetail({ option }: { option: Option }) {
  const last = option.legs.length - 1
  return (
    <ol data-testid="option-detail" className="flex flex-col px-1">
      {option.legs.map((leg, i) => {
        const walk = leg.mode === 'walk'
        const color = MODE_COLORS[leg.mode]
        return (
          <li key={i} className="flex gap-3">
            <div className="flex w-8 flex-none flex-col items-center">
              <span
                className={`flex h-8 w-8 flex-none items-center justify-center rounded-full ${
                  walk ? 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300' : 'text-white'
                }`}
                style={walk ? undefined : { backgroundColor: color }}
              >
                <ModeIcon mode={leg.mode} />
              </span>
              {i < last && (
                <span
                  aria-hidden
                  className={`my-1 w-0 flex-1 ${walk ? 'border-l-2 border-dotted border-zinc-400 dark:border-zinc-600' : 'border-l-4'}`}
                  style={walk ? undefined : { borderColor: color }}
                />
              )}
            </div>
            {walk ? (
              <div className="flex min-h-8 items-center pb-4 text-sm text-zinc-600 dark:text-zinc-400">
                {`Walk ${leg.minutes} min`}
              </div>
            ) : (
              <div className="flex min-w-0 flex-col gap-0.5 pb-4 text-sm">
                <span className="flex min-h-8 flex-wrap items-center gap-2 font-semibold">
                  <span>{`${leg.mode === 'rail' ? 'Train' : 'Bus'} ${routeName(leg.route)} to ${leg.headsign}`}</span>
                  <Badge realtime={leg.realtime} />
                </span>
                <span className="text-zinc-700 dark:text-zinc-300">{`From ${leg.fromStop} at ${clock(leg.departAt)}`}</span>
                <span className="text-zinc-700 dark:text-zinc-300">{`To ${leg.toStop} at ${clock(leg.arriveAt)}`}</span>
                {(leg.vehicleLabel || leg.occupancy) && (
                  <span className="flex flex-wrap gap-x-2 text-xs text-zinc-500 dark:text-zinc-400">
                    {leg.vehicleLabel && <span>{`${leg.mode === 'rail' ? 'Train' : 'Bus'} ${leg.vehicleLabel}`}</span>}
                    {leg.occupancy && <span>{OCCUPANCY_TEXT[leg.occupancy]}</span>}
                  </span>
                )}
              </div>
            )}
          </li>
        )
      })}
    </ol>
  )
}
