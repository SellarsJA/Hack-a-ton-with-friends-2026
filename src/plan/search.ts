import type { Db } from '@/src/db/client'
import type { SearchResponse } from '@/src/contract/schema'

export const MIN_QUERY_LENGTH = 2
const STOP_LIMIT = 6

const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`)

type StopRow = { stop_id: string; name: string; lat: number; lon: number }
type RouteRow = { route_id: string; short_name: string | null; long_name: string | null }

export async function searchIndex(db: Db, q: string): Promise<SearchResponse> {
  const term = q.trim()
  if (term.length < MIN_QUERY_LENGTH) return { stops: [], routes: [] }
  const like = escapeLike(term)
  const [stops, routes] = await Promise.all([
    // Only stops with scheduled service: entrances, elevators and retired duplicates have none.
    // One row per name: a station's platforms share a name and would otherwise fill every slot.
    // Stations rank first (LRT names end in "Station", Valley Line ones in "Stop"; not "Station Drive"), then transit
    // centres, then names that start with what was typed, then the rest.
    db.query<StopRow>(
      `select stop_id, name, lat, lon from (
         select distinct on (name) stop_id, name, lat, lon from stops
         where name ilike '%' || $1 || '%' escape '\\'
           and exists (select 1 from stop_times st where st.stop_id = stops.stop_id)
         order by name, stop_id
       ) s
       order by case
         when name ~* '(station|stop)( underground)?$' then 0
         when name ilike '%transit centre%' then 1
         when name ilike $1 || '%' escape '\\' then 2
         else 3
       end, name
       limit ${STOP_LIMIT}`,
      [like],
    ),
    db.query<RouteRow>(
      `select route_id, short_name, long_name from routes
       where short_name = $2 or long_name ilike '%' || $1 || '%' escape '\\'
       order by short_name limit 5`,
      [like, term],
    ),
  ])
  return {
    stops: stops.map((s) => ({ stopId: s.stop_id, name: s.name, lat: Number(s.lat), lon: Number(s.lon) })),
    routes: routes.map((r) => ({ routeId: r.route_id, shortName: r.short_name ?? '', longName: r.long_name ?? '' })),
  }
}
