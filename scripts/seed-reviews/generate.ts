/**
 * Demo rider reviews: realistic, repeatable, and removable. Pure: give it the routes running today and
 * the live buses, and it returns feedback rows. No I/O here; scripts/seed-reviews/index.ts writes them.
 */
import type { Accuracy, Issue } from '@/src/contract/schema'

/** Every seeded profile id starts with this, so the seed can be found and removed without touching real riders. */
export const SEED_PROFILE_PREFIX = '00000000-5eed-4000-8000-'

export type SeedRoute = {
  /** Route short name, as the ride link stores it in feedback.route_id ("004", "Capital"). */
  shortName: string
  /** Trip ids running today on this route. */
  tripIds: string[]
  /** LRT: far more riders per trip than a bus, so it gets proportionally more reviews. */
  rail?: boolean
}
export type SeedVehicle = { label: string; tripId: string; shortName: string }

export type SeedRow = {
  profileId: string
  rideKey: string
  vehicleLabel: string | null
  routeId: string
  tripId: string
  serviceDate: string
  stars: number | null
  accuracy: Accuracy
  issue: Issue | null
  /** Epoch ms; used for created_at and updated_at. */
  at: number
}

export type SeedInput = {
  routes: SeedRoute[]
  vehicles: SeedVehicle[]
  serviceDate: string
  /** Reviews spread evenly-ish from `from` to `to` (epoch ms). */
  from: number
  to: number
  total?: number
  profiles?: number
  /** Every route running today gets at least this many, so no card is empty. */
  minPerRoute?: number
  seed?: number
}

/** Small, fast, seeded PRNG (mulberry32), so a rerun produces the same demo data. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const seedProfileId = (i: number) => `${SEED_PROFILE_PREFIX}${i.toString(16).padStart(12, '0')}`

const ISSUE_WEIGHTS: [Issue, number][] = [
  ['too_full', 0.36],
  ['cleanliness', 0.32],
  ['disruption', 0.2],
  ['safety', 0.12],
]

export function generateSeedReviews(input: SeedInput): SeedRow[] {
  const { routes, vehicles, serviceDate, from, to } = input
  const total = input.total ?? 1000
  const profileCount = input.profiles ?? 600
  const minPerRoute = input.minPerRoute ?? 3
  const r = rng(input.seed ?? 20261115)

  const normal = (mean: number, sd: number) => {
    // Box-Muller.
    const u = Math.max(r(), 1e-9)
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r())
  }
  const score = (mean: number, sd: number) => Math.min(5, Math.max(1, Math.round(normal(mean, sd))))
  const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)]

  const served = routes.filter((x) => x.tripIds.length > 0)
  if (served.length === 0) return []

  // Each route has its own character: most are good, a few are not, and some lean to one problem.
  const character = new Map(
    served.map((x) => {
      const quality = Math.min(4.7, Math.max(2.6, normal(3.95, 0.45)))
      const issueRate = Math.min(0.55, Math.max(0.08, 0.5 - (quality - 2.6) * 0.18 + normal(0, 0.05)))
      const leaning = pick(ISSUE_WEIGHTS)[0]
      return [x.shortName, { quality, issueRate, leaning }]
    }),
  )
  const issueFor = (route: string): Issue | null => {
    const c = character.get(route)!
    if (r() >= c.issueRate) return null
    if (r() < 0.45) return c.leaning
    let u = r()
    for (const [issue, w] of ISSUE_WEIGHTS) if ((u -= w) < 0) return issue
    return 'too_full'
  }

  // Rides to review: a floor for every route so no card is empty, then live buses (each named bus gets
  // a couple), then scheduled trips weighted by how busy the route is. Trimming only cuts the tail.
  const rides: { routeId: string; tripId: string; label: string | null }[] = []
  const byName = new Map(served.map((x) => [x.shortName, x]))
  for (const x of served) for (let i = 0; i < minPerRoute; i++) rides.push({ routeId: x.shortName, tripId: pick(x.tripIds), label: null })
  // Named-bus reviews are capped at about a third, so busy routes (and trains, which have no fleet
  // numbers in the feed) still get most of the reviews.
  const liveCap = rides.length + Math.round(total * 0.35)
  for (const v of vehicles.filter((v) => byName.has(v.shortName))) {
    const n = r() < 0.75 ? 1 : 2
    for (let i = 0; i < n && rides.length < liveCap; i++) rides.push({ routeId: v.shortName, tripId: v.tripId, label: v.label })
  }
  const RAIL_WEIGHT = 5
  const weightOf = (x: SeedRoute) => x.tripIds.length * (x.rail ? RAIL_WEIGHT : 1)
  const weightTotal = served.reduce((a, x) => a + weightOf(x), 0)
  while (rides.length < total) {
    let u = r() * weightTotal
    const x = served.find((s) => (u -= weightOf(s)) < 0) ?? served[served.length - 1]
    rides.push({ routeId: x.shortName, tripId: pick(x.tripIds), label: null })
  }
  rides.length = Math.max(total, served.length * minPerRoute)

  const used = new Set<string>()
  const span = Math.max(1, to - from)
  const rows: SeedRow[] = []
  for (const ride of rides) {
    const rideKey = `${ride.label ?? 'none'}:${ride.tripId}:${serviceDate}`
    let profileId = seedProfileId(Math.floor(r() * profileCount))
    // One review per rider per ride, as the real table enforces.
    for (let tries = 0; used.has(`${profileId}|${rideKey}`) && tries < 50; tries++)
      profileId = seedProfileId(Math.floor(r() * profileCount))
    if (used.has(`${profileId}|${rideKey}`)) continue
    used.add(`${profileId}|${rideKey}`)

    const c = character.get(ride.routeId)!
    const issue = issueFor(ride.routeId)
    const stars = r() < 0.88 ? score(c.quality - (issue ? 0.9 : 0), 0.8) : null
    const accuracy: Accuracy = {}
    if (r() < 0.8) accuracy.time = score(4.1, 0.85)
    if (r() < 0.6) accuracy.position = score(3.9, 0.95)
    if (issue === 'too_full' || r() < 0.2) accuracy.crowding = score(3.6, 1)
    if (r() < 0.12) accuracy.transfer = score(3.7, 1)
    if (r() < 0.08) accuracy.alerts = score(3.5, 1.1)
    // Every row must carry at least one answer, like a real submission.
    if (stars === null && issue === null && Object.keys(accuracy).length === 0) accuracy.time = score(4.1, 0.85)
    rows.push({
      profileId,
      rideKey,
      vehicleLabel: ride.label,
      routeId: ride.routeId,
      tripId: ride.tripId,
      serviceDate,
      stars,
      accuracy,
      issue,
      at: Math.round(from + r() * span),
    })
  }
  return rows
}
