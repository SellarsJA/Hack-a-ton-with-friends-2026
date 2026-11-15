import { describe, expect, it } from 'vitest'
import { FeedbackRequest } from '@/src/contract/schema'
import { SEED_PROFILE_PREFIX, generateSeedReviews, type SeedInput } from '@/scripts/seed-reviews/generate'

const routes = [
  { shortName: 'Capital', tripIds: Array.from({ length: 150 }, (_, i) => `C${i}`), rail: true },
  { shortName: '004', tripIds: Array.from({ length: 120 }, (_, i) => `B${i}`) },
  { shortName: '930X', tripIds: ['X1', 'X2'] },
  { shortName: 'Empty', tripIds: [] },
]
const vehicles = Array.from({ length: 40 }, (_, i) => ({ label: String(4000 + i), tripId: `B${i}`, shortName: '004' }))
const input: SeedInput = {
  routes,
  vehicles,
  serviceDate: '2026-11-15',
  from: Date.parse('2026-11-15T12:30:00Z'),
  to: Date.parse('2026-11-15T18:00:00Z'),
  total: 1000,
}

describe('generateSeedReviews', () => {
  const rows = generateSeedReviews(input)

  it('makes the requested number of reviews, every one a valid submission', () => {
    expect(rows).toHaveLength(1000)
    for (const r of rows) {
      const body = { rideKey: r.rideKey, vehicleLabel: r.vehicleLabel, routeId: r.routeId, tripId: r.tripId, serviceDate: r.serviceDate, accuracy: r.accuracy, ...(r.stars !== null && { stars: r.stars }), ...(r.issue && { issue: r.issue }) }
      expect(FeedbackRequest.safeParse(body).success).toBe(true)
    }
  })

  it('only uses removable seed profiles, one review per rider per ride', () => {
    expect(rows.every((r) => r.profileId.startsWith(SEED_PROFILE_PREFIX))).toBe(true)
    expect(new Set(rows.map((r) => `${r.profileId}|${r.rideKey}`)).size).toBe(rows.length)
  })

  it('covers every route that runs, busy routes most, and names live buses on their own trips', () => {
    const per = (name: string) => rows.filter((r) => r.routeId === name).length
    expect(per('930X')).toBeGreaterThanOrEqual(3)
    expect(per('Empty')).toBe(0)
    expect(per('Capital')).toBeGreaterThan(per('930X'))
    // Trains carry far more riders per trip than buses, and have no named buses to soak up reviews.
    expect(per('Capital')).toBeGreaterThan(per('004'))
    expect(rows.filter((r) => r.vehicleLabel).length).toBeLessThanOrEqual(350)
    const named = rows.filter((r) => r.vehicleLabel)
    expect(named.length).toBeGreaterThan(30)
    expect(named.every((r) => r.routeId === '004' && r.tripId === `B${Number(r.vehicleLabel) - 4000}`)).toBe(true)
  })

  it('looks like real riders: mostly good, some problems, timed within the window', () => {
    const stars = rows.flatMap((r) => (r.stars === null ? [] : [r.stars]))
    const avg = stars.reduce((a, b) => a + b, 0) / stars.length
    expect(avg).toBeGreaterThan(3.2)
    expect(avg).toBeLessThan(4.6)
    const issues = rows.filter((r) => r.issue).length / rows.length
    expect(issues).toBeGreaterThan(0.08)
    expect(issues).toBeLessThan(0.5)
    expect(rows.every((r) => r.at >= input.from && r.at <= input.to)).toBe(true)
  })

  it('is repeatable', () => {
    expect(generateSeedReviews(input)).toEqual(rows)
  })
})
