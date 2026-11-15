import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import pkg from '@/package.json'

const root = fileURLToPath(new URL('../..', import.meta.url))
const src = `${root}node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs`
const dest = `${root}public/maplibre-gl-worker.js`

describe('maplibre worker copy', () => {
  it('predev and prebuild use the cross-platform node script, not cp', () => {
    expect(pkg.scripts.predev).toBe('node scripts/copy-maplibre-worker.mjs')
    expect(pkg.scripts.prebuild).toBe('node scripts/copy-maplibre-worker.mjs')
  })

  it('copies the worker into public/', () => {
    rmSync(dest, { force: true })
    execFileSync(process.execPath, ['scripts/copy-maplibre-worker.mjs'], { cwd: root, stdio: 'pipe' })
    expect(readFileSync(dest).equals(readFileSync(src))).toBe(true)
  })
})
