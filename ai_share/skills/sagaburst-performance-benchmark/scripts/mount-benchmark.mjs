import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { chromium } from 'playwright'

const args = new Set(process.argv.slice(2))
const valueOf = (name, fallback) => {
  const prefix = `--${name}=`
  const arg = process.argv.find((item) => item.startsWith(prefix))
  return arg ? arg.slice(prefix.length) : fallback
}

if (args.has('--help')) {
  console.log(`
SagaBurst 標準效能量測

選項：
  --scenario=D|E|F|G|H|I|K|L|M|all   預設 all
  --phase=before-contact|during-combat
  --runs=N                 Before Contact 預設 3，Combat 預設 1
  --tag=NAME               輸出檔名 tag
  --host=HOST:PORT         預設 127.0.0.1:5173
  --no-subphase            允許沒有 Mount internal breakdown 的 baseline
  --warmup-ms=N            預設 3000
  --observation-ms=N       預設 20000
  --timeout-ms=N            預設 25000
  --initial-timeout-ms=N    等待完整生成的時限，預設 15000（K/L/M 建議 120000）
  --out=PATH               指定輸出 JSON 路徑
`)
  process.exit(0)
}

const phase = valueOf('phase', 'before-contact')
if (!['before-contact', 'during-combat'].includes(phase)) {
  throw new Error(`未知 phase: ${phase}`)
}

const scenarioArg = valueOf('scenario', 'all').toUpperCase()
const allScenarios = [
  { id: 'D', query: 'devcombat=d', sideCount: 100, horseCount: 200 },
  { id: 'E', query: 'devcombat=e', sideCount: 100, horseCount: 200 },
  { id: 'F', query: 'devcombat=f', sideCount: 100, horseCount: 200 },
  { id: 'G', query: 'devcombat=g', sideCount: 200, horseCount: 0 },
  { id: 'H', query: 'devcombat=h', sideCount: 200, horseCount: 160 },
  { id: 'I', query: 'devcombat=i', sideCount: 200, horseCount: 400 },
  // K is heavy (600 actors) and only runs when named explicitly. Horse Count only counts
  // horse-registry mounts: the 300 Roman armored horses, not the 300 Viking snow leopards.
  { id: 'K', query: 'devcombat=k', sideCount: 300, horseCount: 300, explicitOnly: true },
  // L: 300v300 Six Feline Ranger horse archers; every mount is a cat, so Horse Count is 0.
  { id: 'L', query: 'devcombat=l', sideCount: 300, horseCount: 0, explicitOnly: true },
  // M: scenario L's Rangers on 150 snow leopards + 150 other felines per side (Horse Count 0).
  { id: 'M', query: 'devcombat=m', sideCount: 300, horseCount: 0, explicitOnly: true },
]
const scenarios = scenarioArg === 'ALL'
  ? allScenarios.filter((scenario) => !scenario.explicitOnly)
  : allScenarios.filter((scenario) => scenario.id === scenarioArg)
if (scenarios.length === 0) throw new Error(`未知 scenario: ${scenarioArg}`)

const renderProbe = valueOf('render-probe', 'normal').toLowerCase()
const probeQueries = {
  'normal': '',
  'no-shadow': '&perfNoShadow',
  'half-resolution': '&perfHalfResolution',
  'simple-material': '&perfSimpleMaterial',
}
if (!(renderProbe in probeQueries)) {
  throw new Error(`未知 render-probe: ${renderProbe}，可選: ${Object.keys(probeQueries).join(', ')}`)
}

const runs = Number(valueOf('runs', phase === 'before-contact' ? '3' : '1'))
const host = valueOf('host', '127.0.0.1:5173')
const warmupMs = Number(valueOf('warmup-ms', '3000'))
const observationMs = Number(valueOf('observation-ms', '20000'))
const timeoutMs = Number(valueOf('timeout-ms', '25000'))
const initialBattleStateTimeoutMs = Number(valueOf('initial-timeout-ms', '15000'))
const tag = valueOf('tag', `${scenarioArg.toLowerCase()}-${phase}`)
const requireSubphase = !args.has('--no-subphase')
const chromePath = process.env.SAGABURST_CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
if (!fs.existsSync(chromePath)) {
  throw new Error(`Local Google Chrome executable not found at ${chromePath}; set SAGABURST_CHROME_PATH instead of falling back to bundled Chromium`)
}

