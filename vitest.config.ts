import { configDefaults, defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

export default defineConfig(env => mergeConfig(viteConfig(env), {
  test: {
    include: configDefaults.include.map(pattern => `tests/${pattern}`),
    exclude: [...configDefaults.exclude, 'output/**', 'tools/release/**', 'tests/release/**'],
    // Town fixtures rebuild whole armies; hosted CI CPUs need more than 5s.
    testTimeout: process.env.CI ? 20000 : 5000,
  },
}))
