/**
 * profile-npc-subphases.mjs
 *
 * 量測 NPC Update 各子階段耗時（PR #46）。
 * 使用 Vite DEV server（import.meta.env.DEV = true，才能啟用 subphase collector）。
 *
 * 執行方式：
 *   node tools/profile-npc-subphases.mjs
 *
 * 輸出：
 *   output/profile/npc-subphase-results.json
 *   output/profile/npc-subphase-table.md
 *
 * 量測邏輯：
 *   每個 Scenario 各跑兩次：
 *     Pass A：?devcombat=X&nolock             → subphase OFF（純 baseline）
 *     Pass B：?devcombat=X&nolock&npcsubphase=1 → subphase ON
 *   兩次的 NPC Update 差值 = instrumentation overhead 估算。
 *
 * Scenario D = ?devcombat=d  (100v100 騎兵 + 馬弓)
 * Scenario E = ?devcombat=e  (100v100 All-Melee Cavalry, Scattered, Initial Spectator)
 */

import { chromium } from 'playwright'
import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'

const PORT = 5177   // 用不常用的 port 避免衝突
const BASE_URL = `http://localhost:${PORT}`
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

// ─── DEV server ──────────────────────────────────────────────
async function startDevServer() {
  console.log(`Starting Vite DEV server on port ${PORT}...`)
  const server = spawn('npx', ['vite', '--port', String(PORT)], {
    cwd: process.cwd(),
    stdio: 'pipe',
    // 關閉 HMR 避免在量測期間 reload
    env: { ...process.env, VITE_HMR: 'false' },
  })
  server.stdout.on('data', () => {})
  server.stderr.on('data', () => {})
  // 等待 server 就緒
  await sleep(3500)
  console.log('  DEV server ready.')
  return server
}

// ─── 等待 game 初始化 ────────────────────────────────────────
async function waitForGame(page, timeoutMs = 40000) {
  await page.waitForFunction(
    () =>
      window.game &&
      window.game.player &&
      window.game.runtimeProfiler &&
      window.game.npcs &&
      window.game.npcs.length > 0,
    { timeout: timeoutMs },
  )
}

// ─── 等待接戰 ────────────────────────────────────────────────
// Scenario D/E 以騎兵為主，用 arrows（馬弓） + damaged + activeMelee
async function waitForCombat(page, timeoutMs = 45000) {
  console.log(`    Waiting up to ${timeoutMs / 1000}s for combat engagement...`)
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const status = await page.evaluate(() => {
        const g = window.game
        if (!g || !g.npcs) return null
        let damaged = 0
        let activeMelee = 0
        const MELEE = new Set([
          'attack1','attack2','attack3','attackRunning',
          'slash','slashReverse','thrust',
          'swordSlash','lanceThrust','mountedLance',
        ])
        for (const n of g.npcs) {
          if (!n.dead && n.hp < n.maxHp) damaged++
          if (MELEE.has(n.combatAnimationAction)) activeMelee++
        }
        return { damaged, activeMelee, arrows: g.arrows.length }
      })
      if (!status) { await sleep(500); continue }
      if (status.damaged > 0 || status.activeMelee >= 2 || status.arrows > 0) {
        console.log(`    Combat engaged! damaged=${status.damaged} activeMelee=${status.activeMelee} arrows=${status.arrows}`)
        return true
      }
    } catch (_) {
      // page 可能還在導航，忽略
    }
    await sleep(700)
  }
  console.warn(`    WARNING: combat not detected within ${timeoutMs / 1000}s, proceeding.`)
  return false
}

