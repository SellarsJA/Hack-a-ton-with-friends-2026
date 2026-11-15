import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server'
import { proxy, config } from '../../proxy'
import { getProfileId, isValidProfileId, PROFILE_COOKIE } from '../../src/profile/profile'

const UUID = '3f2b8c1e-9a4d-4e6b-8c7a-1d2e3f4a5b6c'

function req(cookie?: string) {
  return new NextRequest('http://localhost/', cookie ? { headers: { cookie } } : undefined)
}

describe('proxy profile cookie', () => {
  it('sets a fresh uuid with the required attributes when no cookie', () => {
    const res = proxy(req())
    const c = res.cookies.get(PROFILE_COOKIE)
    expect(c && isValidProfileId(c.value)).toBe(true)
    expect(c?.httpOnly).toBe(true)
    expect(c?.secure).toBe(true)
    expect(c?.sameSite).toBe('lax')
    expect(c?.path).toBe('/')
    expect(c?.maxAge).toBe(2592000)
  })

  it('re-sets a valid cookie to the same value', () => {
    const res = proxy(req(`rid=${UUID}`))
    expect(res.cookies.get('rid')?.value).toBe(UUID)
    expect(res.cookies.get('rid')?.maxAge).toBe(2592000)
  })

  it('replaces an invalid cookie', () => {
    const res = proxy(req('rid=not-a-uuid'))
    const v = res.cookies.get('rid')?.value
    expect(v).not.toBe('not-a-uuid')
    expect(isValidProfileId(v)).toBe(true)
  })

  it('exposes a minted id to downstream handlers via the request cookie header', () => {
    const res = proxy(req())
    const minted = res.cookies.get('rid')!.value
    expect(res.headers.get('x-middleware-request-cookie')).toContain(minted)
  })

  it('matches pages and api but not internals or static files', () => {
    const m = (url: string) => unstable_doesMiddlewareMatch({ config, url })
    for (const u of ['/', '/ride', '/api/feedback', '/stats', '/foo-png']) expect(m(u), u).toBe(true)
    for (const u of ['/_next/static/a.js', '/favicon.ico', '/logo.png', '/maplibre-gl-worker.js'])
      expect(m(u), u).toBe(false)
  })
})

describe('profile helpers', () => {
  it('validates uuid v4 only', () => {
    expect(isValidProfileId(UUID)).toBe(true)
    expect(isValidProfileId(UUID.toUpperCase())).toBe(true)
    expect(isValidProfileId('3f2b8c1e-9a4d-1e6b-8c7a-1d2e3f4a5b6c')).toBe(false)
    expect(isValidProfileId('3f2b8c1e-9a4d-4e6b-1c7a-1d2e3f4a5b6c')).toBe(false)
    expect(isValidProfileId(undefined)).toBe(false)
  })
  it('getProfileId returns null for junk and the value for valid', () => {
    expect(getProfileId(req('rid=../../etc'))).toBeNull()
    expect(getProfileId(req())).toBeNull()
    expect(getProfileId(req(`rid=${UUID}`))).toBe(UUID)
  })
})
