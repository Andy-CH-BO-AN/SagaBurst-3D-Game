import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'

async function run() {
  const outputDir = path.resolve('output/playwright')
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }

  console.log('Launching browser...')
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()

  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.error('[Browser Error]', msg.text())
    }
  })

  page.on('pageerror', err => {
    console.error('[Page Exception]', err.message)
  })

  const port = process.env.PORT || '5176'
  console.log(`Navigating to devcombat nolock on port ${port}...`)
  await page.addInitScript(() => {
    try {
      window.localStorage.clear()
    } catch {}
  })
  await page.goto(`http://127.0.0.1:${port}/?devcombat&nolock`, { waitUntil: 'domcontentloaded' })

  // Wait for game initialization
  console.log('Waiting for window.game...')
  await page.waitForFunction(() => {
    return window.game && window.game.player && window.game.inventoryManager
  }, { timeout: 15000 })

  // Let assets and first frame settle
  await page.waitForTimeout(1000)

  // Step 1: Verify Initial Mounted State
  const initialData = await page.evaluate(() => {
    const p = window.game.player
    const inv = window.game.inventoryManager
    const hud = document.getElementById('mount-hud')
    const hudVisible = hud ? hud.classList.contains('visible') : false
    const mount = p.currentMount

    return {
      isMounted: p.isMounted,
      hasMount: Boolean(mount),
      mountType: mount ? mount.type : null,
      mountState: mount ? mount.state : null,
      mountHp: mount ? mount.currentHp : 0,
      equippedMeleeId: inv.equippedMelee ? inv.equippedMelee.id : null,
      equippedRangedId: inv.equippedRanged ? inv.equippedRanged.id : null,
      equippedShieldId: inv.equippedShield ? inv.equippedShield.id : null,
      hudVisible,
      stacks: inv.inventoryStacks.map(s => ({ id: s.item.id, qty: s.quantity, isEquipped: inv.isEquipped(s.item.id) })),
      playerPos: { x: p.position.x, y: p.position.y, z: p.position.z },
      mountPos: mount ? { x: mount.group.position.x, y: mount.group.position.y, z: mount.group.position.z } : null,
    }
  })

  console.log('--- Initial Browser State ---')
  console.log(JSON.stringify(initialData, null, 2))

  if (!initialData.isMounted || !initialData.hasMount) {
    throw new Error('Assertion failed: Player is not mounted at startup')
  }
  if (initialData.mountState !== 'CONTROLLED') {
    throw new Error(`Assertion failed: Mount state is ${initialData.mountState}, expected CONTROLLED`)
  }
  if (initialData.equippedMeleeId !== 'steel_lance') {
    throw new Error(`Assertion failed: equippedMeleeId is ${initialData.equippedMeleeId}, expected steel_lance`)
  }
  if (initialData.equippedRangedId !== 'elven_runebow') {
    throw new Error(`Assertion failed: equippedRangedId is ${initialData.equippedRangedId}, expected elven_runebow`)
  }
  if (initialData.equippedShieldId !== 'round_shield_t3') {
    throw new Error(`Assertion failed: equippedShieldId is ${initialData.equippedShieldId}, expected round_shield_t3`)
  }
  if (!initialData.hudVisible) {
    throw new Error('Assertion failed: Mount HUD is not visible')
  }

  const greatswordStack = initialData.stacks.find(s => s.id === 'runic_greatsword')
  if (!greatswordStack) {
    throw new Error('Assertion failed: runic_greatsword is missing from inventory')
  }
  if (greatswordStack.isEquipped) {
    throw new Error('Assertion failed: runic_greatsword should not be equipped by default')
  }

  const initialShot = path.join(outputDir, 'mounted-initial.png')
  await page.screenshot({ path: initialShot })
  console.log(`Saved screenshot: ${initialShot}`)

  // Step 2: Test Interactive Movement (W key)
  console.log('Testing mounted movement input...')
  await page.keyboard.down('KeyW')
  await page.waitForTimeout(500)
  await page.keyboard.up('KeyW')
  await page.waitForTimeout(100)

  const movedMountPos = await page.evaluate(() => {
    const mount = window.game.player.currentMount
    return mount ? { x: mount.group.position.x, z: mount.group.position.z } : null
  })
  console.log('Moved mount position:', movedMountPos)
  if (!movedMountPos || !initialData.mountPos) {
    throw new Error('Assertion failed: Mount position unavailable for movement verification')
  }
  const moveDistance = Math.hypot(
    movedMountPos.x - initialData.mountPos.x,
    movedMountPos.z - initialData.mountPos.z
  )
  console.log(`Mounted movement distance: ${moveDistance.toFixed(3)}m`)
  if (moveDistance <= 0.05) {
    throw new Error(`Assertion failed: Mount did not move under KeyW input (distance: ${moveDistance})`)
  }

  // Step 3: Test Dismount via KeyE Interaction
  console.log('Testing dismount via KeyE interaction...')
  await page.keyboard.press('KeyE')
  await page.waitForTimeout(200)

  const dismountData = await page.evaluate(() => {
    const p = window.game.player
    const hud = document.getElementById('mount-hud')
    return {
      isMounted: p.isMounted,
      currentMount: p.currentMount,
      hudVisible: hud ? hud.classList.contains('visible') : false,
    }
  })
  console.log('Dismounted state:', dismountData)
  if (dismountData.isMounted || dismountData.currentMount !== null) {
    throw new Error('Assertion failed: Player failed to dismount after pressing KeyE')
  }
  if (dismountData.hudVisible) {
    throw new Error('Assertion failed: Mount HUD remains visible after dismounting')
  }

  // Step 4: Test Equipment UI Interaction - Equip Runic Greatsword
  console.log('Opening Equipment UI & equipping Runic Greatsword via UI click...')
  await page.evaluate(() => {
    window.game.equipmentUI.open(window.game.skillManager, window.game.inventoryManager)
  })
  await page.waitForTimeout(200)

  // Click the equip button for Runic Greatsword in Equipment UI
  const clickedEquip = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('#inventory-list .inventory-card'))
    for (const card of cards) {
      if (card.textContent && card.textContent.includes('精鋼戰刃')) {
        const btn = card.querySelector('.btn-equip')
        if (btn && !btn.classList.contains('is-active')) {
          btn.click()
          return true
        }
      }
    }
    return false
  })
  console.log('Equip UI click executed:', clickedEquip)

  await page.waitForTimeout(300)

  const equipData = await page.evaluate(() => {
    const inv = window.game.inventoryManager
    return {
      equippedMeleeId: inv.equippedMelee.id,
      equippedShieldId: inv.equippedShield ? inv.equippedShield.id : null,
      isGreatswordEquipped: inv.isEquipped('runic_greatsword'),
    }
  })
  console.log('Post-equip state:', equipData)
  if (equipData.equippedMeleeId !== 'runic_greatsword' || !equipData.isGreatswordEquipped) {
    throw new Error('Assertion failed: Runic Greatsword could not be equipped via UI')
  }

  const greatswordShot = path.join(outputDir, 'dismount-greatsword.png')
  await page.screenshot({ path: greatswordShot })
  console.log(`Saved screenshot: ${greatswordShot}`)

  console.log('WebGL browser smoke validation with interactive controls PASSED successfully!')
  await browser.close()
}

run().catch(err => {
  console.error('Validation FAILED:', err)
  process.exit(1)
})
