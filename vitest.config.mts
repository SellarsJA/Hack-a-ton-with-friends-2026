import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const alias = { '@': fileURLToPath(new URL('.', import.meta.url)) }

export default defineConfig({
  plugins: [react()],
  resolve: { alias },
  test: {
    testTimeout: 30000,
    hookTimeout: 30000,
    projects: [
      {
        extends: true,
        test: { name: 'node', environment: 'node', include: ['tests/**/*.test.ts'] },
      },
      {
        extends: true,
        test: { name: 'jsdom', environment: 'jsdom', include: ['tests/**/*.test.tsx'] },
      },
    ],
  },
})