// ─── 收集一個 profiler 快照 ───────────────────────────────────
async function collectSnapshot(page, withSubphase) {
  return await page.evaluate((ws) => {
    const g = window.game
    if (!g || !g.runtimeProfiler) return null

    const snap    = g.runtimeProfiler.getLatestSnapshot()
    const subSnap = ws ? g.runtimeProfiler.getLatestSubphaseSnapshot() : null
    const info    = g.renderer.info

    let alive = 0, dead = 0
    for (const n of g.npcs) {
      if (n.dead || n.hp <= 0) dead++; else alive++
    }

    let horses = 0
    for (const m of g.mounts) {
      if (m.getHorseDebugState()) horses++
    }

    return {
      snapshot:          snap,
      subphaseSnapshot:  subSnap,
      alive,
      dead,
      npcCount:          g.npcs.length,
      horseCount:        horses,
      arrowCount:        g.arrows.length,
      drawCalls:         info.render.calls,
      triangles:         info.render.triangles,
      fps:               snap ? snap.fps : null,
      cpuFrameAvg:       snap ? snap.cpuFrame.avg : null,
      npcUpdateAvg:      snap ? snap.npcUpdate.avg : null,
    }
  }, withSubphase)
}

// ─── 重置 profiler ────────────────────────────────────────────
async function resetProfiler(page, withSubphase) {
  await page.evaluate((ws) => {
    window.game.runtimeProfiler.reset(performance.now())
    if (ws) window.game.resetNpcSubphaseProfiling?.()
  }, withSubphase)
}

// ─── Scenario fail-fast ───────────────────────────────────────
async function assertScenarioSanity(page, scenarioLetter) {
  const sanity = await page.evaluate(() => {
    const g = window.game
    const npcs = g.npcs
    let alive = 0
    let dead = 0
    let viking = 0
    let roman = 0
    let allMeleeCavalry = true

    for (const npc of npcs) {
      if (npc.dead || npc.hp <= 0) dead++; else alive++
      if (npc.characterFaction === 'viking') viking++
      if (npc.characterFaction === 'roman') roman++
      if (npc.aiType !== 'MELEE' || !npc.generatedAsCavalry) allMeleeCavalry = false
    }

    return {
      actualNpcCount: npcs.length,
      alive,
      dead,
      viking,
      roman,
      allMeleeCavalry,
      spectator: g.player?.spectatorOnly === true,
    }
  })

  const { actualNpcCount } = sanity
  if (scenarioLetter === 'd' && actualNpcCount !== 200) {
    throw new Error(`Scenario D expected 200 NPCs, got ${actualNpcCount}`)
  }
  if (scenarioLetter === 'e' && actualNpcCount !== 200) {
    throw new Error(`Scenario E expected 200 NPCs (100v100), got ${actualNpcCount}`)
  }
  if (scenarioLetter === 'e') {
    if (!sanity.spectator) throw new Error('Scenario E expected initial spectator mode')
    if (sanity.viking !== 100 || sanity.roman !== 100) {
      throw new Error(`Scenario E expected 100 Viking + 100 Roman, got ${sanity.viking} + ${sanity.roman}`)
    }
    if (!sanity.allMeleeCavalry) {
      throw new Error('Scenario E expected every NPC to be melee cavalry')
    }
  }

  console.log(`    Sanity: NPC total=${actualNpcCount}, Alive=${sanity.alive}, Dead=${sanity.dead}`)
}

function assertSnapshotPopulation(scenarioLetter, label, snapshot, requireBeforeContact = false) {
  if (!snapshot) throw new Error(`${label}: missing profiler snapshot`)
  if (scenarioLetter !== 'e') return

  if (snapshot.npcCount !== 200 || snapshot.alive + snapshot.dead !== 200) {
    throw new Error(`${label}: Scenario E expected NPC total = Alive + Dead = 200, got ${snapshot.npcCount} = ${snapshot.alive} + ${snapshot.dead}`)
  }
  if (requireBeforeContact && (snapshot.alive !== 200 || snapshot.dead !== 0)) {
    throw new Error(`${label}: Scenario E Before Contact expected Alive = 200, Dead = 0; got Alive = ${snapshot.alive}, Dead = ${snapshot.dead}`)
  }
}

