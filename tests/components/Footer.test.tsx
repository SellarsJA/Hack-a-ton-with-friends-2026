import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import Footer from '@/components/Footer'

afterEach(cleanup)

const TEXT = 'Contains information licensed under the Open Government Licence – City of Edmonton.'
const URL = 'https://data.edmonton.ca/stories/s/City-of-Edmonton-Open-Data-Terms-of-Use/msh8-if28/'

describe('Footer', () => {
  it('shows the exact attribution text', () => {
    const { container } = render(<Footer />)
    expect(container.textContent).toContain(TEXT)
  })

  it('links to the Terms of Use in a new tab, safely', () => {
    render(<Footer />)
    const link = screen.getByRole('link')
    expect(link.getAttribute('href')).toBe(URL)
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('does not imply the City runs the site', () => {
    const { container } = render(<Footer />)
    expect(container.textContent?.toLowerCase()).not.toContain('official')
    expect(container.querySelector('img, svg')).toBeNull()
  })
})
