import type { Leg } from '@/src/contract/schema'

type Mode = Leg['mode']

/** Small line icons for bus, train and walk. currentColor, 1em square unless sized by className. */
export default function ModeIcon({ mode, className = 'h-4 w-4' }: { mode: Mode; className?: string }) {
  const common = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
    'aria-hidden': true,
    'data-mode': mode,
  }
  if (mode === 'bus')
    return (
      <svg {...common}>
        <rect x="4" y="3" width="16" height="15" rx="3" />
        <path d="M4 11h16M8 3v8M16 3v8" />
        <circle cx="8" cy="14.5" r="0.6" fill="currentColor" />
        <circle cx="16" cy="14.5" r="0.6" fill="currentColor" />
        <path d="M7 18v2.5M17 18v2.5" />
      </svg>
    )
  if (mode === 'rail')
    return (
      <svg {...common}>
        <rect x="5" y="2.5" width="14" height="15" rx="4" />
        <path d="M5 10h14M12 2.5V10" />
        <circle cx="9" cy="13.8" r="0.6" fill="currentColor" />
        <circle cx="15" cy="13.8" r="0.6" fill="currentColor" />
        <path d="M8.5 17.5 6 21.5M15.5 17.5l2.5 4M7.2 19.5h9.6" />
      </svg>
    )
  return (
    <svg {...common}>
      <circle cx="13" cy="4" r="1.8" />
      <path d="M10 21l2-6.5M12 14.5l-1.5-4.5 3.5-2 2.5 4 2.5 1M10.5 10l-3 2.5-1 3.5M12.5 14.5l2.5 2.5 1 4" />
    </svg>
  )
}
