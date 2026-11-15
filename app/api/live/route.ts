import { NextResponse, type NextRequest } from 'next/server'
import type { LiveResponse } from '@/src/contract/schema'
import { getDb } from '@/src/db/client'
import { getLiveIndex } from '@/src/live/cache'
import { nextDepartures } from '@/src/plan/departures'
import { refreshOptions } from '@/src/plan/live'
import { decodeLiveKey } from '@/src/plan/liveKey'
import { dbVehicleLookups, vehiclesForRoutes } from '@/src/plan/vehicles'
import fixture from '@/fixtures/live.json'

const headers = { 'Cache-Control': 'no-store' }
const MAX_KEYS = 5

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  if (params.get('fixture') === '1') return NextResponse.json(fixture, { headers })

  const raw = params.get('keys') ?? ''
  const keys = raw === '' ? [] : raw.split(',')
  if (keys.length > MAX_KEYS) return NextResponse.json({ error: 'too_many_keys' }, { status: 400, headers })
  const payloads = keys.map((k) => decodeLiveKey(k))
  if (keys.length === 0 || payloads.some((p) => p === null)) {
    return NextResponse.json({ error: 'bad_key' }, { status: 400, headers })
  }

  try {
    const nowEpoch = Date.now() / 1000
    // A live-feed failure must degrade to schedule-only, never fail the request.
    const live = await Promise.resolve()
      .then(() => getLiveIndex())
      .catch(() => null)
    const db = getDb()
    const lookups = dbVehicleLookups(db)
    const routeIds = [...new Set(payloads.flatMap((p) => p!.legs.map((l) => l.r)))]
    const [options, vehicles] = await Promise.all([
      refreshOptions(keys, live, nowEpoch, { nextDepartures: (args) => nextDepartures(db, args) }),
      vehiclesForRoutes(routeIds, live, lookups.tripRoute, lookups.routeNames),
    ])
    const body: LiveResponse = {
      liveDataAgeSeconds: live ? Math.max(0, Math.round(nowEpoch - live.feedTimestamp)) : null,
      options,
      vehicles,
    }
    return NextResponse.json(body, { headers })
  } catch (err) {
    console.error('live failed', err)
    return NextResponse.json({ error: 'server_error' }, { status: 500, headers })
  }
}
