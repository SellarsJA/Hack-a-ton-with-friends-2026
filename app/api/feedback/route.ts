import { NextResponse, type NextRequest } from 'next/server'
import { FeedbackRequest } from '@/src/contract/schema'
import { getProfileId } from '@/src/profile/profile'
import { upsertFeedback } from '@/src/feedback/store'

const headers = { 'Cache-Control': 'no-store' }
const MAX_BYTES = 4096

const invalid = (fields: string[] = []) =>
  NextResponse.json({ error: 'invalid', fields }, { status: 400, headers })

export async function POST(request: NextRequest) {
  const profileId = getProfileId(request)
  if (!profileId) return NextResponse.json({ error: 'no_profile' }, { status: 400, headers })

  let text: string
  try {
    text = await request.text()
  } catch {
    return invalid()
  }
  if (new TextEncoder().encode(text).length >= MAX_BYTES) return invalid()

  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return invalid()
  }

  const parsed = FeedbackRequest.safeParse(json)
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? '')).filter(Boolean))]
    return invalid(fields)
  }

  try {
    await upsertFeedback(profileId, parsed.data)
    return NextResponse.json({ ok: true }, { headers })
  } catch (err) {
    console.error('feedback failed', err instanceof Error ? err.name : 'error')
    return NextResponse.json({ error: 'server_error' }, { status: 500, headers })
  }
}
