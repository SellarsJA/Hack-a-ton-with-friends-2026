import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
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
    function TripMapStub() {
      return <div data-testid="map" />
    },
}))

const plan = PlanResponse.parse(fixture)
const base = { stop: 'Whyte Ave & 104 St', fallbackDepartAt: null }

afterEach(() => {
  cleanup()
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
