// TomTom Map Display API (classic raster). Tiles and caption are fetched by the browser only; never stored.
export function tomtomRasterUrl(key: string): string {
  return `https://api.tomtom.com/map/1/tile/basic/main/{z}/{x}/{y}.png?key=${encodeURIComponent(key)}&tileSize=256`
}

// compact: false keeps the TomTom copyright expanded on small screens (maplibre collapses it by default at <= 640px).
export function attributionOptions(text: string): { customAttribution: string; compact: false } {
  return { customAttribution: text, compact: false }
}

export function tomtomCopyrightUrl(key: string): string {
  return `https://api.tomtom.com/map/2/copyrights/caption.json?key=${encodeURIComponent(key)}`
}
