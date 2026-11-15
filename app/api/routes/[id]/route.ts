import { NextResponse, type NextRequest } from 'next/server'
import { getDb, type Db } from '@/src/db/client'
import { routeDetail } from '@/src/routes/queries'
import fixture from '@/fixtures/route-detail.json'

const headers = { 'Cache-Control': 'no-store' }
const ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const params = request.nextUrl.searchParams
  if (params.get('fixture') === '1') return NextResponse.json(fixture, { headers })

  if (!ID_RE.test(id)) return NextResponse.json({ error: 'unknown_route' }, { status: 404, headers })
  const stop = params.get('stop')
  if (stop !== null && !ID_RE.test(stop)) return NextResponse.json({ error: 'bad_stop' }, { status: 400, headers })

  try {
    const lazyDb: Db = {
      query: (text, p) => {
        try {
          return getDb().query(text, p)
        } catch (err) {
          return Promise.reject(err)
        }
      },
    }
    const body = await routeDetail(lazyDb, id, stop, Date.now() / 1000)
    if (!body) return NextResponse.json({ error: 'unknown_route' }, { status: 404, headers })
    return NextResponse.json(body, { headers })
  } catch (err) {
    console.error('route detail failed', err)
    return NextResponse.json({ error: 'server_error' }, { status: 500, headers })
  }
}
