import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import fixture from '@/fixtures/plan.json'
import { PlanResponse } from '@/src/contract/schema'
import OptionList from '@/components/OptionList'
import OptionDetail from '@/components/OptionDetail'
import LiveBanner from '@/components/LiveBanner'
import ResultsPage from '@/app/results/page'

let search = ''
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(search),
}))

// jsdom has no WebGL: stand in for the dynamically loaded TripMap with a placeholder.
vi.mock('next/dynamic', () => ({
  default: () =>
    function TripMapStub({ showWalking }: { showWalking: boolean }) {
      return <div data-testid="map" data-show-walking={String(showWalking)} />
    },
}))

const plan = PlanResponse.parse(fixture)

function Harness() {
  const [id, setId] = useState(plan.options[0].id)
  return <OptionList options={plan.options} selectedId={id} onSelect={setId} />
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('OptionList', () => {
  it('renders 4 cards in order with badges', () => {
    render(<Harness />)
    const cards = screen.getAllByRole('button', { name: /Leave/ })
    expect(cards).toHaveLength(4)
    expect(within(cards[0]).getByText('Leave 6:07 PM · 34 min · $3.00')).toBeTruthy()
    expect(within(cards[0]).getByText('Cash $3.75')).toBeTruthy()
    expect(within(cards[0]).getByText('Live')).toBeTruthy()
    expect(within(cards[1]).getByText('Scheduled')).toBeTruthy()
    expect(within(cards[2]).getByText(/Full/)).toBeTruthy()
    expect(within(cards[2]).getByText(/⚠️/)).toBeTruthy()
  })

  it('tapping card 2 selects it and shows its steps', async () => {
    render(<Harness />)
    const cards = screen.getAllByRole('button', { name: /Leave/ })
    expect(cards[0].getAttribute('aria-pressed')).toBe('true')
    await userEvent.click(cards[1])
    expect(cards[1].getAttribute('aria-pressed')).toBe('true')
    expect(cards[0].getAttribute('aria-pressed')).toBe('false')
    const detail = screen.getByTestId('option-detail')
    expect(within(detail).getAllByText(/^Walk \d+ min$/).length).toBeGreaterThan(0)
    expect(within(detail).getAllByText(/^(Bus|Train) \S+ to /).length).toBeGreaterThan(0)
    expect(within(detail).getAllByText(/^From /).length).toBeGreaterThan(0)
    expect(within(detail).getAllByText(/^To /).length).toBeGreaterThan(0)
  })

  it("renders the selected card's steps inside its own list item, directly under the card", async () => {
    render(<Harness />)
    const cards = screen.getAllByRole('button', { name: /Leave/ })
    await userEvent.click(cards[1])
    const items = screen.getAllByRole('listitem').filter((li) => li.parentElement?.tagName === 'UL')
    expect(items).toHaveLength(4)
    expect(screen.getAllByTestId('option-detail')).toHaveLength(1)
    const detail = within(items[1]).getByTestId('option-detail')
    expect(detail.previousElementSibling).toBe(cards[1])
    expect(within(items[0]).queryByTestId('option-detail')).toBeNull()
    expect(within(items[2]).queryByTestId('option-detail')).toBeNull()
  })

  it('appends (estimated) when the fare is estimated', () => {
    const o = { ...plan.options[0], fare: { ...plan.options[0].fare, estimated: true, cashAmount: null } }
    render(<OptionList options={[o]} selectedId={o.id} onSelect={() => {}} />)
    expect(screen.getByText('Leave 6:07 PM · 34 min · $3.00 (estimated)')).toBeTruthy()
    expect(screen.queryByText(/Cash/)).toBeNull()
  })
})

describe('OptionDetail', () => {
  it('labels vehicles Train for rail and Bus for bus', () => {
    const base = plan.options[0].legs.find((l) => l.mode !== 'walk')!
    const rail = { ...plan.options[0], legs: [{ ...base, mode: 'rail' as const, vehicleLabel: '1012' }] }
    const { unmount } = render(<OptionDetail option={rail} />)
    expect(screen.getByText('Train 1012')).toBeTruthy()
    unmount()
    const bus = { ...rail, legs: [{ ...base, mode: 'bus' as const, vehicleLabel: '4393' }] }
    render(<OptionDetail option={bus} />)
    expect(screen.getByText('Bus 4393')).toBeTruthy()
  })
})

describe('LiveBanner', () => {
  it('shows unavailable when null', () => {
    render(<LiveBanner ageSeconds={null} />)
    expect(screen.getByText('Live data unavailable. Showing scheduled times.')).toBeTruthy()
  })
  it('shows age when over 120 s', () => {
    render(<LiveBanner ageSeconds={300} />)
    expect(screen.getByText('Live data is 5 min old.')).toBeTruthy()
  })
  it('is silent when fresh', () => {
    const { container } = render(<LiveBanner ageSeconds={30} />)
    expect(container.textContent).toBe('')
  })
})

function mockFetch(impl: () => Promise<unknown>) {
  const f = vi.fn((..._args: unknown[]) => impl())
  vi.stubGlobal('fetch', f)
  return f
}
const ok = (body: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) })

