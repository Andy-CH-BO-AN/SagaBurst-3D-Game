import { configDefaults, defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

export default mergeConfig(viteConfig, defineConfig({
  test: { setupFiles: ['./tests/setupMountAssets.ts'], exclude: [...configDefaults.exclude, 'output/**'] },
}))
