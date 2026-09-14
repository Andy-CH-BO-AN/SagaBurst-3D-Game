import fs from 'node:fs'
import { chromium } from 'playwright'
const output = 'output/playwright/sword-release'
fs.mkdirSync(output, { recursive: true })
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = [], states = []
  page.on('pageerror', e => errors.push(e.message))
  await page.addInitScript(() => {
    const army = () => ({ infantry: { 1: 0, 2: 2, 3: 0 }, archer: { 1: 0, 2: 1, 3: 0 }, cavalry: { 1: 0, 2: 0, 3: 0 }, horseArcher: { 1: 0, 2: 0, 3: 0 } })
    sessionStorage.setItem('sagaburst_battle_config', JSON.stringify({ viking: army(), roman: army(), rules: { respawnEnabled: false, includeCamps: false } }))
  })
  await page.goto('http://127.0.0.1:5173/?nolock')
  await page.waitForFunction(() => !!window.game, undefined, { timeout: 90000 })
  if (await page.evaluate(() => window.game.player.isMounted)) await page.keyboard.press('KeyE')
  await page.evaluate(() => {
    const g = window.game
    g.inventoryManager.addWeapon('steel_sword'); g.inventoryManager.equipWeapon('steel_sword')
    g.thirdPersonCamera.pitch = .95
  })
  await page.waitForTimeout(300)
  async function snapshot(name) {
    states.push(await page.evaluate(name => {
      const g = window.game, p = g.player
      const shapes = []
      p.bodyMesh.traverse(o => { if (o.isSkinnedMesh && o.morphTargetDictionary?.swordHand !== undefined) shapes.push({ sword: o.morphTargetInfluences[o.morphTargetDictionary.swordHand], bow: o.morphTargetInfluences[o.morphTargetDictionary.bowGrip] }) })
      p.swordPivot.updateMatrix()
      return { name, mounted: p.isMounted, shapes, attachment: p.swordPivot.matrix.toArray(), arrows: p.arrows, bow: p.bowPivot.visible, sword: p.swordPivot.visible, action: p.animator.currentAction, position: p.position.toArray() }
    }, name))
    const png = await page.evaluate(() => {
      const g = window.game
      g.renderer.render(g.scene, g.camera)
      return g.renderer.domElement.toDataURL('image/png').split(',')[1]
    })
    fs.writeFileSync(`${output}/${name}.png`, Buffer.from(png, 'base64'))
    console.log(name)
  }
  await snapshot('idle')
  await page.keyboard.down('KeyW'); await page.waitForTimeout(350); await snapshot('walk')
  await page.keyboard.down('ShiftLeft'); await page.waitForTimeout(300); await snapshot('run')
  await page.keyboard.up('ShiftLeft'); await page.keyboard.up('KeyW'); await page.waitForTimeout(300)
  await page.mouse.click(700, 450, { button: 'right' }); await page.waitForTimeout(250)
  await page.mouse.click(700, 450); await page.waitForTimeout(1400); await snapshot('bow-hold')
  await page.mouse.click(700, 450); await page.waitForTimeout(60); await snapshot('bow-release')
  await page.mouse.click(700, 450, { button: 'right' })
  await page.waitForFunction(() => {
    const p = window.game.player
    return !p.bowPivot.visible && p.swordPivot.visible && p.animator.currentAction === 'idle'
  }, undefined, { timeout: 15000 })
  await snapshot('sword-return')
  await page.evaluate(() => { window.game._loop = () => {} }); await page.waitForTimeout(100)
  const attack = await page.evaluate(() => {
    const g = window.game, p = g.player, frames = [], rows = []
    p.animator.cancel(); g.input.keys.KeyW = true; g.input._leftClickTriggered = true
    const aim = g.thirdPersonCamera.getAimPoint(p.position.clone(), 30)
    const advance = dt => p.update(dt, g.input, g.thirdPersonCamera.cameraYaw, aim, g.obstacles,
      g.staminaBar, g.quiverUI, g.soundManager, g.inventoryManager, 1)
    advance(0)
    let elapsed = 0, hits = 0
    for (const time of [0, .1, .252, .48, .6]) {
      while (elapsed < time - 1e-10) {
        const dt = Math.min(1 / 120, time - elapsed)
        advance(dt); elapsed += dt
        if (p.isHitFrame()) { hits++; p.markHitProcessed() }
      }
      g.thirdPersonCamera.update(g.input, .016); g.renderer.render(g.scene, g.camera)
      frames.push({ name: `player-attack-${time.toFixed(3)}.png`, data: g.renderer.domElement.toDataURL('image/png').split(',')[1] })
      const clipAction = p.rig.animation.actions.get('swordSlash')[0]
      const handTrack = clipAction.getClip().tracks.find(t => t.name === 'hand_r.quaternion')
      const expectedHand = p.rig.right.wrist.quaternion.clone().fromArray(handTrack.createInterpolant().evaluate(time)).normalize()
      const handError = p.rig.right.wrist.quaternion.clone().normalize().angleTo(expectedHand)
      rows.push({ time, hits, action: p.animator.currentAction, clip: p.rig.animation.current,
        clipTime: clipAction.time, handError })
      if (time === .252 && (Math.abs(clipAction.time - time) > 1e-5 || handError > 1e-4)) {
        throw Error(`Player contact pose differs from swordSlash: time=${clipAction.time}, handError=${handError}`)
      }
    }
    if (hits !== 1 || p.animator.busy) throw Error('Player attack timeline failed')
    return { frames, rows }
  })
  for (const { name, data } of attack.frames) fs.writeFileSync(`${output}/${name}`, Buffer.from(data, 'base64'))
  const data = { url: page.url(), errors, states, attack: attack.rows }
  fs.writeFileSync(`${output}/measurements.json`, JSON.stringify(data, null, 2))
  const idle = states[0], hold = states.find(s => s.name === 'bow-hold'), returned = states.at(-1)
  if (errors.length || idle.mounted || !idle.shapes.length || hold.shapes.some(s => s.sword !== 0 || s.bow !== 1)
    || returned.shapes.some(s => s.sword !== 1 || s.bow !== 0)
    || JSON.stringify(idle.attachment) !== JSON.stringify(returned.attachment)
    || returned.arrows !== idle.arrows - 1) throw new Error('正式場景握劍／Bow 回歸未通過；請檢查 measurements.json')
  console.log(JSON.stringify({ errors, bowSwitch: 'passed', shotCount: idle.arrows - returned.arrows }))
} finally { await browser.close() }
