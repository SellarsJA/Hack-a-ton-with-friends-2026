import { describe, it, expect } from 'vitest';
import fixture from '@/fixtures/plan.json';
import live from '@/fixtures/live.json';
import routes from '@/fixtures/routes.json';
import routeDetail from '@/fixtures/route-detail.json';
import {
  PlanResponse,
  SearchResponse,
  Occupancy,
  Transfer,
  Vehicle,
  LiveOption,
  LiveResponse,
  RouteSummary,
  RoutesResponse,
  RouteDetail,
} from '@/src/contract/schema';

describe('contract schema', () => {
  it('parses the plan fixture', () => {
    const parsed = PlanResponse.parse(fixture);
    expect(parsed.options).toHaveLength(4);
    for (const o of parsed.options) {
      for (const leg of o.legs) expect(leg.path.length).toBeGreaterThanOrEqual(5);
    }
  });

  it('plan fixture option 4 is a tight scheduled transfer to the LRT', () => {
    const parsed = PlanResponse.parse(fixture);
    const o = parsed.options[3];
    expect(o.transfer).toMatchObject({ status: 'tight', basedOn: 'scheduled' });
    const transit = o.legs.filter((l) => l.mode !== 'walk');
    expect(transit.map((l) => l.mode)).toEqual(['bus', 'rail']);
    expect(transit[0].route).toBe('9');
    expect(transit[1].transferWalkMinutesBefore).not.toBeNull();
    for (const opt of parsed.options) expect(opt.liveKey.length).toBeGreaterThan(0);
  });

  it('transfer spareMinutes matches the legs in plan.json and live.json', () => {
    const spare = (
      transit: { departAt: string; arriveAt: string }[],
      walkMin: number | null,
    ) => (Date.parse(transit[1].departAt) - Date.parse(transit[0].arriveAt)) / 60000 - (walkMin ?? 0);
    const plan = PlanResponse.parse(fixture);
    const walkByKey = new Map<string, number | null>();
    let checked = 0;
    for (const o of plan.options) {
      if (!o.transfer) continue;
      const transit = o.legs.flatMap((l) => (l.mode === 'walk' ? [] : [l]));
      expect(transit).toHaveLength(2);
      walkByKey.set(o.liveKey, transit[1].transferWalkMinutesBefore);
      expect(o.transfer.spareMinutes).toBe(spare(transit, transit[1].transferWalkMinutesBefore));
      checked++;
    }
    for (const o of LiveResponse.parse(live).options) {
      if (!o.transfer) continue;
      expect(o.transfer.spareMinutes).toBe(spare(o.legs, walkByKey.get(o.liveKey) ?? null));
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(2);
  });

  it('parses the live, routes and route-detail fixtures', () => {
    const l = LiveResponse.parse(live);
    expect(l.options[0].expired).toBe(true);
    expect(l.options[3].transfer).toMatchObject({ status: 'at_risk' });
    expect(l.options[3].transfer?.fallbackDepartAt).not.toBeNull();
    expect(RoutesResponse.parse(routes).routes.length).toBeGreaterThan(0);
    expect(RouteDetail.parse(routeDetail).patterns.length).toBeGreaterThan(0);
  });

  it('exports the new schemas', () => {
    for (const s of [Transfer, Vehicle, LiveOption, RouteSummary]) expect(s).toBeTruthy();
  });

  it('rejects an unknown transfer status', () => {
    expect(() =>
      Transfer.parse({ stop: 'x', spareMinutes: 1, status: 'late', basedOn: 'live', fallbackDepartAt: null }),
    ).toThrow();
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