// Freeze only the shader/JIT warmup. The measured Before Contact window must
// use live simulation so movement, state progression, and timers are real.
async function setSimulationFrozen(page, frozen) {
  await page.evaluate((shouldFreeze) => {
    const clock = window.game.clock
    if (shouldFreeze) {
      clock.autoStart = false
      clock.running = false
    } else {
      clock.autoStart = true
      clock.start()
    }
  }, frozen)
}

// ─── 單次 pass ────────────────────────────────────────────────
async function runPass(page, scenarioLetter, withSubphase) {
  const subParam = withSubphase ? '&npcsubphase=1' : ''
  const url = `${BASE_URL}/?devcombat=${scenarioLetter}&nolock${subParam}`

  console.log(`  → ${url}`)

  // 每次 navigate 前先清除之前可能掛的 listener
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 })

  // 等 game 初始化（NPC 全部 spawn）
  console.log(`    Waiting for game + NPCs...`)
  await waitForGame(page, 40000)
  await assertScenarioSanity(page, scenarioLetter)

  // Avoid Scenario E entering melee during shader/JIT warmup.
  await setSimulationFrozen(page, true)

  // Warmup：讓 shader、JIT compile、冷啟動穩定
  console.log(`    Warming up 6s...`)
  await sleep(6000)

  // Resume live simulation, then begin an immediate clean pre-contact window.
  await setSimulationFrozen(page, false)
  await resetProfiler(page, withSubphase)

  // 1.25s is long enough for the 1-second RuntimeProfiler window while
  // keeping the all-melee scattered scenario before its first deaths.
  console.log(`    Before Contact: sampling 1.25s...`)
  await sleep(1250)

  const beforeContact = await collectSnapshot(page, withSubphase)
  assertSnapshotPopulation(scenarioLetter, 'Before Contact', beforeContact, true)
  console.log(`    BC: FPS=${beforeContact?.fps?.toFixed(1) ?? '--'}, NPC Update=${beforeContact?.npcUpdateAvg?.toFixed(2) ?? '--'}ms, Alive=${beforeContact?.alive ?? '--'}, Dead=${beforeContact?.dead ?? '--'}`)

  // 等待接戰
  await waitForCombat(page, 45000)

  // 重置，During Combat 窗口乾淨
  await resetProfiler(page, withSubphase)

  // During Combat 採樣
  const sampleDuration = withSubphase ? 5000 : 3500  // subphase ON 需要幾個 8-frame window
  console.log(`    During Combat: sampling ${sampleDuration / 1000}s...`)
  await sleep(sampleDuration)

  const duringCombat = await collectSnapshot(page, withSubphase)
  assertSnapshotPopulation(scenarioLetter, 'During Combat', duringCombat)
  console.log(`    DC: FPS=${duringCombat?.fps?.toFixed(1) ?? '--'}, NPC Update=${duringCombat?.npcUpdateAvg?.toFixed(2) ?? '--'}ms, Alive=${duringCombat?.alive ?? '--'}, Dead=${duringCombat?.dead ?? '--'}`)

  // 截圖
  const outDir = path.resolve('output/profile')
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
  const tag = withSubphase ? 'on' : 'off'
  const scPath = path.join(outDir, `npc-subphase-${scenarioLetter}-${tag}.png`)
  await page.screenshot({ path: scPath })
  console.log(`    Screenshot → ${scPath}`)

  return { beforeContact, duringCombat, screenshot: scPath }
}

