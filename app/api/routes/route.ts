import { NextResponse, type NextRequest } from 'next/server'
import type { RoutesResponse } from '@/src/contract/schema'
import { getDb, type Db } from '@/src/db/client'
import { listRoutes } from '@/src/routes/queries'
import fixture from '@/fixtures/routes.json'

const okHeaders = { 'Cache-Control': 'public, max-age=3600' }
const errHeaders = { 'Cache-Control': 'no-store' }

export async function GET(request: NextRequest) {
  // Reading the request keeps this handler dynamic, so nothing queries the DB at build time.
  if (request.nextUrl.searchParams.get('fixture') === '1') return NextResponse.json(fixture, { headers: okHeaders })
  try {
    const lazyDb: Db = {
      query: (text, params) => {
        try {
          return getDb().query(text, params)
        } catch (err) {
          return Promise.reject(err)
        }
      },
    }
    const body: RoutesResponse = { routes: await listRoutes(lazyDb) }
    return NextResponse.json(body, { headers: okHeaders })
  } catch (err) {
    console.error('routes failed', err)
    return NextResponse.json({ error: 'server_error' }, { status: 500, headers: errHeaders })
  }
}
