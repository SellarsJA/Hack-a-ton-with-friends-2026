import { describe, it, expect } from 'vitest'
import { tomtomRasterUrl, tomtomCopyrightUrl } from '@/src/tomtom/tiles'

describe('tomtom urls', () => {
  it('builds the raster tile template', () => {
    expect(tomtomRasterUrl('abc')).toBe(
      'https://api.tomtom.com/map/1/tile/basic/main/{z}/{x}/{y}.png?key=abc&tileSize=256',
    )
  })
  it('builds the copyright caption url', () => {
    expect(tomtomCopyrightUrl('abc')).toBe('https://api.tomtom.com/map/2/copyrights/caption.json?key=abc')
  })
  it('encodes the key', () => {
    expect(tomtomRasterUrl('a&b')).toContain('key=a%26b')
  })
})