// ─── 子階段 console 摘要 ──────────────────────────────────────
function printSubphase(subSnap, npcUpdateAvg, label) {
  if (!subSnap) { console.log(`  [${label}] (no subphase data)`); return }
  const ref = npcUpdateAvg || 1
  const phases = [
    ['Grid Nearby Query',  subSnap.gridQuery],
    ['Target / AI',        subSnap.targetAI],
    ['Separation',         subSnap.separation],
    ['Obstacle Avoidance', subSnap.obstacleAvoid],
    ['Movement / Facing',  subSnap.moveFace],
    ['Combat Logic',       subSnap.combatLogic],
    ['Humanoid Animation', subSnap.humanoidAnim],
    ['Mount Update',       subSnap.mountUpdate],
    ['Foot Physics',       subSnap.footPhysics],
    ['Dead Update',        subSnap.deadUpdate],
  ]
  console.log(`  [${label}] NPC Update raw = ${ref.toFixed(2)} ms`)
  for (const [lbl, stat] of phases) {
    const avg = stat?.avg ?? 0
    const pct = ((avg / ref) * 100).toFixed(0)
    console.log(`    ${lbl.padEnd(22)}: ${avg.toFixed(2).padStart(6)} ms  ${pct.padStart(3)}%`)
  }
  const classified = phases.reduce((s, [, v]) => s + (v?.avg ?? 0), 0)
  const other = Math.max(0, ref - classified)
  console.log(`    ${'Other (est.)'.padEnd(22)}: ${other.toFixed(2).padStart(6)} ms  ${((other / ref) * 100).toFixed(0).padStart(3)}%`)
}

