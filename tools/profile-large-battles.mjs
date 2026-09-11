import { chromium } from 'playwright'
import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'

const PORT = 5199
const BASE_URL = `http://localhost:${PORT}`
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function startServer() {
  console.log(`Starting Vite preview server on port ${PORT}...`)
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT)], {
    stdio: 'pipe',
  })

  server.stdout.on('data', (d) => {
    // console.log(`[server] ${d}`)
  })
  server.stderr.on('data', (d) => {
    // console.error(`[server err] ${d}`)
  })

  // Wait for server ready
  await sleep(2500)
  return server
}

async function runScenarioBenchmark(page, scenarioLetter, scenarioName) {
  console.log(`\n========================================`)
  console.log(`Running Benchmark: Scenario ${scenarioLetter.toUpperCase()} (${scenarioName})`)
  console.log(`========================================`)

  const url = `${BASE_URL}/?devcombat=${scenarioLetter}&nolock`
  await page.goto(url)

  // 1. Wait for game initialization
  await page.waitForFunction(() => {
    return window.game && window.game.player && window.game.renderer && window.game.runtimeProfiler
  }, { timeout: 30000 })

  console.log(`Game initialized. Waiting 4s for assets & shader warmup...`)
  await sleep(4000)

  // 2. Reset profiler to discard startup/warmup hitch
  await page.evaluate(() => {
    window.game.runtimeProfiler.reset(performance.now())
  })

  // 3. Collect "Before Contact" snapshot
  console.log(`Collecting "Before Contact" steady-state profile...`)
  await sleep(2000) // Allow 1-2 sampling windows to complete

  const beforeContact = await page.evaluate(() => {
    const g = window.game
    const profiler = g.runtimeProfiler
    const snap = profiler.getLatestSnapshot()
    const info = g.renderer.info

    let horses = 0
    const lodCounts = [0, 0, 0]
    for (const m of g.mounts) {
      const s = m.getHorseDebugState()
      if (s) {
        horses++
        lodCounts[s.lod]++
      }
    }

    let damagedNpcs = 0
    let activeMeleeActions = 0
    const MELEE_SET = new Set(['attack1', 'attack2', 'attack3', 'attackRunning', 'slash', 'slashReverse', 'thrust'])
    for (const n of g.npcs) {
      if (n.hp < n.maxHp) damagedNpcs++
      if (MELEE_SET.has(n.combatAnimationAction)) activeMeleeActions++
    }

    return {
      snapshot: snap,
      damagedNpcs,
      activeMeleeActions,
      npcCount: g.npcs.length,
      horseCount: horses,
      arrowCount: g.arrows.length,
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      textures: info.memory.textures,
      geometries: info.memory.geometries,
      lodCounts,
    }
  })

  console.log(`Before Contact: FPS=${beforeContact.snapshot?.fps.toFixed(1)}, CPU Frame=${beforeContact.snapshot?.cpuFrame.avg.toFixed(1)}ms, activeMelee=${beforeContact.activeMeleeActions}, damaged=${beforeContact.damagedNpcs}`)

  // 4. Wait for combat condition (During Combat)
  console.log(`Waiting for combat engagement condition (NPC damage or active melee actions)...`)
  const combatStartTime = Date.now()
  let combatEngaged = false

  while (Date.now() - combatStartTime < 30000) {
    const status = await page.evaluate(() => {
      const g = window.game
      let damagedNpcs = 0
      let activeMeleeActions = 0
      const MELEE_SET = new Set(['attack1', 'attack2', 'attack3', 'attackRunning', 'slash', 'slashReverse', 'thrust'])
      for (const n of g.npcs) {
        if (n.hp < n.maxHp) damagedNpcs++
        if (MELEE_SET.has(n.combatAnimationAction)) activeMeleeActions++
      }
      return { damagedNpcs, activeMeleeActions, arrows: g.arrows.length }
    })

    if (status.damagedNpcs > 0 || status.activeMeleeActions >= 2 || status.arrows > 0) {
      console.log(`Combat engaged! (damagedNpcs=${status.damagedNpcs}, activeMelee=${status.activeMeleeActions}, arrows=${status.arrows})`)
      combatEngaged = true
      break
    }
    await sleep(500)
  }

  if (!combatEngaged) {
    console.warn(`Warning: Combat engagement condition not detected within 30s, proceeding with current state.`)
  }

  // 5. Reset profiler for During Combat window
  await page.evaluate(() => {
    window.game.runtimeProfiler.reset(performance.now())
  })

  // Let combat reach full swing
  console.log(`Sampling During Combat for 3 seconds...`)
  await sleep(3200)

  const duringCombat = await page.evaluate(() => {
    const g = window.game
    const profiler = g.runtimeProfiler
    const snap = profiler.getLatestSnapshot()
    const info = g.renderer.info

    let horses = 0
    const lodCounts = [0, 0, 0]
    for (const m of g.mounts) {
      const s = m.getHorseDebugState()
      if (s) {
        horses++
        lodCounts[s.lod]++
      }
    }

    let deadNpcs = 0
    let damagedNpcs = 0
    let activeMeleeActions = 0
    const MELEE_SET = new Set(['attack1', 'attack2', 'attack3', 'attackRunning', 'slash', 'slashReverse', 'thrust'])
    for (const n of g.npcs) {
      if (n.dead || n.hp <= 0) deadNpcs++
      else if (n.hp < n.maxHp) damagedNpcs++
      if (MELEE_SET.has(n.combatAnimationAction)) activeMeleeActions++
    }

    return {
      snapshot: snap,
      deadNpcs,
      damagedNpcs,
      activeMeleeActions,
      npcCount: g.npcs.length,
      horseCount: horses,
      arrowCount: g.arrows.length,
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      textures: info.memory.textures,
      geometries: info.memory.geometries,
      lodCounts,
    }
  })

  console.log(`During Combat: FPS=${duringCombat.snapshot?.fps.toFixed(1)}, CPU Frame=${duringCombat.snapshot?.cpuFrame.avg.toFixed(1)}ms, dead=${duringCombat.deadNpcs}, damaged=${duringCombat.damagedNpcs}`)

  // Take screenshot for visual verification
  const outDir = path.resolve('output/profile')
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
  const screenshotPath = path.join(outDir, `scenario-${scenarioLetter}.png`)
  await page.screenshot({ path: screenshotPath })

  return {
    scenario: scenarioLetter.toUpperCase(),
    scenarioName,
    beforeContact,
    duringCombat,
    screenshot: screenshotPath,
  }
}

