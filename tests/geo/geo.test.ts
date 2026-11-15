import { describe, it, expect } from 'vitest';
import { distanceMeters, walkMinutes, boundingBox, sliceShape, parseLatLng } from '@/src/geo/geo';

describe('distanceMeters', () => {
  it('Churchill Square to Southgate is ~6720 m', () => {
    const d = distanceMeters({ lat: 53.5444, lon: -113.4909 }, { lat: 53.4857, lon: -113.5163 });
    expect(Math.abs(d - 6720)).toBeLessThan(50);
  });
  it('is zero for identical points', () => {
    expect(distanceMeters({ lat: 53.5, lon: -113.5 }, { lat: 53.5, lon: -113.5 })).toBe(0);
  });
});

describe('walkMinutes', () => {
  it('800 m is 13 minutes', () => expect(walkMinutes(800)).toBe(13));
});

describe('boundingBox', () => {
  it('spans the radius in metres around the centre', () => {
    const c = { lat: 53.5, lon: -113.5 };
    const b = boundingBox(c, 1000);
    expect(b.maxLat - c.lat).toBeCloseTo(1000 / 111320, 8);
    expect(c.lat - b.minLat).toBeCloseTo(1000 / 111320, 8);
    expect(distanceMeters(c, { lat: c.lat, lon: b.maxLon })).toBeCloseTo(1000, -1);
    expect(distanceMeters(c, { lat: c.lat, lon: b.minLon })).toBeCloseTo(1000, -1);
  });
});

describe('sliceShape', () => {
  const line: [number, number][] = Array.from({ length: 10 }, (_, i) => [53 + i * 0.01, -113.5]);
  it('returns points between nearest indexes inclusive', () => {
    const out = sliceShape(line, { lat: 53.021, lon: -113.5 }, { lat: 53.069, lon: -113.5 });
    expect(out).toHaveLength(6);
    expect(out[0]).toEqual(line[2]);
    expect(out[5]).toEqual(line[7]);
  });
  it('on a loop, to resolves after from', () => {
    const loop: [number, number][] = [
      [53.0, -113.5], [53.01, -113.5], [53.01, -113.49], [53.0, -113.49], [53.0, -113.5],
    ];
    const out = sliceShape(loop, { lat: 53.0, lon: -113.5 }, { lat: 53.0, lon: -113.5 });
    expect(out).toEqual(loop);
  });
  it('returns short shapes unchanged', () => {
    expect(sliceShape([[53, -113.5]], { lat: 53, lon: -113.5 }, { lat: 53, lon: -113.5 })).toEqual([[53, -113.5]]);
  });
});

describe('parseLatLng', () => {
  it('parses valid input with whitespace', () => {
    expect(parseLatLng('53.5444,-113.4909')).toEqual({ lat: 53.5444, lon: -113.4909 });
    expect(parseLatLng(' 53.5 , -113.5 ')).toEqual({ lat: 53.5, lon: -113.5 });
  });
  it('rejects bad input', () => {
    expect(parseLatLng('abc')).toBeNull();
    expect(parseLatLng('0,0')).toBeNull();
    expect(parseLatLng('53.5')).toBeNull();
    expect(parseLatLng('53.5,-113.5,1')).toBeNull();
    expect(parseLatLng('NaN,-113.5')).toBeNull();
    expect(parseLatLng('53.5,')).toBeNull();
  });
});
