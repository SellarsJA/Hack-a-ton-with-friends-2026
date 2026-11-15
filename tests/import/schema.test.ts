import { describe, it, expect } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('db/schema.sql', () => {
  it('can be applied twice without error and keeps existing rows', async () => {
    const pg = new PGlite()
    const sql = readFileSync(join(process.cwd(), 'db/schema.sql'), 'utf8')
    await pg.exec(sql)
    await pg.query("insert into stops (stop_id, name, lat, lon) values ('x', 'X', 1, 2)")
    await pg.exec(sql)
    expect((await pg.query<{ c: number }>('select count(*)::int c from stops')).rows[0].c).toBe(1)
  })
})
