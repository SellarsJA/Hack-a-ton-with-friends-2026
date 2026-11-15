import { Issue, type FeedbackRequest, type VehicleSummary } from '@/src/contract/schema'
import { getDb, type Db } from '@/src/db/client'

export async function upsertFeedback(profileId: string, f: FeedbackRequest, db: Db = getDb()): Promise<void> {
  await db.query(
    'insert into profiles(id) values ($1) on conflict (id) do update set last_seen_at = now()',
    [profileId],
  )
  await db.query(
    `insert into feedback (profile_id, ride_key, vehicle_label, route_id, trip_id, service_date, stars, accuracy, issue, note)
     values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
     on conflict (profile_id, ride_key) do update set
       vehicle_label = excluded.vehicle_label, route_id = excluded.route_id, trip_id = excluded.trip_id,
       service_date = excluded.service_date, stars = excluded.stars, accuracy = excluded.accuracy,
       issue = excluded.issue, note = excluded.note, updated_at = now()`,
    [
      profileId,
      f.rideKey,
      f.vehicleLabel,
      f.routeId,
      f.tripId,
      f.serviceDate,
      f.stars ?? null,
      JSON.stringify(f.accuracy),
      f.issue ?? null,
      f.note ?? null,
    ],
  )
}

/**
 * Both windows (90d ratings, 30d issues) use updated_at, matching the
 * feedback_vehicle (vehicle_label, updated_at) index. Never selects `note`.
 */
export async function vehicleSummary(label: string, db: Db = getDb()): Promise<VehicleSummary> {
  const [ratings] = await db.query<{ average_stars: number | null; rating_count: number }>(
    `select round(avg(stars)::numeric, 1)::float8 as average_stars, count(*)::int as rating_count
       from feedback
      where vehicle_label = $1 and stars is not null and updated_at >= now() - interval '90 days'`,
    [label],
  )
  const issueRows = await db.query<{ issue: string; n: number }>(
    `select issue, count(*)::int as n
       from feedback
      where vehicle_label = $1 and issue is not null and updated_at >= now() - interval '30 days'
      group by issue`,
    [label],
  )
  const issues = Object.fromEntries(Issue.options.map((i) => [i, 0])) as VehicleSummary['issues']
  for (const r of issueRows) issues[r.issue as Issue] = Number(r.n)
  return {
    label,
    averageStars: ratings?.average_stars == null ? null : Number(ratings.average_stars),
    ratingCount: Number(ratings?.rating_count ?? 0),
    issues,
  }
}