const metricPatterns = {
  fps: /^FPS:\s+([\d.]+)/m,
  cpuFrameMs: /^CPU Frame Work\s*:\s*([\d.]+)/m,
  npcUpdateMs: /^NPC Update\s*:\s*([\d.]+)/m,
  mountInteractionMs: /^Mount \/ Interaction\s*:\s*([\d.]+)/m,
  renderSubmitMs: /^Renderer Submit\s*:\s*([\d.]+)/m,
  alive: /^Alive:\s+(\d+)/m,
  dead: /^Dead:\s+(\d+)/m,
  activeAttack: /^Active Attack NPCs:\s+(\d+)/m,
  horseCount: /^Horse Count:\s+(\d+)/m,
  arrowCount: /^Arrow Count:\s+(\d+)/m,
  drawCalls: /^Main-pass Draw Calls:\s+(\d+)/m,
  triangles: /^Main-pass Triangles:\s+(\d+)/m,
  mountUpdatePhaseMs: /^  Mount Update\s*:\s*([\d.]+)/m,
  mountPhysicsMs: /^  Physics \/ Gravity\s*:\s*([\d.]+)/m,
  mountObstacleCollisionMs: /^  Obstacle Collision\s*:\s*([\d.]+)/m,
  mountHorseAnimationMs: /^  Horse Animation\s*:\s*([\d.]+)/m,
  mountRiderEquipmentMs: /^  Rider Equipment\s*:\s*([\d.]+)/m,
  mountSaddleTransformMs: /^  Saddle World Transform\s*:\s*([\d.]+)/m,
  mountRiderTransformMs: /^  Rider Transform\s*:\s*([\d.]+)/m,
  mountOtherMs: /^  Mount Other \(est\.\)\s*:\s*([\d.]+)/m,
}

function parseHud(text) {
  const values = {}
  for (const [key, pattern] of Object.entries(metricPatterns)) {
    const match = text.match(pattern)
    if (match) values[key] = Number(match[1])
  }
  const phases = [
    ['Physics / Gravity', values.mountPhysicsMs],
    ['Obstacle Collision', values.mountObstacleCollisionMs],
    ['Horse Animation', values.mountHorseAnimationMs],
    ['Rider Equipment', values.mountRiderEquipmentMs],
    ['Saddle World Transform', values.mountSaddleTransformMs],
    ['Rider Transform', values.mountRiderTransformMs],
  ].filter(([, value]) => value !== undefined)
  if (phases.length > 0) {
    const [label, value] = phases.reduce((best, current) => current[1] > best[1] ? current : best)
    values.maxMountSubphase = value
    values.maxMountSubphaseLabel = label
  }
  return values
}

function median(values) {
  const sorted = [...values].filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  if (sorted.length === 0) return null
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}

function percentile(values, p) {
  const sorted = [...values].filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : null
}

function onePercentLowFps(intervalsMs) {
  const sorted = intervalsMs.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b)
  if (sorted.length === 0) return null
  const tailCount = Math.max(1, Math.ceil(sorted.length * 0.01))
  const worst = sorted.slice(-tailCount)
  const meanWorstMs = worst.reduce((a, b) => a + b, 0) / worst.length
  return meanWorstMs > 0 ? 1000 / meanWorstMs : null
}

function readGitCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim() || null
  } catch {
    return null
  }
}

function isCombatEvidence(metrics) {
  return (metrics.activeAttack ?? 0) > 0 || (metrics.dead ?? 0) > 0 || (metrics.arrowCount ?? 0) > 0
}

function hasProfilerSnapshot(text) {
  return Boolean(
    text &&
    /^FPS:\s+(?!--)/m.test(text) &&
    (!requireSubphase || text.includes('Mount internal breakdown'))
  )
}

function addBattleHudAliveDead(metrics, battleText, sideCount) {
  const viking = battleText.match(new RegExp(`VIKING:\\s+(\\d+)\\s+\\/\\s+${sideCount}`, 'm'))?.[1]
  const roman = battleText.match(new RegExp(`ROMAN:\\s+(\\d+)\\s+\\/\\s+${sideCount}`, 'm'))?.[1]
  if (viking !== undefined && roman !== undefined) {
    metrics.alive = Number(viking) + Number(roman)
    metrics.dead = sideCount * 2 - metrics.alive
    metrics.aliveDeadSource = 'battle-hud'
  }
  return metrics
}

