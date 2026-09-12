import { chromium } from 'playwright'
import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'

const PORT = 5205
const BASE_URL = `http://localhost:${PORT}`
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  console.log('Starting preview server on port', PORT)
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT)], { stdio: 'pipe' })
  await sleep(2500)

  const browser = await chromium.launch({
    headless: false,
    executablePath: CHROME_PATH,
    args: ['--use-gl=angle', '--use-angle=metal', '--enable-gpu-rasterization'],
  })

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    devicePixelRatio: 1,
  })
  const page = await context.newPage()

  const consoleErrors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => consoleErrors.push(err.message))

  const outDir = path.resolve('output/visual_check')
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })

  try {
    console.log('Navigating to Mounts Dev Studio...')
    await page.goto(`${BASE_URL}/?devmodels=mounts&nolock`)
    await page.waitForFunction(() => window.game && window.game.mounts && window.game.mounts.length > 0, { timeout: 30000 })
    await sleep(3000)

    console.log('Mount Studio loaded. Setting camera distances to test LOD0, LOD1, LOD2...')

    // Function to set camera distance and capture screenshot
    async function captureAtDistance(dist, label) {
      await page.evaluate((d) => {
        const g = window.game
        const controls = g.studioControls
        const mount = g.mountStudioHorse
        const target = controls.target
        // Set camera position at distance d along Z
        g.camera.position.set(target.x, target.y + 0.5, target.z + d)
        controls.update()
        g.camera.updateProjectionMatrix()
      }, dist)
      await sleep(600)

      const state = await page.evaluate(() => {
        const g = window.game
        const horse = g.mountStudioHorse?.horseVisual
        const debug = horse?.debugState ? horse.debugState() : null
        return {
          lod: debug ? debug.lod : -1,
          variant: debug ? debug.variant : -1,
        }
      })
      console.log(`Distance ${dist}m -> Measured LOD: ${state.lod}, Variant: ${state.variant}`)

      const shotPath = path.join(outDir, `horse-${label}.png`)
      await page.screenshot({ path: shotPath })
      console.log(`Saved screenshot: ${shotPath}`)
      return state
    }

    // 1. LOD0 close-up (~5m)
    await captureAtDistance(5, 'lod0-5m')

    // 2. LOD1 middle distance (~25m)
    await captureAtDistance(25, 'lod1-25m')

    // 3. LOD transition 37m -> 40m
    await captureAtDistance(36, 'transition-36m-lod1')
    await captureAtDistance(40, 'transition-40m-lod2')

    // 4. LOD2 far (~45m)
    await captureAtDistance(45, 'lod2-45m')

    // 5. LOD2 extreme distance (~60m)
    await captureAtDistance(60, 'lod2-60m')

    // 6. Test variant cycle on LOD2 (45m)
    console.log('Testing variant cycle on LOD2...')
    for (const v of [0, 1, 2]) {
      await page.evaluate((variantIdx) => {
        const g = window.game
        const horse = g.mountStudioHorse?.horseVisual
        horse.setAppearanceVariant(variantIdx)
      }, v)
      await sleep(400)
      await captureAtDistance(42, `lod2-variant-${v}`)
    }

    // 7. Verify animation playback on LOD2 (walk, gallop, jump, death)
    console.log('Testing animation clips on LOD2...')
    for (const clip of ['walk', 'gallop', 'jump', 'death']) {
      await page.evaluate((c) => {
        const g = window.game
        const horse = g.mountStudioHorse
        horse.playStudioClip(c)
      }, clip)
      await sleep(600)
      await captureAtDistance(42, `lod2-clip-${clip}`)
    }

    console.log('Console errors encountered:', consoleErrors.length)
    if (consoleErrors.length > 0) {
      console.error('Errors:', consoleErrors)
    }

  } finally {
    await browser.close()
    server.kill()
  }
}

main().catch((err) => {
  console.error('Visual check failed:', err)
  process.exit(1)
})
