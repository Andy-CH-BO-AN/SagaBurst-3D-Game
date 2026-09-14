import fs from 'node:fs'
import { chromium } from 'playwright'

const output = 'output/playwright/melee-tier-parity'
fs.mkdirSync(output, { recursive: true })
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    const army = () => ({
      infantry: { 1: 1, 2: 1, 3: 1 }, archer: { 1: 0, 2: 0, 3: 0 },
      cavalry: { 1: 0, 2: 0, 3: 0 }, horseArcher: { 1: 0, 2: 0, 3: 0 },
    })
    sessionStorage.setItem('sagaburst_battle_config', JSON.stringify({
      viking: army(), roman: army(), rules: { respawnEnabled: false, includeCamps: false },
    }))
  })
  await page.goto('http://127.0.0.1:5173/?nolock')
  await page.waitForFunction(() => window.game?.npcs?.length === 6, undefined, { timeout: 90000 })
  await page.evaluate(() => { window.game._loop = () => {} })
  await page.waitForTimeout(100)

  const result = await page.evaluate(async () => {
    const THREE = await import('/node_modules/.vite/deps/three.js')
    const { getTerrainHeight } = await import('/src/world/Terrain.ts')
    const { WEAPONS } = await import('/src/rpg/WeaponDatabase.ts')
    const game = window.game
    game.player.group.visible = false
    const rows = []
    const images = []
    const factions = [['PLAYER', 'viking'], ['ENEMY', 'roman']]
    for (const [faction, label] of factions) {
      const units = game.npcs.filter(npc => npc.faction === faction).sort((a, b) => a.tier - b.tier)
      if (units.length !== 3) throw Error(`${label}: expected three infantry tiers`)
      for (const npc of game.npcs) npc.group.visible = units.includes(npc)
      for (const [index, npc] of units.entries()) {
        const x = (index - 1) * 2.25
        npc.group.position.set(x, getTerrainHeight(x, 0), 0)
        npc.group.rotation.set(0, 0, 0)
        npc.animator.cancel()
        npc.animator.setLocomotion(0)
        npc.animator.update(1 / 60)
      }
      const camera = game.camera
      camera.position.set(0, 1.35, 9)
      camera.fov = 31
      camera.updateProjectionMatrix()
      camera.lookAt(0, 1, 0)

      const capture = name => {
        game.renderer.render(game.scene, camera)
        images.push({ name, data: game.renderer.domElement.toDataURL('image/png').split(',')[1] })
      }
      capture(`${label}-tiers-idle.png`)
      for (const npc of units) {
        const requestedAction = npc._meleeAction()
        if (requestedAction !== 'swordSlash') throw Error(`${label} T${npc.tier}: selected ${requestedAction}`)
        npc.animator.start(requestedAction)
        for (let elapsed = 0; elapsed < .252 - 1e-10;) {
          const dt = Math.min(1 / 120, .252 - elapsed)
          npc.animator.setLocomotion(0)
          npc.animator.update(dt)
          elapsed += dt
        }
      }
      capture(`${label}-tiers-contact.png`)

      for (const npc of units) {
        const box = new THREE.Box3().setFromObject(npc.swordGripPivot)
        const size = box.getSize(new THREE.Vector3())
        const materials = []
        npc.swordGripPivot.traverse(object => {
          if (!object.isMesh) return
          const list = Array.isArray(object.material) ? object.material : [object.material]
          materials.push(...list.map(material => `${material.name}:${material.map?.name ?? ''}`))
        })
        const shapes = []
        npc.bodyMesh.traverse(object => {
          const index = object.morphTargetDictionary?.swordHand
          if (index !== undefined) shapes.push(object.morphTargetInfluences[index])
        })
        rows.push({ label, tier: npc.tier, action: npc.animator.currentAction,
          clip: npc.rig.animation.current, attachmentOwned: npc.swordPivot.userData.swordAttachmentOwned,
          size: size.toArray(), materials, swordHandShapes: shapes })
      }
      for (const npc of units) {
        npc.animator.setLocomotion(0)
        npc.animator.update(.228)
        npc.animator.update(.12)
      }
      capture(`${label}-tiers-recovery.png`)
    }
    const playerRows = []
    for (const id of ['rusty_dagger', 'steel_sword', 'runic_greatsword']) {
      game.player.rebuildMeleeWeapon(id)
      const box = new THREE.Box3().setFromObject(game.player.swordGripPivot)
      playerRows.push({ id, requestedAction: game.player._meleeAction(WEAPONS[id]),
        attachmentOwned: game.player.swordPivot.userData.swordAttachmentOwned,
        size: box.getSize(new THREE.Vector3()).toArray() })
    }
    return { rows, images, playerRows }
  })
  for (const { name, data } of result.images) fs.writeFileSync(`${output}/${name}`, Buffer.from(data, 'base64'))
  const measurements = { url: page.url(), errors, rows: result.rows, playerRows: result.playerRows }
  fs.writeFileSync(`${output}/measurements.json`, JSON.stringify(measurements, null, 2))
  for (const label of ['viking', 'roman']) {
    const rows = result.rows.filter(row => row.label === label)
    const shape = rows[1].size
    if (rows.some(row => row.action !== 'swordSlash' || row.clip !== 'swordSlash'
      || !row.attachmentOwned || !row.swordHandShapes.length || row.swordHandShapes.some(value => value !== 1)
      || row.size.some((value, index) => Math.abs(value - shape[index]) > 1e-5))) {
      throw Error(`${label}: tier shape, attachment, or animation mismatch`)
    }
    if (new Set(rows.map(row => JSON.stringify(row.materials))).size !== 3) throw Error(`${label}: tier patterns are not distinct`)
  }
  const playerShape = result.playerRows[1].size
  if (result.playerRows.some(row => row.requestedAction !== 'swordSlash' || !row.attachmentOwned
    || row.size.some((value, index) => Math.abs(value - playerShape[index]) > 1e-5))) {
    throw Error('Player tier shape, attachment, or animation mismatch')
  }
  if (errors.length) throw Error(errors.join('\n'))
  console.log(JSON.stringify({ npcRows: result.rows.length, playerRows: result.playerRows.length,
    screenshots: result.images.length, errors }))
} finally {
  await browser.close()
}
