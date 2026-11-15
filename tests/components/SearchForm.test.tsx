import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, cleanup, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach } from 'vitest'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('@/src/tomtom/suggest', () => ({ suggestAddresses: vi.fn() }))

import { suggestAddresses } from '@/src/tomtom/suggest'
import type { Place } from '@/src/tomtom/place'
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
    // A stop named "... Stop" is a Valley Line station: it gets the Station tag, addresses get Address.
    expect(opts[0].textContent).toContain('Station')
    expect(opts[1].textContent).toContain('Address')
    expect(opts[1].textContent).toContain('Church Rd')
  })

  it('geolocation error clears the start and shows the denied message', async () => {
    geo((_ok, err) => err({ code: 1 } as GeolocationPositionError))
    render(<SearchForm />)
    expect(await screen.findByText('Location unavailable. Type a start.')).toBeTruthy()
    expect(input('Start').value).toBe('')
  })

  it('asks for a position with a 10 s timeout and 60 s maximum age', () => {
    const spy = vi.fn()
    geo(spy)
    render(<SearchForm />)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][2]).toEqual({ timeout: 10000, maximumAge: 60000 })
  })

  it('a geolocation timeout follows the denied path', async () => {
    geo((_ok, err) => err({ code: 3, TIMEOUT: 3 } as GeolocationPositionError))
    render(<SearchForm />)
    expect(await screen.findByText('Location unavailable. Type a start.')).toBeTruthy()
    expect(input('Start').value).toBe('')
    expect(screen.queryByText('Locating…')).toBeNull()
  })

  it('without geolocation support, shows the denied message from the first render', () => {
    Object.defineProperty(globalThis.navigator, 'geolocation', { configurable: true, value: undefined })
    render(<SearchForm />)
    expect(screen.getByText('Location unavailable. Type a start.')).toBeTruthy()
    expect(input('Start').value).toBe('')
  })

  it('closes the suggestion list on blur and drops aria-controls while closed', async () => {
    located()
    const user = userEvent.setup()
    render(<SearchForm />)
    await user.click(input('Start'))
    await user.type(input('Start'), 'chur')
    await waitFor(() => expect(screen.getByRole('listbox')).toBeTruthy())
    expect(input('Start').getAttribute('aria-controls')).toBe(screen.getByRole('listbox').id)
    await user.click(document.body)
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(input('Start').getAttribute('aria-expanded')).toBe('false')
    expect(input('Start').hasAttribute('aria-controls')).toBe(false)
  })

  it('a click on a suggestion still selects it (no blur-close race)', async () => {
    located()
    const user = userEvent.setup()
    render(<SearchForm />)
    await user.type(input('Destination'), 'chur')
    await user.click(await screen.findByRole('option', { name: /Church Rd/ }))
    expect(input('Destination').value).toBe('Church Rd')
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

  it('ignores a late geolocation fix after the rider picked a start', async () => {
    let ok: PositionCallback = () => {}
    geo((cb) => {
      ok = cb
    })
    const user = userEvent.setup()
    render(<SearchForm />)
    await user.type(input('Start'), 'chur')
    await user.click(await screen.findByRole('option', { name: /Church Stop/ }))
    await user.type(input('Destination'), 'chur')
    await user.click(await screen.findByRole('option', { name: /Church Rd/ }))
    act(() => ok({ coords: { latitude: 1, longitude: 2 } } as GeolocationPosition))
    expect(input('Start').value).toBe('Church Stop')
    await user.click(button())
    const url = new URL(push.mock.calls[0][0], 'http://x')
    expect(url.searchParams.get('from')).toBe('53.7,-113.3')
    expect(url.searchParams.get('fromLabel')).toBe('Church Stop')
  })

  it('typing in the start field replaces "Your location" while locating', async () => {
    geo(() => {})
    const user = userEvent.setup()
    render(<SearchForm />)
    await user.type(input('Start'), 'x')
    expect(input('Start').value).toBe('x')
  })

  it('typing in the start field replaces "Your location" once located', async () => {
    located()
    const user = userEvent.setup()
    render(<SearchForm />)
    await waitFor(() => expect(screen.queryByText('Locating…')).toBeNull())
    await user.type(input('Start'), 'x')
    expect(input('Start').value).toBe('x')
  })

  it('waits the full 300 ms before asking TomTom', async () => {
    located()
    vi.useFakeTimers()
    try {
      render(<SearchForm />)
      fireEvent.change(input('Destination'), { target: { value: 'chur' } })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(299)
      })
      expect(suggest).not.toHaveBeenCalled()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1)
      })
      expect(suggest).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a stale response arriving after a newer query does not replace newer results', async () => {
    located()
    let resolveStale: (p: Place[]) => void = () => {}
    suggest.mockReset()
    suggest
      .mockImplementationOnce(() => new Promise<Place[]>((r) => (resolveStale = r)))
      .mockResolvedValueOnce([{ kind: 'address', label: 'Fresh Rd', lat: 1, lon: 1 }])
    const user = userEvent.setup()
    render(<SearchForm />)
    await user.type(input('Destination'), 'chur')
    await waitFor(() => expect(suggest).toHaveBeenCalledTimes(1))
    await user.type(input('Destination'), 'c')
    await waitFor(() => expect(screen.getByRole('option', { name: /Fresh Rd/ })).toBeTruthy())
    await act(async () => {
      resolveStale([{ kind: 'address', label: 'Stale Rd', lat: 2, lon: 2 }])
    })
    expect(screen.queryByRole('option', { name: /Stale Rd/ })).toBeNull()
    expect(screen.getByRole('option', { name: /Fresh Rd/ })).toBeTruthy()
  })
})
