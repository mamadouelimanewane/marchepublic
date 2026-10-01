import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  test: { testTimeout: 30_000 },   // tolérance quand les suites tournent en parallèle (pglite, PDF)
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
})