describe('results page', () => {
  beforeEach(() => {
    search = 'from=53.5,-113.5&to=53.4,-113.4&fromLabel=Churchill&toLabel=Southgate'
  })

  it('fetches, shows header, cards, map placeholder and walking toggle', async () => {
    const f = mockFetch(() => ok(fixture))
    render(<ResultsPage />)
    expect(screen.getByText('Finding trips…')).toBeTruthy()
    expect((await screen.findAllByRole('button', { name: /Leave/ })).length).toBe(4)
    const heading = screen.getByRole('heading', { name: /Churchill/ })
    expect(heading.textContent).toContain('Churchill')
    expect(heading.textContent).toContain('Southgate')
    const url = f.mock.calls[0][0] as string
    expect(url).toContain('/api/plan?from=53.5%2C-113.5&to=53.4%2C-113.4')
    expect(url).not.toContain('fixture')
    expect((f.mock.calls[0][1] as RequestInit).cache).toBe('no-store')
    const map = screen.getByTestId('map')
    expect(map.getAttribute('data-show-walking')).toBe('true')
    await userEvent.click(screen.getByLabelText('Show walking'))
    expect(map.getAttribute('data-show-walking')).toBe('false')
    // the first option is selected and its steps sit inside its card's list item
    const firstCard = screen.getAllByRole('button', { name: /Leave/ })[0]
    expect(firstCard.closest('li')!.querySelector('[data-testid="option-detail"]')).not.toBeNull()
    expect(screen.getAllByTestId('option-detail')).toHaveLength(1)
  })

  it('keeps a long start from hiding the destination', async () => {
    search =
      'from=53.5,-113.5&to=53.4,-113.4&fromLabel=Churchill+Square+At+100+St+%26+102+Ave&toLabel=Southgate+Station'
    mockFetch(() => ok(fixture))
    render(<ResultsPage />)
    const heading = await screen.findByRole('heading', { name: /Southgate Station/ })
    expect(heading.textContent).toContain('Churchill Square At 100 St & 102 Ave')
    expect(heading.textContent).toContain('→ Southgate Station')
  })

  it('adds fixture=1 from env', async () => {
    vi.stubEnv('NEXT_PUBLIC_USE_FIXTURE', '1')
    const f = mockFetch(() => ok(fixture))
    render(<ResultsPage />)
    await screen.findAllByRole('button', { name: /Leave/ })
    expect(f.mock.calls[0][0]).toContain('&fixture=1')
  })

  it('shows empty reason message', async () => {
    mockFetch(() => ok({ ...fixture, options: [], emptyReason: 'no_trips_soon' }))
    render(<ResultsPage />)
    expect(await screen.findByText('No direct trips in the next 90 minutes.')).toBeTruthy()
  })

  it('shows unavailable banner when live age is null', async () => {
    mockFetch(() => ok({ ...fixture, liveDataAgeSeconds: null }))
    render(<ResultsPage />)
    expect(await screen.findByText('Live data unavailable. Showing scheduled times.')).toBeTruthy()
  })

  it('shows error and retries', async () => {
    const f = vi.fn((..._args: unknown[]) => ok(fixture)).mockRejectedValueOnce(new Error("net"))
    vi.stubGlobal('fetch', f)
    render(<ResultsPage />)
    expect(
      await screen.findByText("Couldn't load trip options. Check your connection and try again."),
    ).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Leave/ })).toHaveLength(4))
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('treats non-2xx and invalid bodies as errors', async () => {
    mockFetch(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }))
    const { unmount } = render(<ResultsPage />)
    expect(await screen.findByText(/Couldn't load trip options/)).toBeTruthy()
    unmount()
    mockFetch(() => ok({ nope: 1 }))
    render(<ResultsPage />)
    expect(await screen.findByText(/Couldn't load trip options/)).toBeTruthy()
  })

  it('handles missing params', () => {
    search = 'from=abc'
    const f = mockFetch(() => ok(fixture))
    render(<ResultsPage />)
    expect(screen.getByText('Missing start or destination.')).toBeTruthy()
    expect(f).not.toHaveBeenCalled()
  })

  it('rejects out-of-range coordinates without fetching', () => {
    search = 'from=999,999&to=53.4,-113.4'
    const f = mockFetch(() => ok(fixture))
    render(<ResultsPage />)
    expect(screen.getByText('Missing start or destination.')).toBeTruthy()
    expect(f).not.toHaveBeenCalled()
  })
})
