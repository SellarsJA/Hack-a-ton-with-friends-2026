import Link from 'next/link'
import type { Option } from '@/src/contract/schema'
import { encodeRideLink, rideLinkFor } from '@/src/feedback/rideLink'

const BEFORE_MS = 2 * 60_000
const AFTER_MS = 10 * 60_000

export default function OnBoardButton({
  option,
  legIndex,
  now,
}: {
  option: Option
  legIndex: number
  /** Epoch ms from the live poll; 0 means no poll yet. */
  now: number
}) {
  if (!now) return null
  const leg = option.legs[legIndex]
  if (!leg || leg.mode === 'walk') return null
  const dep = Date.parse(leg.departAt)
  const arr = Date.parse(leg.arriveAt)
  if (now < dep - BEFORE_MS || now > arr + AFTER_MS) return null
  const ride = rideLinkFor(option, legIndex)
  return (
    <Link
      href={`/ride?r=${encodeRideLink(ride)}`}
      className="mt-1 flex h-12 items-center justify-center rounded-lg bg-blue-700 px-4 font-semibold text-white"
    >
      {leg.vehicleLabel ? `I'm on bus ${leg.vehicleLabel}` : "I'm on this ride"}
    </Link>
  )
}
