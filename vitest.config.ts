import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Tests unitaires des fonctions pures de app/utils (sans Nuxt ni navigateur)
export default defineConfig({
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('./app', import.meta.url))
    }
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node'
  }
})
