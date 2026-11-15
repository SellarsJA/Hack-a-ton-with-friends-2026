import { describe, expect, it } from 'vitest'
import { rankKey, transferStatus, TRAIN_SIDE_NOTE } from '@/src/plan/transfer'

const ARRIVE = 1_000_000

describe('transferStatus', () => {
  it('is on_track when spare is more than 3 minutes', () => {
    // 240 s spare with no walk
    expect(transferStatus(ARRIVE, ARRIVE + 240, 0, true)).toEqual({
      spareMinutes: 4,
      status: 'on_track',
      basedOn: 'live',
    })
  })

  it('is tight when spare is exactly 3 minutes', () => {
    expect(transferStatus(ARRIVE, ARRIVE + 180, 0, true).status).toBe('tight')
  })

  it('is tight when spare is zero', () => {
    expect(transferStatus(ARRIVE, ARRIVE, 0, true).status).toBe('tight')
  })

  it('is at_risk when spare is negative, rounding down to -1', () => {
    expect(transferStatus(ARRIVE, ARRIVE - 30, 0, true)).toEqual({
      spareMinutes: -1,
      status: 'at_risk',
      basedOn: 'live',
    })
  })

  it('subtracts walk seconds from the gap', () => {
    // 300 s gap minus 120 s walk = 180 s spare -> tight
    expect(transferStatus(ARRIVE, ARRIVE + 300, 120, true).status).toBe('tight')
  })

  it('reports basedOn scheduled unless both sides are live', () => {
    expect(transferStatus(ARRIVE, ARRIVE + 240, 0, false).basedOn).toBe('scheduled')
  })
})

describe('rankKey', () => {
  it('adds nothing for a direct option', () => {
    expect(rankKey(1000, null)).toBe(1000)
  })

  it('adds nothing for on_track', () => {
    expect(rankKey(1000, { status: 'on_track' })).toBe(1000)
  })

  it('adds 120 for tight', () => {
    expect(rankKey(1000, { status: 'tight' })).toBe(1120)
  })

  it('adds 900 for at_risk', () => {
    expect(rankKey(1000, { status: 'at_risk' })).toBe(1900)
  })
})

describe('TRAIN_SIDE_NOTE', () => {
  it('is the train copy', () => {
    expect(TRAIN_SIDE_NOTE).toBe('Train side uses the schedule')
  })
})
