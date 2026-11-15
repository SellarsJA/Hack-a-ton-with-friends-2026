/** Green A / red B pin with the place's name beside it. Shared by the home map and the trip map. */
export function placeTag(text: string, role: 'start' | 'destination'): HTMLElement {
  const el = document.createElement('div')
  el.dataset.role = role
  el.setAttribute('aria-label', `${role}: ${text}`)
  el.style.cssText = 'display:flex;align-items:center;gap:4px;pointer-events:none;max-width:170px'
  const dot = document.createElement('span')
  dot.textContent = role === 'start' ? 'A' : 'B'
  const fill = role === 'start' ? '#15803D' : '#B91C1C'
  dot.style.cssText = `flex:none;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:9999px;background:${fill};color:#fff;font:700 11px system-ui,sans-serif;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)`
  const name = document.createElement('span')
  name.textContent = text
  name.style.cssText =
    'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:rgba(255,255,255,.95);color:#111827;border-radius:6px;padding:2px 6px;font:600 11px system-ui,sans-serif;box-shadow:0 1px 3px rgba(0,0,0,.25)'
  el.append(dot, name)
  return el
}
