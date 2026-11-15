import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const dir = fileURLToPath(new URL('../fixtures/gtfs-mini/', import.meta.url))

describe('gtfs-mini fixture line endings', () => {
  // csv-parse auto-detects the record delimiter from the first one it meets, so every file
  // must use LF only (.gitattributes pins tests/fixtures to eol=lf on every checkout).
  for (const name of readdirSync(dir)) {
    it(`${name} uses LF only`, () => {
      expect(readFileSync(`${dir}${name}`, 'utf8').includes('\r')).toBe(false)
    })
  }
})
