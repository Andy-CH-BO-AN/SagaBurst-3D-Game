import { configDefaults, defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

export default defineConfig(env => mergeConfig(viteConfig(env), {
  test: {
    // CI manifest paths are exact globs; post-run completeness verifies the result.
    include: process.env.LOGIC_TEST_FILES
      ? JSON.parse(process.env.LOGIC_TEST_FILES)
      : configDefaults.include.map(pattern => `tests/${pattern}`),
    exclude: [...configDefaults.exclude, 'output/**', '.github/scripts/release/**', 'tests/release/**', 'tests/**/*.test.cjs'],
    setupFiles: ['./tests/helpers/logicOnly.ts'],
    reporters: ['default', './tests/tooling/vitest-budget-reporter.mjs'],
    maxWorkers: 2,
    allowOnly: false,
    // Deadlock protection; the reporter independently enforces 100ms including cleanup.
    testTimeout: 5000,
  },
}))
