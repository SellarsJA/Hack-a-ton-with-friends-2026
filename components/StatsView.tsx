import type { AccuracyStats } from '@/src/accuracy/stats'

const LABELS: Record<keyof AccuracyStats['sliders'], string> = {
  time: 'Arrival time',
  position: 'Bus position',
  crowding: 'Crowding',
  transfer: 'Transfer advice',
  alerts: 'Alerts',
}

const min = (n: number | null) => (n === null ? 'n/a' : `${n} min`)

export default function StatsView({ stats }: { stats: AccuracyStats }) {
  const { sliders, measured } = stats
  return (
    <div className="mx-auto w-full max-w-md space-y-6 p-4">
      <section>
        <h2 className="text-lg font-semibold">What riders told us</h2>
        <p className="text-sm">Average accuracy rating, 1 to 5.</p>
        <ul>
          {(Object.keys(LABELS) as (keyof typeof LABELS)[]).map((k) => (
            <li key={k}>
              {LABELS[k]}: {sliders[k].average === null ? 'n/a' : sliders[k].average} ({sliders[k].count} ratings)
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2 className="text-lg font-semibold">What we measured</h2>
        <ul>
          <li>Predictions checked: {measured.count}</li>
          <li>Median error: {min(measured.medianErrorMinutes)}</li>
          <li>Within 2 minutes: {measured.within2MinPct === null ? 'n/a' : `${measured.within2MinPct}%`}</li>
          <li>Median error, live predictions: {min(measured.byRealtime.live)}</li>
          <li>Median error, scheduled times: {min(measured.byRealtime.scheduled)}</li>
        </ul>
        <p className="mt-2 text-sm">&quot;Actual&quot; time is the feed&apos;s last prediction before the bus reached the stop.</p>
      </section>
    </div>
  )
}
