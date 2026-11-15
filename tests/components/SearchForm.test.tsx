import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach } from 'vitest'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('@/src/tomtom/suggest', () => ({ suggestAddresses: vi.fn() }))

import { suggestAddresses } from '@/src/tomtom/suggest'
import SearchForm from '@/components/SearchForm'

const suggest = vi.mocked(suggestAddresses)

function geo(impl: (ok: PositionCallback, err: PositionErrorCallback) => void) {
  Object.defineProperty(globalThis.navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: impl },
  })
}
const located = () =>
  geo((ok) => ok({ coords: { latitude: 53.55, longitude: -113.5 } } as GeolocationPosition))

const input = (name: string) => screen.getByLabelText(name) as HTMLInputElement
const button = () => screen.getByRole('button', { name: 'See options' }) as HTMLButtonElement

afterEach(cleanup)

beforeEach(() => {
  push.mockReset()
  suggest.mockReset()
  suggest.mockResolvedValue([{ kind: 'address', label: 'Church Rd', lat: 53.6, lon: -113.4 }])
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        stops: [{ stopId: '1', name: 'Church Stop', lat: 53.7, lon: -113.3 }],
        routes: [{ routeId: 'r', shortName: '9', longName: 'Nine' }],
      }),
    }),
  )
})

describe('SearchForm', () => {
  it('debounces: 4 quick keystrokes call suggestAddresses once', async () => {
    located()
    const user = userEvent.setup()
    render(<SearchForm />)
    await user.type(input('Destination'), 'chur')
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2))
    expect(suggest).toHaveBeenCalledTimes(1)
    expect(suggest.mock.calls[0][0]).toBe('chur')
  })

  it('does not call TomTom under 3 characters', async () => {
    located()
    const user = userEvent.setup()
    render(<SearchForm />)
    await user.type(input('Destination'), 'ch')
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1))
    expect(suggest).not.toHaveBeenCalled()
  })

  it('renders stops above addresses and no route options', async () => {
    located()
    const user = userEvent.setup()
    render(<SearchForm />)
    await user.type(input('Destination'), 'chur')
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2))
    const opts = screen.getAllByRole('option')
    expect(opts[0].textContent).toContain('Church Stop')
    expect(opts[1].textContent).toContain('Church Rd')
  })

  it('geolocation error clears the start and shows the denied message', async () => {
    geo((_ok, err) => err({ code: 1 } as GeolocationPositionError))
    render(<SearchForm />)
    expect(await screen.findByText('Location unavailable. Type a start.')).toBeTruthy()
    expect(input('Start').value).toBe('')
  })

  it('shows Your location and Locating hint while pending', () => {
    geo(() => {})
    render(<SearchForm />)
    expect(input('Start').value).toBe('Your location')
    expect(screen.getByText('Locating…')).toBeTruthy()
    expect(button().disabled).toBe(true)
  })

  it('navigates with the right query after choosing both places', async () => {
    located()
    const user = userEvent.setup()
    render(<SearchForm />)
    await waitFor(() => expect(screen.queryByText('Locating…')).toBeNull())
    expect(button().disabled).toBe(true)
    await user.type(input('Destination'), 'chur')
    await user.click(await screen.findByRole('option', { name: /Church Stop/ }))
    expect(button().disabled).toBe(false)
    await user.click(button())
    const url = new URL(push.mock.calls[0][0], 'http://x')
    expect(url.pathname).toBe('/results')
    expect(url.searchParams.get('from')).toBe('53.55,-113.5')
    expect(url.searchParams.get('to')).toBe('53.7,-113.3')
    expect(url.searchParams.get('fromLabel')).toBe('Your location')
    expect(url.searchParams.get('toLabel')).toBe('Church Stop')
  })

  it('selects with the keyboard (Enter)', async () => {
    located()
    const user = userEvent.setup()
    render(<SearchForm />)
    await user.type(input('Destination'), 'chur')
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2))
    await user.keyboard('{ArrowDown}{Enter}')
    expect(input('Destination').value).toBe('Church Stop')
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})
