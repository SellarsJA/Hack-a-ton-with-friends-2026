import { describe, it, expect } from 'vitest'
import fixture from '@/fixtures/plan.json'
import { PlanResponse } from '@/src/contract/schema'
import { decodeRideLink, encodeRideLink, rideLinkFor } from '@/src/feedback/rideLink'

const option = PlanResponse.parse(fixture).options[0]
const idx = option.legs.findIndex((l) => l.mode !== 'walk')

describe('rideLink', () => {
  it('uses none: when the leg has no vehicleLabel', () => {
    const o = { ...option, legs: option.legs.map((l) => (l.mode !== 'walk' ? { ...l, vehicleLabel: null } : l)) }
    expect(rideLinkFor(o, idx).rideKey.startsWith('none:')).toBe(true)
  })
  it('round-trips', () => {
    const r = rideLinkFor(option, idx)
    expect(decodeRideLink(encodeRideLink(r))).toEqual(r)
  })
  it('returns null for bad input', () => {
    expect(decodeRideLink('bad')).toBeNull()
    expect(decodeRideLink('a'.repeat(3000))).toBeNull()
    expect(decodeRideLink(encodeRideLink({ nope: 1 } as never))).toBeNull()
  })
})
