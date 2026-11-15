import { describe, it, expect, vi, afterEach } from 'vitest'
import { Suspense } from 'react'
import { render, act, screen, within, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import routesFixture from '@/fixtures/routes.json'
import detailFixture from '@/fixtures/route-detail.json'
import RoutesPage from '@/app/routes/page'
import RouteDetailPage from '@/app/routes/[id]/page'
import TabBar from '@/components/TabBar'

let pathname = '/'
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
}))

// jsdom has no WebGL: stand in for the dynamically loaded RouteMap.
vi.mock('next/dynamic', () => ({
  default: () =>
    function RouteMapStub({ selectedStopId }: { selectedStopId: string | null }) {
      return <div data-testid="map" data-selected={selectedStopId ?? ''} />
    },
}))

const json = (body: unknown, status = 200) =>
  Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) })

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('TabBar', () => {
  it('links Plan and Routes and marks the active tab', () => {
    pathname = '/routes/9'
    render(<TabBar />)
    const routes = screen.getByRole('link', { name: 'Routes' })
    const plan = screen.getByRole('link', { name: 'Plan' })
    expect(routes.getAttribute('href')).toBe('/routes')
    expect(plan.getAttribute('href')).toBe('/')
    expect(routes.getAttribute('aria-current')).toBe('page')
    expect(plan.getAttribute('aria-current')).toBeNull()
  })
  it('marks Plan active on the home page', () => {
    pathname = '/'
    render(<TabBar />)
    expect(screen.getByRole('link', { name: 'Plan' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: 'Routes' }).getAttribute('aria-current')).toBeNull()
  })
})

describe('/routes', () => {
  it('shows loading then the three section headers in order', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json(routesFixture)))
    render(<RoutesPage />)
    expect(screen.getByText('Loading routes…')).toBeTruthy()
    await screen.findByText('Bus')
    const heads = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(heads).toEqual(['Bus', 'LRT', 'Regional'])
  })

  it('filters by number or name and hides empty sections', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json(routesFixture)))
    render(<RoutesPage />)
    await screen.findByText('Bus')
    await userEvent.type(screen.getByLabelText('Search routes'), 'val')
    expect(screen.getByText(/Valley Line/)).toBeTruthy()
    expect(screen.queryByText(/Meadowlark/)).toBeNull()
    expect(screen.queryByText('Bus')).toBeNull()
    expect(screen.queryByText('Regional')).toBeNull()
    expect(screen.getByText('LRT')).toBeTruthy()
  })

  it('rows link to the route page', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json(routesFixture)))
    render(<RoutesPage />)
    const row = await screen.findByRole('link', { name: /Meadowlark/ })
    expect(row.getAttribute('href')).toBe('/routes/9')
    expect(row.textContent).toContain('9 · Meadowlark - Capilano')
  })

  it('requests with no-store and the fixture flag', async () => {
    vi.stubEnv('NEXT_PUBLIC_USE_FIXTURE', '1')
    const f = vi.fn(() => json(routesFixture))
    vi.stubGlobal('fetch', f)
    render(<RoutesPage />)
    await screen.findByText('Bus')
    expect(f).toHaveBeenCalledWith('/api/routes?fixture=1', { cache: 'no-store' })
  })

  it('shows an error with Try again', async () => {
    const f = vi.fn().mockImplementationOnce(() => json({}, 500)).mockImplementation(() => json(routesFixture))
    vi.stubGlobal('fetch', f)
    render(<RoutesPage />)
    await screen.findByText("Couldn't load routes. Check your connection and try again.")
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByText('Bus')
  })
})

const params = (id: string) => Promise.resolve({ id })

describe('/routes/[id]', () => {
  async function renderDetail(f: ReturnType<typeof vi.fn>, id = '9') {
    vi.stubGlobal('fetch', f)
    await act(async () => {
      render(<Suspense><RouteDetailPage params={params(id)} /></Suspense>)
    })
    await screen.findByTestId('map')
  }

  it('shows alerts, stops, departures and a headsign switcher', async () => {
    await renderDetail(vi.fn(() => json(detailFixture)))
    expect(screen.getByText('⚠️ Detour on 82 St')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Southgate' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Churchill' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Churchill Station/ })).toBeTruthy()
    expect(screen.getByText('6:12 PM · Live')).toBeTruthy()
    expect(screen.getByText('6:27 PM · Scheduled')).toBeTruthy()
  })

  it('hides the headsign switcher with a single pattern', async () => {
    const one = { ...detailFixture, patterns: [detailFixture.patterns[0]] }
    await renderDetail(vi.fn(() => json(one)))
    expect(screen.queryByRole('button', { name: 'Churchill' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Southgate' })).toBeNull()
  })

  it('tapping a stop refetches with ?stop=', async () => {
    const f = vi.fn(() => json(detailFixture))
    await renderDetail(f)
    await userEvent.click(screen.getByRole('button', { name: /Whyte Ave/ }))
    await waitFor(() =>
      expect(f).toHaveBeenCalledWith('/api/routes/9?stop=1003', { cache: 'no-store' }),
    )
    await waitFor(() => expect(screen.getByTestId('map').getAttribute('data-selected')).toBe('1003'))
  })

  it('shows the empty copy when there are no departures', async () => {
    await renderDetail(vi.fn(() => json({ ...detailFixture, departures: [] })))
    expect(screen.getByText('No more trips today from this stop.')).toBeTruthy()
  })

  it('shows Route not found on 404', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json({ error: 'unknown_route' }, 404)))
    await act(async () => {
      render(<Suspense><RouteDetailPage params={params('nope')} /></Suspense>)
    })
    await screen.findByText('Route not found.')
    const back = screen.getByRole('link', { name: /routes/i })
    expect(back.getAttribute('href')).toBe('/routes')
    expect(within(document.body).queryByTestId('map')).toBeNull()
  })
})
