import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const upsertFeedback = vi.fn<(...a: unknown[]) => Promise<void>>()
const vehicleSummary = vi.fn<(...a: unknown[]) => Promise<unknown>>()
vi.mock('@/src/feedback/store', () => ({
  upsertFeedback: (...a: unknown[]) => upsertFeedback(...a),
  vehicleSummary: (...a: unknown[]) => vehicleSummary(...a),
}))

const PID = '123e4567-e89b-42d3-a456-426614174000'
const valid = {
  rideKey: 'V1:T1:2026-11-14',
  vehicleLabel: 'V1',
  routeId: 'R1',
  tripId: 'T1',
  serviceDate: '2026-11-14',
  stars: 4,
  accuracy: { time: 3 },
}

const post = async (body: unknown, cookie: string | null = `rid=${PID}`, raw = false) => {
  const { POST } = await import('@/app/api/feedback/route')
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (cookie) headers.cookie = cookie
  return POST(
    new NextRequest('http://localhost/api/feedback', {
      method: 'POST',
      headers,
      body: raw ? (body as string) : JSON.stringify(body),
    }),
  )
}
const vehicle = async (label: string) => {
  const { GET } = await import('@/app/api/vehicles/[label]/route')
  return GET(new NextRequest(`http://localhost/api/vehicles/${encodeURIComponent(label)}`), {
    params: Promise.resolve({ label }),
  })
}

beforeEach(() => {
  upsertFeedback.mockReset().mockResolvedValue(undefined)
  vehicleSummary.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('POST /api/feedback', () => {
  it('400 no_profile without cookie, store not called', async () => {
    const res = await post(valid, null)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'no_profile' })
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(upsertFeedback).not.toHaveBeenCalled()
  })
  it('400 no_profile for an invalid cookie', async () => {
    const res = await post(valid, 'rid=nope')
    expect(res.status).toBe(400)
    expect(upsertFeedback).not.toHaveBeenCalled()
  })
  it.each([
    ['stars 0', { ...valid, stars: 0 }, 'stars'],
    ['stars without label', { ...valid, vehicleLabel: null, rideKey: 'none:T1:2026-11-14' }, 'stars'],
    ['bad issue', { ...valid, issue: 'rude' }, 'issue'],
    ['501-char note', { ...valid, note: 'x'.repeat(501) }, 'note'],
  ])('400 invalid for %s', async (_n, body, field) => {
    const res = await post(body)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('invalid')
    expect(json.fields).toContain(field)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(upsertFeedback).not.toHaveBeenCalled()
  })
  it('400 invalid for non-JSON and oversized bodies', async () => {
    for (const raw of ['{nope', JSON.stringify({ ...valid, note: 'x'.repeat(5000) })]) {
      const res = await post(raw, `rid=${PID}`, true)
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'invalid', fields: [] })
    }
    expect(upsertFeedback).not.toHaveBeenCalled()
  })
  it('200 and stores with the profile id', async () => {
    const res = await post(valid)
    expect(res.status).toBe(200)
    expect(upsertFeedback).toHaveBeenCalledTimes(1)
    expect(upsertFeedback.mock.calls[0][0]).toBe(PID)
  })
  it('does not echo the note', async () => {
    const res = await post({ ...valid, note: '<b>hi</b>' })
    expect(await res.text()).toBe('{"ok":true}')
  })
  it('500 server_error without leaking details', async () => {
    upsertFeedback.mockRejectedValue(new Error('secret db detail'))
    const res = await post({ ...valid, note: 'private' })
    expect(res.status).toBe(500)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const text = await res.text()
    expect(text).toBe('{"error":"server_error"}')
  })
})

describe('GET /api/vehicles/:label', () => {
  it('400 for bad labels, no-store, store not called', async () => {
    for (const l of ['<script>', 'a'.repeat(11), 'a b']) {
      const res = await vehicle(l)
      expect(res.status).toBe(400)
      expect(res.headers.get('cache-control')).toBe('no-store')
    }
    expect(vehicleSummary).not.toHaveBeenCalled()
  })
  it('200 with cache header', async () => {
    const summary = { label: 'V1', averageStars: 4, ratingCount: 1, issues: {} }
    vehicleSummary.mockResolvedValue(summary)
    const res = await vehicle('V1')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('public, max-age=60')
    expect(await res.json()).toEqual(summary)
    expect(vehicleSummary.mock.calls[0][0]).toBe('V1')
  })
  it('500 no-store on store failure', async () => {
    vehicleSummary.mockRejectedValue(new Error('x'))
    const res = await vehicle('V1')
    expect(res.status).toBe(500)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
})
