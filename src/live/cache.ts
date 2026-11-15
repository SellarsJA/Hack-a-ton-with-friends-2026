import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { buildLiveIndex, type LiveIndex } from '@/src/live/decode'

const BASE = 'https://gtfs.edmonton.ca/TMGTFSRealTimeWebService'
const URLS = {
  vehicles: `${BASE}/Vehicle/VehiclePositions.pb`,
  tripUpdates: `${BASE}/TripUpdate/TripUpdates.pb`,
  alerts: `${BASE}/Alert/Alerts.pb`,
}
const SNAPSHOT_FILES = {
  vehicles: 'VehiclePositions.pb',
  tripUpdates: 'TripUpdates.pb',
  alerts: 'Alerts.pb',
}
const TTL_MS = 30_000
const FETCH_TIMEOUT_MS = 5_000

let current: LiveIndex | null = null
let loadedAt = 0
let nextAttemptAt = 0
let inflight: Promise<LiveIndex | null> | null = null

async function fetchBuf(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return new Uint8Array(await res.arrayBuffer())
}

async function load(): Promise<LiveIndex> {
  let bufs: [Uint8Array, Uint8Array, Uint8Array]
  if (process.env.LIVE_SOURCE === 'snapshot') {
    const read = (f: string) =>
      readFile(join(process.cwd(), 'data/snapshot', f)).then((b) => new Uint8Array(b))
    bufs = await Promise.all([
      read(SNAPSHOT_FILES.vehicles),
      read(SNAPSHOT_FILES.tripUpdates),
      read(SNAPSHOT_FILES.alerts),
    ])
  } else {
    bufs = await Promise.all([
      fetchBuf(URLS.vehicles),
      fetchBuf(URLS.tripUpdates),
      fetchBuf(URLS.alerts),
    ])
  }
  return buildLiveIndex({ vehicles: bufs[0], tripUpdates: bufs[1], alerts: bufs[2] })
}

export async function getLiveIndex(now: number = Date.now()): Promise<LiveIndex | null> {
  if (current && now - loadedAt < TTL_MS) return current
  if (inflight) return inflight
  if (now < nextAttemptAt) return current
  inflight = (async () => {
    try {
      current = await load()
      loadedAt = now
      nextAttemptAt = 0
    } catch (err) {
      nextAttemptAt = now + TTL_MS
      console.warn('[live] refresh failed, using previous index:', err)
    } finally {
      inflight = null
    }
    return current
  })()
  return inflight
}

/** Test-only: clears module-level cache state. */
export function __resetLiveCacheForTests(): void {
  current = null
  loadedAt = 0
  nextAttemptAt = 0
  inflight = null
}
