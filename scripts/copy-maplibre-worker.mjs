// Copies maplibre-gl's worker into public/ for predev/prebuild. Plain Node, so it runs the same
// from bash, PowerShell and cmd. The bundler looks for this file at /maplibre-gl-worker.js.
import { copyFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = new URL('..', import.meta.url)
const src = fileURLToPath(new URL('node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs', root))
const dest = fileURLToPath(new URL('public/maplibre-gl-worker.js', root))

mkdirSync(fileURLToPath(new URL('public/', root)), { recursive: true })
copyFileSync(src, dest)
