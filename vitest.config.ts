import { configDefaults, defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

export default defineConfig(env => mergeConfig(viteConfig(env), {
  test: {
    include: configDefaults.include.map(pattern => `tests/${pattern}`),
    exclude: [...configDefaults.exclude, 'output/**', 'tools/release/**', 'tests/release/**'],
    setupFiles: ['./tests/helpers/logicOnly.ts'],
    reporters: ['default', './tools/tests/vitest-budget-reporter.mjs'],
    maxWorkers: 2,
    allowOnly: false,
    // Deadlock protection; the reporter independently enforces 100ms including cleanup.
    testTimeout: 5000,
  },
}))
