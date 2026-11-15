import { NextResponse, type NextRequest } from 'next/server'
import { vehicleSummary } from '@/src/feedback/store'

const noStore = { 'Cache-Control': 'no-store' }
const LABEL_RE = /^[A-Za-z0-9-]{1,10}$/

export async function GET(_request: NextRequest, ctx: { params: Promise<{ label: string }> }) {
  const { label } = await ctx.params
  if (!LABEL_RE.test(label)) return NextResponse.json({ error: 'invalid_label' }, { status: 400, headers: noStore })

  try {
    const body = await vehicleSummary(label)
    return NextResponse.json(body, { headers: { 'Cache-Control': 'private, max-age=60' } })
  } catch (err) {
    console.error('vehicle summary failed', err)
    return NextResponse.json({ error: 'server_error' }, { status: 500, headers: noStore })
  }
}