// ─── Markdown 報告 ────────────────────────────────────────────
function buildReport(scenarios, results) {
  const lines = []

  lines.push('# NPC Subphase Profiling Report')
  lines.push('')
  lines.push(`Generated: ${new Date().toISOString()}`)
  lines.push('')

  // ── Overhead 對比 ──
  lines.push('## Profiling Instrumentation Overhead')
  lines.push('')
  lines.push('| Scenario | Phase | NPC Update OFF (ms) | NPC Update ON (ms) | Overhead est. (ms) |')
  lines.push('| :--- | :--- | :--- | :--- | :--- |')
  for (const sc of scenarios) {
    const r = results[sc.letter]
    if (!r) continue
    for (const [phase, pk] of [['Before Contact', 'beforeContact'], ['During Combat', 'duringCombat']]) {
      const off = r.off[pk]?.npcUpdateAvg
      const on  = r.on[pk]?.npcUpdateAvg
      const oh  = (off != null && on != null) ? (on - off).toFixed(2) : '--'
      const lbl = pk === 'beforeContact' ? `**${sc.label}**` : ''
      lines.push(`| ${lbl} | ${phase} | ${off?.toFixed(2) ?? '--'} | ${on?.toFixed(2) ?? '--'} | ${oh} |`)
    }
  }
  lines.push('')

  // ── Raw Metrics ──
  lines.push('## Raw Profiler Metrics (subphase ON)')
  lines.push('')
  lines.push('| Scenario | Phase | Alive/Dead | FPS | CPU Frame avg/max | NPC Update avg/max | Renderer Submit avg/max | Draw Calls |')
  lines.push('| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |')
  for (const sc of scenarios) {
    const r = results[sc.letter]
    if (!r) continue
    for (const [phase, pk] of [['Before Contact', 'beforeContact'], ['During Combat', 'duringCombat']]) {
      const d = r.on[pk]
      const s = d?.snapshot
      if (!s) continue
      const lbl = pk === 'beforeContact' ? `**${sc.label}**` : ''
      lines.push(`| ${lbl} | ${phase} | ${d.alive}/${d.dead} | ${s.fps.toFixed(1)} | ${s.cpuFrame.avg.toFixed(1)} / ${s.cpuFrame.max.toFixed(1)} | ${s.npcUpdate.avg.toFixed(2)} / ${s.npcUpdate.max.toFixed(2)} | ${s.renderSubmit.avg.toFixed(1)} / ${s.renderSubmit.max.toFixed(1)} | ${d.drawCalls?.toLocaleString() ?? '--'} |`)
    }
  }
  lines.push('')

  // ── Subphase 表 ──
  const phaseKeys = [
    ['Grid Nearby Query',  'gridQuery'],
    ['Target / AI',        'targetAI'],
    ['Separation',         'separation'],
    ['Obstacle Avoidance', 'obstacleAvoid'],
    ['Movement / Facing',  'moveFace'],
    ['Combat Logic',       'combatLogic'],
    ['Humanoid Animation', 'humanoidAnim'],
    ['Mount Update',       'mountUpdate'],
    ['Foot Physics',       'footPhysics'],
    ['Dead Update',        'deadUpdate'],
  ]

  lines.push('## NPC Subphase Breakdown (cohort sampling estimate)')
  lines.push('')
  lines.push('> % is relative to NPC Update raw avg. Σ may not equal 100%.')
  lines.push('')

  for (const sc of scenarios) {
    const r = results[sc.letter]
    if (!r) continue
    lines.push(`### ${sc.label}`)
    lines.push('')
    lines.push('| Subphase | Before Contact ms | BC % | During Combat ms | DC % |')
    lines.push('| :--- | ---: | ---: | ---: | ---: |')

    const bcSnap = r.on.beforeContact?.subphaseSnapshot
    const dcSnap = r.on.duringCombat?.subphaseSnapshot
    const bcRef  = r.on.beforeContact?.npcUpdateAvg ?? 1
    const dcRef  = r.on.duringCombat?.npcUpdateAvg  ?? 1

    let bcSum = 0, dcSum = 0
    for (const [lbl, key] of phaseKeys) {
      const bcv = bcSnap?.[key]?.avg ?? 0
      const dcv = dcSnap?.[key]?.avg ?? 0
      bcSum += bcv
      dcSum += dcv
      lines.push(`| ${lbl} | ${bcv.toFixed(2)} | ${((bcv / bcRef) * 100).toFixed(0)}% | ${dcv.toFixed(2)} | ${((dcv / dcRef) * 100).toFixed(0)}% |`)
    }
    const bcOther = Math.max(0, bcRef - bcSum)
    const dcOther = Math.max(0, dcRef - dcSum)
    lines.push(`| Other (est.) | ${bcOther.toFixed(2)} | ${((bcOther / bcRef) * 100).toFixed(0)}% | ${dcOther.toFixed(2)} | ${((dcOther / dcRef) * 100).toFixed(0)}% |`)
    lines.push(`| **NPC Update raw** | **${bcRef.toFixed(2)}** | 100% | **${dcRef.toFixed(2)}** | 100% |`)
    lines.push('')
  }

  // ── 排名 ──
  lines.push('## Cross-Scenario Subphase Ranking')
  lines.push('')

  const contextLabels = []
  const phaseData = {}  // phase key → array of avgs

  for (const sc of scenarios) {
    const r = results[sc.letter]
    if (!r) continue
    for (const [phase, pk] of [['Before Contact', 'beforeContact'], ['During Combat', 'duringCombat']]) {
      const snap = r.on[pk]?.subphaseSnapshot
      if (!snap) continue
      contextLabels.push(`${sc.short} ${phase === 'Before Contact' ? 'BC' : 'DC'}`)
      for (const [, key] of phaseKeys) {
        if (!phaseData[key]) phaseData[key] = []
        phaseData[key].push(snap[key]?.avg ?? 0)
      }
    }
  }

  if (contextLabels.length > 0) {
    const ranked = phaseKeys.map(([lbl, key]) => {
      const vals = phaseData[key] || []
      return { lbl, key, vals, maxVal: Math.max(...vals, 0) }
    }).sort((a, b) => b.maxVal - a.maxVal)

    lines.push(`| Rank | Subphase | ${contextLabels.join(' | ')} | Max |`)
    lines.push(`| :--- | :--- | ${contextLabels.map(() => '---:').join(' | ')} | ---: |`)
    for (let i = 0; i < ranked.length; i++) {
      const { lbl, vals, maxVal } = ranked[i]
      lines.push(`| ${i + 1} | **${lbl}** | ${vals.map((v) => v.toFixed(2)).join(' | ')} | **${maxVal.toFixed(2)}** |`)
    }
    lines.push('')

    lines.push('### Top 3 最大子階段成本')
    lines.push('')
    for (let i = 0; i < Math.min(3, ranked.length); i++) {
      lines.push(`${i + 1}. **${ranked[i].lbl}** — max ${ranked[i].maxVal.toFixed(2)} ms`)
    }
    lines.push('')
    lines.push('> 本 script 僅呈現量測結果。下一支 PR 優化方向請依這些數字決定。')
  }

  return lines.join('\n')
}

