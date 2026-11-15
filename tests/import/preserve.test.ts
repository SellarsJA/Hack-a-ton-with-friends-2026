import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SCHEDULE_TABLES, truncateScheduleSql } from '../../scripts/import-gtfs'
import { loadFixture } from '../helpers/pgliteDb'

const ROOT = join(__dirname, '../..')
const sqlFile = (f: string) => readFileSync(join(ROOT, f), 'utf8')
const PROTECTED = ['profiles', 'feedback', 'predictions']

describe('import preserves feedback data', () => {
  it('keeps profiles, feedback and predictions across a schedule truncate and reload', async () => {
    const pg = new PGlite()
    await pg.exec(sqlFile('db/schema.sql'))
    await pg.exec(sqlFile('db/feedback.sql'))
    await pg.exec(sqlFile('db/feedback.sql')) // idempotent

    const pid = '11111111-1111-4111-8111-111111111111'
    await pg.query('insert into profiles (id) values ($1)', [pid])
    await pg.query(
      `insert into feedback (profile_id, ride_key, vehicle_label, route_id, trip_id, service_date, stars)
       values ($1, 'k1', 'v1', '1', 't1', '2026-11-14', 4)`,
      [pid],
    )
    await pg.query(
      `insert into predictions (trip_id, service_date, stop_id, stop_sequence, scheduled_epoch, predicted_epoch, predicted_at, realtime)
       values ('t1', '2026-11-14', 's1', 1, 100, 110, 90, true)`,
    )

    await loadFixture(pg)
    await pg.exec(truncateScheduleSql())
    expect((await pg.query('select count(*)::int as n from stops')).rows).toEqual([{ n: 0 }])
    await loadFixture(pg)

    for (const t of PROTECTED) {
      const r = await pg.query<{ n: number }>(`select count(*)::int as n from ${t}`)
      expect(r.rows[0].n).toBe(1)
    }
  })

  it('never lists feedback tables as schedule tables or in the truncate statement', () => {
    const stmt = truncateScheduleSql()
    expect(stmt.split(/[ ,]+/)).toContain('stops') // sanity: the check can fail
    for (const t of PROTECTED) {
      expect(SCHEDULE_TABLES as readonly string[]).not.toContain(t)
      expect(stmt.split(/[ ,]+/)).not.toContain(t)
    }
  })
})
