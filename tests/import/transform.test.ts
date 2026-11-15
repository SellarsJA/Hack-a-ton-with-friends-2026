import { describe, it, expect } from 'vitest'
import { createReadStream, existsSync } from 'node:fs'
import { join } from 'node:path'
import { transformFeed } from '../../scripts/import-gtfs/transform'

const DIR = join(__dirname, '../fixtures/gtfs-mini')
const open = async (name: string) =>
  existsSync(join(DIR, name)) ? createReadStream(join(DIR, name)) : null
const opts = { startDate: '2026-11-14', days: 7 }

describe('transformFeed', () => {
  it('keeps A and D, drops B (removed) and C (outside window)', async () => {
    const r = await transformFeed(open, opts)
    expect(r.trips.map((t) => t.tripId).sort()).toEqual(['A', 'D'])
    expect(new Set(r.stopTimes.map((s) => s.tripId))).toEqual(new Set(['A', 'D']))
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
    expect(z).toEqual({ '1001': '1EDM', '1002': '1EDM', '1003': '1EDM', '2001': '2STA', '1004': null })
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
