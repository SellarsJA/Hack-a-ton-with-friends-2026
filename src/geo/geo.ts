import type { LatLng } from '@/src/contract/schema';

const R = 6_371_000;
const M_PER_DEG_LAT = 111_320;
const toRad = (d: number) => (d * Math.PI) / 180;

export function distanceMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function walkMinutes(m: number): number {
  return Math.ceil((m * 1.25) / 80);
}

export function boundingBox(
  c: LatLng,
  radiusM: number,
): { minLat: number; maxLat: number; minLon: number; maxLon: number } {
  const dLat = radiusM / M_PER_DEG_LAT;
  const dLon = radiusM / (M_PER_DEG_LAT * Math.cos(toRad(c.lat)));
  return { minLat: c.lat - dLat, maxLat: c.lat + dLat, minLon: c.lon - dLon, maxLon: c.lon + dLon };
}

// Slice from the point nearest `from` to the nearest `to` after it; <2 points returns a copy, no later point yields just the 1 point.
export function sliceShape(
  points: [number, number][],
  from: LatLng,
  to: LatLng,
): [number, number][] {
  if (points.length < 2) return [...points];
  const nearest = (p: LatLng, start: number): number => {
    let best = -1;
    let bestD = Infinity;
    for (let i = start; i < points.length; i++) {
      const d = distanceMeters(p, { lat: points[i][0], lon: points[i][1] });
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  };
  const i = nearest(from, 0);
  const j = nearest(to, i + 1);
  if (j === -1) return [points[i]];
  return points.slice(i, j + 1);
}

export function parseLatLng(s: string): LatLng | null {
  const parts = s.split(',').map((p) => p.trim());
  if (parts.length !== 2 || parts.some((p) => p === '')) return null;
  const lat = Number(parts[0]);
  const lon = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < 52 || lat > 55 || lon < -115 || lon > -112) return null;
  return { lat, lon };
}
