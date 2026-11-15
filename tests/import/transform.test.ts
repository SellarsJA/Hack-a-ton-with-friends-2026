import { describe, it, expect } from 'vitest'
import { createReadStream, existsSync } from 'node:fs'
import { join } from 'node:path'
import { transformFeed, stopLinks } from '../../scripts/import-gtfs/transform'
import { distanceMeters } from '../../src/geo/geo'

const DIR = join(__dirname, '../fixtures/gtfs-mini')
const open = async (name: string) =>
  existsSync(join(DIR, name)) ? createReadStream(join(DIR, name)) : null
const opts = { startDate: '2026-11-14', days: 7 }

describe('transformFeed', () => {
  it('keeps A and D, drops B (removed) and C (outside window)', async () => {
    const r = await transformFeed(open, opts)
    expect(r.trips.map((t) => t.tripId).sort()).toEqual(['A', 'D', 'E', 'F', 'G', 'H', 'J'])
    expect(new Set(r.stopTimes.map((s) => s.tripId))).toEqual(new Set(['A', 'D', 'E', 'F', 'G', 'H', 'J']))
    expect(r.serviceDates).toEqual([
      { serviceId: 'WK', date: '2026-11-14' },
      { serviceId: 'WK', date: '2026-11-15' },
    ])
    expect(r.shapes.map((s) => s.shapeId)).toEqual(['SH9'])
  })
  it('stores 25:10:00 as 90600 and falls back for blank departure', async () => {
    const r = await transformFeed(open, opts)
    const d3 = r.stopTimes.find((s) => s.tripId === 'D' && s.stopSequence === 3)!
    expect(d3.arr).toBe(90600)
    expect(d3.dep).toBe(90600)
    const a3 = r.stopTimes.find((s) => s.tripId === 'A' && s.stopSequence === 3)!
    expect(a3.dep).toBe(18 * 3600 + 30 * 60)
  })
  it('assigns zones, null when unzoned', async () => {
    const r = await transformFeed(open, opts)
    const z = Object.fromEntries(r.stops.map((s) => [s.stopId, s.zone]))
    expect(z).toEqual({ '1001': '1EDM', '1002': '1EDM', '1003': '1EDM', '2001': '2STA', '1004': null, '1005': '1EDM', '1006': '1EDM', '1007': '1EDM', '1008': '1EDM' })
  })
  it('rounds shape points to 5 decimals', async () => {
    const r = await transformFeed(open, opts)
    expect(r.shapes[0].points[0]).toEqual([53.54441, -113.49091])
    expect(r.shapes[0].points).toHaveLength(6)
  })
  it('maps routes, feed meta, and tolerates missing optional files', async () => {
    const optional = ['areas.txt', 'stop_areas.txt', 'shapes.txt', 'feed_info.txt']
    const r = await transformFeed(async (n) => (optional.includes(n) ? null : open(n)), opts)
    expect(r.stops.every((s) => s.zone === null)).toBe(true)
    expect(r.shapes).toEqual([])
    const full = await transformFeed(open, opts)
    expect(full.routes.find((x) => x.routeId === 'RVL')).toMatchObject({ routeType: 0, shortName: 'Valley' })
    expect(full.feedMeta).toEqual({ feedVersion: 'mini-1', windowStart: '2026-11-14', windowEnd: '2026-11-20' })
  })
  it('throws naming a missing required file', async () => {
    await expect(transformFeed(async (n) => (n === 'trips.txt' ? null : open(n)), opts)).rejects.toThrow('trips.txt')
  })
})

describe('stopLinks', () => {
  it('links the 150 m pair both ways at 180 s, omits the 400 m pair, self-links every stop', async () => {
    const r = await transformFeed(open, opts)
    const by = Object.fromEntries(r.stops.map((s) => [s.stopId, s]))
    const d150 = distanceMeters(by['1002'], by['1005'])
    const d400 = distanceMeters(by['1002'], by['1006'])
    expect(d150).toBeGreaterThan(130)
    expect(d150).toBeLessThan(170)
    expect(d400).toBeGreaterThan(350)
    expect(d400).toBeLessThan(450)
    const find = (a: string, b: string) => r.stopLinks.find((l) => l.fromStop === a && l.toStop === b)
    expect(find('1002', '1005')?.walkS).toBe(180)
    expect(find('1005', '1002')?.walkS).toBe(180)
    expect(find('1002', '1006')).toBeUndefined()
    expect(find('1006', '1002')).toBeUndefined()
    for (const s of r.stops) expect(find(s.stopId, s.stopId)?.walkS).toBe(0)
  })
  it('handles 5,000 random Edmonton stops in under 2 s', () => {
    const stops = Array.from({ length: 5000 }, (_, i) => ({
      stopId: `s${i}`,
      lat: 53.4 + Math.random() * 0.27,
      lon: -113.72 + Math.random() * 0.42,
    }))
    const t = Date.now()
    const links = stopLinks(stops)
    expect(Date.now() - t).toBeLessThan(2000)
    expect(links.length).toBeGreaterThanOrEqual(5000)
  })
})