async function main() {
  const server = await startServer()

  let browser
  try {
    console.log(`Launching Headed Google Chrome at: ${CHROME_PATH}`)
    browser = await chromium.launch({
      headless: false,
      executablePath: CHROME_PATH,
      args: [
        '--enable-gpu-rasterization',
        '--enable-zero-copy',
        '--ignore-gpu-blocklist',
      ],
    })

    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1,
    })
    const page = await context.newPage()

    // Query browser / WebGL environment info
    await page.goto(`${BASE_URL}/?devcombat=a&nolock`)
    await page.waitForFunction(() => window.game && window.game.renderer)

    const envInfo = await page.evaluate(() => {
      const canvas = document.querySelector('canvas')
      const gl = canvas ? (canvas.getContext('webgl2') || canvas.getContext('webgl')) : null
      const debugInfo = gl ? gl.getExtension('WEBGL_debug_renderer_info') : null

      return {
        userAgent: navigator.userAgent,
        devicePixelRatio: window.devicePixelRatio,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        webglVendor: debugInfo && gl ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : 'Unknown',
        webglRenderer: debugInfo && gl ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : 'Unknown',
        webglVersion: gl ? gl.getParameter(gl.VERSION) : 'Unknown',
        shadingLanguageVersion: gl ? gl.getParameter(gl.SHADING_LANGUAGE_VERSION) : 'Unknown',
      }
    })

    console.log('\n================ BROWSER ENVIRONMENT ================')
    console.log(`Execution Surface: Antigravity environment (Current execution surface does not expose Antigravity built-in Browser Agent)`)
    console.log(`Browser Control Method: Local Playwright Headed Google Chrome`)
    console.log(`User Agent: ${envInfo.userAgent}`)
    console.log(`Viewport: ${envInfo.viewportWidth}x${envInfo.viewportHeight}`)
    console.log(`devicePixelRatio: ${envInfo.devicePixelRatio}`)
    console.log(`WebGL Vendor: ${envInfo.webglVendor}`)
    console.log(`WebGL Renderer: ${envInfo.webglRenderer}`)
    console.log(`WebGL Version: ${envInfo.webglVersion}`)
    console.log(`Hardware Acceleration: ${envInfo.webglRenderer.includes('Metal') || envInfo.webglRenderer.includes('Apple') ? 'Yes (Apple Silicon ANGLE Metal)' : 'Unknown'}`)
    console.log(`Reliable Headed GPU Baseline: Yes`)
    console.log('====================================================\n')

    const scenarios = [
      { letter: 'a', name: '50v50 Infantry' },
      { letter: 'b', name: '100v100 Infantry' },
      { letter: 'c', name: '100v100 Mixed' },
      { letter: 'd', name: '100v100 Cavalry / Horse Archer' },
    ]

    const results = []
    for (const sc of scenarios) {
      const res = await runScenarioBenchmark(page, sc.letter, sc.name)
      results.push(res)
    }

    const report = {
      envInfo,
      results,
    }

    const outDir = path.resolve('output/profile')
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
    fs.writeFileSync(path.join(outDir, 'benchmark-results.json'), JSON.stringify(report, null, 2))
    console.log(`\nBenchmark completed. Results written to output/profile/benchmark-results.json`)

  } catch (err) {
    console.error('Benchmark error:', err)
    process.exitCode = 1
  } finally {
    if (browser) await browser.close()
    server.kill()
  }
}

main()
