import fs from 'node:fs'
import { chromium } from 'playwright'

const combinations = process.argv.includes('--combinations')
const output = `artifacts/equipment_pose/minimal-idle${combinations ? '/combinations' : ''}`
fs.mkdirSync(output, { recursive: true })
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } }), errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto('http://127.0.0.1:5173/?devmodels=humans&nolock')
  await page.waitForFunction(() => !!window.game, undefined, { timeout: 180000 })
  await page.evaluate(() => { window.game.humanoidStudioPaused = true; window.game._loop = () => {} })
  await page.waitForTimeout(100)
  await page.evaluate(async () => {
    const T = await import('/node_modules/.vite/deps/three.js'), g = window.game
    window.minimalIdleSample = (weapon, lod, view, mounted, shield) => {
      const [instance, p] = [...g.humanoidStudioPlayback].find(([, p]) => p.faction === 'roman' && p.state === (mounted ? 'mounted' : 'idle'))
      p.setEquipmentLoadout(weapon, shield); p.sampleEquipment(.25, mounted)
      for (const child of g.scene.children) if (!child.isLight) child.visible = child === instance.root
      const horse = mounted ? g.mounts.find(m => Math.abs(m.group.position.x - instance.root.position.x) < .01 && Math.abs(m.group.position.z - instance.root.position.z) < .01) : null
      if (horse) horse.group.visible = true
      const levels = instance.root.children.find(o => o.isLOD)
      levels.autoUpdate = false; levels.levels.forEach(({ object }, i) => { object.visible = i === lod })
      const level = levels.levels[lod].object
      instance.root.updateMatrixWorld(true)
      const bones = {}, morphs = {}
      level.traverse(o => {
        if (o.isBone) bones[o.name] = [...o.position.toArray(), ...o.quaternion.toArray(), ...o.scale.toArray()]
        if (o.isSkinnedMesh) morphs[o.name] = { names: o.morphTargetDictionary, values: o.morphTargetInfluences }
      })
      const grip = p.lanceModel.localToWorld(new T.Vector3(0, .15, 0)), tip = p.lanceModel.localToWorld(new T.Vector3(0, 2.6, 0))
      const palm = level.getObjectByName('hand_r').localToWorld(new T.Vector3(...level.userData.equipmentGripFrames.lanceRight.gripCenterLocal))
      const c = instance.root.position.clone().add(view === 'close' ? new T.Vector3(-.15, 1.25, 0) : new T.Vector3(0, 1, .7))
      if (mounted && view !== 'close') c.copy(horse.group.position).add(new T.Vector3(0, 1.4, .6))
      const eye = view === 'close' ? new T.Vector3(-1.1, .25, 1.7) : view === 'top' ? new T.Vector3(0, 4.5, 1.8) : new T.Vector3(-2.7, .5, 3.4)
      if (mounted && view !== 'close') eye.multiplyScalar(1.3)
      const shieldGrip = p.shield.localToWorld(new T.Vector3(0, 0, .085))
      const shieldPalm = level.getObjectByName('hand_l').localToWorld(new T.Vector3(...level.userData.equipmentGripFrames.shieldLeft.gripCenterLocal))
      const horseIntersections = []
      if (horse && weapon === 'lance') {
        horse.group.updateMatrixWorld(true)
        const meshes = []
        horse.group.traverse(o => {
          if (!o.isMesh) return
          for (let parent = o; parent; parent = parent.parent) if (!parent.visible) return
          meshes.push(o)
        })
        const axis = tip.clone().sub(grip).normalize(), cross = new T.Vector3(1, 0, 0).cross(axis).normalize(), cross2 = axis.clone().cross(cross)
        // Centre line plus eight shaft-surface samples against the visible horse.
        for (let n = 0; n < 9; n++) {
          const origin = grip.clone().addScaledVector(axis, .03)
          if (n < 8) origin.addScaledVector(cross, .022 * Math.cos(n * Math.PI / 4)).addScaledVector(cross2, .022 * Math.sin(n * Math.PI / 4))
          for (const hit of new T.Raycaster(origin, axis, 0, 2.42).intersectObjects(meshes, false)) horseIntersections.push({ mesh: hit.object.name, distance: hit.distance })
        }
      }
      g.camera.near = .01; g.camera.fov = 35; g.camera.updateProjectionMatrix()
      g.studioControls.enableDamping = false; g.studioControls.target.copy(c); g.camera.position.copy(c).add(eye); g.studioControls.update()
      for (const el of document.body.children) if (el.id !== 'canvas-container' && el.tagName !== 'SCRIPT') el.style.display = 'none'
      g.renderer.render(g.scene, g.camera)
      return { weapon, lod, mounted, shield, bones, morphs, horseIntersections, gripError: palm.distanceTo(grip), shieldGripError: shield ? shieldPalm.distanceTo(shieldGrip) : null, forwardDot: tip.clone().sub(grip).normalize().dot(new T.Vector3(0, 0, 1).transformDirection(instance.root.matrixWorld)),
        attachment: p.lance.matrix.toArray(), calibration: level.userData.equipmentGripFrames.lanceRight.modelRotationLocal,
        grip: instance.root.worldToLocal(grip).toArray(), tip: instance.root.worldToLocal(tip).toArray(),
        png: g.renderer.domElement.toDataURL('image/png').split(',')[1] }
    }
  })
  const results = []
  const cases = combinations ? [{ mounted: false, shield: true }, { mounted: true, shield: false }, { mounted: true, shield: true }] : [{ mounted: false, shield: false }]
  for (const { mounted, shield } of cases) for (const lod of [0, 1, 2]) {
    const context = combinations ? `-${mounted ? 'mounted' : 'foot'}-${shield ? 'shield' : 'no-shield'}` : ''
    let baseline
    for (const weapon of ['sword', 'lance']) for (const view of ['full', 'close', 'top']) {
      const r = await page.evaluate(({ weapon, lod, view, mounted, shield }) => window.minimalIdleSample(weapon, lod, view, mounted, shield), { weapon, lod, view, mounted, shield })
      fs.writeFileSync(`${output}/roman-${weapon}${context}-lod${lod}-${view}.png`, Buffer.from(r.png, 'base64')); delete r.png
      if (view !== 'full') continue
      if (weapon === 'sword') baseline = r
      else {
        const bonesUnchanged = JSON.stringify(r.bones) === JSON.stringify(baseline.bones)
        const handShapesUnchanged = JSON.stringify(r.morphs) === JSON.stringify(baseline.morphs)
        if (!bonesUnchanged || !handShapesUnchanged || r.gripError > .01 || r.forwardDot < .95 || (r.shieldGripError !== null && r.shieldGripError > .01)) throw Error(`${context} LOD${lod} baseline mismatch: direction=${r.forwardDot}, grip=${r.gripError}, bones=${bonesUnchanged}, morphs=${handShapesUnchanged}`)
        if (r.horseIntersections.length) throw Error(`${context} shaft intersects horse: ${JSON.stringify(r.horseIntersections)}`)
        results.push({ ...r, bonesUnchanged, handShapesUnchanged })
      }
    }
  }
  fs.writeFileSync(`${output}/measurements.json`, JSON.stringify({ scope: 'Sword Idle skeleton + fixed Lance attachment only', errors, results }, null, 2))
  console.log(JSON.stringify({ errors, lods: results.map(r => ({ mounted: r.mounted, shield: r.shield, lod: r.lod, gripError: r.gripError, forwardDot: r.forwardDot, bonesUnchanged: r.bonesUnchanged, handShapesUnchanged: r.handShapesUnchanged })) }))
  if (errors.length) process.exitCode = 1
} finally { await browser.close() }
