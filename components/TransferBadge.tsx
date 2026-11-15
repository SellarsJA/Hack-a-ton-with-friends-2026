import type { Transfer } from '@/src/contract/schema'
import { TRAIN_SIDE_NOTE } from '@/src/plan/transfer'
import { clock } from './format'

const STYLE: Record<Transfer['status'], string> = {
  on_track: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-300',
  tight: 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300',
  at_risk: 'bg-red-100 text-red-900 dark:bg-red-500/15 dark:text-red-300',
}

export default function TransferBadge({ transfer, trainSide }: { transfer: Transfer; trainSide: boolean }) {
  const suffix = transfer.basedOn === 'scheduled' ? ' (scheduled)' : ''
  let text: string
  if (transfer.status === 'on_track') text = `On track · ${transfer.spareMinutes} min to transfer${suffix}`
  else if (transfer.status === 'tight') text = `Tight · ${transfer.spareMinutes} min to transfer${suffix}`
  else
    text = `At risk${transfer.fallbackDepartAt ? ` · next one ${clock(transfer.fallbackDepartAt)}` : ''}${suffix}`
  return (
    <span className="flex flex-col gap-0.5 text-sm">
      <span className={`self-start rounded-full px-2 py-0.5 font-medium ${STYLE[transfer.status]}`}>{text}</span>
      {trainSide && <span className="text-zinc-600 dark:text-zinc-400">{TRAIN_SIDE_NOTE}</span>}
    </span>
  )
}
