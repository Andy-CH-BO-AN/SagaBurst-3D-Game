import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { chromium } from 'playwright'

const valueOf = (name, fallback) => {
  const arg = process.argv.find(item => item.startsWith(`--${name}=`))
  return arg ? arg.slice(name.length + 3) : fallback
}

if (process.argv.includes('--help')) {
  console.log(`
SagaBurst 四門總守城戰（Commander V）效能量測

以 DEV \`?careerQa=commander-v\` 建立全新 QA 存檔，進入 Town 四門任務後量兩個窗口：
  preparation  守軍與平民已部署、攻方尚未生成（準備倒數中）
  siege        按 H 跳過準備，攻方全員生成並開始推進後

Town 沒有 #dev-combat-status profiler；本 runner 以 rAF callback 計時（JS CPU／frame）、
renderer.render 計時（Renderer Submit，含 driver back-pressure）與 renderer.info 取樣。

選項：
  --runs=N              預設 3，取各 run median 的 median
  --tag=NAME            輸出 tag
  --host=HOST:PORT      預設 127.0.0.1:5173
  --faction=roman|viking  QA 玩家陣營，預設 roman
  --warmup-ms=N         預設 3000
  --observation-ms=N    預設 20000
  --load-timeout-ms=N   預設 180000
  --skip-preparation    不量 preparation 窗口，部署完成即按 H（配對比較兩邊須一致）
  --out=PATH            輸出 JSON
`)
  process.exit(0)
}

const host = valueOf('host', '127.0.0.1:5173')
const runs = Number(valueOf('runs', '3'))
const tag = valueOf('tag', 'run')
const faction = valueOf('faction', 'roman')
const warmupMs = Number(valueOf('warmup-ms', '3000'))
const observationMs = Number(valueOf('observation-ms', '20000'))
const loadTimeoutMs = Number(valueOf('load-timeout-ms', '180000'))
const skipPreparation = process.argv.includes('--skip-preparation')
const chromePath = process.env.SAGABURST_CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const out = valueOf('out', path.join('output', 'local-diagnostics', `four-gate-${tag}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`))

const median = values => {
  const sorted = values.filter(value => Number.isFinite(value)).sort((a, b) => a - b)
  if (!sorted.length) return null
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}
const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : null
}
const onePercentLowFps = values => {
  const sorted = values.filter(value => Number.isFinite(value) && value > 0).sort((a, b) => a - b)
  if (!sorted.length) return null
  const tailCount = Math.max(1, Math.ceil(sorted.length * 0.01))
  const worst = sorted.slice(-tailCount)
  const meanWorstMs = worst.reduce((a, b) => a + b, 0) / worst.length
  return meanWorstMs > 0 ? 1000 / meanWorstMs : null
}
const readGitCommit = () => {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim() || null
  } catch {
    return null
  }
}

const browser = await chromium.launch({ headless: false, executablePath: chromePath })
let context, page
const instrument = () => {
  // Every rAF callback's synchronous duration; the game loop is one rAF chain.
  const frames = []
  window.__fourGateFrames = frames
  const raf = window.requestAnimationFrame.bind(window)
  window.requestAnimationFrame = callback => raf(time => {
    const start = performance.now()
    try { callback(time) } finally { frames.push({ at: start, cpu: performance.now() - start }) }
  })
}

const census = () => page.evaluate(() => {
  const town = window.__townScene, defense = town?.scene?.defense
  if (!defense) return null
  const residents = defense.residents ?? []
  const civilians = residents.filter(r => r.spec.role === 'civilian')
  const military = residents.filter(r => r.spec.role !== 'civilian')
  const info = town.scene.renderer?.info?.render
  return {
    phase: defense.phase,
    enemiesExpected: defense.enemyTotal,
    enemiesAlive: (defense.enemies ?? []).filter(n => !n.dead).length,
    friendlyAlive: military.filter(r => !r.npc.dead).length,
    friendlyTotal: military.length,
    civiliansAlive: civilians.filter(r => !r.npc.dead).length,
    civilianTotal: civilians.length,
    reinforcementsAlive: (defense.reinforcements ?? []).filter(n => !n.dead).length,
    // Town Center frame (TOWN_CENTER_FRAME in TownLayout): the civilian refuge.
    civiliansInHall: civilians.filter(r => { const p = r.npc.group.position; return p.x >= 32 && p.x <= 72 && p.z >= -44 && p.z <= -8 }).length,
    civilianPositions: civilians.map(r => [r.npc.group.position.x, r.npc.group.position.z]),
    drawCalls: info?.calls ?? null,
    triangles: info?.triangles ?? null,
    camera: town.camera ? [town.camera.position.x, town.camera.position.y, town.camera.position.z].map(v => Math.round(v * 10) / 10) : null,
  }
})

