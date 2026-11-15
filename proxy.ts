import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { PROFILE_COOKIE, getProfileId } from './src/profile/profile'

const MAX_AGE = 60 * 60 * 24 * 30

// Runs on pages and /api/*; skips Next internals and static files.
export function proxy(request: NextRequest) {
  const existing = getProfileId(request)
  const id = existing ?? crypto.randomUUID()

  let response: NextResponse
  if (existing) {
    response = NextResponse.next()
  } else {
    // Make a freshly minted id visible to downstream handlers on this request.
    const headers = new Headers(request.headers)
    const others = (request.headers.get('cookie') ?? '')
      .split(';')
      .map((c) => c.trim())
      .filter((c) => c && !c.startsWith(`${PROFILE_COOKIE}=`))
    headers.set('cookie', [...others, `${PROFILE_COOKIE}=${id}`].join('; '))
    response = NextResponse.next({ request: { headers } })
  }

  response.cookies.set(PROFILE_COOKIE, id, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE,
  })
  return response
}

export const config = {
  matcher: [
    '/((?!_next/|favicon\.ico|maplibre-gl-worker\.js|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
