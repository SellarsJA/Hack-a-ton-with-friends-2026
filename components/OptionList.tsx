import type { Option } from '@/src/contract/schema'
import OptionCard from './OptionCard'
import OptionDetail from './OptionDetail'

export default function OptionList({
  options,
  selectedId,
  onSelect,
  expired = false,
  onSearchAgain,
}: {
  options: Option[]
  selectedId: string | null
  onSelect: (id: string) => void
  /** The selected option has already left. */
  expired?: boolean
  onSearchAgain?: () => void
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
              <OptionCard option={o} selected={selected} expired={gone} />
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
            {/* Steps sit directly under the tapped card so they are on screen on a phone. */}
            {selected && <OptionDetail option={o} />}
          </li>
        )
      })}
    </ul>
  )
}
