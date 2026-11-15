import { NextResponse, type NextRequest } from 'next/server'
import { parseLatLng } from '@/src/geo/geo'
import { planTrip } from '@/src/plan/plan'
import { scheduleRecordAndTrack } from '@/src/accuracy/after'
import fixture from '@/fixtures/plan.json'

const headers = { 'Cache-Control': 'no-store' }

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  if (params.get('fixture') === '1') return NextResponse.json(fixture, { headers })
  const from = parseLatLng(params.get('from') ?? '')
  const to = parseLatLng(params.get('to') ?? '')
  if (!from || !to) return NextResponse.json({ error: 'bad_coordinates' }, { status: 400, headers })
  try {
    const result = await planTrip(from, to)
    scheduleRecordAndTrack(result.options, Date.now() / 1000)
    return NextResponse.json(result, { headers })
  } catch (err) {
    console.error('plan failed', err)
    return NextResponse.json({ error: 'server_error' }, { status: 500, headers })
  }
}
