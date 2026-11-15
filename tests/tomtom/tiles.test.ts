import { describe, it, expect } from 'vitest'
import { tomtomRasterUrl, tomtomCopyrightUrl, tomtomTrafficFlowUrl, attributionOptions } from '@/src/tomtom/tiles'

describe('tomtom urls', () => {
  it('builds the raster tile template', () => {
    expect(tomtomRasterUrl('abc')).toBe(
      'https://api.tomtom.com/map/1/tile/basic/main/{z}/{x}/{y}.png?key=abc&tileSize=256',
    )
  })
  it('builds the copyright caption url', () => {
    expect(tomtomCopyrightUrl('abc')).toBe('https://api.tomtom.com/map/2/copyrights/caption.json?key=abc')
  })
  it('keeps attribution non-compact', () => {
    expect(attributionOptions('© TomTom')).toEqual({ customAttribution: '© TomTom', compact: false })
  })
  it('builds the traffic flow tile template', () => {
    expect(tomtomTrafficFlowUrl('a&b')).toBe(
      'https://api.tomtom.com/traffic/map/4/tile/flow/relative0/{z}/{x}/{y}.png?key=a%26b&tileSize=256&thickness=8',
    )
  })
  it('encodes the key', () => {
    expect(tomtomRasterUrl('a&b')).toContain('key=a%26b')
  })
})