function readInitialBattleState(devHudText, battleText, scenario) {
  const metrics = addBattleHudAliveDead(parseHud(devHudText), battleText, scenario.sideCount)
  const expectedNpcCount = scenario.sideCount * 2
  const npcCount = metricsFromText(devHudText, /^NPC Count:\s+(\d+)/m)
  const horseCount = metricsFromText(devHudText, /^Horse Count:\s+(\d+)/m)
  return {
    npcCount,
    horseCount,
    alive: metrics.alive ?? null,
    dead: metrics.dead ?? null,
    expectedNpcCount,
    expectedHorseCount: scenario.horseCount,
    valid: npcCount === expectedNpcCount && horseCount === scenario.horseCount &&
      metrics.alive === expectedNpcCount && metrics.dead === 0,
  }
}

function metricsFromText(text, pattern) {
  const match = text.match(pattern)
  return match ? Number(match[1]) : null
}

async function waitForInitialBattleState(page, scenario) {
  const deadline = Date.now() + initialBattleStateTimeoutMs
  let latestState = null

  while (Date.now() < deadline) {
    const hud = await page.evaluate(() => ({
      devHudText: document.querySelector('#dev-combat-status')?.textContent ?? '',
      battleText: document.querySelector('#battle-status-hud')?.textContent ?? '',
    }))
    latestState = readInitialBattleState(hud.devHudText, hud.battleText, scenario)
    if (latestState.valid) return latestState
    await page.waitForTimeout(100)
  }

  const expectedNpcCount = scenario.sideCount * 2
  throw new Error(
    `Initial battle state timeout after ${initialBattleStateTimeoutMs}ms: ` +
    `actual NPC Count=${latestState?.npcCount ?? '--'}, Horse Count=${latestState?.horseCount ?? '--'}, ` +
    `Alive=${latestState?.alive ?? '--'}, Dead=${latestState?.dead ?? '--'}; ` +
    `expected NPC Count=${expectedNpcCount}, Horse Count=${scenario.horseCount}, Alive=${expectedNpcCount}, Dead=0`
  )
}

function aggregate(samples) {
  const keys = [
    'fps', 'cpuFrameMs', 'npcUpdateMs', 'mountInteractionMs', 'renderSubmitMs',
    'mountUpdatePhaseMs', 'maxMountSubphase', 'mountPhysicsMs', 'mountObstacleCollisionMs',
    'mountHorseAnimationMs', 'mountRiderEquipmentMs', 'mountSaddleTransformMs',
    'mountRiderTransformMs', 'mountOtherMs', 'alive', 'dead', 'activeAttack',
    'drawCalls', 'triangles', 'horseCount', 'arrowCount',
  ]
  const metrics = Object.fromEntries(keys.map((key) => [
    key,
    median(samples.map((sample) => sample.metrics[key]).filter((value) => typeof value === 'number')),
  ]))
  const labels = samples.map((sample) => sample.metrics.maxMountSubphaseLabel).filter(Boolean)
  if (labels.length > 0) {
    metrics.maxMountSubphaseLabel = labels.sort((a, b) =>
      labels.filter((label) => label === b).length - labels.filter((label) => label === a).length
    )[0]
  }
  return metrics
}

const browser = await chromium.launch({ headless: false, executablePath: chromePath })
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } })
const page = await context.newPage()
await page.addInitScript(({ combatTimeoutMs }) => {
  window.__sagaburstHudSamples = []
  let lastHudText = ''
  let recordScheduled = false
  const recordHud = () => {
    if (recordScheduled) return
    recordScheduled = true
    queueMicrotask(() => {
      recordScheduled = false
      const hud = document.querySelector('#dev-combat-status')
      if (!hud) return
      const hudText = hud.textContent ?? ''
      if (!hudText || hudText === lastHudText) return
      lastHudText = hudText
      window.__sagaburstHudSamples.push({
        atMs: performance.now(),
        hudText,
        battleText: document.querySelector('#battle-status-hud')?.textContent ?? '',
      })
    })
  }
  const startObserver = () => {
    const root = document.documentElement
    if (!root) return
    new MutationObserver(recordHud).observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
    })
    recordHud()
  }
  if (document.documentElement) startObserver()
  else document.addEventListener('DOMContentLoaded', startObserver, { once: true })
  window.__sagaburstWaitForCombat = () => new Promise((resolve, reject) => {
    const deadline = performance.now() + combatTimeoutMs
    const poll = () => {
      const evidence = window.__sagaburstHudSamples.some((sample) =>
        /Active Attack NPCs:\s+([1-9]\d*)/.test(sample.hudText) ||
        /Arrow Count:\s+([1-9]\d*)/.test(sample.hudText) ||
        /Dead:\s+([1-9]\d*)/.test(sample.hudText)
      )
      if (evidence) return resolve()
      if (performance.now() >= deadline) return reject(new Error('combat evidence timeout'))
      window.setTimeout(poll, 100)
    }
    poll()
  })
}, { combatTimeoutMs: timeoutMs })

