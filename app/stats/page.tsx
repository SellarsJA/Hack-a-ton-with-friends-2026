import { Suspense } from 'react'
import { connection } from 'next/server'
import StatsView from '@/components/StatsView'
import { accuracyStats, type AccuracyStats } from '@/src/accuracy/stats'

export const metadata = { robots: { index: false, follow: false } }

async function Stats() {
  // Defers to request time so the build never touches the database.
  await connection()
  let stats: AccuracyStats
  try {
    stats = await accuracyStats()
  } catch (err) {
    console.warn('[stats] failed:', err)
    return <p className="p-4">Stats are unavailable right now.</p>
  }
  return <StatsView stats={stats} />
}

export default function StatsPage() {
  return (
    <Suspense fallback={<p className="p-4">Loading…</p>}>
      <Stats />
    </Suspense>
  )
}