async function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await page.evaluate(predicate).catch(() => false)) return
    await page.waitForTimeout(250)
  }
  throw new Error(`${label} timeout after ${timeoutMs}ms`)
}

async function measure(label) {
  await page.waitForTimeout(warmupMs)
  await page.evaluate(() => {
    window.__fourGateFrames.length = 0
    const renderer = window.__townScene.scene.renderer
    if (!renderer.__fourGateWrapped) {
      const render = renderer.render.bind(renderer)
      renderer.__fourGateSubmit = []
      renderer.render = (...args) => { const s = performance.now(); try { return render(...args) } finally { renderer.__fourGateSubmit.push(performance.now() - s) } }
      renderer.__fourGateWrapped = true
    }
    renderer.__fourGateSubmit.length = 0
    window.__townScene?.resetProfiler?.()
    window.__fourGateGpuProbe = window.__townScene?.measureGpuRender?.() ?? null
  })
  const before = await census()
  const censusSamples = []
  const started = Date.now()
  while (Date.now() - started < observationMs) {
    await page.waitForTimeout(2000)
    censusSamples.push(await census())
  }
  const { frames, submit, gpuRaw, profiler } = await page.evaluate(() => {
    const gpuProbe = window.__fourGateGpuProbe
    window.__fourGateGpuProbe = null
    return {
      frames: window.__fourGateFrames.slice(),
      submit: window.__townScene.scene.renderer.__fourGateSubmit.slice(),
      gpuRaw: gpuProbe?.finish?.() ?? null,
      profiler: window.__townScene?.readProfiler?.() ?? null,
    }
  })
  const intervals = frames.slice(1).map((frame, i) => frame.at - frames[i].at)
  const cpu = frames.map(frame => frame.cpu)
  const gpuSamples = Array.isArray(gpuRaw?.samplesMs) ? gpuRaw.samplesMs : []
  const gpuRender = gpuRaw
    ? {
        supported: Boolean(gpuRaw.supported),
        sampleCount: gpuSamples.length,
        medianMs: gpuRaw.supported ? median(gpuSamples) : null,
        p95Ms: gpuRaw.supported ? percentile(gpuSamples, .95) : null,
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
  const after = await census()
  const civilianMaxMoveM = before?.civilianPositions && after?.civilianPositions
    ? Math.max(0, ...before.civilianPositions.map(([x, z], i) => Math.hypot(after.civilianPositions[i][0] - x, after.civilianPositions[i][1] - z))) : null
  for (const sample of [before, after]) if (sample) delete sample.civilianPositions
  return {
    civilianMaxMoveM,
    label, frameCount: frames.length,
    fps: intervals.length ? 1000 / median(intervals) : null,
    meanFps: intervals.length ? 1000 * intervals.length / intervals.reduce((a, b) => a + b, 0) : null,
    frameIntervalP95Ms: percentile(intervals, .95),
    frameIntervalP99Ms: percentile(intervals, .99),
    fps1PercentLow: onePercentLowFps(intervals),
    cpuFrameMs: median(cpu), cpuFrameP95Ms: percentile(cpu, .95), cpuFrameP99Ms: percentile(cpu, .99),
    renderSubmitMs: median(submit), renderSubmitP95Ms: percentile(submit, .95), renderSubmitP99Ms: percentile(submit, .99),
    gpuRenderMedianMs: gpuRender.medianMs,
    gpuRenderP95Ms: gpuRender.p95Ms,
    gpuRender,
    segments: profiler?.segments ?? null,
    saves: profiler?.saves ?? null,
    drawCalls: median(censusSamples.map(s => s?.drawCalls)),
    triangles: median(censusSamples.map(s => s?.triangles)),
    before, after,
  }
}

async function runOne(run) {
  // A fresh context per run: empty storage, so no previous save boots and gets aborted.
  await context?.close()
  context = await browser.newContext({ viewport: { width: 1280, height: 720 } })
  page = await context.newPage()
  await page.addInitScript(instrument)
  const errors = []
  const onError = error => errors.push(error.message ?? String(error))
  const onConsole = message => { if (message.type() === 'error' && !message.text().includes('favicon')) errors.push(message.text()) }
  page.on('pageerror', onError); page.on('console', onConsole)
  const startedAt = new Date().toISOString()
  try {
    // A fresh QA save each run: the same accepted mission, full roster and camera.
    await page.goto(`http://${host}/?careerQa=commander-v&faction=${faction}`, { waitUntil: 'load' })
    await waitFor(() => Boolean(window.__townScene?.scene?.defense?.deployment) && !document.getElementById('career-town-loading')
      && window.__townScene.scene.defense.phase === 'PREPARING', loadTimeoutMs, 'Town four-gate deployment')
    const preparation = skipPreparation ? null : await measure('preparation')
    await page.keyboard.press('KeyH')
    await waitFor(() => window.__townScene.scene.defense.phase === 'ATTACKING'
      && window.__townScene.scene.defense.attackersReady, loadTimeoutMs, 'four-gate attackers')
    const siege = await measure('siege')
    const valid = siege.before.enemiesAlive === siege.before.enemiesExpected
      && siege.before.friendlyAlive === siege.before.friendlyTotal && siege.before.civiliansAlive === siege.before.civilianTotal
    return { run, startedAt, ok: valid && errors.length === 0, valid, errors, preparation, siege }
  } catch (error) {
    return { run, startedAt, ok: false, errors: [...errors, error.message] }
  } finally {
    page.off('pageerror', onError); page.off('console', onConsole)
  }
}

const results = []
for (let run = 1; run <= runs; run++) {
  const result = await runOne(run)
  results.push(result)
  const s = result.siege, p = result.preparation
  console.log(`run ${run}: ${result.ok ? 'ok' : 'FAILED'}`
    + (p ? ` | prep ${p.fps?.toFixed(1)}fps cpu ${p.cpuFrameMs?.toFixed(1)}ms` : '')
    + (s ? ` | siege ${s.fps?.toFixed(1)}fps cpu ${s.cpuFrameMs?.toFixed(1)}ms submit ${s.renderSubmitMs?.toFixed(1)}ms alive ${s.before.enemiesAlive}/${s.before.friendlyAlive}` : '')
    + (result.errors.length ? ` | ${result.errors.slice(0, 2).join(' ; ')}` : ''))
}
await context?.close()
await browser.close()

const ok = results.filter(result => result.ok)
const summarize = key => {
  const base = Object.fromEntries([
    'fps', 'meanFps', 'frameIntervalP95Ms', 'frameIntervalP99Ms', 'fps1PercentLow',
    'cpuFrameMs', 'cpuFrameP95Ms', 'cpuFrameP99Ms',
    'renderSubmitMs', 'renderSubmitP95Ms', 'renderSubmitP99Ms',
    'gpuRenderMedianMs', 'gpuRenderP95Ms',
    'drawCalls', 'triangles',
  ].map(metric => [metric, median(ok.map(result => result[key]?.[metric]))]))
  const segmentKeys = Object.keys(ok[0]?.[key]?.segments ?? {})
  if (segmentKeys.length) {
    base.segments = Object.fromEntries(segmentKeys.map(seg => [seg, {
      medianMs: median(ok.map(result => result[key]?.segments?.[seg]?.medianMs)),
      p95Ms: median(ok.map(result => result[key]?.segments?.[seg]?.p95Ms)),
      maxMs: median(ok.map(result => result[key]?.segments?.[seg]?.maxMs)),
    }]))
  }
  if (ok[0]?.[key]?.saves) {
    base.saves = Object.fromEntries([
      'count', 'totalMsSum', 'medianTotalMs', 'maxTotalMs',
      'medianParseMs', 'medianCloneMs', 'medianStringifyMs', 'medianSetItemMs',
      'medianBytes', 'maxBytes',
    ].map(field => [field, median(ok.map(result => result[key]?.saves?.[field]))]))
  }
  return base
}
const report = {
  tool: 'four-gate-benchmark', tag, commit: readGitCommit(), host, faction, chromePath, viewport: '1280x720', warmupMs, observationMs,
  instrumentation: 'DEV build; rAF callback timing + renderer.render wrapper + TownDevProfiler',
  okRuns: ok.length, totalRuns: results.length,
  skipPreparation,
  summary: { ...(skipPreparation ? {} : { preparation: summarize('preparation') }), siege: summarize('siege') },
  population: ok[0] ? { preparation: ok[0].preparation?.before ?? null, siege: ok[0].siege.before } : null,
  results,
}
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify({ out, okRuns: report.okRuns, summary: report.summary, population: report.population }, null, 2))
if (!ok.length) process.exitCode = 1
