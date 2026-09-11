import { chromium } from 'playwright'
import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'

const PORT = 5202
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

  server.stdout.on('data', () => {})
  server.stderr.on('data', () => {})

  await sleep(2500)
  return server
}

async function collectSample(page) {
  return await page.evaluate(() => {
    const g = window.game
    const profiler = g.runtimeProfiler
    const snap = profiler.getLatestSnapshot()
    const info = g.renderer.info

    let damagedNpcs = 0
    let deadNpcs = 0
    let activeMeleeActions = 0
    const MELEE_SET = new Set(['attack1', 'attack2', 'attack3', 'attackRunning', 'slash', 'slashReverse', 'thrust'])
    for (const n of g.npcs) {
      if (n.dead || n.hp <= 0) deadNpcs++
      else if (n.hp < n.maxHp) damagedNpcs++
      if (MELEE_SET.has(n.combatAnimationAction)) activeMeleeActions++
    }

    const census = window.__collectHorseCensus
      ? window.__collectHorseCensus(g.mounts)
      : null

    // Check rider visibility
    let ridersVisible = 0
    for (const n of g.npcs) {
      if (n.mount && n.group.visible) ridersVisible++
    }

    return {
      snapshot: snap,
      deadNpcs,
      damagedNpcs,
      activeMeleeActions,
      npcCount: g.npcs.length,
      horseCount: g.mounts.filter((m) => m.horseVisual).length,
      arrowCount: g.arrows.length,
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      textures: info.memory.textures,
      geometries: info.memory.geometries,
      census,
      ridersVisible,
      playerVisible: g.player.group.visible,
    }
  })
}

async function runScenarioMode(page, scenarioLetter, scenarioName, hideHorseVisuals = false) {
  const modeLabel = hideHorseVisuals ? 'Horse Hidden' : 'Normal'
  console.log(`\n========================================`)
  console.log(`Running: Scenario ${scenarioLetter.toUpperCase()} (${scenarioName}) [${modeLabel}]`)
  console.log(`========================================`)

  const url = `${BASE_URL}/?devcombat=${scenarioLetter}&nolock`
  await page.goto(url)

  await page.waitForFunction(() => {
    return window.game && window.game.player && window.game.renderer && window.game.runtimeProfiler
  }, { timeout: 30000 })

  console.log(`Game initialized. Waiting 4s for assets & shader warmup...`)
  await sleep(4000)

  if (hideHorseVisuals) {
    console.log(`Applying dev isolation: hiding horse visuals (simulation preserved)...`)
    await page.evaluate(() => {
      const g = window.game
      if (window.__setHorseVisualsHidden) {
        window.__setHorseVisualsHidden(g.mounts, true)
      } else {
        for (const m of g.mounts) {
          if (m.horseVisual) m.horseVisual.root.visible = false
        }
      }
    })
  }

  // 1. Reset profiler for Before Contact steady state
  await page.evaluate(() => {
    window.game.runtimeProfiler.reset(performance.now())
  })

  console.log(`Collecting "Before Contact" steady-state profile...`)
  await sleep(2200)

  const beforeContact = await collectSample(page)
  console.log(`Before Contact: FPS=${beforeContact.snapshot?.fps.toFixed(1)}, CPU Frame=${beforeContact.snapshot?.cpuFrame.avg.toFixed(1)}ms, Submit=${beforeContact.snapshot?.renderSubmit.avg.toFixed(1)}ms, Calls=${beforeContact.drawCalls}, Triangles=${beforeContact.triangles}`)

  // 2. Wait for combat engagement
  console.log(`Waiting for combat engagement...`)
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
      console.log(`Combat engaged! (damaged=${status.damagedNpcs}, activeMelee=${status.activeMeleeActions}, arrows=${status.arrows})`)
      combatEngaged = true
      break
    }
    await sleep(500)
  }

  if (!combatEngaged) {
    console.warn(`Warning: Combat condition not detected within 30s, proceeding.`)
  }

  // 3. Reset profiler for During Combat
  await page.evaluate(() => {
    window.game.runtimeProfiler.reset(performance.now())
  })

  console.log(`Sampling During Combat for 3.2 seconds...`)
  await sleep(3200)

  const duringCombat = await collectSample(page)
  console.log(`During Combat: FPS=${duringCombat.snapshot?.fps.toFixed(1)}, CPU Frame=${duringCombat.snapshot?.cpuFrame.avg.toFixed(1)}ms, Submit=${duringCombat.snapshot?.renderSubmit.avg.toFixed(1)}ms, Calls=${duringCombat.drawCalls}, Triangles=${duringCombat.triangles}`)

  const outDir = path.resolve('output/profile')
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
  const suffix = hideHorseVisuals ? 'horse-hidden' : 'normal'
  const screenshotPath = path.join(outDir, `scenario-${scenarioLetter}-${suffix}.png`)
  await page.screenshot({ path: screenshotPath })

  return {
    scenario: scenarioLetter.toUpperCase(),
    scenarioName,
    mode: modeLabel,
    hideHorseVisuals,
    beforeContact,
    duringCombat,
    screenshot: screenshotPath,
  }
}

