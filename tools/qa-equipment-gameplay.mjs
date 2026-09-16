import fs from 'node:fs'
import { chromium } from 'playwright'

const swordMode = process.argv.includes('--sword')
const output = `output/playwright/equipment-gameplay${swordMode ? '-sword' : ''}`
fs.mkdirSync(output, { recursive: true })
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } }), errors = []
  page.on('pageerror', e => { errors.push(e.stack); console.error(e.stack) })
  await page.addInitScript(() => {
    const army = () => ({ infantry: { 1: 0, 2: 1, 3: 0 }, archer: { 1: 0, 2: 0, 3: 0 }, cavalry: { 1: 0, 2: 0, 3: 0 }, horseArcher: { 1: 0, 2: 0, 3: 0 } })
    sessionStorage.setItem('sagaburst_battle_config', JSON.stringify({ viking: army(), roman: army(), rules: { respawnEnabled: false, includeCamps: false } }))
  })
  await page.goto('http://127.0.0.1:5173/?nolock')
  await page.waitForFunction(() => !!window.game, undefined, { timeout: 300000 })
  await page.evaluate(() => { window.game._loop = () => {} })
  await page.waitForTimeout(100)
  await page.evaluate(async (swordMode) => {
    const T = await import('/node_modules/.vite/deps/three.js')
    const { Player } = await import('/src/player/Player.ts')
    const { NPC, Faction, AIType } = await import('/src/world/NPC.ts')
    const { Mount, MountType } = await import('/src/world/Mount.ts')
    const { InventoryManager } = await import('/src/rpg/InventoryManager.ts')
    const g = window.game, scene = new T.Scene()
    scene.background = new T.Color(0x9caab5)
    scene.add(new T.HemisphereLight(0xffffff, 0x777777, 2))
    const sun = new T.DirectionalLight(0xffffff, 3); sun.position.set(-4, 6, 4); scene.add(sun)
    const actors = []
    for (const faction of ['roman', 'viking']) for (const kind of ['player', 'npc']) {
      const actor = kind === 'player' ? new Player(scene, faction) : new NPC(scene, 0, 0, faction === 'roman' ? Faction.ENEMY : Faction.PLAYER, AIType.MELEE, '装備驗收', 2, !swordMode)
      const mount = kind === 'player' || swordMode ? new Mount(scene, MountType.HORSE, 0, 0) : actor.mount
      const inventory = new InventoryManager()
      const spec = { actor, mount, inventory, faction, kind, hits: 0, shots: 0 }
      spec.step = (dt, click = false, keys = {}, aim = false, release = false) => {
        if (kind === 'player') {
          actor.update(dt, { keys, isLeftMouseDown: aim && !release, isRightMouseDown: aim, consumeLeftClick: () => click, consumeLeftClickRelease: () => release }, Math.PI,
            actor.group.position.clone().add(new T.Vector3(0, 1, 10)), [], { setFill() {} }, { setAiming() {}, setChargeRatio() {}, setShieldBlocked() {} }, { playSwing() {}, playBowRelease() {} }, inventory)
          if (actor.isHitFrame()) { spec.hits++; actor.markHitProcessed() }
        } else actor.update(dt, g.player, [actor], [], [], g.playerHpBar, () => spec.hits++, () => spec.shots++, true)
      }
      actors.push(spec)
    }
    window.gameplayEquipment = { actors, scene, T }
    window.gameplaySample = ({ faction, kind, mounted, shield, attack = false, time = 0, motion = 'idle', view = 'full' }) => {
      const q = actors.find(a => a.kind === kind && a.faction === faction), { actor: a, mount, inventory } = q
      for (const other of actors) { other.actor.group.visible = other === q; other.mount.group.visible = other === q && mounted }
      a.animator.cancel(); a.rig.animation.stop()
      if (a.isMounted) a.dismountFromMount()
      a.group.position.set(0, 0, 0); a.group.rotation.set(0, 0, 0)
      mount.group.position.set(0, 0, 0); mount.group.rotation.set(0, 0, 0); mount.state = 'CONTROLLED'; mount.velY = 0; mount.currentHp = mount.maxHp
      if (mounted) {
        if (kind === 'player') { a.isMounted = true; a.currentMount = mount; a.syncMountTransform() }
        else { a.mount = mount; mount.setNpcRider(a, a.faction); a._syncToMount() }
      }
      const shieldId = `${faction === 'roman' ? 'scutum' : 'round_shield'}_t2`
      if (kind === 'player') { inventory.loadSaveState({ equippedMeleeId: swordMode ? faction === 'roman' ? 'gladius_standard' : 'steel_sword' : 'steel_lance', equippedShieldId: shield ? shieldId : null }); a.stamina = 100 }
      else {
        a.shieldId = shield ? shieldId : null; a.rebuildShield(); a.state = 'IDLE'; a.attackTimer = 0
        a._findTarget = () => null
        a.waypoints = [a.combatPosition.clone()]
      }
      q.step(.2)
      if (kind === 'npc') {
        a.state = attack ? 'ATTACK' : motion === 'idle' ? 'IDLE' : 'CHASE'
        a._findTarget = () => ({ position: a.combatPosition.clone().add(new T.Vector3(0, 0, attack ? 1 : 10)), isDead: false, isPlayer: true })
      }
      q.hits = 0; q.shots = 0
      const keys = motion === 'idle' ? {} : { KeyW: true, ShiftLeft: motion === 'run' }
      if (attack) q.step(0, true, keys)
      const matrix = a.swordPivot.matrix.toArray()
      const duration = attack ? swordMode ? .48 : mounted ? .42 : .70 : 1
      for (let elapsed = 0; elapsed < time * duration - 1e-9;) {
        const dt = Math.min(1 / 120, time * duration - elapsed)
        q.step(dt, false, keys); elapsed += dt
      }
      a.group.updateWorldMatrix(true, true)
      const model = a.swordGripPivot, grip = model.localToWorld(new T.Vector3(...model.userData.gripCenterLocal)), tip = model.localToWorld(new T.Vector3(0, 2.6, 0)), support = model.localToWorld(new T.Vector3(0, .33, 0))
      const shieldGrip = a.shieldPivot.localToWorld(new T.Vector3(0, 0, .085))
      let lod; a.group.traverse(o => { if (o.isLOD) lod = o })
      const hands = lod.levels.map(({ object }, i) => {
        const frames = object.userData.equipmentGripFrames
        return { lod: i, right: object.getObjectByName('hand_r').localToWorld(new T.Vector3(...frames.lanceRight.gripCenterLocal)).distanceTo(grip),
          left: object.getObjectByName('hand_l').localToWorld(new T.Vector3(...(shield ? frames.shieldLeft : frames.lanceLeft).gripCenterLocal)).distanceTo(shield ? shieldGrip : support) }
      })
      const c = mounted ? mount.group.position.clone().add(new T.Vector3(0, 1.5, .4)) : grip.clone().add(new T.Vector3(0, -.2, .4))
      g.camera.near = .01; g.camera.fov = view === 'top' ? 58 : 35; g.camera.updateProjectionMatrix()
      if (view === 'hands') c.copy(grip).add(new T.Vector3(.15, 0, .1))
      g.camera.position.copy(c).add(view === 'top' ? new T.Vector3(0, 6, 3) : view === 'hands' ? new T.Vector3(-1, .5, .9) : new T.Vector3(-4, 1.2, 5))
      g.camera.lookAt(c); g.renderer.render(scene, g.camera)
      const localTip = a.group.worldToLocal(tip.clone()).toArray()
      return { faction, kind, mounted, shield, attack, time, motion, hands, tip: localTip, hits: q.hits, action: a.animator.currentAction,
        attachmentFixed: JSON.stringify(matrix) === JSON.stringify(a.swordPivot.matrix.toArray()),
        png: g.renderer.domElement.toDataURL('image/png').split(',')[1] }
    }
  }, swordMode)
  const rows = [], failures = []
  for (const faction of ['roman', 'viking']) for (const kind of ['player', 'npc']) for (const mounted of swordMode ? [true] : [false, true]) for (const shield of [false, true]) {
    const spec = { faction, kind, mounted, shield }, name = `${faction}-${kind}-${mounted ? 'mounted' : 'foot'}-${shield ? 'shield' : 'no-shield'}`
    for (const attack of [false, true]) for (const time of attack ? [0, .15, .42, .38/.7, .8, 1] : [.25]) for (const view of ['hands', 'top', 'full']) {
      const r = await page.evaluate(s => window.gameplaySample(s), { ...spec, attack, time, view })
      fs.writeFileSync(`${output}/${name}-${attack ? 'thrust' : 'ready'}-${time.toFixed(3)}-${view}.png`, Buffer.from(r.png, 'base64')); delete r.png
      if (view !== 'full') continue
      rows.push(r)
      if (!r.attachmentFixed || r.hands.some(h => h.right > .01 || shield && h.left > .01)) failures.push(r)
      if (attack && time === 1 && (r.hits !== 1 || r.action !== 'idle')) failures.push({ ...r, reason: '攻擊事件' })
    }
    console.log(`正式路徑 ${name}`)
  }
  const bow = await page.evaluate(() => {
    const { actors } = window.gameplayEquipment, rows = []
    for (const q of actors.filter(q => q.kind === 'player')) {
      const a = q.actor; a.animator.cancel(); a.isSwinging = false; a.isDead = false; a.arrows = 30
      q.inventory.loadSaveState({ equippedShieldId: 'round_shield_t2' }); q.step(.2, false, {}, true)
      if (a.isAiming || a.bowChargeTime || a.arrows !== 30) throw Error('持盾未阻擋 Bow')
      q.inventory.unequipShield(); q.step(.3, false, {}, true)
      if (!a.isAiming || a.bowChargeTime <= 0) throw Error('卸盾後無法拉弓')
      q.inventory.loadSaveState({ equippedShieldId: 'round_shield_t2' }); q.step(.3, false, {}, false, true)
      if (a.bowChargeTime || a.arrows !== 30) throw Error('裝盾取消時補發箭')
      q.inventory.unequipShield(); q.step(.3, false, {}, true); q.step(.22, false, {}, true, true)
      rows.push({ faction: q.faction, arrows: a.arrows, mounted: a.isMounted })
      if (a.arrows !== 29) throw Error('卸盾 Bow 放箭失敗')
    }
    return rows
  })
  fs.writeFileSync(`${output}/measurements.json`, JSON.stringify({ errors, failures, rows, bow }, null, 2))
  console.log(JSON.stringify({ samples: rows.length, failures: failures.length, errors, bow }))
  if (failures.length || errors.length) process.exitCode = 1
} finally { await browser.close() }
