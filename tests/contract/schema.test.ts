import { describe, it, expect } from 'vitest';
import fixture from '@/fixtures/plan.json';
import { PlanResponse, SearchResponse, Occupancy } from '@/src/contract/schema';

describe('contract schema', () => {
  it('parses the plan fixture', () => {
    const parsed = PlanResponse.parse(fixture);
    expect(parsed.options).toHaveLength(3);
    for (const o of parsed.options) {
      for (const leg of o.legs) expect(leg.path.length).toBeGreaterThanOrEqual(5);
    }
  });

  it('rejects a string fare amount', () => {
    const bad = structuredClone(fixture) as { options: { fare: Record<string, unknown> }[] };
    bad.options[0].fare.amount = '3';
    expect(() => PlanResponse.parse(bad)).toThrow();
  });

  it('rejects timestamps without an offset', () => {
    const bad = structuredClone(fixture) as Record<string, unknown>;
    bad.generatedAt = '2026-11-14T18:02:00';
    expect(() => PlanResponse.parse(bad)).toThrow();
  });

  it('exports the occupancy enum', () => {
    expect(Occupancy.options).toEqual(['not_crowded', 'some_standing', 'full']);
  });

  it('parses a search response', () => {
    expect(
      SearchResponse.parse({
        stops: [{ stopId: '1', name: 'Churchill', lat: 53.5, lon: -113.4 }],
        routes: [{ routeId: 'r9', shortName: '9', longName: 'Downtown' }],
      }),
    ).toBeTruthy();
  });
});
