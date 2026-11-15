import type { Option } from '@/src/contract/schema'
import { Badge, clock } from './format'

export default function OptionDetail({ option }: { option: Option }) {
  return (
    <ol data-testid="option-detail" className="flex flex-col gap-3">
      {option.legs.map((leg, i) =>
        leg.mode === 'walk' ? (
          <li key={i} className="text-sm">{`Walk ${leg.minutes} min`}</li>
        ) : (
          <li key={i} className="flex flex-col gap-0.5 text-sm">
            <span className="flex items-center gap-2 font-semibold">
              <span>{`${leg.mode === 'rail' ? 'Train' : 'Bus'} ${leg.route} to ${leg.headsign}`}</span>
              <Badge realtime={leg.realtime} />
            </span>
            <span>{`From ${leg.fromStop} at ${clock(leg.departAt)}`}</span>
            <span>{`To ${leg.toStop} at ${clock(leg.arriveAt)}`}</span>
            {leg.vehicleLabel && <span>{`Bus ${leg.vehicleLabel}`}</span>}
          </li>
        ),
      )}
    </ol>
  )
}
