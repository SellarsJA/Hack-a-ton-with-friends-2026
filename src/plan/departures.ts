import { DateTime } from 'luxon'
import type { Db } from '@/src/db/client'
import type { LiveIndex } from '@/src/live/decode'
import { applyRealtime } from '@/src/plan/realtime'
import { activeServiceDays, ZONE } from '@/src/time/edmonton'

export type Departure = {
  tripId: string
  serviceDate: string
  routeId: string
  headsign: string
  departEpoch: number
  realtime: boolean
}

const WINDOW_SECONDS = 10800

// Departures from one stop inside the window, driven by the stop_times (stop_id, dep) index.
const DEPARTURES_SQL = `
select st.trip_id, d.service_date::text service_date, t.route_id, t.headsign, st.stop_sequence seq, st.dep
from unnest($2::date[], $3::int[]) as d(service_date, now_s)
cross join lateral (
  select s.trip_id, s.stop_sequence, s.dep from stop_times s
  where s.stop_id = $1 and s.dep between d.now_s and d.now_s + ${WINDOW_SECONDS}) st
join trips t on t.trip_id = st.trip_id
join service_dates sd on sd.service_id = t.service_id and sd.date = d.service_date
join routes r on r.route_id = t.route_id
where ($4::text is null or t.route_id = $4)
order by st.dep, st.trip_id
limit $5`

type Row = { trip_id: string; service_date: string; route_id: string; headsign: string | null; seq: number; dep: number }

export async function nextDepartures(
  db: Db,
  args: { stopId: string; routeId?: string; afterEpoch: number; limit: number; live: LiveIndex | null },
): Promise<Departure[]> {
  const { stopId, routeId, afterEpoch, limit, live } = args
  const days = activeServiceDays(DateTime.fromSeconds(afterEpoch, { zone: ZONE }))
  const rows = await db.query<Row>(DEPARTURES_SQL, [
    stopId,
    days.map((d) => d.serviceDate),
    days.map((d) => d.nowSeconds),
    routeId ?? null,
    Math.max(limit * 3, 20),
  ])
  return rows
    .map((r): Departure => {
      const rt = applyRealtime(
        {
          tripId: r.trip_id,
          serviceDate: r.service_date,
          board: { stopId, seq: r.seq, dep: r.dep },
          alight: { stopId, seq: r.seq, arr: r.dep },
        },
        live,
      )
      return {
        tripId: r.trip_id,
        serviceDate: r.service_date,
        routeId: r.route_id,
        headsign: r.headsign ?? '',
        departEpoch: rt.departEpoch,
        realtime: rt.realtime,
      }
    })
    .filter((d) => d.departEpoch >= afterEpoch)
    .sort((a, b) => a.departEpoch - b.departEpoch)
    .slice(0, limit)
}
