import { defineConfig } from 'vite'

export default defineConfig(({ command, mode, isPreview }) => ({
  // The desktop build is served at sagaburst://game/, never through file://.
  base: (command === 'serve' && !isPreview) || mode === 'desktop' || mode === 'test'
    ? '/' : '/SagaBurst-3D-Game/',
  build: { outDir: mode === 'desktop' ? 'dist-desktop' : 'dist' },
  server: { port: 5173, open: true },
}))
