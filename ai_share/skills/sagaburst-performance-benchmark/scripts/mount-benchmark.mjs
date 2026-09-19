import fs from 'node:fs'
import path from 'node:path'
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
  --scenario=D|E|all       預設 all
  --phase=before-contact|during-combat
  --runs=N                 Before Contact 預設 3，Combat 預設 1
  --tag=NAME               輸出檔名 tag
  --host=HOST:PORT         預設 127.0.0.1:5173
  --no-subphase            允許沒有 Mount internal breakdown 的 baseline
  --warmup-ms=N            預設 3000
  --observation-ms=N       預設 20000
  --timeout-ms=N            預設 25000
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
  { id: 'D', query: 'devcombat=d' },
  { id: 'E', query: 'devcombat=e' },
]
const scenarios = scenarioArg === 'ALL'
  ? allScenarios
  : allScenarios.filter((scenario) => scenario.id === scenarioArg)
if (scenarios.length === 0) throw new Error(`未知 scenario: ${scenarioArg}`)

const runs = Number(valueOf('runs', phase === 'before-contact' ? '3' : '1'))
const host = valueOf('host', '127.0.0.1:5173')
const warmupMs = Number(valueOf('warmup-ms', '3000'))
const observationMs = Number(valueOf('observation-ms', '20000'))
const timeoutMs = Number(valueOf('timeout-ms', '25000'))
const tag = valueOf('tag', `${scenarioArg.toLowerCase()}-${phase}`)
const requireSubphase = !args.has('--no-subphase')

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
  const sorted = [...values].sort((a, b) => a - b)
  if (sorted.length === 0) return null
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
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

function addBattleHudAliveDead(metrics, battleText) {
  const viking = battleText.match(/VIKING:\s+(\d+)\s+\/\s+100/m)?.[1]
  const roman = battleText.match(/ROMAN:\s+(\d+)\s+\/\s+100/m)?.[1]
  if (viking !== undefined && roman !== undefined) {
    metrics.alive = Number(viking) + Number(roman)
    metrics.dead = 200 - metrics.alive
    metrics.aliveDeadSource = 'battle-hud'
  }
  return metrics
}

function aggregate(samples) {
  const keys = [
    'fps', 'cpuFrameMs', 'npcUpdateMs', 'mountInteractionMs', 'renderSubmitMs',
    'mountUpdatePhaseMs', 'maxMountSubphase', 'mountPhysicsMs', 'mountObstacleCollisionMs',
    'mountHorseAnimationMs', 'mountRiderEquipmentMs', 'mountSaddleTransformMs',
    'mountRiderTransformMs', 'mountOtherMs', 'alive', 'dead', 'activeAttack',
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

const browser = await chromium.launch({ headless: false })
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
  const url = `http://${host}/?${scenario.query}&nolock&npcsubphase=1`
  const startedAt = new Date().toISOString()
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 60_000 })
    await page.waitForSelector('#dev-combat-status', { timeout: 60_000 })
    await page.waitForTimeout(warmupMs)
    const combatEvidenceMode = phase !== 'during-combat'
      ? 'not-applicable'
      : scenario.id === 'E' ? 'scenario-e-starts-in-combat' : 'wait-for-hud-evidence'
    if (phase === 'during-combat' && scenario.id !== 'E') {
      await page.evaluate(() => window.__sagaburstWaitForCombat())
    }
    await new Promise((resolve) => setTimeout(resolve, observationMs))
    const recorded = await page.evaluate(() => window.__sagaburstHudSamples ?? [])
    const parsed = recorded
      .filter((sample) => hasProfilerSnapshot(sample.hudText))
      .map((sample) => ({
        atMs: sample.atMs,
        metrics: addBattleHudAliveDead(parseHud(sample.hudText), sample.battleText),
        spawnPlanCountKnown: /NPC Count:\s+200\b/m.test(sample.hudText),
        hudText: sample.hudText,
        battleText: sample.battleText,
      }))
    let combatEvidenceStarted = false
    const samples = []
    for (const sample of parsed) {
      if (phase === 'during-combat') {
        samples.push({ atMs: sample.atMs, metrics: sample.metrics })
        continue
      }
      if (isCombatEvidence(sample.metrics)) {
        combatEvidenceStarted = true
        continue
      }
      if (combatEvidenceStarted) continue
      const reliableAliveDead = sample.metrics.alive === 200 && sample.metrics.dead === 0
      const provisionalBeforeEvidence = sample.metrics.alive === undefined && sample.spawnPlanCountKnown
      if (!reliableAliveDead && !provisionalBeforeEvidence) continue
      const metrics = { ...sample.metrics }
      if (provisionalBeforeEvidence) {
        metrics.alive = 200
        metrics.dead = 0
        metrics.aliveDeadSource = 'spawn-plan-before-first-combat-evidence'
      }
      samples.push({ atMs: sample.atMs, metrics })
    }
    if (samples.length === 0) throw new Error(`沒有有效 profiler windows；recorded=${recorded.length}`)
    const last = parsed.at(-1)
    return {
      scenario: scenario.id,
      phase,
      run,
      startedAt,
      url,
      status: 'ok',
      metrics: aggregate(samples),
      warmupMs,
      observationMs,
      observationDurationMs: observationMs,
      combatEvidenceMode,
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
  phase,
  scenarios: scenarios.map((scenario) => scenario.id),
  host,
  warmupMs,
  observationMs,
  timeoutMs,
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
