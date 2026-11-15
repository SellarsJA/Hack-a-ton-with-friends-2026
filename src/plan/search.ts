import type { Db } from '@/src/db/client'
import type { SearchResponse } from '@/src/contract/schema'

export const MIN_QUERY_LENGTH = 2

const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`)

type StopRow = { stop_id: string; name: string; lat: number; lon: number }
type RouteRow = { route_id: string; short_name: string | null; long_name: string | null }

export async function searchIndex(db: Db, q: string): Promise<SearchResponse> {
  const term = q.trim()
  if (term.length < MIN_QUERY_LENGTH) return { stops: [], routes: [] }
  const like = escapeLike(term)
  const [stops, routes] = await Promise.all([
    db.query<StopRow>(
      `select stop_id, name, lat, lon from stops
       where name ilike '%' || $1 || '%' escape '\\'
       order by name limit 5`,
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
