import type { Option } from '@/src/contract/schema'
import { Badge, OCCUPANCY_TEXT, clock } from './format'
import TransferBadge from './TransferBadge'

export const EXPIRED_TEXT = 'This option has left. Search again.'

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
  const head = `Leave ${clock(option.leaveAt)} · ${option.durationMinutes} min · $${fare.amount.toFixed(2)}${
    fare.estimated ? ' (estimated)' : ''
  }`
  const trainSide = option.legs.some((l) => l.mode === 'rail')
  return (
    <div
      className={`flex min-h-12 flex-col gap-1 rounded-lg border-2 px-3 py-2 text-left ${
        selected ? 'border-blue-700 bg-blue-50 dark:bg-blue-950' : 'border-zinc-300 dark:border-zinc-700'
      }`}
    >
      <span className="text-base font-semibold">{head}</span>
      {fare.cashAmount !== null && (
        <span className="text-sm text-zinc-600 dark:text-zinc-400">{`Cash $${fare.cashAmount.toFixed(2)}`}</span>
      )}
      {option.legs.map((leg, i) =>
        leg.mode === 'walk' ? null : (
          <span key={i} className="flex flex-wrap items-center gap-2 text-sm">
            <span>{`Route ${leg.route}`}</span>
            <Badge realtime={leg.realtime} />
            {leg.occupancy && <span>{OCCUPANCY_TEXT[leg.occupancy]}</span>}
          </span>
        ),
      )}
      {option.transfer && <TransferBadge transfer={option.transfer} trainSide={trainSide} />}
      {option.alerts.map((a, i) => (
        <span key={i} className="text-sm text-amber-800 dark:text-amber-300">{`⚠️ ${a.headline}`}</span>
      ))}
      {expired && <span className="text-sm font-semibold text-red-800 dark:text-red-300">{EXPIRED_TEXT}</span>}
    </div>
  )
}
