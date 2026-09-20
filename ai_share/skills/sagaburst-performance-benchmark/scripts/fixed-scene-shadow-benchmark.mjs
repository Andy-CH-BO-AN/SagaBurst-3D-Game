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
SagaBurst 固定場景陰影成本拆解 (Fixed-Scene Shadow Cost Breakdown)

選項：
  --scenario=F            預設 F
  --settle-ms=N           接戰後展開時間 (ms)，預設 4000
  --observation-ms=N      每個 Window 觀測時間 (ms)，預設 4000
  --timeout-ms=N          等待 Combat Evidence 超時時間 (ms)，預設 30000
  --shadow-map-size=N     DEV shadowMapSize（2048 / 1024 / 512 / 256），預設 production 值
  --host=HOST:PORT        預設 127.0.0.1:5173
  --tag=NAME              輸出 tag
  --out=PATH              指定輸出 JSON 路徑 (預設 output/local-diagnostics/fixed-scene-shadow.json)
`)
  process.exit(0)
}

const scenario = valueOf('scenario', 'F').toUpperCase()
const settleMs = Number(valueOf('settle-ms', '4000'))
const observationMs = Number(valueOf('observation-ms', '4000'))
const timeoutMs = Number(valueOf('timeout-ms', '30000'))
const shadowMapSize = valueOf('shadow-map-size', '')
const host = valueOf('host', '127.0.0.1:5173')
const tag = valueOf('tag', 'fixed-scene-shadow')
const defaultOut = path.resolve('output/local-diagnostics/fixed-scene-shadow.json')
const outPath = path.resolve(valueOf('out', defaultOut))

const chromePath = process.env.SAGABURST_CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
if (!fs.existsSync(chromePath)) {
  throw new Error(`Local Google Chrome executable not found at ${chromePath}; set SAGABURST_CHROME_PATH`)
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  if (sorted.length === 0) return 0
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}

console.log(`[Fixed-Scene Shadow Benchmark] 啟動 headed Chrome (${chromePath})...`)
const browser = await chromium.launch({ headless: false, executablePath: chromePath })
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } })
const page = await context.newPage()

try {
  const shadowMapQuery = shadowMapSize ? `&shadowMapSize=${encodeURIComponent(shadowMapSize)}` : ''
  const targetUrl = `http://${host}/?devcombat=${scenario.toLowerCase()}&nolock${shadowMapQuery}`
  console.log(`[Fixed-Scene Shadow Benchmark] 載入頁面: ${targetUrl}`)
  await page.goto(targetUrl)

  console.log(`[Fixed-Scene Shadow Benchmark] 等待 Combat Evidence (Active Attack > 0 || Arrow Count > 0 || Dead > 0)...`)
  await page.waitForFunction(
    () => {
      const hud = document.querySelector('#dev-combat-status')?.textContent ?? ''
      const active = Number(hud.match(/Active Attack NPCs:\s+(\d+)/)?.[1] ?? 0)
      const dead = Number(hud.match(/Dead:\s+(\d+)/)?.[1] ?? 0)
      const arrows = Number(hud.match(/Arrow Count:\s+(\d+)/)?.[1] ?? 0)
      return (active > 0 || dead > 0 || arrows > 0) && (window.game !== undefined)
    },
    { timeout: timeoutMs }
  )

  console.log(`[Fixed-Scene Shadow Benchmark] 已偵測到交戰信號，等待戰況展開 ${settleMs} ms...`)
  await page.waitForTimeout(settleMs)

  console.log(`[Fixed-Scene Shadow Benchmark] 執行 Simulation Freeze...`)
  await page.evaluate(() => {
    window.game.setSimulationFrozen(true)
  })

  // 擷取初始凍結場景特徵指紋 (逐 entity 穩定座標快照)
  const initialFingerprint = await page.evaluate(() => {
    const game = window.game
    const hudText = document.querySelector('#dev-combat-status')?.textContent ?? ''
    const alive = game.npcs.filter((n) => !n.dead).length
    const dead = game.npcs.filter((n) => n.dead).length
    const arrowCount = game.arrows.length
    const horseCount = game.mounts.length
    const camPos = game.camera.position.toArray()
    const camQuat = game.camera.quaternion.toArray()
    const npcPositions = game.npcs.map((n) => [n.group.position.x, n.group.position.y, n.group.position.z])
    const mountPositions = game.mounts.map((m) => [m.group.position.x, m.group.position.y, m.group.position.z])
    const arrowPositions = game.arrows.map((a) => [a.mesh.position.x, a.mesh.position.y, a.mesh.position.z])
    return {
      alive,
      dead,
      arrowCount,
      horseCount,
      camPos,
      camQuat,
      npcPositions,
      mountPositions,
      arrowPositions,
      hudText,
    }
  })

  console.log(
    `[Fixed-Scene Shadow Benchmark] 凍結完成: Alive=${initialFingerprint.alive}, Dead=${initialFingerprint.dead}, Arrows=${initialFingerprint.arrowCount}, Horses=${initialFingerprint.horseCount}`
  )

  /**
   * 執行單一觀察窗口 (嚴格隔離 RuntimeProfiler，等待 generation 推進)
   */
  async function observeWindow(windowLabel, enableShadow) {
    console.log(`[Fixed-Scene Shadow Benchmark] === 進入 ${windowLabel} (Shadow=${enableShadow}) ===`)
    const resetGen = await page.evaluate((enabled) => {
      window.game.setShadowsEnabled(enabled)
      return window.__resetRuntimeProfiler(performance.now())
    }, enableShadow)

    console.log(`[Fixed-Scene Shadow Benchmark] 等待 reset (generation=${resetGen}) 後產生第一個完整新 snapshot...`)
    await page.waitForFunction(
      (gen) => {
        const s = window.game?.runtimeProfiler?.getLatestSnapshot()
        return s !== null && s.generation > gen
      },
      resetGen,
      { timeout: 8000 }
    )

    console.log(`[Fixed-Scene Shadow Benchmark] 開始觀測 ${observationMs} ms (依 generation 去重)...`)
    const startTime = Date.now()
    const samples = []
    const seenGenerations = new Set()

    while (Date.now() - startTime < observationMs) {
      await page.waitForTimeout(200)
      const sample = await page.evaluate(() => {
        const game = window.game
        const s = game.runtimeProfiler.getLatestSnapshot()
        const hud = document.querySelector('#dev-combat-status')?.textContent ?? ''
        return {
          snapshot: s
            ? {
                generation: s.generation,
                timestamp: s.timestamp,
                fps: s.fps,
                cpuFrameMs: s.cpuFrame.avg,
                renderSubmitMs: s.renderSubmit.avg,
              }
            : null,
          hudText: hud,
        }
      })

      if (sample.snapshot && sample.snapshot.generation > resetGen) {
        if (!seenGenerations.has(sample.snapshot.generation)) {
          seenGenerations.add(sample.snapshot.generation)
          samples.push(sample)
        }
      }
    }

    if (samples.length === 0) {
      throw new Error(`${windowLabel} 未能採樣到有效的 RuntimeProfiler snapshot`)
    }

    const medFps = median(samples.map((s) => s.snapshot.fps))
    const medCpuFrame = median(samples.map((s) => s.snapshot.cpuFrameMs))
    const medRenderSubmit = median(samples.map((s) => s.snapshot.renderSubmitMs))

    console.log(
      `[Fixed-Scene Shadow Benchmark] ${windowLabel} 觀測結果 (${samples.length} 個獨立 generation 樣本): FPS=${medFps.toFixed(1)}, CPU Frame=${medCpuFrame.toFixed(2)}ms, Render Submit=${medRenderSubmit.toFixed(2)}ms`
    )

    return {
      label: windowLabel,
      enableShadow,
      sampleCount: samples.length,
      fps: medFps,
      cpuFrameMs: medCpuFrame,
      renderSubmitMs: medRenderSubmit,
      rawSamples: samples,
    }
  }

  // ── Window A: Shadow ON #1 ──
  const windowA = await observeWindow('Shadow ON #1', true)
  const mainCensusOn1 = await page.evaluate(() => window.__collectMainPassCensus(window.game))
  const shadowCensusOn = await page.evaluate(() => window.__collectShadowPassCensus(window.game))

  // ── Window B: Shadow OFF ──
  const windowB = await observeWindow('Shadow OFF', false)
  const mainCensusOff = await page.evaluate(() => window.__collectMainPassCensus(window.game))
  const shadowCensusOff = await page.evaluate(() => window.__collectShadowPassCensus(window.game))

  // ── Window C: Shadow ON #2 (Sanity Check) ──
  const windowC = await observeWindow('Shadow ON #2', true)

  // ── 結束驗證指紋 (逐 entity 穩定座標快照) ──
  const finalFingerprint = await page.evaluate(() => {
    const game = window.game
    const alive = game.npcs.filter((n) => !n.dead).length
    const dead = game.npcs.filter((n) => n.dead).length
    const arrowCount = game.arrows.length
    const horseCount = game.mounts.length
    const camPos = game.camera.position.toArray()
    const camQuat = game.camera.quaternion.toArray()
    const npcPositions = game.npcs.map((n) => [n.group.position.x, n.group.position.y, n.group.position.z])
    const mountPositions = game.mounts.map((m) => [m.group.position.x, m.group.position.y, m.group.position.z])
    const arrowPositions = game.arrows.map((a) => [a.mesh.position.x, a.mesh.position.y, a.mesh.position.z])
    return {
      alive,
      dead,
      arrowCount,
      horseCount,
      camPos,
      camQuat,
      npcPositions,
      mountPositions,
      arrowPositions,
    }
  })

  // ── 嚴格 Invariant 檢查 ──
  console.log(`[Fixed-Scene Shadow Benchmark] 執行 Invariant 嚴格校驗...`)

  const errors = []
  if (initialFingerprint.alive !== finalFingerprint.alive) {
    errors.push(`Alive 人數變動: 初始 ${initialFingerprint.alive} vs 結束 ${finalFingerprint.alive}`)
  }
  if (initialFingerprint.dead !== finalFingerprint.dead) {
    errors.push(`Dead 人數變動: 初始 ${initialFingerprint.dead} vs 結束 ${finalFingerprint.dead}`)
  }
  if (initialFingerprint.arrowCount !== finalFingerprint.arrowCount) {
    errors.push(`Arrow 數量變動: 初始 ${initialFingerprint.arrowCount} vs 結束 ${finalFingerprint.arrowCount}`)
  }
  if (initialFingerprint.horseCount !== finalFingerprint.horseCount) {
    errors.push(`Horse 數量變動: 初始 ${initialFingerprint.horseCount} vs 結束 ${finalFingerprint.horseCount}`)
  }

  // 逐 NPC 座標校驗
  if (initialFingerprint.npcPositions.length !== finalFingerprint.npcPositions.length) {
    errors.push(`NPC 實體數變動: 初始 ${initialFingerprint.npcPositions.length} vs 結束 ${finalFingerprint.npcPositions.length}`)
  } else {
    for (let i = 0; i < initialFingerprint.npcPositions.length; i++) {
      const [x0, y0, z0] = initialFingerprint.npcPositions[i]
      const [x1, y1, z1] = finalFingerprint.npcPositions[i]
      const dist = Math.hypot(x1 - x0, y1 - y0, z1 - z0)
      if (dist > 1e-4) {
        errors.push(`NPC #${i} 座標變動 (dist=${dist.toFixed(6)}): [${x0.toFixed(2)}, ${y0.toFixed(2)}, ${z0.toFixed(2)}] -> [${x1.toFixed(2)}, ${y1.toFixed(2)}, ${z1.toFixed(2)}]`)
        break
      }
    }
  }

  // 逐 Mount 座標校驗
  if (initialFingerprint.mountPositions.length !== finalFingerprint.mountPositions.length) {
    errors.push(`Mount 實體數變動: 初始 ${initialFingerprint.mountPositions.length} vs 結束 ${finalFingerprint.mountPositions.length}`)
  } else {
    for (let i = 0; i < initialFingerprint.mountPositions.length; i++) {
      const [x0, y0, z0] = initialFingerprint.mountPositions[i]
      const [x1, y1, z1] = finalFingerprint.mountPositions[i]
      const dist = Math.hypot(x1 - x0, y1 - y0, z1 - z0)
      if (dist > 1e-4) {
        errors.push(`Mount #${i} 座標變動 (dist=${dist.toFixed(6)}): [${x0.toFixed(2)}, ${y0.toFixed(2)}, ${z0.toFixed(2)}] -> [${x1.toFixed(2)}, ${y1.toFixed(2)}, ${z1.toFixed(2)}]`)
        break
      }
    }
  }

  // 逐 Arrow 座標校驗
  if (initialFingerprint.arrowPositions.length !== finalFingerprint.arrowPositions.length) {
    errors.push(`Arrow 實體數變動: 初始 ${initialFingerprint.arrowPositions.length} vs 結束 ${finalFingerprint.arrowPositions.length}`)
  } else {
    for (let i = 0; i < initialFingerprint.arrowPositions.length; i++) {
      const [x0, y0, z0] = initialFingerprint.arrowPositions[i]
      const [x1, y1, z1] = finalFingerprint.arrowPositions[i]
      const dist = Math.hypot(x1 - x0, y1 - y0, z1 - z0)
      if (dist > 1e-4) {
        errors.push(`Arrow #${i} 座標變動 (dist=${dist.toFixed(6)}): [${x0.toFixed(2)}, ${y0.toFixed(2)}, ${z0.toFixed(2)}] -> [${x1.toFixed(2)}, ${y1.toFixed(2)}, ${z1.toFixed(2)}]`)
        break
      }
    }
  }

  // 攝影機位置與四元數校驗
  const camPosDiff = initialFingerprint.camPos.reduce(
    (sum, val, idx) => sum + Math.abs(val - finalFingerprint.camPos[idx]),
    0
  )
  if (camPosDiff > 1e-5) {
    errors.push(`Camera 位置變動: diff = ${camPosDiff}`)
  }
  const camQuatDiff = initialFingerprint.camQuat.reduce(
    (sum, val, idx) => sum + Math.abs(val - finalFingerprint.camQuat[idx]),
    0
  )
  if (camQuatDiff > 1e-5) {
    errors.push(`Camera 旋轉四元數變動: diff = ${camQuatDiff}`)
  }

  // Non-shadow MainPassCensus Invariants
  const nonShadowCallsOn = mainCensusOn1.passTotals.totalNonShadow.mainSubmissions
  const nonShadowCallsOff = mainCensusOff.passTotals.totalNonShadow.mainSubmissions
  const nonShadowTrisOn = mainCensusOn1.passTotals.totalNonShadow.triangles
  const nonShadowTrisOff = mainCensusOff.passTotals.totalNonShadow.triangles

  if (nonShadowCallsOn !== nonShadowCallsOff) {
    errors.push(`Main/non-shadow Calls 不一致: ON=${nonShadowCallsOn} vs OFF=${nonShadowCallsOff}`)
  }
  if (nonShadowTrisOn !== nonShadowTrisOff) {
    errors.push(`Main/non-shadow Triangles 不一致: ON=${nonShadowTrisOn} vs OFF=${nonShadowTrisOff}`)
  }

  // ShadowPassCensus Sanity Invariants
  if (shadowCensusOn.totalSubmissions <= 0) {
    errors.push(`Shadow ON 時 Shadow Census submissions 必須 > 0，實際為: ${shadowCensusOn.totalSubmissions}`)
  }
  if (shadowCensusOff.totalSubmissions !== 0) {
    errors.push(`Shadow OFF 時 Shadow Census submissions 必須 == 0，實際為: ${shadowCensusOff.totalSubmissions}`)
  }
  if (shadowCensusOff.totalTriangles !== 0) {
    errors.push(`Shadow OFF 時 Shadow Census triangles 必須 == 0，實際為: ${shadowCensusOff.totalTriangles}`)
  }

  if (errors.length > 0) {
    console.error(`[Fixed-Scene Shadow Benchmark] Invariant 校驗失敗:\n - ${errors.join('\n - ')}`)
    throw new Error(`Fixed-Scene Invariant Check Failed:\n${errors.join('\n')}`)
  }

  console.log(`[Fixed-Scene Shadow Benchmark] 所有 Invariants 完全吻合！`)

  // ── 計算差值與分析 ──
  const diffOn1ToOff = windowB.renderSubmitMs - windowA.renderSubmitMs
  const pctOn1ToOff = (diffOn1ToOff / windowA.renderSubmitMs) * 100
  const diffOn1ToOn2 = windowC.renderSubmitMs - windowA.renderSubmitMs
  const pctOn1ToOn2 = (diffOn1ToOn2 / windowA.renderSubmitMs) * 100

  // ── 格式化輸出報告 ──
  const report = {
    generatedAt: new Date().toISOString(),
    scenario,
    tag,
    shadowMapSize: shadowMapSize ? Number(shadowMapSize) : null,
    fingerprint: {
      alive: initialFingerprint.alive,
      dead: initialFingerprint.dead,
      arrowCount: initialFingerprint.arrowCount,
      horseCount: initialFingerprint.horseCount,
      camPos: initialFingerprint.camPos,
      camQuat: initialFingerprint.camQuat,
      npcCount: initialFingerprint.npcPositions.length,
      mountCount: initialFingerprint.mountPositions.length,
    },
    abResults: {
      on1: windowA,
      off: windowB,
      on2: windowC,
      deltaOnToOffMs: diffOn1ToOff,
      deltaOnToOffPct: pctOn1ToOff,
      deltaOnToOn2Ms: diffOn1ToOn2,
      deltaOnToOn2Pct: pctOn1ToOn2,
      nonShadowCalls: nonShadowCallsOn,
      nonShadowTriangles: nonShadowTrisOn,
    },
    shadowCensus: shadowCensusOn,
    shadowCasterInstances: shadowCensusOn.categories.reduce((sum, category) => sum + category.instances, 0),
    shadowCensusOff,
    mainPassCensusOn: {
      passTotals: mainCensusOn1.passTotals,
      categories: mainCensusOn1.categories,
    },
    mainPassCensusOff: {
      passTotals: mainCensusOff.passTotals,
    },
  }

  // 寫入輸出檔案
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8')
  console.log(`[Fixed-Scene Shadow Benchmark] 原始 JSON 已儲存至: ${outPath}`)

  // 終端印出 Markdown 報告
  console.log(`\n================== 固定場景量測結果 (Fixed-Scene Shadow Breakdown) ==================\n`)
  console.log(`### 戰場凍結上下文 (Scene Context)`)
  console.log(`- 存活人數 (Alive): ${initialFingerprint.alive}`)
  console.log(`- 陣亡人數 (Dead): ${initialFingerprint.dead}`)
  console.log(`- 空中箭矢 (Arrows): ${initialFingerprint.arrowCount}`)
  console.log(`- 戰馬數量 (Horses): ${initialFingerprint.horseCount}`)
  console.log(`- 攝影機位置: [${initialFingerprint.camPos.map((v) => v.toFixed(2)).join(', ')}]`)
  console.log(`- 攝影機旋轉: [${initialFingerprint.camQuat.map((v) => v.toFixed(2)).join(', ')}]\n`)

  console.log(`### Same-scene Shadow A/B 對比表`)
  console.log(`| 狀態 | Renderer Submit | CPU Frame | Main/non-shadow Calls | Main/non-shadow Tris | 備註 |`)
  console.log(`|:---|---:|---:|---:|---:|:---|`)
  console.log(
    `| Shadow ON #1 | ${windowA.renderSubmitMs.toFixed(2)} ms | ${windowA.cpuFrameMs.toFixed(2)} ms | ${nonShadowCallsOn} | ${nonShadowTrisOn.toLocaleString()} | 初始基準 |`
  )
  console.log(
    `| Shadow OFF | ${windowB.renderSubmitMs.toFixed(2)} ms | ${windowB.cpuFrameMs.toFixed(2)} ms | ${nonShadowCallsOff} | ${nonShadowTrisOff.toLocaleString()} | 差距: ${diffOn1ToOff.toFixed(2)} ms (${pctOn1ToOff.toFixed(1)}%) |`
  )
  console.log(
    `| Shadow ON #2 | ${windowC.renderSubmitMs.toFixed(2)} ms | ${windowC.cpuFrameMs.toFixed(2)} ms | ${nonShadowCallsOn} | ${nonShadowTrisOn.toLocaleString()} | 回復檢驗: ${diffOn1ToOn2 >= 0 ? '+' : ''}${diffOn1ToOn2.toFixed(2)} ms |`
  )
  console.log(``)

  console.log(`### Shadow Pass Census (陰影投射類別人口普查)`)
  console.log(`| Category | Shadow Submissions | Shadow Triangles | Instances | Skinned Meshes | 佔比 (Submissions) |`)
  console.log(`|:---|---:|---:|---:|---:|---:|`)
  for (const cat of shadowCensusOn.categories) {
    const pct =
      shadowCensusOn.totalSubmissions > 0
        ? ((cat.shadowSubmissions / shadowCensusOn.totalSubmissions) * 100).toFixed(1)
        : '0.0'
    console.log(
      `| ${cat.category} | ${cat.shadowSubmissions} | ${cat.shadowTriangles.toLocaleString()} | ${cat.instances} | ${cat.submittedSkinnedMeshes} | ${pct}% |`
    )
  }
  console.log(
    `| **Total** | **${shadowCensusOn.totalSubmissions}** | **${shadowCensusOn.totalTriangles.toLocaleString()}** | - | - | **100.0%** |`
  )
  console.log(``)

  if (shadowCensusOn.details && shadowCensusOn.details.length > 0) {
    console.log(`### Shadow Pass Census 詳細分類 (Top 10)`)
    console.log(`| Category / Part | Shadow Submissions | Shadow Triangles | Instances |`)
    console.log(`|:---|---:|---:|---:|`)
    for (const d of shadowCensusOn.details.slice(0, 10)) {
      console.log(`| ${d.category} | ${d.shadowSubmissions} | ${d.shadowTriangles.toLocaleString()} | ${d.instances} |`)
    }
    console.log(``)
  }

  console.log(`====================================================================================\n`)
} finally {
  await browser.close()
}