// ─── 主程式 ──────────────────────────────────────────────────
async function main() {
  const server = await startDevServer()

  let browser
  try {
    console.log('Launching Google Chrome...')
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

    // 禁用 HMR WebSocket（避免 dev server HMR 觸發 reload）
    await context.route('**/ws', (route) => route.abort())

    const page = await context.newPage()

    // 讓頁面錯誤不中止 script
    page.on('pageerror', (err) => console.warn('[page error]', err.message.substring(0, 80)))

    // ── 環境資訊 ──
    await page.goto(`${BASE_URL}/?devcombat=d&nolock`, { waitUntil: 'domcontentloaded' })
    await waitForGame(page, 30000)

    const envInfo = await page.evaluate(() => {
      const canvas = document.querySelector('canvas')
      const gl = canvas ? (canvas.getContext('webgl2') || canvas.getContext('webgl')) : null
      const dbg = gl ? gl.getExtension('WEBGL_debug_renderer_info') : null
      return {
        userAgent:      navigator.userAgent,
        webglVendor:    dbg && gl ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : 'Unknown',
        webglRenderer:  dbg && gl ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'Unknown',
        devicePixelRatio: window.devicePixelRatio,
      }
    })

    console.log('\n================ ENVIRONMENT ================')
    console.log(`GPU: ${envInfo.webglRenderer}`)
    console.log(`GPU Vendor: ${envInfo.webglVendor}`)
    console.log(`DPR: ${envInfo.devicePixelRatio}`)
    console.log('=============================================\n')

    // ── Scenario 清單 ──
    // Scenario D = ?devcombat=d (100v100 騎兵 + 馬弓，formation mode)
    // Scenario E = ?devcombat=e (100v100 All-Melee Cavalry, Scattered, Initial Spectator)
    const scenarios = [
      { letter: 'd', label: 'Scenario D (100v100 Cavalry + Horse Archer)', short: 'D' },
      { letter: 'e', label: 'Scenario E (100v100 All-Melee Cavalry, Scattered)', short: 'E' },
    ]

    const results = {}

    for (const sc of scenarios) {
      console.log(`\n${'='.repeat(60)}`)
      console.log(`${sc.label}`)
      console.log('='.repeat(60))

      console.log('\n[Pass A] subphase OFF')
      const offResult = await runPass(page, sc.letter, false)

      console.log('\n[Pass B] subphase ON')
      const onResult = await runPass(page, sc.letter, true)

      results[sc.letter] = { off: offResult, on: onResult }

      // console 子階段摘要
      for (const [pk, pLabel] of [['beforeContact', 'Before Contact'], ['duringCombat', 'During Combat']]) {
        const d = onResult[pk]
        printSubphase(d?.subphaseSnapshot, d?.npcUpdateAvg, `${sc.short} ${pLabel}`)
      }
    }

    // ── 輸出 ──
    const outDir = path.resolve('output/profile')
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })

    const report = buildReport(scenarios, results)

    const jsonPath = path.join(outDir, 'npc-subphase-results.json')
    const mdPath   = path.join(outDir, 'npc-subphase-table.md')

    fs.writeFileSync(
      jsonPath,
      JSON.stringify({ envInfo, scenarios, results }, null, 2),
    )
    fs.writeFileSync(mdPath, report)

    console.log('\n\n================ REPORT ================')
    console.log(report)
    console.log('========================================\n')
    console.log(`JSON → ${jsonPath}`)
    console.log(`MD   → ${mdPath}`)

  } catch (err) {
    console.error('Script error:', err)
    process.exitCode = 1
  } finally {
    if (browser) await browser.close().catch(() => {})
    server.kill()
    console.log('Done.')
  }
}

main()
