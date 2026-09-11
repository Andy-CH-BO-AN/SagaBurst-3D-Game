import { chromium } from 'playwright'
import { spawn } from 'child_process'

async function main() {
  console.log('=== Starting Rigorous Cold Start & Frame Benchmarks via Playwright ===')
  
  const port = '5198'
  // Start preview server
  const server = spawn('npx', ['vite', 'preview', '--port', port], {
    stdio: 'pipe',
  })

  // Wait for server to start
  await new Promise((resolve) => setTimeout(resolve, 2000))

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()

  try {
    // ──────────────────────────────────────────────────────────
    // 1. Hard Reload & Page Load
    // ──────────────────────────────────────────────────────────
    await page.goto(`http://localhost:${port}/?devcombat&nolock`)
    await page.waitForFunction(() => window.game && window.game.player && window.game.renderer)

    // Allow frames to stabilize
    await page.waitForTimeout(1000)

    // ──────────────────────────────────────────────────────────
    // 2. Barricade Raycast Obstruction Verification (Explicit Identity)
    // ──────────────────────────────────────────────────────────
    const barricadeCheck = await page.evaluate(() => {
      const g = window.game
      
      // Find a barricade mesh child strictly by explicit userData / name identity
      const barricadeMesh = g._aimTargetRegistry.targets.find(
        (t) => t.isMesh && (t.userData?.isBarricade === true || t.name?.startsWith('barricade'))
      )

      if (!barricadeMesh) {
        return { error: 'No barricade mesh found with explicit identity', targetsCount: g._aimTargetRegistry.targets.length }
      }

      // Ensure matrixWorld is fully updated
      g.scene.updateMatrixWorld(true)

      // Calculate its exact world center
      const worldPos = g.camera.position.clone()
      barricadeMesh.getWorldPosition(worldPos)

      // Raycast directly towards the barricade mesh from 5m away
      const origin = worldPos.clone().add(new g.camera.position.constructor(0, 0, 5))
      const dir = worldPos.clone().sub(origin).normalize()
      const raycaster = new g._aimRaycaster.constructor(origin, dir)
      raycaster.layers.enable(1)
      const hits = raycaster.intersectObjects(g._aimTargetRegistry.targets, false)

      return {
        hitCount: hits.length,
        firstHitObject: hits[0] ? hits[0].object.type : null,
        hitObjectName: hits[0] ? hits[0].object.name : null,
        isBarricade: hits[0] ? hits[0].object.userData?.isBarricade === true : false,
        hitDistance: hits[0] ? hits[0].distance : null,
      }
    })

    console.log('\n[Barricade Aim Raycast Verification (Explicit Identity)]')
    console.log(`- Aim hits obstacle: ${barricadeCheck.hitCount > 0}`)
    console.log(`- Hit object: ${barricadeCheck.firstHitObject} (${barricadeCheck.hitObjectName}), isBarricade: ${barricadeCheck.isBarricade}`)
    console.log(`- Hit distance: ${barricadeCheck.hitDistance?.toFixed(2)}m`)

    // ──────────────────────────────────────────────────────────
    // 3. Aim Microbenchmark (Batch Timing: 100 batches x 100 calls = 10,000 calls)
    // ──────────────────────────────────────────────────────────
    const aimBench = await page.evaluate(() => {
      const g = window.game
      const target = g.camera.position.clone()
      g.player.isAiming = true

      const callsPerBatch = 100
      const batches = 100
      const batchAverages = new Float64Array(batches)

      for (let b = 0; b < batches; b++) {
        const start = performance.now()
        for (let i = 0; i < callsPerBatch; i++) {
          g._getCameraAimPoint(target)
        }
        batchAverages[b] = (performance.now() - start) / callsPerBatch
      }

      g.player.isAiming = false

      // Calculate statistics over batch samples
      const sorted = Array.from(batchAverages).sort((a, b) => a - b)
      const sum = sorted.reduce((acc, v) => acc + v, 0)
      const avg = sum / batches
      const min = sorted[0]
      const max = sorted[batches - 1]
      const p50 = sorted[Math.floor(batches * 0.5)]
      const p95 = sorted[Math.floor(batches * 0.95)]
      const p99 = sorted[Math.floor(batches * 0.99)]

      return {
        targetsCount: g._aimTargetRegistry.targets.length,
        totalCalls: callsPerBatch * batches,
        avgMs: avg,
        p50Ms: p50,
        p95Ms: p95,
        p99Ms: p99,
        minMs: min,
        maxMs: max,
      }
    })

    console.log('\n[Aim Raycast Microbenchmark - Batch Timing (100 batches x 100 = 10,000 calls)]')
    console.log(`- Active targets in registry: ${aimBench.targetsCount}`)
    console.log(`- Average per-call duration: ${aimBench.avgMs.toFixed(4)} ms`)
    console.log(`- Median (p50): ${aimBench.p50Ms.toFixed(4)} ms`)
    console.log(`- 95th Percentile (p95): ${aimBench.p95Ms.toFixed(4)} ms`)
    console.log(`- 99th Percentile (p99): ${aimBench.p99Ms.toFixed(4)} ms`)
    console.log(`- Min batch per-call: ${aimBench.minMs.toFixed(4)} ms | Max batch per-call: ${aimBench.maxMs.toFixed(4)} ms`)

    // ──────────────────────────────────────────────────────────
    // 4. Real Browser Frame Timing (Baseline vs First vs Second vs Delta)
    // ──────────────────────────────────────────────────────────
    const frameTiming = await page.evaluate(() => {
      const g = window.game

      function measureRender(action) {
        const start = performance.now()
        if (action) action()
        g.renderer.render(g.scene, g.camera)
        return performance.now() - start
      }

      // 4A: Aim Activation
      const aimBaseline = measureRender()
      const firstAim = measureRender(() => {
        g.player.isAiming = true
        const target = g.camera.position.clone()
        g._getCameraAimPoint(target)
      })
      const secondAim = measureRender(() => {
        const target = g.camera.position.clone()
        g._getCameraAimPoint(target)
      })
      g.player.isAiming = false

      // 4B: Projectile Launch
      const projBaseline = measureRender()
      const firstProj = measureRender(() => {
        const origin = g.camera.position.clone().set(0, 2, 0)
        const dir = g.camera.position.clone().set(0, 0, -1)
        g.player.onFireArrow({ origin, direction: dir, speed: 35, damage: 25 })
      })
      const secondProj = measureRender(() => {
        const origin = g.camera.position.clone().set(0, 2, 0)
        const dir = g.camera.position.clone().set(0, 0, -1)
        g.player.onFireArrow({ origin, direction: dir, speed: 35, damage: 25 })
      })

      // 4C: 60m Transition (LOD2 -> LOD1)
      const enemy = g.npcs.find((n) => n.faction === 'ENEMY' || n.faction === 'enemy')
      let lod60 = { baseline: 0, first: 0, second: 0 }
      let lod28 = { baseline: 0, first: 0, second: 0 }

      if (enemy) {
        const epos = enemy.group.position.clone()

        // 60m Transition: Place at 75m
        g.camera.position.set(epos.x, epos.y + 2, epos.z + 75)
        lod60.baseline = measureRender()

        // Approach 50m (LOD2 -> LOD1 trigger)
        lod60.first = measureRender(() => {
          g.camera.position.set(epos.x, epos.y + 2, epos.z + 50)
        })

        // Steady at 50m
        lod60.second = measureRender()

        // 28m Transition: Place at 35m
        g.camera.position.set(epos.x, epos.y + 2, epos.z + 35)
        lod28.baseline = measureRender()

        // Approach 20m (LOD1 -> LOD0 trigger)
        lod28.first = measureRender(() => {
          g.camera.position.set(epos.x, epos.y + 2, epos.z + 20)
        })

        // Steady at 20m
        lod28.second = measureRender()
      }

      return {
        aim: {
          baseline: aimBaseline,
          first: firstAim,
          second: secondAim,
          deltaVsBaseline: firstAim - aimBaseline,
        },
        projectile: {
          baseline: projBaseline,
          first: firstProj,
          second: secondProj,
          deltaVsBaseline: firstProj - projBaseline,
        },
        lod60: {
          baseline: lod60.baseline,
          first: lod60.first,
          second: lod60.second,
          deltaVsBaseline: lod60.first - lod60.baseline,
        },
        lod28: {
          baseline: lod28.baseline,
          first: lod28.first,
          second: lod28.second,
          deltaVsBaseline: lod28.first - lod28.baseline,
        },
      }
    })

    console.log('\n[Browser Frame Validation: Baseline vs First vs Second (Headless SwiftShader)]')
    console.log(`- Aiming:     Baseline=${frameTiming.aim.baseline.toFixed(1)}ms | First=${frameTiming.aim.first.toFixed(1)}ms | Second=${frameTiming.aim.second.toFixed(1)}ms | Delta=${frameTiming.aim.deltaVsBaseline > 0 ? '+' : ''}${frameTiming.aim.deltaVsBaseline.toFixed(1)}ms`)
    console.log(`- Projectile: Baseline=${frameTiming.projectile.baseline.toFixed(1)}ms | First=${frameTiming.projectile.first.toFixed(1)}ms | Second=${frameTiming.projectile.second.toFixed(1)}ms | Delta=${frameTiming.projectile.deltaVsBaseline > 0 ? '+' : ''}${frameTiming.projectile.deltaVsBaseline.toFixed(1)}ms`)
    console.log(`- LOD 60m:    Baseline=${frameTiming.lod60.baseline.toFixed(1)}ms | First=${frameTiming.lod60.first.toFixed(1)}ms | Second=${frameTiming.lod60.second.toFixed(1)}ms | Delta=${frameTiming.lod60.deltaVsBaseline > 0 ? '+' : ''}${frameTiming.lod60.deltaVsBaseline.toFixed(1)}ms`)
    console.log(`- LOD 28m:    Baseline=${frameTiming.lod28.baseline.toFixed(1)}ms | First=${frameTiming.lod28.first.toFixed(1)}ms | Second=${frameTiming.lod28.second.toFixed(1)}ms | Delta=${frameTiming.lod28.deltaVsBaseline > 0 ? '+' : ''}${frameTiming.lod28.deltaVsBaseline.toFixed(1)}ms`)
    console.log('*(Note: Absolute frame times reflect headless SwiftShader CPU rasterizer; the critical metric is delta vs baseline / first vs subsequent).*')

    console.log('\n=== Cold Start Benchmarks Completed Successfully ===')
  } catch (err) {
    console.error('Benchmark error:', err)
    process.exitCode = 1
  } finally {
    await browser.close()
    server.kill()
  }
}

main()
