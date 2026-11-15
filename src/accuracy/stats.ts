import { getDb, type Db } from '@/src/db/client'

export const SLIDER_KEYS = ['time', 'position', 'crowding', 'transfer', 'alerts'] as const
export type SliderKey = (typeof SLIDER_KEYS)[number]

export type AccuracyStats = {
  sliders: Record<SliderKey, { average: number | null; count: number }>
  measured: {
    count: number
    medianErrorMinutes: number | null
    within2MinPct: number | null
    byRealtime: { live: number | null; scheduled: number | null }
  }
}

const round = (n: number | null, places: number): number | null => {
  if (n === null || n === undefined) return null
  const f = 10 ** places
  return Math.round(Number(n) * f) / f
}

/** Aggregates only; never selects free-text notes. */
export async function accuracyStats(db: Db = getDb()): Promise<AccuracyStats> {
  // SLIDER_KEYS are constants, so interpolating them is safe.
  const sliderCols = SLIDER_KEYS.map(
    (k) => `avg((accuracy->>'${k}')::int)::float8 as ${k}_avg, count(accuracy->>'${k}')::int as ${k}_n`,
  ).join(', ')
  const [sl] = await db.query<Record<string, number | null>>(`select ${sliderCols} from feedback`)
  const sliders = {} as AccuracyStats['sliders']
  for (const k of SLIDER_KEYS) {
    const count = Number(sl?.[`${k}_n`] ?? 0)
    sliders[k] = { average: count === 0 ? null : round(sl[`${k}_avg`], 1), count }
  }

  const [m] = await db.query<{ n: number; med: number | null; within: number | null; live: number | null; sched: number | null }>(
    `select count(*)::int as n,
            percentile_cont(0.5) within group (order by e)::float8 as med,
            (avg((e <= 2)::int) * 100)::float8 as within,
            (percentile_cont(0.5) within group (order by e) filter (where realtime))::float8 as live,
            (percentile_cont(0.5) within group (order by e) filter (where not realtime))::float8 as sched
       from (select distinct on (trip_id, service_date, stop_sequence)
                    abs(predicted_epoch - latest_epoch)::float8 / 60 as e, realtime
               from predictions where final and latest_epoch is not null
              order by trip_id, service_date, stop_sequence, predicted_at) t`,
  )
  const count = Number(m?.n ?? 0)
  return {
    sliders,
    measured: {
      count,
      medianErrorMinutes: count === 0 ? null : round(m.med, 1),
      within2MinPct: count === 0 ? null : round(m.within, 0),
      byRealtime: { live: round(m?.live ?? null, 1), scheduled: round(m?.sched ?? null, 1) },
    },
  }
}
