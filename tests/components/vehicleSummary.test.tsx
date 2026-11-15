import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import fixture from '@/fixtures/vehicle-summary.json'
import VehicleSummary, { invalidateVehicleSummary, __resetVehicleSummaryCacheForTests } from '@/components/VehicleSummary'

const okJson = (body: unknown, ok = true) => Promise.resolve({ ok, json: () => Promise.resolve(body) })

beforeEach(() => __resetVehicleSummaryCacheForTests())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('VehicleSummary', () => {
  it('shows stars and only non-zero issues', async () => {
    vi.stubGlobal('fetch', vi.fn(() => okJson(fixture)))
    const { container } = render(<VehicleSummary label="4012" />)
    await waitFor(() => expect(container.textContent).toBe('★ 4.2 (12) · 2 cleanliness · 1 too full this month'))
    expect(container.textContent).not.toMatch(/safety|disruption/)
  })
  it('shows just stars when no issues, one decimal', async () => {
    const body = { ...fixture, averageStars: 3, issues: { cleanliness: 0, safety: 0, disruption: 0, too_full: 0 } }
    vi.stubGlobal('fetch', vi.fn(() => okJson(body)))
    const { container } = render(<VehicleSummary label="4012" />)
    await waitFor(() => expect(container.textContent).toBe('★ 3.0 (12)'))
  })
  it('renders nothing for ratingCount 0', async () => {
    const f = vi.fn(() => okJson({ ...fixture, ratingCount: 0, averageStars: 0 }))
    vi.stubGlobal('fetch', f)
    const { container } = render(<VehicleSummary label="4012" />)
    await waitFor(() => expect(f).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 10))
    expect(container.textContent).toBe('')
  })
  it('renders nothing on non-OK, invalid body, and rejected fetch', async () => {
    for (const impl of [() => okJson({}, false), () => okJson({ nope: 1 }), () => Promise.reject(new Error('x'))]) {
      __resetVehicleSummaryCacheForTests()
      const f = vi.fn(impl)
      vi.stubGlobal('fetch', f)
      const { container, unmount } = render(<VehicleSummary label="4012" />)
      await waitFor(() => expect(f).toHaveBeenCalled())
      await new Promise((r) => setTimeout(r, 10))
      expect(container.textContent).toBe('')
      unmount()
    }
  })
  it('two components with the same label make one fetch', async () => {
    const f = vi.fn(() => okJson(fixture))
    vi.stubGlobal('fetch', f)
    render(
      <>
        <VehicleSummary label="4012" />
        <VehicleSummary label="4012" />
      </>,
    )
    await waitFor(() => expect(screen.getAllByText(/★ 4.2/)).toHaveLength(2))
    expect(f).toHaveBeenCalledTimes(1)
  })
  it('refetches after invalidation, with no-cache', async () => {
    const f = vi.fn(() => okJson(fixture))
    vi.stubGlobal('fetch', f)
    const { unmount } = render(<VehicleSummary label="4012" />)
    await waitFor(() => expect(f).toHaveBeenCalledTimes(1))
    expect(f).toHaveBeenCalledWith('/api/vehicles/4012', { cache: 'no-cache' })
    unmount()
    invalidateVehicleSummary('4012')
    render(<VehicleSummary label="4012" />)
    await waitFor(() => expect(f).toHaveBeenCalledTimes(2))
  })
  it('null label makes no fetch and URL-encodes labels', async () => {
    const f = vi.fn(() => okJson(fixture))
    vi.stubGlobal('fetch', f)
    const { container } = render(<VehicleSummary label={null} />)
    expect(container.textContent).toBe('')
    expect(f).not.toHaveBeenCalled()
    render(<VehicleSummary label="a/b" />)
    await waitFor(() => expect(f).toHaveBeenCalledWith('/api/vehicles/a%2Fb', { cache: 'no-cache' }))
  })
})
