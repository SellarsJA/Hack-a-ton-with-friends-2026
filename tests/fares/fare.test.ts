import { describe, expect, it } from 'vitest';
import fares from '@/config/fares.json';
import { fareFor, type ZoneId } from '@/src/fares/fare';

const ets = (r: string) => ({ agencyId: '1', routeShortName: r });
const ESTIMATED_LABEL = 'Adult, Arc or tap. Estimated: several transit agencies';

describe('fareFor', () => {
  it('same-zone Edmonton trip has cash fare', () => {
    expect(fareFor({ firstZone: '1EDM', lastZone: '1EDM', legs: [ets('9')] })).toEqual({
      amount: 3,
      cashAmount: 3.75,
      estimated: false,
      label: 'Adult, Arc or tap. Transfers included',
    });
  });
  it('1EDM to 2STA is 4.5 with no cash', () => {
    const f = fareFor({ firstZone: '1EDM', lastZone: '2STA', legs: [ets('9')] });
    expect(f.amount).toBe(4.5);
    expect(f.cashAmount).toBeNull();
  });
  it('is symmetric', () => {
    expect(fareFor({ firstZone: '2STA', lastZone: '1EDM', legs: [ets('9')] }).amount).toBe(4.5);
  });
  it('airport on 747 only costs 6 cash', () => {
    const f = fareFor({ firstZone: '1EDM', lastZone: '1AIR', legs: [ets('747')] });
    expect(f.amount).toBe(6);
    expect(f.cashAmount).toBe(6);
  });
  it('airport with a non-747 leg costs 9.75 cash', () => {
    const f = fareFor({ firstZone: '1EDM', lastZone: '1AIR', legs: [ets('9'), ets('747')] });
    expect(f.cashAmount).toBe(9.75);
  });
  it('non-ETS leg gives no cash fare', () => {
    const f = fareFor({
      firstZone: '1EDM',
      lastZone: '1EDM',
      legs: [{ agencyId: '2', routeShortName: 'X' }],
    });
    expect(f.cashAmount).toBeNull();
  });
  it('estimated pair uses estimated label', () => {
    const f = fareFor({ firstZone: '1EDM', lastZone: '6FST', legs: [ets('9')] });
    expect(f).toMatchObject({ amount: 9.5, estimated: true, label: ESTIMATED_LABEL });
  });
  it('9LT to 1AIR is 2', () => {
    expect(fareFor({ firstZone: '9LT', lastZone: '1AIR', legs: [ets('747')] }).amount).toBe(2);
  });
  it('resolves every pair of the 8 zones in both directions', () => {
    const ids = Object.keys(fares.zones) as ZoneId[];
    expect(ids).toHaveLength(8);
    for (const a of ids)
      for (const b of ids)
        expect(() => fareFor({ firstZone: a, lastZone: b, legs: [ets('1')] })).not.toThrow();
    expect(Object.keys(fares.arc)).toHaveLength(36);
  });
  it('throws naming the key for an unknown pair', () => {
    expect(() =>
      fareFor({ firstZone: '1EDM', lastZone: 'XXXX' as ZoneId, legs: [] }),
    ).toThrow('1EDM|XXXX');
  });
});
