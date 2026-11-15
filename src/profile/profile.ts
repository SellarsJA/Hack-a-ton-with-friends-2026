import type { NextRequest } from 'next/server'

export const PROFILE_COOKIE = 'rid'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isValidProfileId(s: string | undefined): s is string {
  return typeof s === 'string' && UUID_V4.test(s)
}

export function getProfileId(req: NextRequest): string | null {
  const v = req.cookies.get(PROFILE_COOKIE)?.value
  return isValidProfileId(v) ? v : null
}
