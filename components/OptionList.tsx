import type { Option } from '@/src/contract/schema'
import OptionCard from './OptionCard'
import OptionDetail from './OptionDetail'

export default function OptionList({
  options,
  selectedId,
  onSelect,
}: {
  options: Option[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  return (
    <ul className="flex flex-col gap-3">
      {options.map((o) => (
        <li key={o.id} className="flex flex-col gap-3">
          <button
            type="button"
            aria-pressed={o.id === selectedId}
            onClick={() => onSelect(o.id)}
            className="block w-full"
          >
            <OptionCard option={o} selected={o.id === selectedId} />
          </button>
          {/* Steps sit directly under the tapped card so they are on screen on a phone. */}
          {o.id === selectedId && <OptionDetail option={o} />}
        </li>
      ))}
    </ul>
  )
}