async function runOne(scenario, run) {
  const consoleErrors = []
  const pageErrors = []
  const onConsole = (message) => {
    if (message.type() === 'error' && !message.text().includes('favicon.ico')) consoleErrors.push(message.text())
  }
  const onPageError = (error) => pageErrors.push(error.message)
  page.on('console', onConsole)
  page.on('pageerror', onPageError)
  const probeQuery = probeQueries[renderProbe] || ''
  const url = `http://${host}/?${scenario.query}&nolock&npcsubphase=1${probeQuery}`
  const startedAt = new Date().toISOString()
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 60_000 })
    await page.waitForSelector('#dev-combat-status', { timeout: 60_000 })
    const initialBattleState = await waitForInitialBattleState(page, scenario)
    await page.waitForTimeout(warmupMs)
    const combatEvidenceMode = phase !== 'during-combat'
      ? 'not-applicable'
      : scenario.id === 'E' ? 'scenario-e-starts-in-combat' : 'wait-for-hud-evidence'
    if (phase === 'during-combat' && scenario.id !== 'E') {
      await page.evaluate(() => window.__sagaburstWaitForCombat())
    }
    const observationStartMs = await page.evaluate(() => {
      window.__sagaburstGpuProbe = window.__measureGpuRender?.() ?? null
      return performance.now()
    })
    await new Promise((resolve) => setTimeout(resolve, observationMs))
    const { recorded, frameSamplesAll, gpuRaw } = await page.evaluate(() => {
      const probe = window.__sagaburstGpuProbe
      window.__sagaburstGpuProbe = null
      return {
        recorded: window.__sagaburstHudSamples ?? [],
        frameSamplesAll: window.__getRuntimeProfilerFrames?.() ?? [],
        gpuRaw: probe?.finish?.() ?? null,
      }
    })
    const parsed = recorded
      .filter((sample) => hasProfilerSnapshot(sample.hudText))
      .map((sample) => ({
        atMs: sample.atMs,
        metrics: addBattleHudAliveDead(parseHud(sample.hudText), sample.battleText, scenario.sideCount),
        spawnPlanCountKnown: new RegExp(`NPC Count:\\s+${scenario.sideCount * 2}\\b`, 'm').test(sample.hudText),
        hudText: sample.hudText,
        battleText: sample.battleText,
      }))
    let combatEvidenceStarted = false
    let firstCombatAtMs = Infinity
    const samples = []
    for (const sample of parsed) {
      if (phase === 'during-combat') {
        if (sample.atMs >= observationStartMs) {
          samples.push({ atMs: sample.atMs, metrics: sample.metrics })
        }
        continue
      }
      if (isCombatEvidence(sample.metrics)) {
        if (!combatEvidenceStarted) firstCombatAtMs = sample.atMs
        combatEvidenceStarted = true
        continue
      }
      if (combatEvidenceStarted) continue
      const reliableAliveDead = sample.metrics.alive === scenario.sideCount * 2 && sample.metrics.dead === 0
      const provisionalBeforeEvidence = sample.metrics.alive === undefined && sample.spawnPlanCountKnown
      if (!reliableAliveDead && !provisionalBeforeEvidence) continue
      const metrics = { ...sample.metrics }
      if (provisionalBeforeEvidence) {
        metrics.alive = scenario.sideCount * 2
        metrics.dead = 0
        metrics.aliveDeadSource = 'spawn-plan-before-first-combat-evidence'
      }
      samples.push({ atMs: sample.atMs, metrics })
    }
    if (samples.length === 0) throw new Error(`沒有有效 profiler windows；recorded=${recorded.length}`)
    const frameSamples = phase === 'during-combat'
      ? frameSamplesAll.filter((s) => s.atMs >= observationStartMs)
      : frameSamplesAll.filter((s) => s.atMs <= firstCombatAtMs)
    const intervals = frameSamples.map((s) => s.frameIntervalMs)
    const cpuFrames = frameSamples.map((s) => s.cpuFrameMs)
    const submitFrames = frameSamples.map((s) => s.renderSubmitMs)
    const gpuSamples = Array.isArray(gpuRaw?.samplesMs) ? gpuRaw.samplesMs : []
    const gpuRender = gpuRaw
      ? {
          supported: Boolean(gpuRaw.supported),
          sampleCount: gpuSamples.length,
          medianMs: gpuRaw.supported ? median(gpuSamples) : null,
          p95Ms: gpuRaw.supported ? percentile(gpuSamples, 0.95) : null,
          averageMs: gpuRaw.supported ? (gpuRaw.averageMs ?? null) : null,
          disjointSamples: gpuRaw.disjointSamples ?? 0,
          droppedSamples: gpuRaw.droppedSamples ?? 0,
          unresolved: gpuRaw.unresolved ?? 0,
          reason: gpuRaw.supported ? (gpuSamples.length ? 'ok' : 'no-completed-queries') : 'EXT_disjoint_timer_query_webgl2 unsupported',
        }
      : {
          supported: false,
          sampleCount: 0,
          medianMs: null,
          p95Ms: null,
          averageMs: null,
          disjointSamples: 0,
          droppedSamples: 0,
          unresolved: 0,
          reason: 'probe-unavailable',
        }
    const metrics = {
      ...aggregate(samples),
      frameIntervalP95Ms: percentile(intervals, 0.95),
      frameIntervalP99Ms: percentile(intervals, 0.99),
      fps1PercentLow: onePercentLowFps(intervals),
      cpuFrameP95Ms: percentile(cpuFrames, 0.95),
      cpuFrameP99Ms: percentile(cpuFrames, 0.99),
      renderSubmitP95Ms: percentile(submitFrames, 0.95),
      renderSubmitP99Ms: percentile(submitFrames, 0.99),
      gpuRenderMedianMs: gpuRender.medianMs,
      gpuRenderP95Ms: gpuRender.p95Ms,
    }
    const last = parsed.at(-1)
    return {
      scenario: scenario.id,
      renderProbe,
      phase,
      run,
      startedAt,
      url,
      status: 'ok',
      metrics,
      gpuRender,
      frameSampleCount: frameSamples.length,
      warmupMs,
      observationMs,
      observationDurationMs: observationMs,
      combatEvidenceMode,
      initialBattleState,
      sampleCount: samples.length,
      recordedSnapshotCount: parsed.length,
      contactEvidenceSeen: parsed.some((sample) => isCombatEvidence(sample.metrics)),
      samples,
      firstHudText: parsed[0]?.hudText ?? '',
      lastHudText: last?.hudText ?? '',
      battleText: last?.battleText ?? '',
      consoleErrors,
      pageErrors,
    }
  } catch (error) {
    return {
      scenario: scenario.id,
      renderProbe,
      phase,
      run,
      startedAt,
      url,
      status: 'failed',
      error: String(error),
      consoleErrors,
      pageErrors,
    }
  } finally {
    page.off('console', onConsole)
    page.off('pageerror', onPageError)
  }
}

const rows = []
try {
  for (const scenario of scenarios) {
    for (let run = 1; run <= runs; run++) {
      rows.push(await runOne(scenario, run))
      await page.waitForTimeout(750)
    }
  }
} finally {
  await context.close()
  await browser.close()
}

const report = {
  generatedAt: new Date().toISOString(),
  tag,
  commit: readGitCommit(),
  viewport: '1280x720',
  renderProbe,
  phase,
  scenarios: scenarios.map((scenario) => scenario.id),
  host,
  warmupMs,
  observationMs,
  timeoutMs,
  chromePath,
  requireSubphase,
  browserReuse: 'one browser process and one page for all runs',
  headed: true,
  rows,
}
const outputPath = path.resolve(valueOf('out', `output/local-diagnostics/mount-benchmark-${tag}-${phase}.json`))
fs.mkdirSync(path.dirname(outputPath), { recursive: true })
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify({
  outputPath,
  phase,
  summary: rows.map((row) => ({ scenario: row.scenario, run: row.run, status: row.status, metrics: row.metrics, sampleCount: row.sampleCount })),
}, null, 2))
if (rows.some((row) => row.status !== 'ok')) process.exitCode = 1
