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
    // 2. Barricade Raycast Obstruction Verification (Player Aiming at Barricade)
    // ──────────────────────────────────────────────────────────
    const barricadeCheck = await page.evaluate(() => {
      const g = window.game
      
      // Find a barricade mesh child from the registry
      const barricadeMesh = g._aimTargetRegistry.targets.find(
        (t) => t.parent && t.parent.type === 'Group' && t.isMesh
      )

      if (!barricadeMesh) {
        return { error: 'No barricade mesh found in targets registry', targetsCount: g._aimTargetRegistry.targets.length }
      }

      // Ensure matrixWorld is fully updated
      g.scene.updateMatrixWorld(true)

      // Calculate its exact world center
      const worldPos = g.camera.position.clone()
      barricadeMesh.getWorldPosition(worldPos)

      // Position camera 5m away and look directly at the barricade mesh
      g.camera.position.set(worldPos.x, worldPos.y, worldPos.z + 5)
      g.camera.lookAt(worldPos)
      g.camera.updateMatrixWorld(true)

      // Trigger Game's actual aim raycast
      g.player.isAiming = true
      const aimTarget = g.camera.position.clone()
      g._getCameraAimPoint(aimTarget)
      g.player.isAiming = false

      // Check intersections from g._aimRaycaster
      const hits = g._aimRaycaster.intersectObjects(g._aimTargetRegistry.targets, false)

      return {
        hitCount: hits.length,
        firstHitObject: hits[0] ? hits[0].object.type : null,
        isBarricadeMesh: hits[0] ? hits[0].object.parent?.type === 'Group' : false,
        hitDistance: hits[0] ? hits[0].distance : null,
        barricadeWorldY: worldPos.y,
      }
    })

    console.log('\n[Barricade Aim Raycast Verification]')
    console.log(`- Aim hits obstacle: ${barricadeCheck.hitCount > 0}`)
    console.log(`- Hit object type: ${barricadeCheck.firstHitObject} (parent: ${barricadeCheck.isBarricadeMesh ? 'Barricade Group' : 'Other'})`)
    console.log(`- Hit distance: ${barricadeCheck.hitDistance?.toFixed(2)}m`)

    // ──────────────────────────────────────────────────────────
    // 3. Aim Microbenchmark (1,000 iterations + distribution stats)
    // ──────────────────────────────────────────────────────────
    const aimBench = await page.evaluate(() => {
      const g = window.game
      const target = g.camera.position.clone()
      g.player.isAiming = true

      const iterations = 1000
      const durations = new Float64Array(iterations)

      for (let i = 0; i < iterations; i++) {
        const t0 = performance.now()
        g._getCameraAimPoint(target)
        durations[i] = performance.now() - t0
      }

      g.player.isAiming = false

      // Calculate statistics
      const sorted = Array.from(durations).sort((a, b) => a - b)
      const sum = sorted.reduce((acc, v) => acc + v, 0)
      const avg = sum / iterations
      const min = sorted[0]
      const max = sorted[iterations - 1]
      const p50 = sorted[Math.floor(iterations * 0.5)]
      const p95 = sorted[Math.floor(iterations * 0.95)]
      const p99 = sorted[Math.floor(iterations * 0.99)]

      return {
        targetsCount: g._aimTargetRegistry.targets.length,
        firstCallMs: durations[0],
        avgMs: avg,
        p50Ms: p50,
        p95Ms: p95,
        p99Ms: p99,
        minMs: min,
        maxMs: max,
      }
    })

    console.log('\n[Aim Raycast Microbenchmark - 1,000 Iterations]')
    console.log(`- Active targets in registry: ${aimBench.targetsCount}`)
    console.log(`- First call duration: ${aimBench.firstCallMs.toFixed(4)} ms`)
    console.log(`- Average duration: ${aimBench.avgMs.toFixed(4)} ms`)
    console.log(`- Median (p50): ${aimBench.p50Ms.toFixed(4)} ms`)
    console.log(`- 95th Percentile (p95): ${aimBench.p95Ms.toFixed(4)} ms`)
    console.log(`- 99th Percentile (p99): ${aimBench.p99Ms.toFixed(4)} ms`)
    console.log(`- Min: ${aimBench.minMs.toFixed(4)} ms | Max: ${aimBench.maxMs.toFixed(4)} ms`)

    // ──────────────────────────────────────────────────────────
    // 4. Real Browser Frame Timing on First-Use Actions
    // ──────────────────────────────────────────────────────────
    const frameTiming = await page.evaluate(() => {
      const g = window.game

      function measureAction(action) {
        const start = performance.now()
        action()
        g.renderer.render(g.scene, g.camera)
        return performance.now() - start
      }

      // 4A: First Aim Activation Frame
      const aimFrameMs = measureAction(() => {
        g.player.isAiming = true
        const target = g.camera.position.clone()
        g._getCameraAimPoint(target)
      })
      g.player.isAiming = false

      // 4B: First Projectile Launch Frame
      const projectileFrameMs = measureAction(() => {
        const origin = g.camera.position.clone().set(0, 2, 0)
        const dir = g.camera.position.clone().set(0, 0, -1)
        g.player.onFireArrow({ origin, direction: dir, speed: 35, damage: 25 })
      })

      // 4C: 60m Transition Frame (LOD2 -> LOD1)
      const enemy = g.npcs.find((n) => n.faction === 'ENEMY' || n.faction === 'enemy')
      let lod60mFrameMs = 0
      let lod28mFrameMs = 0

      if (enemy) {
        const epos = enemy.group.position.clone()

        // Place camera at 75m first
        g.camera.position.set(epos.x, epos.y + 2, epos.z + 75)
        g.renderer.render(g.scene, g.camera)

        // Move to 50m (triggers LOD2 -> LOD1)
        lod60mFrameMs = measureAction(() => {
          g.camera.position.set(epos.x, epos.y + 2, epos.z + 50)
        })

        // Move to 20m (triggers LOD1 -> LOD0)
        lod28mFrameMs = measureAction(() => {
          g.camera.position.set(epos.x, epos.y + 2, epos.z + 20)
        })
      }

      return {
        aimFrameMs,
        projectileFrameMs,
        lod60mFrameMs,
        lod28mFrameMs,
      }
    })

    console.log('\n[Browser Frame Validation (Action + Render Pass Duration)]')
    console.log(`- First Aim Activation Frame: ${frameTiming.aimFrameMs.toFixed(2)} ms`)
    console.log(`- First Projectile Launch Frame: ${frameTiming.projectileFrameMs.toFixed(2)} ms`)
    console.log(`- 60m Transition Frame (LOD2 -> LOD1): ${frameTiming.lod60mFrameMs.toFixed(2)} ms`)
    console.log(`- 28m Transition Frame (LOD1 -> LOD0): ${frameTiming.lod28mFrameMs.toFixed(2)} ms`)

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
