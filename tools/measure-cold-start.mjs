import { chromium } from 'playwright'
import { spawn } from 'child_process'

async function main() {
  console.log('=== Starting Cold Start Benchmarks via Playwright ===')
  
  // Start preview server
  const server = spawn('npx', ['vite', 'preview', '--port', '5188'], {
    stdio: 'pipe',
  })

  // Wait for server to start
  await new Promise((resolve) => setTimeout(resolve, 1500))

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()

  try {
    await page.goto('http://localhost:5188/?devcombat&nolock')
    await page.waitForFunction(() => window.game && window.game.player)

    // Benchmark 1: Aim Raycast
    const aimBench = await page.evaluate(() => {
      const g = window.game
      const target = g.camera.position.clone()

      // Enable aiming
      g.player.isAiming = true

      // First aim raycast
      const t0 = performance.now()
      g._getCameraAimPoint(target)
      const firstAimMs = performance.now() - t0

      // Second aim raycast
      const t1 = performance.now()
      g._getCameraAimPoint(target)
      const secondAimMs = performance.now() - t1

      // 100 aim raycasts to test sustained throughput
      const t2 = performance.now()
      for (let i = 0; i < 100; i++) {
        g._getCameraAimPoint(target)
      }
      const avgAimMs = (performance.now() - t2) / 100

      g.player.isAiming = false
      return { firstAimMs, secondAimMs, avgAimMs, targetCount: g._aimTargetRegistry.targets.length }
    })

    console.log('Aim Raycast Results:')
    console.log(`- Targets in registry: ${aimBench.targetCount}`)
    console.log(`- First aim raycast: ${aimBench.firstAimMs.toFixed(3)} ms`)
    console.log(`- Second aim raycast: ${aimBench.secondAimMs.toFixed(3)} ms`)
    console.log(`- 100x average aim raycast: ${aimBench.avgAimMs.toFixed(3)} ms`)

    // Benchmark 2: Projectile Creation
    const projectileBench = await page.evaluate(() => {
      const g = window.game
      const origin = g.camera.position.clone().set(0, 2, 0)
      const dir = g.camera.position.clone().set(0, 0, -1)

      const t0 = performance.now()
      g.player.onFireArrow({ origin, direction: dir, speed: 35, damage: 25 })
      const firstArrowMs = performance.now() - t0

      const t1 = performance.now()
      g.player.onFireArrow({ origin, direction: dir, speed: 35, damage: 25 })
      const secondArrowMs = performance.now() - t1

      return { firstArrowMs, secondArrowMs }
    })

    console.log('Projectile Creation Results:')
    console.log(`- First arrow fired: ${projectileBench.firstArrowMs.toFixed(3)} ms`)
    console.log(`- Second arrow fired: ${projectileBench.secondArrowMs.toFixed(3)} ms`)

    // Benchmark 3: LOD Transitions
    const lodBench = await page.evaluate(() => {
      const g = window.game
      const enemy = g.npcs.find((n) => n.faction === 'ENEMY' || n.faction === 'enemy')
      if (!enemy) return { error: 'No enemy found', npcs: g.npcs.map((n) => n.faction) }

      // Measure LOD transitions by simulating approach from 75m to 50m (LOD2 -> LOD1) and to 20m (LOD1 -> LOD0)
      const startPos = enemy.group.position.clone()

      // At 75m
      g.camera.position.set(startPos.x, startPos.y + 2, startPos.z + 75)
      g.renderer.render(g.scene, g.camera)

      // Approach 50m (trigger LOD2 -> LOD1)
      const t0 = performance.now()
      g.camera.position.set(startPos.x, startPos.y + 2, startPos.z + 50)
      g.renderer.render(g.scene, g.camera)
      const lod60mTransitionMs = performance.now() - t0

      // Approach 20m (trigger LOD1 -> LOD0)
      const t1 = performance.now()
      g.camera.position.set(startPos.x, startPos.y + 2, startPos.z + 20)
      g.renderer.render(g.scene, g.camera)
      const lod28mTransitionMs = performance.now() - t1

      // Second pass over the same positions
      g.camera.position.set(startPos.x, startPos.y + 2, startPos.z + 50)
      const t2 = performance.now()
      g.renderer.render(g.scene, g.camera)
      const second60mPassMs = performance.now() - t2

      g.camera.position.set(startPos.x, startPos.y + 2, startPos.z + 20)
      const t3 = performance.now()
      g.renderer.render(g.scene, g.camera)
      const second28mPassMs = performance.now() - t3

      return { lod60mTransitionMs, lod28mTransitionMs, second60mPassMs, second28mPassMs }
    })

    console.log('LOD Transition Results:')
    console.log(`- First 60m transition render (LOD2->LOD1): ${lodBench.lod60mTransitionMs.toFixed(3)} ms (second pass: ${lodBench.second60mPassMs.toFixed(3)} ms)`)
    console.log(`- First 28m transition render (LOD1->LOD0): ${lodBench.lod28mTransitionMs.toFixed(3)} ms (second pass: ${lodBench.second28mPassMs.toFixed(3)} ms)`)

  } finally {
    await browser.close()
    server.kill()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
