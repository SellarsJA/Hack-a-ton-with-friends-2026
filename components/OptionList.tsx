import type { Option } from '@/src/contract/schema'
import OptionCard from './OptionCard'
import OptionDetail from './OptionDetail'

export default function OptionList({
  options,
  selectedId,
  onSelect,
  expired = false,
  onSearchAgain,
  now,
  onStart,
  riding = false,
  reviewsVersion = 0,
  onRate,
}: {
  options: Option[]
  selectedId: string | null
  onSelect: (id: string) => void
  /** The selected option has already left. */
  expired?: boolean
  onSearchAgain?: () => void
  /** Epoch ms from the live poll; enables the on-board button on the selected option. */
  now?: number
  /** Start the selected trip: the page then shows only it, with a way to rate it. */
  onStart?: (id: string) => void
  /** The rider has started this trip; the start button is replaced by the page's rate bar. */
  riding?: boolean
  reviewsVersion?: number
  /** Open the rate sheet for the started trip. */
  onRate?: () => void
}) {
  return (
    <ul className="flex flex-col gap-3">
      {options.map((o) => {
        const selected = o.id === selectedId
        const gone = selected && expired
        return (
          <li key={o.id} className="flex flex-col gap-3">
            <button
              type="button"
              aria-pressed={selected}
              onClick={() => onSelect(o.id)}
              className="block w-full"
            >
              <OptionCard option={o} selected={selected} expired={gone} reviewsVersion={reviewsVersion} />
            </button>
            {gone && (
              <button
                type="button"
                onClick={onSearchAgain}
                className="h-12 rounded-lg bg-blue-700 px-4 font-semibold text-white"
              >
                Search again
              </button>
            )}
            {/* On a started trip, rating sits right under the card: always in view, never over the steps.
                No time window, so it works in a demo and after the rider has got off. */}
            {selected && riding && onRate && (
              <button
                type="button"
                onClick={onRate}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-700 px-4 font-semibold text-white shadow-sm"
              >
                <span aria-hidden>★</span>
                Ride over? Rate it
              </button>
            )}
            {/* Steps sit directly under the tapped card so they are on screen on a phone. */}
            {selected && <OptionDetail option={o} now={now} />}
            {selected && !riding && !gone && onStart && (
              <button
                type="button"
                onClick={() => onStart(o.id)}
                className="h-12 rounded-xl bg-blue-700 px-4 font-semibold text-white shadow-sm"
              >
                Start this trip
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}
