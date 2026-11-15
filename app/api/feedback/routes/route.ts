import { NextResponse, type NextRequest } from 'next/server'
import { routeFeedbackSummaries } from '@/src/feedback/store'

const noStore = { 'Cache-Control': 'no-store' }
/** Route short names: "9", "004", "930X", "Capital", "Valley Line". */
const ROUTE_RE = /^[A-Za-z0-9 -]{1,30}$/
const MAX_ROUTES = 10

/** GET /api/feedback/routes?ids=9,Capital → { routes: RouteFeedbackSummary[] } in the order asked. */
export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get('ids') ?? ''
  const ids = [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))]
  if (ids.length === 0 || ids.length > MAX_ROUTES || !ids.every((id) => ROUTE_RE.test(id)))
    return NextResponse.json({ error: 'invalid_ids' }, { status: 400, headers: noStore })
  try {
    return NextResponse.json({ routes: await routeFeedbackSummaries(ids) }, { headers: noStore })
  } catch (err) {
    console.error('route feedback summary failed', err instanceof Error ? err.name : 'error')
    return NextResponse.json({ error: 'server_error' }, { status: 500, headers: noStore })
  }
}
