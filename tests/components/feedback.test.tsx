import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import fixture from '@/fixtures/plan.json'
import { PlanResponse, type RideLink } from '@/src/contract/schema'
import OnBoardButton from '@/components/OnBoardButton'
import FeedbackForm from '@/components/FeedbackForm'
import VehicleSummary, { __resetVehicleSummaryCacheForTests } from '@/components/VehicleSummary'
import vehicleFixture from '@/fixtures/vehicle-summary.json'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const option = PlanResponse.parse(fixture).options[0]
const idx = option.legs.findIndex((l) => l.mode !== 'walk')
const leg = option.legs[idx]
const dep = Date.parse(leg.mode === 'walk' ? '' : leg.departAt)
const arr = Date.parse(leg.mode === 'walk' ? '' : leg.arriveAt)

const ride: RideLink = {
  rideKey: 'none:t1:2026-11-14',
  vehicleLabel: null,
  routeId: '9',
  routeShortName: '9',
  tripId: 't1',
  serviceDate: '2026-11-14',
  departAt: '2026-11-14T08:00:00-07:00',
  arriveAt: '2026-11-14T08:30:00-07:00',
  showed: { crowding: false, transfer: false, alerts: false },
}
const bus: RideLink = { ...ride, rideKey: '4393:t1:2026-11-14', vehicleLabel: '4393' }

describe('OnBoardButton', () => {
  it('shows 1 minute before departure', () => {
    render(<OnBoardButton option={option} legIndex={idx} now={dep - 60_000} />)
    expect(screen.getByRole('link').getAttribute('href')).toMatch(/^\/ride\?r=/)
  })
  it('hidden 11 minutes after arrival', () => {
    render(<OnBoardButton option={option} legIndex={idx} now={arr + 11 * 60_000} />)
    expect(screen.queryByRole('link')).toBeNull()
  })
  it('hidden without now', () => {
    render(<OnBoardButton option={option} legIndex={idx} now={0} />)
    expect(screen.queryByRole('link')).toBeNull()
  })
})

describe('FeedbackForm', () => {
  it('asks about the ride, with stars, when there is no fleet number', () => {
    render(<FeedbackForm ride={ride} />)
    expect(screen.queryByText('How was this bus?')).toBeNull()
    expect(screen.getByText('How was this ride?')).toBeTruthy()
    expect(screen.getByRole('radio', { name: '4 stars' })).toBeTruthy()
    expect(screen.getByText('Route 9 · this ride')).toBeTruthy()
  })
  it('shows stars with a label', () => {
    render(<FeedbackForm ride={bus} />)
    expect(screen.getByText('Route 9 · Bus 4393')).toBeTruthy()
    expect(screen.getByRole('radio', { name: '4 stars' })).toBeTruthy()
  })
  it('hides Crowding when not shown, shows when shown', () => {
    render(<FeedbackForm ride={ride} />)
    expect(screen.queryByText('Crowding')).toBeNull()
    cleanup()
    render(<FeedbackForm ride={{ ...ride, showed: { ...ride.showed, crowding: true } }} />)
    expect(screen.getByText('Crowding')).toBeTruthy()
  })
  it('POSTs only the moved slider', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', f)
    render(<FeedbackForm ride={ride} />)
    fireEvent.change(screen.getByLabelText('Departure and arrival times'), { target: { value: '4' } })
    await userEvent.click(screen.getByRole('button', { name: 'Send feedback' }))
    await waitFor(() => expect(f).toHaveBeenCalled())
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('/api/feedback')
    expect(init.credentials).toBe('same-origin')
    expect(JSON.parse(init.body)).toEqual({
      rideKey: ride.rideKey,
      vehicleLabel: null,
      routeId: '9',
      tripId: 't1',
      serviceDate: '2026-11-14',
      accuracy: { time: 4 },
    })
    expect(await screen.findByText(/Thanks! Your feedback is saved/)).toBeTruthy()
  })
  it('whitespace note is not an answer', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    render(<FeedbackForm ride={ride} />)
    await userEvent.type(screen.getByLabelText(/Anything else/), '   ')
    await userEvent.click(screen.getByRole('button', { name: 'Send feedback' }))
    expect(screen.getByText('Add at least one answer.')).toBeTruthy()
    expect(f).not.toHaveBeenCalled()
  })
  it('Clear resets a slider', async () => {
    render(<FeedbackForm ride={ride} />)
    fireEvent.change(screen.getByLabelText('Bus position on the map'), { target: { value: '2' } })
    await userEvent.click(screen.getByRole('button', { name: 'Clear Bus position on the map' }))
    expect(screen.getAllByText('Not rated').length).toBe(2)
  })
  it('exposes Not rated as aria-valuetext', () => {
    render(<FeedbackForm ride={ride} />)
    expect(screen.getByLabelText('Departure and arrival times').getAttribute('aria-valuetext')).toBe('Not rated')
  })
  it('pointer-up on an untouched slider records 3', () => {
    render(<FeedbackForm ride={ride} />)
    const input = screen.getByLabelText('Departure and arrival times')
    fireEvent.pointerUp(input)
    expect(input.getAttribute('aria-valuetext')).toBe('3 of 5')
  })
  it('shows 400 and network errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'invalid' }) }))
    render(<FeedbackForm ride={ride} />)
    await userEvent.click(screen.getByRole('radio', { name: 'Safety' }))
    await userEvent.click(screen.getByRole('button', { name: 'Send feedback' }))
    expect(await screen.findByText(/Something's not right/)).toBeTruthy()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('x')))
    await userEvent.click(screen.getByRole('button', { name: 'Send feedback' }))
    expect(await screen.findByText(/Couldn't send/)).toBeTruthy()
  })
  it('shows the generic save error for 500 and 400 no_profile', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'server_error' }) }))
    render(<FeedbackForm ride={ride} />)
    await userEvent.click(screen.getByRole('radio', { name: 'Safety' }))
    await userEvent.click(screen.getByRole('button', { name: 'Send feedback' }))
    expect(await screen.findByText("Couldn't save your feedback. Please try again in a moment.")).toBeTruthy()
    expect(screen.queryByText(/Something's not right/)).toBeNull()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'no_profile' }) }))
    await userEvent.click(screen.getByRole('button', { name: 'Send feedback' }))
    await waitFor(() => expect(screen.queryByText(/Something's not right/)).toBeNull())
    expect(screen.getByText(/Couldn't save your feedback/)).toBeTruthy()
  })
  it('refetches the vehicle summary after a successful submit', async () => {
    const summary = { ...vehicleFixture, label: '4012' }
    const f = vi.fn((url: string) =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(url === '/api/feedback' ? { ok: true } : summary) }),
    )
    vi.stubGlobal('fetch', f)
    __resetVehicleSummaryCacheForTests()
    const r = { ...ride, vehicleLabel: '4012' }
    const first = render(<VehicleSummary label="4012" />)
    await waitFor(() => expect(f).toHaveBeenCalledTimes(1))
    first.unmount()
    render(<FeedbackForm ride={r} />)
    await userEvent.click(screen.getByRole('radio', { name: 'Safety' }))
    await userEvent.click(screen.getByRole('button', { name: 'Send feedback' }))
    await screen.findByText(/Thanks!/)
    render(<VehicleSummary label="4012" />)
    await waitFor(() => expect(f.mock.calls.filter((c) => String(c[0]).startsWith('/api/vehicles/'))).toHaveLength(2))
  })
})
