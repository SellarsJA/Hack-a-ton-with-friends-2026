import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import TomTomCredit from '@/components/TomTomCredit'
import Footer from '@/components/Footer'
import { tomtomCopyrightUrl } from '@/src/tomtom/tiles'

const CAPTION = '© 1992 - 2026 TomTom.'

let getItem: ReturnType<typeof vi.spyOn>
let setItem: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  getItem = vi.spyOn(Storage.prototype, 'getItem')
  setItem = vi.spyOn(Storage.prototype, 'setItem')
})
afterEach(() => {
  cleanup()
  expect(getItem).not.toHaveBeenCalled()
  expect(setItem).not.toHaveBeenCalled()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('TomTomCredit', () => {
  it('fetches the copyright caption in the browser and shows it', async () => {
    vi.stubEnv('NEXT_PUBLIC_TOMTOM_KEY', 'k1')
    const f = vi.fn<(url: string) => Promise<unknown>>(async () => ({ ok: true, json: async () => ({ copyrightsCaption: CAPTION }) }))
    vi.stubGlobal('fetch', f)
    render(<TomTomCredit />)
    expect(await screen.findByText(CAPTION)).toBeTruthy()
    expect(f.mock.calls[0][0]).toBe(tomtomCopyrightUrl('k1'))
  })

  it('falls back to © TomTom when the fetch fails', async () => {
    vi.stubEnv('NEXT_PUBLIC_TOMTOM_KEY', 'k1')
    const f = vi.fn<(url: string) => Promise<unknown>>(async () => {
      throw new Error('net')
    })
    vi.stubGlobal('fetch', f)
    render(<TomTomCredit />)
    await vi.waitFor(() => expect(f).toHaveBeenCalled())
    await Promise.resolve()
    expect(screen.getByText('© TomTom')).toBeTruthy()
  })

  it('falls back to © TomTom on a non-2xx response', async () => {
    vi.stubEnv('NEXT_PUBLIC_TOMTOM_KEY', 'k1')
    const f = vi.fn<(url: string) => Promise<unknown>>(async () => ({ ok: false, json: async () => ({}) }))
    vi.stubGlobal('fetch', f)
    render(<TomTomCredit />)
    await vi.waitFor(() => expect(f).toHaveBeenCalled())
    expect(screen.getByText('© TomTom')).toBeTruthy()
  })

  it('shows © TomTom without fetching when there is no key', () => {
    vi.stubEnv('NEXT_PUBLIC_TOMTOM_KEY', '')
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    render(<TomTomCredit />)
    expect(screen.getByText('© TomTom')).toBeTruthy()
    expect(f).not.toHaveBeenCalled()
  })

  it('aborts the fetch on unmount', () => {
    vi.stubEnv('NEXT_PUBLIC_TOMTOM_KEY', 'k1')
    let signal: AbortSignal | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        signal = init?.signal ?? undefined
        return new Promise(() => {})
      }),
    )
    const { unmount } = render(<TomTomCredit />)
    expect(signal?.aborted).toBe(false)
    unmount()
    expect(signal?.aborted).toBe(true)
  })

  it('is part of the footer on every page', () => {
    vi.stubEnv('NEXT_PUBLIC_TOMTOM_KEY', '')
    const { container } = render(<Footer />)
    expect(container.textContent).toContain('© TomTom')
  })
})
