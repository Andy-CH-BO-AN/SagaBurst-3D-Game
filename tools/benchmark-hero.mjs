import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { chromium } from 'playwright'

const option = (name, fallback) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback
if (process.argv.includes('--help')) {
  console.log('Commander acceptance: --host=127.0.0.1:5173 --faction=all|roman|viking --view=all|near|mid|far --runs=3 --max-runs=5 --warmup-ms=6000 --observation-ms=20000 --cycles=5 --out=output/hero-benchmark.json')
  process.exit(0)
}
const host = option('host', '127.0.0.1:5173')
const origin = host.startsWith('http') ? host : `http://${host}`
const selected = (name, values) => {
  const arg = option(name, 'all')
  if (arg !== 'all' && !values.includes(arg)) throw new Error(`Invalid ${name}: ${arg}`)
  return arg === 'all' ? values : [arg]
}
const factions = selected('faction', ['roman', 'viking'])
const views = selected('view', ['near', 'mid', 'far'])
const runs = Number(option('runs', '3')), maxRuns = Number(option('max-runs', '5'))
const warmupMs = Number(option('warmup-ms', '6000')), observationMs = Number(option('observation-ms', '20000'))
const cycles = Number(option('cycles', '5'))
if (![runs, maxRuns, cycles].every(Number.isInteger) || runs < 3 || maxRuns < runs || cycles < 4) throw new Error('Require at least 3 paired runs, max-runs >= runs and 4 lifecycle cycles')
if (![warmupMs, observationMs].every(Number.isFinite) || warmupMs < 3000 || observationMs < 3000 || observationMs > 60000) throw new Error('Warmup and observation must be finite and >= 3 seconds; observation <= 60 seconds')
const output = path.resolve(option('out', 'output/hero-benchmark.json'))
const chromePath = process.env.SAGABURST_CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
if (!fs.existsSync(chromePath)) throw new Error('A local graphical Google Chrome is required; set SAGABURST_CHROME_PATH')
const hash = value => createHash('sha256').update(value).digest('hex')
const git = (...args) => execFileSync('rtk', ['proxy', 'git', ...args], { encoding: 'utf8' }).trim()
const sourceMetadata = () => {
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)])
  const files = [...walk('src'), 'tools/benchmark-hero.mjs'].sort().map(file => ({ file, sha256: hash(fs.readFileSync(file)) }))
  return { sha256: hash(JSON.stringify(files)), files }
}
const assetMetadata = (id) => {
  const root = path.resolve('public/models/characters/v2', id)
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)])
  const files = walk(root).sort().map(file => ({ file: path.relative(root, file), bytes: fs.statSync(file).size, sha256: hash(fs.readFileSync(file)) }))
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'))
  const sourceGlbTrianglesPerLod = [0, 1, 2].map(lod => {
    const bytes = fs.readFileSync(path.join(root, manifest.files[`lod${lod}`]))
    const jsonLength = bytes.readUInt32LE(12)
    const document = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength))
    let triangles = 0
    const scene = document.scenes[document.scene ?? 0]
    const visit = index => {
      const node = document.nodes[index]
      if (node.mesh !== undefined) for (const primitive of document.meshes[node.mesh].primitives) {
        const count = document.accessors[primitive.indices ?? primitive.attributes.POSITION].count
        const mode = primitive.mode ?? 4
        triangles += mode === 4 ? count / 3 : mode === 5 || mode === 6 ? Math.max(0, count - 2) : 0
      }
      for (const child of node.children ?? []) visit(child)
    }
    for (const node of scene.nodes) visit(node)
    return triangles
  })
  return { id, bytes: files.reduce((sum, file) => sum + file.bytes, 0), sha256: hash(JSON.stringify(files)), files,
    lodFiles: [0, 1, 2].map(lod => manifest.files[`lod${lod}`]), sourceGlbTrianglesPerLod }
}
const initialAssets = Object.fromEntries(factions.flatMap(faction => [4, 5].map(tier => [`${faction}-hero-t${tier}`, assetMetadata(`${faction}-hero-t${tier}`)])))
const report = {
  protocol: 'hero-100-continuous-melee-v1', status: 'running', startedAt: new Date().toISOString(),
  commit: git('rev-parse', 'HEAD'), sourceDiffSha256: hash(git('diff', 'HEAD')), source: sourceMetadata(), assets: initialAssets,
  hardware: { hostname: os.hostname(), platform: os.platform(), architecture: os.arch(), osRelease: os.release(),
    cpu: os.cpus()[0]?.model, logicalCpuCount: os.cpus().length, physicalMemoryBytes: os.totalmem() },
  configuration: { origin, factions, views, runs, maxRuns, warmupMs, observationMs, cycles,
    viewport: { width: 1280, height: 720 }, graphicalChrome: chromePath, randomSeed: 0x5a6ab7,
    instrumentation: 'DEV Game/NPC/AI/render loop; full hero stats; refill each receiver before normal takeDamage',
    memoryScope: 'Chrome JavaScript heap bytes (forced GC only outside measured windows), WebGL geometry/texture/program counts; not total RAM or VRAM',
    frameStats: 'mean FPS=1000*frames/sum intervals; 1% low=1000/mean slowest ceil(1%) intervals; P95 nearest-rank',
    triangleScopes: 'assets.sourceGlbTrianglesPerLod counts active GLB-scene primitives before runtime preparation; states.runtimeVisibleGeometryTrianglesPerLod honors descendant visibility/material/drawRange but ignores per-LOD selection and camera culling; activeLodVisibleGeometryTriangles sums current visible LOD geometry before camera culling; mainPassCensus records actual submitted humanoid triangles outside measured windows',
    acceptance: { meanFpsRatioMin: .9, onePercentLowRatioMin: .9, p95FrameMsRatioMax: 1.1, boundaryMargin: .02 },
  }, samples: [], comparisons: [], errors: [],
}
const save = () => { fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`) }
const median = values => { const list = [...values].sort((a, b) => a - b), middle = Math.floor(list.length / 2); return list.length % 2 ? list[middle] : (list[middle - 1] + list[middle]) / 2 }
const summary = samples => Object.fromEntries(Object.keys(samples[0].summary).map(key => [key, median(samples.map(sample => sample.summary[key]))]))
let browser
try {
  browser = await chromium.launch({ headless: false, executablePath: chromePath, args: ['--enable-precise-memory-info'] })
  report.chromeVersion = browser.version()
  const context = await browser.newContext({ viewport: report.configuration.viewport })
  await context.addInitScript(seed => {
    let state = seed >>> 0
    Math.random = () => {
      state = (state + 0x6d2b79f5) >>> 0
      let value = Math.imul(state ^ (state >>> 15), 1 | state)
      value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296
    }
  }, report.configuration.randomSeed)
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  let activeErrors = []
  page.on('pageerror', error => activeErrors.push(String(error)))
  page.on('console', message => { if (message.type() === 'error') activeErrors.push(message.text()) })
  const waitFrames = count => page.evaluate(count => new Promise(resolve => {
    const step = () => --count <= 0 ? resolve() : requestAnimationFrame(step)
    requestAnimationFrame(step)
  }), count)
  const memoryCheckpoint = async () => {
    await cdp.send('HeapProfiler.collectGarbage')
    await waitFrames(5)
    return page.evaluate(() => window.__heroBenchmark.snapshot())
  }
  const runSample = async (faction, view, tier, pairIndex, checkLifecycle) => {
    activeErrors = []
    const url = `${origin}/?devcombat=commander&commanderFaction=${faction}&commanderTier=${tier}&commanderView=${view}&nolock&menu=1`
    report.activeAttempt = { faction, view, tier, pairIndex, url }
    save()
    await page.goto(url, { waitUntil: 'networkidle', timeout: 120000 })
    await page.waitForFunction(() => window.__heroBenchmark && window.__heroBenchmark.snapshot().population === 100, null, { timeout: 120000 })
    const initial = await page.evaluate(() => {
      const canvas = document.querySelector('canvas'), gl = canvas?.getContext('webgl2')
      const debug = gl?.getExtension('WEBGL_debug_renderer_info')
      return { snapshot: window.__heroBenchmark.snapshot(), fixture: window.__heroBenchmark.fixture,
        renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER),
        vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl?.getParameter(gl.VENDOR), userAgent: navigator.userAgent }
    })
    if (!initial.renderer || /SwiftShader|llvmpipe|Software Rasterizer/i.test(initial.renderer)) throw new Error(`Missing or software renderer cannot provide acceptance evidence: ${initial.renderer}`)
    if (!initial.snapshot.quality.shadows) throw new Error('Acceptance requires unchanged shadows enabled')
    const assetId = `${faction}-hero-t${tier}`
    const servedManifest = await page.request.get(`${origin}/models/characters/v2/${assetId}/manifest.json`)
    const expectedManifest = initialAssets[assetId].files.find(file => file.file === 'manifest.json')
    const validManifest = servedManifest.ok() && hash(await servedManifest.body()) === expectedManifest.sha256
    await servedManifest.dispose()
    if (!validManifest) throw new Error('Server asset manifest differs from the measured checkout')
    const servedLodFiles = []
    for (const file of initialAssets[assetId].lodFiles) {
      const expected = initialAssets[assetId].files.find(entry => entry.file === file)
      const response = await page.request.get(`${origin}/models/characters/v2/${assetId}/${file}`)
      const bytes = await response.body()
      const served = { file, bytes: bytes.byteLength, sha256: hash(bytes) }
      const validLod = response.ok() && served.bytes === expected?.bytes && served.sha256 === expected?.sha256
      await response.dispose()
      if (!validLod) throw new Error(`Served ${assetId}/${file} differs from the measured checkout`)
      servedLodFiles.push(served)
    }
    await page.waitForTimeout(warmupMs)
    const measured = await page.evaluate(ms => window.__heroBenchmark.measure(ms), observationMs)
    const mainPassCensus = await page.evaluate(async () => {
      const { collectMainPassCensus } = await import('/src/debug/MainPassCensus.ts')
      return collectMainPassCensus(window.game)
    })
    const sample = { faction, view, tier, pairIndex, url, initial, servedLodFiles, ...measured, mainPassCensus, errors: [...activeErrors] }
    if (checkLifecycle) {
      const checkpoints = [await memoryCheckpoint()]
      for (let cycle = 0; cycle < cycles; cycle++) {
        await page.evaluate(() => window.__heroBenchmark.cycle())
        await page.waitForTimeout(warmupMs)
        checkpoints.push(await memoryCheckpoint())
      }
      const first = checkpoints[0], last = checkpoints.at(-1)
      const heapValues = checkpoints.map(item => item.jsHeapUsedBytes)
      const persistentHeapGrowth = heapValues.every(value => value !== null)
        && heapValues.slice(1).every((value, index) => value - heapValues[index] > 65536)
        && last.jsHeapUsedBytes - first.jsHeapUsedBytes > 1048576
      sample.lifecycle = { checkpoints, persistentHeapGrowth,
        passed: last.geometries <= first.geometries && last.textures <= first.textures
          && (last.programs === null || first.programs === null || last.programs <= first.programs) && !persistentHeapGrowth
          && checkpoints.every(item => item.alive === 100 && item.population === 100 && item.identity.valid) }
    }
    sample.errors = [...activeErrors]
    sample.valid &&= sample.errors.length === 0 && (sample.lifecycle?.passed ?? true)
    report.samples.push(sample)
    report.activeAttempt = null
    save()
    console.log(`${faction} ${view} T${tier} pair ${pairIndex + 1}: ${sample.summary.meanFps.toFixed(2)} FPS, 1% ${sample.summary.onePercentLowFps.toFixed(2)}, P95 ${sample.summary.p95FrameMs.toFixed(2)}ms, valid=${sample.valid}`)
    return sample
  }
  for (const faction of factions) for (const view of views) {
    let comparison
    for (let pairIndex = 0; pairIndex < maxRuns; pairIndex++) {
      // Alternate ordering to reduce thermal and browser-cache order bias.
      for (const tier of pairIndex % 2 ? [5, 4] : [4, 5]) await runSample(faction, view, tier, pairIndex, pairIndex === 0 && view === views[0])
      const group = report.samples.filter(sample => sample.faction === faction && sample.view === view)
      const baseline = group.filter(sample => sample.tier === 4), candidate = group.filter(sample => sample.tier === 5)
      const baselineSummary = summary(baseline), candidateSummary = summary(candidate)
      const gate = await page.evaluate(async ({ baseline, candidate }) => {
        const { compareHeroFrameSummaries } = await import('/src/debug/HeroBenchmarkMetrics.ts')
        return compareHeroFrameSummaries(baseline, candidate)
      }, { baseline: baselineSummary, candidate: candidateSummary })
      const averageLods = samples => [0, 1, 2].map(lod => median(samples.flatMap(sample => sample.states.map(state => state.counts[lod]))))
      const baselineLods = averageLods(baseline), candidateLods = averageLods(candidate)
      const comparableLods = baselineLods.every((count, index) => Math.abs(count - candidateLods[index]) <= 5)
      const cameraAndQuality = sample => JSON.stringify({ camera: sample.states[0].camera, quality: sample.states[0].quality })
      const comparableSettings = group.every(sample => cameraAndQuality(sample) === cameraAndQuality(group[0]))
      comparison = { faction, view, pairs: pairIndex + 1, baseline: baselineSummary, candidate: candidateSummary,
        baselineLods, candidateLods, comparableLods, comparableSettings, ...gate,
        passed: group.every(sample => sample.valid) && comparableLods && comparableSettings && gate.passed }
      if (pairIndex + 1 >= runs && (!gate.nearBoundary || pairIndex + 1 >= maxRuns)) break
    }
    report.comparisons.push(comparison)
    save()
  }
  const finalAssets = Object.fromEntries(Object.keys(initialAssets).map(id => [id, assetMetadata(id)]))
  if (JSON.stringify(initialAssets) !== JSON.stringify(finalAssets)) throw new Error('Assets changed during paired measurement')
  if (sourceMetadata().sha256 !== report.source.sha256) throw new Error('Runtime source or runner changed during paired measurement')
  report.status = report.comparisons.every(comparison => comparison.passed) ? 'passed' : 'failed'
} catch (error) {
  report.status = 'failed'
  report.errors.push(String(error.stack ?? error))
  console.error(error)
} finally {
  report.completedAt = new Date().toISOString()
  save()
  await browser?.close()
}
console.log(`${report.status}: ${output}`)
if (report.status !== 'passed') process.exitCode = 1
