import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['__tests__/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
      },
      include: ['src/**/*.ts'],
      exclude: ['src/prompts/**', 'src/types.ts', 'src/webhook.ts'],
    },
  },
})
