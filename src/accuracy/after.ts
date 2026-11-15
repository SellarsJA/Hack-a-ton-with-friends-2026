import { after } from 'next/server'
import type { Option } from '@/src/contract/schema'
import { getLiveIndex } from '@/src/live/cache'
import type { LiveIndex } from '@/src/live/decode'
import { recordPredictions } from './record'
import { trackActuals } from './track'

/** Runs `work` after the response; never throws, never runs in snapshot mode. */
function schedule(work: () => Promise<void>): void {
  if (process.env.LIVE_SOURCE === 'snapshot') return
  try {
    after(async () => {
      try {
        await work()
      } catch (err) {
        console.warn('[accuracy] background work failed:', err)
      }
    })
  } catch (err) {
    console.warn('[accuracy] could not schedule background work:', err)
  }
}

export function scheduleRecordAndTrack(options: Option[], nowEpoch: number): void {
  schedule(async () => {
    await recordPredictions(options, nowEpoch)
    const live = await getLiveIndex()
    if (live) await trackActuals(live, nowEpoch)
  })
}

export function scheduleTrack(live: LiveIndex | null, nowEpoch: number): void {
  if (!live) return
  schedule(() => trackActuals(live, nowEpoch))
}
