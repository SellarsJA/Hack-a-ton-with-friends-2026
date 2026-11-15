'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import FeedbackForm from '@/components/FeedbackForm'
import { decodeRideLink } from '@/src/feedback/rideLink'

function Ride() {
  const r = useSearchParams().get('r')
  const ride = r ? decodeRideLink(r) : null
  return (
    <div className="mx-auto w-full max-w-md p-4">
      {ride ? <FeedbackForm ride={ride} /> : <p>This ride link isn&apos;t valid.</p>}
    </div>
  )
}

export default function RidePage() {
  return (
    <Suspense fallback={<p className="p-4">Loading…</p>}>
      <Ride />
    </Suspense>
  )
}
