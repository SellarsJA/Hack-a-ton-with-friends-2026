import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import fixture from '@/fixtures/plan.json'
import liveFixture from '@/fixtures/live.json'
import { PlanResponse } from '@/src/contract/schema'
import TransferBadge from '@/components/TransferBadge'
import OptionList from '@/components/OptionList'
import ResultsPage from '@/app/results/page'

vi.mock('next/navigation', () => ({
  useSearchParams: () =>
    new URLSearchParams('from=53.5,-113.5&to=53.4,-113.4&fromLabel=Churchill&toLabel=Southgate'),
}))
vi.mock('next/dynamic', () => ({
  default: () =>
    function TripMapStub({ vehicles = [] }: { vehicles?: { label: string }[] }) {
      return <div data-testid="map" data-vehicles={vehicles.map((v) => v.label).join(',')} />
    },
}))

const plan = PlanResponse.parse(fixture)
const base = { stop: 'Whyte Ave & 104 St', fallbackDepartAt: null }

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('TransferBadge', () => {
  it('on track', () => {
    render(
      <TransferBadge transfer={{ ...base, spareMinutes: 5, status: 'on_track', basedOn: 'live' }} trainSide={false} />,
    )
    expect(screen.getByText('On track · 5 min to transfer')).toBeTruthy()
  })
  it('tight, scheduled', () => {
    render(
      <TransferBadge transfer={{ ...base, spareMinutes: 2, status: 'tight', basedOn: 'scheduled' }} trainSide={false} />,
    )
    expect(screen.getByText('Tight · 2 min to transfer (scheduled)')).toBeTruthy()
  })
  it('at risk shows the next departure', () => {
    render(
      <TransferBadge
        transfer={{
          ...base,
          spareMinutes: -2,
          status: 'at_risk',
          basedOn: 'live',
          fallbackDepartAt: '2026-11-14T18:27:00-07:00',
        }}
        trainSide={false}
      />,
    )
    expect(screen.getByText('At risk · next one 6:27 PM')).toBeTruthy()
  })
  it('shows the train note when train side', () => {
    render(<TransferBadge transfer={{ ...base, spareMinutes: 5, status: 'on_track', basedOn: 'scheduled' }} trainSide />)
    expect(screen.getByText('Train side uses the schedule')).toBeTruthy()
  })
  it('no train note otherwise', () => {
    render(
      <TransferBadge transfer={{ ...base, spareMinutes: 5, status: 'on_track', basedOn: 'live' }} trainSide={false} />,
    )
    expect(screen.queryByText('Train side uses the schedule')).toBeNull()
  })
})

describe('OptionList transfer and expired', () => {
  it('shows the transfer badge with the train note on the rail transfer card', () => {
    render(<OptionList options={plan.options} selectedId={plan.options[3].id} onSelect={() => {}} />)
    expect(screen.getByText('Tight · 3 min to transfer (scheduled)')).toBeTruthy()
    expect(screen.getByText('Train side uses the schedule')).toBeTruthy()
  })

  it('expired selected option shows copy and a working Search again button', async () => {
    const onSearchAgain = vi.fn()
    render(
      <OptionList options={plan.options} selectedId="opt-1" onSelect={() => {}} expired onSearchAgain={onSearchAgain} />,
    )
    expect(screen.getByText('This option has left. Search again.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Search again' }))
    expect(onSearchAgain).toHaveBeenCalledTimes(1)
  })
})

describe('results page live polling', () => {
  it('polls the selected option, shows expired, and Search again refetches the plan', async () => {
    const f = vi.fn((url: unknown) => {
      const body = String(url).startsWith('/api/live') ? liveFixture : fixture
      return Promise.resolve({ ok: true, json: () => Promise.resolve(body) })
    })
    vi.stubGlobal('fetch', f)
    render(<ResultsPage />)
    expect(await screen.findByText('This option has left. Search again.')).toBeTruthy()
    const liveCalls = f.mock.calls.filter((c) => String(c[0]).startsWith('/api/live'))
    expect(liveCalls[0][0]).toBe('/api/live?keys=k-opt-1')
    await userEvent.click(screen.getByRole('button', { name: 'Search again' }))
    await waitFor(() => expect(f.mock.calls.filter((c) => String(c[0]).startsWith('/api/plan'))).toHaveLength(2))
  })
})

describe('results page live state', () => {
  const isLive = (url: unknown) => String(url).startsWith('/api/live')
  const ok = (body: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) })
  const flush = async () => {
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
    }
  }
  const poll = async (n: number) => {
    for (let i = 0; i < n; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000)
      })
    }
  }
  // Live response for opt-1 that the server still calls not expired.
  const liveNotExpired = { ...liveFixture, options: liveFixture.options.map((o) => ({ ...o, expired: false })) }

  it('shows the stale banner after failed polls age the last good response past 120 s', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-14T18:05:00-07:00') })
    let liveCalls = 0
    vi.stubGlobal('fetch', vi.fn((url: unknown) => {
      if (!isLive(url)) return ok(fixture)
      return liveCalls++ === 0 ? ok({ ...liveNotExpired, liveDataAgeSeconds: 25 }) : Promise.reject(new Error('net'))
    }))
    render(<ResultsPage />)
    await flush()
    expect(liveCalls).toBe(1)
    expect(screen.queryByRole('status')).toBeNull()
    await poll(4)
    expect(liveCalls).toBe(5)
    expect(screen.getByRole('status').textContent).toBe('Live data is 2 min old.')
  })

  it('marks the selected option expired once its first departure passes, with no new server response', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-14T18:05:00-07:00') })
    let liveCalls = 0
    vi.stubGlobal('fetch', vi.fn((url: unknown) => {
      if (!isLive(url)) return ok(fixture)
      return liveCalls++ === 0 ? ok(liveNotExpired) : Promise.reject(new Error('net'))
    }))
    render(<ResultsPage />)
    await flush()
    expect(liveCalls).toBe(1)
    expect(screen.queryByText('This option has left. Search again.')).toBeNull()
    // opt-1 leaves at 18:12; poll on (all failing) until 18:13.
    await poll(16)
    expect(screen.getByText('This option has left. Search again.')).toBeTruthy()
  })

  it('keeps the last live vehicles on the map while a new selection loads', async () => {
    const liveBody = { ...liveFixture, vehicles: [{ ...liveFixture.vehicles[0], label: 'LIVE1' }] }
    vi.stubGlobal('fetch', vi.fn((url: unknown) => {
      if (!isLive(url)) return ok(fixture)
      return String(url).includes('k-opt-1') ? ok(liveBody) : new Promise(() => {})
    }))
    render(<ResultsPage />)
    await waitFor(() => expect(screen.getByTestId('map').getAttribute('data-vehicles')).toBe('LIVE1'))
    await userEvent.click(screen.getAllByRole('button', { name: /Leave/ })[1])
    expect(screen.getAllByRole('button', { name: /Leave/ })[1].getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('map').getAttribute('data-vehicles')).toBe('LIVE1')
  })
})
