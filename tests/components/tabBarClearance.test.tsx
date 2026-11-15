import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ResultsPage from '@/app/results/page'

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('from=53.5,-113.5&to=53.4,-113.4'),
}))
vi.mock('next/dynamic', () => ({ default: () => () => null }))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('fixed tab bar clearance', () => {
  it('the results screen is shorter than the viewport by the bar and the safe area', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    const { container } = render(<ResultsPage />)
    const cls = (container.firstElementChild as HTMLElement).className
    expect(cls).toContain('h-[calc(100dvh-3rem-env(safe-area-inset-bottom))]')
    expect(cls).not.toContain('h-dvh')
  })

  it('the layout body keeps its bottom padding and the viewport covers the safe area', () => {
    const src = readFileSync(join(process.cwd(), 'app/layout.tsx'), 'utf8')
    expect(src).toContain('pb-[calc(3rem+env(safe-area-inset-bottom))]')
    expect(src).toMatch(/viewportFit:\s*["']cover["']/)
  })
})
