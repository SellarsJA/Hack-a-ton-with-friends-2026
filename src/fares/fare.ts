import fares from '@/config/fares.json';
import type { Fare } from '@/src/contract/schema';

export type ZoneId = '1EDM' | '1AIR' | '2STA' | '4SCT' | '5SGT' | '6FST' | '7BT' | '9LT';

export interface FareInput {
  firstZone: ZoneId;
  lastZone: ZoneId;
  legs: { agencyId: string; routeShortName: string }[];
}

const arc: Record<string, number> = fares.arc;
const estimatedPairs = new Set<string>(fares.estimated);

const BASE_LABEL = 'Adult, Arc or tap. Transfers included';
const ESTIMATED_LABEL = 'Adult, Arc or tap. Estimated: several transit agencies';

function cashFor(input: FareInput): number | null {
  const { firstZone, lastZone, legs } = input;
  if (legs.length === 0 || !legs.every((l) => l.agencyId === '1')) return null;
  if (firstZone === '1EDM' && lastZone === '1EDM') return fares.cash.edmonton;
  if (firstZone === '1AIR' || lastZone === '1AIR') {
    return legs.every((l) => l.routeShortName === '747') ? fares.cash.airport747 : 9.75;
  }
  return null;
}

export function fareFor(input: FareInput): Fare {
  const key = [input.firstZone, input.lastZone].sort().join('|');
  const amount = arc[key];
  if (amount === undefined) throw new Error(`No fare for zone pair ${key}`);
  const estimated = estimatedPairs.has(key);
  return {
    amount,
    cashAmount: cashFor(input),
    estimated,
    label: estimated ? ESTIMATED_LABEL : BASE_LABEL,
  };
}
