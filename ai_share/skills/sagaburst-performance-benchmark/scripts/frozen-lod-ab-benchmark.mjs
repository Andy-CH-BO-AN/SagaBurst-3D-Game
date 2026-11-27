// SagaBurst 凍結場景 render A/B：接戰後凍結模擬，可選擇把所有繪製中的人物強制到同一 LOD，
// 再於同一凍結狀態依序切換 DEV `__perfToggle(name)` OFF→ON→OFF→ON，各窗取 RuntimeProfiler、
// GPU timer、Main/Shadow census、renderer CPU profile 與截圖，結束後恢復 LOD 並核對指紋。
import fs from 'node:fs'
import { chromium } from 'playwright'
if (process.argv.includes('--help')) {
  console.log(`SagaBurst 凍結場景 render A/B

選項：
  --scenario=k|l|...      devcombat 場景，預設 k
  --settle-ms=N           第一次實際命中後展開時間，預設 5000
  --window-ms=N           每窗量測時間，預設 4000
  --force-lod=0|1|2       凍結後把所有繪製中的人物釘在該 LOD，量完恢復（省略則不強制）
  --toggle=NAME           __perfToggle 名稱；省略則只量一窗
  --host=HOST:PORT        預設 localhost:5191
  --out=PATH              JSON 路徑；同名 .cpuprofile／.png 另存`)
  process.exit(0)
}
const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d
const host = arg('host', '127.0.0.1:5173'), scenario = arg('scenario', 'k').toLowerCase()
const settleMs = Number(arg('settle-ms', 5000)), windowMs = Number(arg('window-ms', 4000))
const out = arg('out', `output/local-diagnostics/dense-${scenario}.json`)
const toggle = arg('toggle', '')
const forceLod = arg('force-lod', '')
const browser = await chromium.launch({ headless: false, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } })
const page = await context.newPage()
const errors = []
page.on('pageerror', e => errors.push(e.message))
await page.addInitScript(() => {
  window.__hits = 0
  const sub = () => { const st = window.game?.combatEvents; if (!st) return void setTimeout(sub, 50)
    st.subscribe(e => { if (e.type === 'damage_applied' || e.type === 'hit_blocked' || e.type === 'actor_killed') window.__hits++ }) }
  sub()
})
await page.goto(`http://${host}/?devcombat=${scenario}&nolock&npcsubphase=1`, { waitUntil: 'load' })
await page.waitForFunction(() => {
  const hud = document.querySelector('#dev-combat-status')?.textContent ?? ''
  const n = k => Number(hud.match(new RegExp(`${k}:\\s+(\\d+)`))?.[1] ?? 0)
  return window.game && (window.__hits > 0 || n('Dead') > 0)
}, null, { timeout: 240000, polling: 200 })
await page.waitForTimeout(settleMs)
await page.evaluate(() => window.game.setSimulationFrozen(true))
await page.waitForTimeout(1000)
const fingerprint = () => page.evaluate(() => {
  const g = window.game, hud = document.querySelector('#dev-combat-status')?.textContent ?? ''
  const lod = [0, 0, 0]
  for (const m of g.mounts) { const s = m.getHorseDebugState?.(); if (s) lod[s.lod]++ }
  const equipLod = [0, 0, 0]
  // Off-frustum visual sleep hides characterVisualGroup; those actors are not drawn at any LOD.
  for (const n of g.npcs) if (n.group.visible && n.characterVisualGroup?.visible !== false) equipLod[n.equipmentVisualLOD.currentLevel]++
  return { alive: g.npcs.filter(n => !n.dead).length, dead: g.npcs.filter(n => n.dead).length, arrows: g.arrows.length,
    activeAttack: Number(hud.match(/Active Attack NPCs:\s+(\d+)/)?.[1] ?? 0), horseLod: lod, equipLod,
    cam: g.camera.position.toArray().map(v => +v.toFixed(3)),
    posHash: g.npcs.reduce((h, n) => h + n.group.position.x * 1.3 + n.group.position.z * 0.7, 0).toFixed(4) }
})
const cdp = await context.newCDPSession(page)
async function windowMeasure(label) {
  await page.waitForTimeout(800)
  const gen = await page.evaluate(() => window.__resetRuntimeProfiler(performance.now()))
  await page.evaluate(() => { window.__denseGpu = window.__measureGpuRender() })
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 100 }); await cdp.send('Profiler.start')
  const t0 = Date.now(); const snaps = new Map()
  while (Date.now() - t0 < windowMs) {
    await page.waitForTimeout(200)
    const s = await page.evaluate(() => { const s = window.game.runtimeProfiler.getLatestSnapshot(); return s && { g: s.generation, fps: s.fps, cpu: s.cpuFrame.avg, submit: s.renderSubmit.avg } })
    if (s && s.g > gen) snaps.set(s.g, s)
  }
  const { profile } = await cdp.send('Profiler.stop')
  const gpu = await page.evaluate(() => window.__denseGpu.finish())
  const frames = await page.evaluate(() => window.__getRuntimeProfilerFrames?.() ?? [])
  const med = a => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[(s.length - 1) >> 1] : null }
  const profFile = out.replace(/\.json$/, `-${label}.cpuprofile`)
  await page.screenshot({ path: out.replace(/\.json$/, `-${label}.png`) })
  fs.writeFileSync(profFile, JSON.stringify(profile))
  const main = await page.evaluate(() => window.__collectMainPassCensus(window.game))
  const shadow = await page.evaluate(() => window.__collectShadowPassCensus(window.game))
  return { label, snapshots: [...snaps.values()],
    fps: med([...snaps.values()].map(s => s.fps)), cpuFrameMs: med([...snaps.values()].map(s => s.cpu)), renderSubmitMs: med([...snaps.values()].map(s => s.submit)),
    frameCount: frames.length, frameCpuMedian: med(frames.map(f => f.cpuFrameMs)), frameSubmitMedian: med(frames.map(f => f.renderSubmitMs)),
    gpu: { supported: gpu?.supported, samples: gpu?.samplesMs?.length ?? 0, medianMs: med(gpu?.samplesMs ?? []), disjoint: gpu?.disjointSamples, dropped: gpu?.droppedSamples },
    profFile, main: { mainCalls: main.mainCalls, mainTriangles: main.mainTriangles, passTotals: main.passTotals, categories: main.categories, categoryPasses: main.categoryPasses },
    shadow }
}
const fp0 = await fingerprint()
let forced = null, fpForced = null
if (forceLod !== '') {
  forced = await page.evaluate(level => window.__forceHumanoidLod(level), Number(forceLod))
  await page.waitForTimeout(1000)
  fpForced = await fingerprint()
}
const windows = []
if (toggle) {
  for (const [label, on] of [['A-off', false], ['B-on', true], ['A2-off', false], ['B2-on', true]]) {
    const r = await page.evaluate(({ toggle, on }) => window.__perfToggle(toggle, on), { toggle, on })
    windows.push({ toggle: r, ...(await windowMeasure(label)) })
  }
} else {
  windows.push(await windowMeasure('frozen'))
}
let restored = null
if (forceLod !== '') {
  restored = await page.evaluate(() => window.__forceHumanoidLod(null))
  await page.waitForTimeout(1000)
}
const fp1 = await fingerprint()
fs.writeFileSync(out, JSON.stringify({ scenario, settleMs, windowMs, toggle, fingerprintBefore: fp0, fingerprintAfter: fp1, fingerprintStable: JSON.stringify(fp0) === JSON.stringify(fp1), forceLod, forced, fpForced, restored, errors, windows }, null, 1))
console.log(JSON.stringify({ out, fp0, fpForced, fp1, forced, restored, stable: JSON.stringify(fp0) === JSON.stringify(fp1), errors, w: windows.map(w => ({ l: w.label, fps: w.fps, cpu: w.cpuFrameMs, submit: w.renderSubmitMs, gpu: w.gpu.medianMs, calls: w.main.mainCalls, tris: w.main.mainTriangles, shadow: w.shadow.totalSubmissions })) }))
await browser.close()
