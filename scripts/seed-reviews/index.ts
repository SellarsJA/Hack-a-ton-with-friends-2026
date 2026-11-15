/**
 * Seed demo rider reviews for today: ~1000 across every route running today, with real fleet numbers
 * from the live feed. Rerunnable: it first removes its own earlier seed (profiles starting
 * 00000000-5eed-), never real riders' feedback.
 *
 *   npx tsx --env-file=.env.local scripts/seed-reviews/index.ts            seed (replaces earlier seed)
 *   npx tsx --env-file=.env.local scripts/seed-reviews/index.ts --remove   remove the seed only
 *   --total=1500                                                           change the count
 */
import GtfsRealtimeBindings from 'gtfs-realtime-bindings'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DateTime } from 'luxon'
import postgres from 'postgres'
import { ZONE } from '../../src/time/edmonton'
import { SEED_PROFILE_PREFIX, generateSeedReviews, type SeedVehicle } from './generate'

const VEHICLES_URL = 'https://gtfs.edmonton.ca/TMGTFSRealTimeWebService/Vehicle/VehiclePositions.pb'

async function liveVehicleBuffer(): Promise<Uint8Array | null> {
  try {
    const res = await fetch(VEHICLES_URL, { signal: AbortSignal.timeout(8000) })
    if (res.ok) return new Uint8Array(await res.arrayBuffer())
  } catch {}
  try {
    return new Uint8Array(await readFile(join(process.cwd(), 'data/snapshot/VehiclePositions.pb')))
  } catch {
    return null
  }
}

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  const remove = process.argv.includes('--remove')
  const totalArg = process.argv.find((a) => a.startsWith('--total='))
  const total = totalArg ? Number(totalArg.split('=')[1]) : 1000
  if (!Number.isInteger(total) || total < 1 || total > 20000) throw new Error('--total must be 1..20000')

  const sql = postgres(url, { onnotice: () => {}, max: 1 })
  try {
    const like = `${SEED_PROFILE_PREFIX}%`
    if (remove) {
      const [f] = await sql`delete from feedback where profile_id::text like ${like} returning 1`.then((r) => [r.count])
      const [p] = await sql`delete from profiles where id::text like ${like} returning 1`.then((r) => [r.count])
      console.log(`Removed ${f} seeded reviews and ${p} seeded profiles. Real feedback was not touched.`)
      return
    }

    const now = DateTime.now().setZone(ZONE)
    const serviceDate = now.toISODate()!
    // Reviews land between 5:30 this morning and now (or the last two hours, early in the day).
    const morning = now.startOf('day').plus({ hours: 5, minutes: 30 })
    const from = (now.diff(morning, 'hours').hours > 2 ? morning : now.minus({ hours: 2 })).toMillis()

    const routeRows = await sql<{ short_name: string; rail: boolean; trip_ids: string[] }[]>`
      select r.short_name, bool_or(r.route_type in (0, 1, 2)) as rail, array_agg(t.trip_id order by t.trip_id) as trip_ids
        from trips t join routes r using (route_id)
        join service_dates d on d.service_id = t.service_id and d.date = ${serviceDate}::date
       where r.short_name is not null
       group by r.short_name`
    if (routeRows.length === 0) throw new Error(`No trips scheduled for ${serviceDate}. Has the GTFS import run recently?`)
    const routes = routeRows.map((x) => ({ shortName: x.short_name, tripIds: x.trip_ids, rail: x.rail }))

    let vehicles: SeedVehicle[] = []
    const buf = await liveVehicleBuffer()
    if (buf) {
      const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(buf)
      const live = feed.entity.flatMap((e) => {
        const label = e.vehicle?.vehicle?.label
        const tripId = e.vehicle?.trip?.tripId
        return label && tripId ? [{ label, tripId }] : []
      })
      const names = await sql<{ trip_id: string; short_name: string }[]>`
        select t.trip_id, r.short_name from trips t join routes r using (route_id)
         where t.trip_id = any(${live.map((v) => v.tripId)}::text[])`
      const routeOf = new Map(names.map((n) => [n.trip_id, n.short_name]))
      vehicles = live.flatMap((v) => (routeOf.has(v.tripId) ? [{ ...v, shortName: routeOf.get(v.tripId)! }] : []))
    }

    const rows = generateSeedReviews({ routes, vehicles, serviceDate, from, to: now.toMillis(), total })
    const profileIds = [...new Set(rows.map((r) => r.profileId))]

    await sql.begin(async (tx) => {
      await tx`delete from feedback where profile_id::text like ${like}`
      await tx`delete from profiles where id::text like ${like}`
      await tx`insert into profiles ${tx(profileIds.map((id) => ({ id })))}`
      const CHUNK = 500
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK).map((r) => ({
          profile_id: r.profileId,
          ride_key: r.rideKey,
          vehicle_label: r.vehicleLabel,
          route_id: r.routeId,
          trip_id: r.tripId,
          service_date: r.serviceDate,
          stars: r.stars,
          accuracy: tx.json(r.accuracy as postgres.JSONValue),
          issue: r.issue,
          note: null,
          created_at: new Date(r.at),
          updated_at: new Date(r.at),
        }))
        await tx`insert into feedback ${tx(chunk)}`
      }
    })

    const labelled = rows.filter((r) => r.vehicleLabel).length
    const starred = rows.filter((r) => r.stars !== null)
    const avg = starred.reduce((a, r) => a + r.stars!, 0) / Math.max(1, starred.length)
    const issues = rows.filter((r) => r.issue).length
    console.log(
      `Seeded ${rows.length} reviews for ${serviceDate} from ${profileIds.length} riders across ${routes.length} routes.`,
    )
    console.log(
      `  ${labelled} on ${new Set(rows.flatMap((r) => r.vehicleLabel ?? [])).size} named buses (live feed: ${vehicles.length} buses),` +
        ` average ★ ${avg.toFixed(2)}, ${issues} issue reports.`,
    )
    console.log('  Remove any time with --remove. Real feedback is never touched.')
  } finally {
    await sql.end()
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