function evaluateGpuReliability(rendererStr, vendorStr, isHeadless = false) {
  if (isHeadless) {
    return { reliable: false, hardwareAccelerated: false, label: 'No', reason: 'Headless browser environment' }
  }
  const r = (rendererStr || '').toLowerCase()
  const v = (vendorStr || '').toLowerCase()

  const isSoftware = (
    r.includes('swiftshader') ||
    r.includes('llvmpipe') ||
    r.includes('softpipe') ||
    r.includes('software rasterizer') ||
    r.includes('software renderer') ||
    r.includes('virtualbox') ||
    r.includes('vmware') ||
    r === 'unknown' ||
    v === 'unknown'
  )

  if (isSoftware) {
    return { reliable: false, hardwareAccelerated: false, label: 'No', reason: `Software rasterizer detected (${rendererStr})` }
  }

  const isHardware = (
    r.includes('metal') ||
    r.includes('apple') ||
    r.includes('nvidia') ||
    r.includes('amd') ||
    r.includes('radeon') ||
    r.includes('intel') ||
    r.includes('adreno') ||
    r.includes('mali') ||
    r.includes('direct3d')
  )

  return {
    reliable: isHardware,
    hardwareAccelerated: isHardware,
    label: isHardware ? 'Yes' : 'No',
    reason: isHardware ? (r.includes('metal') ? 'Yes (Apple Silicon ANGLE Metal)' : 'Yes (Hardware GPU)') : 'Unknown GPU',
  }
}

