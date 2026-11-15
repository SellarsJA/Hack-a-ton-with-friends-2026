import type { Transfer } from '@/src/contract/schema'

export const TRAIN_SIDE_NOTE = 'Train side uses the schedule'

export function transferStatus(
  arrive1Epoch: number,
  depart2Epoch: number,
  walkSeconds: number,
  bothLive: boolean,
): Omit<Transfer, 'stop' | 'fallbackDepartAt'> {
  const spare = (depart2Epoch - arrive1Epoch - walkSeconds) / 60
  const status: Transfer['status'] = spare > 3 ? 'on_track' : spare >= 0 ? 'tight' : 'at_risk'
  return {
    spareMinutes: Math.floor(spare),
    status,
    basedOn: bothLive ? 'live' : 'scheduled',
  }
}

const PENALTY: Record<Transfer['status'], number> = {
  on_track: 0,
  tight: 120,
  at_risk: 900,
}

export function rankKey(arriveAtDestEpoch: number, transfer: Pick<Transfer, 'status'> | null): number {
  return arriveAtDestEpoch + (transfer ? PENALTY[transfer.status] : 0)
}
