'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/', label: 'Plan' },
  { href: '/routes', label: 'Routes' },
] as const

export default function TabBar() {
  const pathname = usePathname() ?? '/'
  const active = (href: string) => (href === '/' ? !pathname.startsWith('/routes') : pathname.startsWith(href))
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-20 flex border-t border-zinc-300 bg-white pb-[env(safe-area-inset-bottom)] dark:border-zinc-700 dark:bg-zinc-900"
    >
      {TABS.map((t) => {
        const on = active(t.href)
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={on ? 'page' : undefined}
            className={`flex h-12 min-w-12 flex-1 items-center justify-center text-sm font-semibold ${
              on ? 'text-blue-700 underline dark:text-blue-400' : 'text-zinc-700 dark:text-zinc-300'
            }`}
          >
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}