function computeDelta(normalVal, hiddenVal, higherIsBetter = false) {
  const diff = hiddenVal - normalVal
  const pct = normalVal !== 0 ? (diff / normalVal) * 100 : 0
  const sign = diff > 0 ? '+' : ''
  return {
    normal: normalVal,
    hidden: hiddenVal,
    diff,
    pct,
    str: `${sign}${pct.toFixed(1)}%`,
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

    // 0. Query environment
    await page.goto(`${BASE_URL}/?devcombat=d&nolock`)
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

    const gpuEval = evaluateGpuReliability(envInfo.webglRenderer, envInfo.webglVendor, false)
    envInfo.hardwareAcceleration = gpuEval.hardwareAccelerated ? 'Yes' : 'No'
    envInfo.reliableHeadedGpuBaseline = gpuEval.label

    console.log('\n================ BROWSER ENVIRONMENT ================')
    console.log(`Execution Surface: Local Playwright Headed Google Chrome`)
    console.log(`User Agent: ${envInfo.userAgent}`)
    console.log(`Viewport: ${envInfo.viewportWidth}x${envInfo.viewportHeight}`)
    console.log(`devicePixelRatio: ${envInfo.devicePixelRatio}`)
    console.log(`WebGL Vendor: ${envInfo.webglVendor}`)
    console.log(`WebGL Renderer: ${envInfo.webglRenderer}`)
    console.log(`WebGL Version: ${envInfo.webglVersion}`)
    console.log(`Hardware Acceleration: ${gpuEval.reason}`)
    console.log(`Reliable Headed GPU Baseline: ${gpuEval.label}`)
    console.log('====================================================\n')

    if (!gpuEval.reliable) {
      throw new Error(`GPU evaluation failed: ${gpuEval.reason}. Benchmark requires a reliable hardware GPU baseline.`)
    }

    // Run Scenario D Normal & Horse Hidden
    const dNormal = await runScenarioMode(page, 'd', '100v100 Cavalry / Horse Archer', false)
    const dHidden = await runScenarioMode(page, 'd', '100v100 Cavalry / Horse Archer', true)

    // Run Scenario C Normal & Horse Hidden (Optional but recommended)
    const cNormal = await runScenarioMode(page, 'c', '100v100 Mixed', false)
    const cHidden = await runScenarioMode(page, 'c', '100v100 Mixed', true)

    // Build delta comparisons
    function makeComparison(normalRun, hiddenRun) {
      const comparisons = {}
      for (const phase of ['beforeContact', 'duringCombat']) {
        const n = normalRun[phase]
        const h = hiddenRun[phase]
        comparisons[phase] = {
          drawCalls: computeDelta(n.drawCalls, h.drawCalls),
          triangles: computeDelta(n.triangles, h.triangles),
          rendererSubmitAvg: computeDelta(n.snapshot.renderSubmit.avg, h.snapshot.renderSubmit.avg),
          cpuFrameAvg: computeDelta(n.snapshot.cpuFrame.avg, h.snapshot.cpuFrame.avg),
          fps: computeDelta(n.snapshot.fps, h.snapshot.fps, true),
          npcUpdateAvg: computeDelta(n.snapshot.npcUpdate.avg, h.snapshot.npcUpdate.avg),
          collisionAvg: computeDelta(n.snapshot.collision.avg, h.snapshot.collision.avg),
          censusNormal: n.census,
          censusHidden: h.census,
        }
      }
      return comparisons
    }

    const compD = makeComparison(dNormal, dHidden)
    const compC = makeComparison(cNormal, cHidden)

    // Format Markdown Tables
    function formatComparisonTable(scenarioLabel, comp) {
      const lines = [
        `### ${scenarioLabel} A/B 對照分析`,
        '',
        '| 階段 | 指標 | Normal (原版) | Horse Hidden (隱藏馬身) | 變動量 (Delta) | 貢獻佔比 / 解讀 |',
        '| :--- | :--- | :--- | :--- | :--- | :--- |',
      ]

      for (const phase of ['beforeContact', 'duringCombat']) {
        const pName = phase === 'beforeContact' ? '接戰前 (Before Contact)' : '接戰中 (During Combat)'
        const c = comp[phase]

        const callDelta = c.drawCalls.pct.toFixed(1)
        const triDelta = c.triangles.pct.toFixed(1)
        const submitDelta = c.rendererSubmitAvg.pct.toFixed(1)
        const cpuDelta = c.cpuFrameAvg.pct.toFixed(1)
        const fpsDelta = c.fps.pct > 0 ? `+${c.fps.pct.toFixed(1)}%` : `${c.fps.pct.toFixed(1)}%`

        lines.push(`| **${pName}** | **Draw Calls** | ${c.drawCalls.normal.toLocaleString()} | ${c.drawCalls.hidden.toLocaleString()} | **${callDelta}%** | Horse 貢獻約 ${Math.abs(c.drawCalls.diff).toLocaleString()} calls (${Math.abs(c.drawCalls.pct).toFixed(1)}%) |`)
        lines.push(`| | **Triangles** | ${c.triangles.normal.toLocaleString()} | ${c.triangles.hidden.toLocaleString()} | **${triDelta}%** | Horse 貢獻約 ${(Math.abs(c.triangles.diff) / 1e6).toFixed(2)}M 面 (${Math.abs(c.triangles.pct).toFixed(1)}%) |`)
        lines.push(`| | **Renderer Submit** | ${c.rendererSubmitAvg.normal.toFixed(1)} ms | ${c.rendererSubmitAvg.hidden.toFixed(1)} ms | **${submitDelta}%** | 節省約 ${Math.abs(c.rendererSubmitAvg.diff).toFixed(1)} ms (${Math.abs(c.rendererSubmitAvg.pct).toFixed(1)}%) |`)
        lines.push(`| | **CPU Frame Work** | ${c.cpuFrameAvg.normal.toFixed(1)} ms | ${c.cpuFrameAvg.hidden.toFixed(1)} ms | **${cpuDelta}%** | 節省約 ${Math.abs(c.cpuFrameAvg.diff).toFixed(1)} ms (${Math.abs(c.cpuFrameAvg.pct).toFixed(1)}%) |`)
        lines.push(`| | **FPS** | ${c.fps.normal.toFixed(1)} | ${c.fps.hidden.toFixed(1)} | **${fpsDelta}** | 提升約 ${(c.fps.diff).toFixed(1)} FPS |`)
      }

      return lines.join('\n')
    }

    const tableD = formatComparisonTable('Scenario D (100v100 Cavalry / Horse Archer)', compD)
    const tableC = formatComparisonTable('Scenario C (100v100 Mixed)', compC)

    console.log('\n================ A/B COMPARISON TABLE (SCENARIO D) ================')
    console.log(tableD)
    console.log('\n================ A/B COMPARISON TABLE (SCENARIO C) ================')
    console.log(tableC)
    console.log('===================================================================\n')

    const horseCensus = dNormal.beforeContact.census

    const outDir = path.resolve('output/profile')
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })

    const fullReport = {
      envInfo,
      horseCensus,
      scenarioD: {
        normal: dNormal,
        hidden: dHidden,
        comparison: compD,
      },
      scenarioC: {
        normal: cNormal,
        hidden: cHidden,
        comparison: compC,
      },
    }

    fs.writeFileSync(path.join(outDir, 'horse-render-cost-results.json'), JSON.stringify(fullReport, null, 2))
    fs.writeFileSync(path.join(outDir, 'horse-render-cost-table.md'), `${tableD}\n\n${tableC}\n`)
    fs.writeFileSync(path.join(outDir, 'horse-census.json'), JSON.stringify(horseCensus, null, 2))

    console.log(`Results written to:`)
    console.log(`- output/profile/horse-render-cost-results.json`)
    console.log(`- output/profile/horse-render-cost-table.md`)
    console.log(`- output/profile/horse-census.json`)

  } catch (err) {
    console.error('Benchmark execution failed:', err)
    process.exitCode = 1
  } finally {
    if (browser) await browser.close()
    server.kill()
  }
}

main()
