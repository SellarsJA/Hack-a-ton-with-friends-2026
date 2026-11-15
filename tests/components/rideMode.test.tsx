import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import fixture from '@/fixtures/plan.json'
import { PlanResponse } from '@/src/contract/schema'
import RouteReviews, { __resetRouteReviewsCacheForTests, reviewText } from '@/components/RouteReviews'
import RateSheet from '@/components/RateSheet'
import ResultsPage from '@/app/results/page'

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('from=53.5,-113.5&to=53.4,-113.4&fromLabel=A&toLabel=B'),
}))
vi.mock('next/dynamic', () => ({
  default: () =>
    function TripMapStub({ options }: { options: { id: string }[] }) {
      return <div data-testid="map" data-count={options.length} />
    },
}))

const plan = PlanResponse.parse(fixture)
const issues = { cleanliness: 0, safety: 0, disruption: 0, too_full: 0 }
const capital = { routeId: 'Valley Line', averageStars: 4, ratingCount: 3, issues: { ...issues, cleanliness: 2 } }

type Handler = (url: string, init?: RequestInit) => unknown
function stubFetch(handler: Handler) {
  const f = vi.fn((url: string, init?: RequestInit) => {
    const body = handler(url, init) ?? {}
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
  })
  vi.stubGlobal('fetch', f)
  return f
}

beforeEach(() => __resetRouteReviewsCacheForTests())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('reviewText', () => {
  it('joins stars and issues, or says nothing', () => {
    expect(reviewText(capital)).toBe('★ 4.0 (3) · 2 cleanliness')
    expect(reviewText({ ...capital, ratingCount: 0, averageStars: null, issues })).toBeNull()
  })
})

describe('RouteReviews', () => {
  it('fetches all routes in one request and shows the ones riders talked about', async () => {
    const f = stubFetch(() => ({ routes: [{ ...capital, routeId: '9', ratingCount: 0, averageStars: null, issues }, capital] }))
    render(<RouteReviews routeIds={['9', 'Valley Line', '9']} />)
    expect(await screen.findByText('★ 4.0 (3) · 2 cleanliness')).toBeTruthy()
    expect(screen.getByText('Valley Line riders:')).toBeTruthy()
    expect(screen.queryByText(/^9 riders/)).toBeNull()
    expect(f).toHaveBeenCalledTimes(1)
    expect(f.mock.calls[0][0]).toBe('/api/feedback/routes?ids=9%2CValley%20Line')
  })
})

describe('RateSheet', () => {
  it('rates one ride at a time on a transfer trip, then offers the next', async () => {
    const posts: unknown[] = []
    stubFetch((url, init) => {
      if (url === '/api/feedback') posts.push(JSON.parse(String(init?.body)))
      return { ok: true }
    })
    const onSaved = vi.fn()
    const transfer = plan.options[3]
    render(<RateSheet option={transfer} onClose={() => {}} onSaved={onSaved} />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['9', 'Valley Line'])
    await userEvent.click(screen.getByRole('radio', { name: '5 stars' }))
    await userEvent.click(screen.getByRole('button', { name: 'Send feedback' }))
    expect(await screen.findByText(/Riders will see it next time/)).toBeTruthy()
    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(posts[0]).toMatchObject({ routeId: '9', stars: 5 })
    await userEvent.click(screen.getByRole('button', { name: 'Rate Valley Line next' }))
    expect(screen.getAllByRole('tab')[1].getAttribute('aria-selected')).toBe('true')
    // The train has no fleet number but can still be starred.
    await userEvent.click(screen.getByRole('radio', { name: '3 stars' }))
    await userEvent.click(screen.getByRole('button', { name: 'Send feedback' }))
    await waitFor(() => expect(posts).toHaveLength(2))
    expect(posts[1]).toMatchObject({ routeId: 'Valley Line', vehicleLabel: null, stars: 3 })
    expect(await screen.findByRole('button', { name: 'Done' })).toBeTruthy()
  })
})

describe('results page trip mode', () => {
  it('Start this trip hides the other options; the rate bar opens the sheet; All options goes back', async () => {
    stubFetch((url) => (url.startsWith('/api/plan') ? fixture : url.startsWith('/api/feedback/routes') ? { routes: [] } : {}))
    render(<ResultsPage />)
    expect(await screen.findAllByRole('button', { name: /Leave/ })).toHaveLength(4)
    expect(screen.queryByRole('button', { name: /Rate it/ })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Start this trip' }))
    expect(screen.getAllByRole('button', { name: /Leave/ })).toHaveLength(1)
    expect(screen.getByTestId('map').getAttribute('data-count')).toBe('1')
    expect(screen.queryByRole('button', { name: 'Start this trip' })).toBeNull()

    // The rate button sits between the trip card and its steps, never over them.
    const rate = screen.getByRole('button', { name: /Ride over\? Rate it/ })
    expect(rate.nextElementSibling?.getAttribute('data-testid')).toBe('option-detail')
    await userEvent.click(screen.getByRole('button', { name: /Ride over\? Rate it/ }))
    const sheet = screen.getByRole('dialog', { name: 'Rate your trip' })
    expect(within(sheet).getByRole('button', { name: 'Send feedback' })).toBeTruthy()
    await userEvent.click(within(sheet).getAllByRole('button', { name: 'Close' })[0])
    expect(screen.queryByRole('dialog')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: '← All options' }))
    expect(screen.getAllByRole('button', { name: /Leave/ })).toHaveLength(4)
    expect(screen.getByTestId('map').getAttribute('data-count')).toBe('4')
  })
})
