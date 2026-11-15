import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const routeFeedbackSummaries = vi.fn<(ids: string[]) => Promise<unknown>>()
vi.mock('@/src/feedback/store', () => ({ routeFeedbackSummaries: (ids: string[]) => routeFeedbackSummaries(ids) }))

const get = async (qs: string) => {
  const { GET } = await import('@/app/api/feedback/routes/route')
  return GET(new NextRequest(`http://localhost/api/feedback/routes${qs}`))
}

beforeEach(() => {
  routeFeedbackSummaries.mockReset()
  routeFeedbackSummaries.mockResolvedValue([])
})

describe('GET /api/feedback/routes', () => {
  it('passes unique trimmed ids through, uncached', async () => {
    const res = await get('?ids=9,%20Valley%20Line,9')
    expect(res.status).toBe(200)
    expect(routeFeedbackSummaries).toHaveBeenCalledWith(['9', 'Valley Line'])
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
  it.each([[''], ['?ids='], ['?ids=a;drop'], [`?ids=${Array.from({ length: 11 }, (_, i) => i).join(',')}`]])(
    'rejects %s',
    async (qs) => {
      expect((await get(qs)).status).toBe(400)
      expect(routeFeedbackSummaries).not.toHaveBeenCalled()
    },
  )
  it('500 when the store fails', async () => {
    routeFeedbackSummaries.mockRejectedValue(new Error('db'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await get('?ids=9')).status).toBe(500)
  })
})
