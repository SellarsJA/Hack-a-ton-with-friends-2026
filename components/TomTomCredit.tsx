'use client'

import { useEffect, useState } from 'react'
import { tomtomCopyrightUrl } from '@/src/tomtom/tiles'

const FALLBACK = '© TomTom'

/** TomTom copyright for address search, shown in the footer. Fetched by the browser, never stored. */
export default function TomTomCredit() {
  const key = process.env.NEXT_PUBLIC_TOMTOM_KEY
  const [caption, setCaption] = useState<string | null>(null)

  useEffect(() => {
    if (!key) return
    const ctrl = new AbortController()
    fetch(tomtomCopyrightUrl(key), { signal: ctrl.signal, cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j: { copyrightsCaption?: string }) => {
        if (!ctrl.signal.aborted && j.copyrightsCaption) setCaption(j.copyrightsCaption)
      })
      .catch(() => {})
    return () => ctrl.abort()
  }, [key])

  return <p className="mt-1">{caption ?? FALLBACK}</p>
}
