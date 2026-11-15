import { describe, it, expect } from 'vitest'
import { makeTestDb } from '../helpers/pgliteDb'

describe('makeTestDb', () => {
  it('loads the mini feed with the right row counts', async () => {
    const db = await makeTestDb()
    const n = async (t: string) =>
      Number((await db.query<{ c: string }>(`select count(*) c from ${t}`))[0].c)
    expect(await n('stops')).toBe(5)
    expect(await n('routes')).toBe(2)
    expect(await n('trips')).toBe(2)
    expect(await n('service_dates')).toBe(2)
    expect(await n('stop_times')).toBe(6)
    expect(await n('shapes')).toBe(1)
    expect(await n('feed_meta')).toBe(1)
  })
  it('returns isolated databases', async () => {
    const a = await makeTestDb()
    await a.query('delete from stops')
    const b = await makeTestDb()
    expect((await b.query('select 1 from stops')).length).toBe(5)
  })
})
