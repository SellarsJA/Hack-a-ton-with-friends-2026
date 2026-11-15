import { NextResponse, type NextRequest } from 'next/server'
import { getDb } from '@/src/db/client'
import { MIN_QUERY_LENGTH, searchIndex } from '@/src/plan/search'

const headers = { 'Cache-Control': 'no-store' }

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q') ?? ''
  if (q.trim().length < MIN_QUERY_LENGTH) return NextResponse.json({ stops: [], routes: [] }, { headers })
  try {
    return NextResponse.json(await searchIndex(getDb(), q), { headers })
  } catch (err) {
    console.error('search failed', err)
    return NextResponse.json({ error: 'server_error' }, { status: 500, headers })
  }
}
