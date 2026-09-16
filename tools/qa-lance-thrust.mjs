import fs from 'node:fs'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const output = 'output/playwright/lance-thrust'
fs.mkdirSync(output, { recursive: true })
const source = fs.readFileSync('tools/equipment-browser-probe.js', 'utf8')
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } }), errors = [], rows = []
  page.on('pageerror', e => errors.push(e.stack))
  page.on('console', e => { if (e.type() === 'error') errors.push(e.text()) })
  await page.goto('http://127.0.0.1:5173/?devmodels=humans&nolock')
  await page.waitForFunction(() => !!window.game, undefined, { timeout: 180000 })
  await page.evaluate(() => { window.game._loop = () => {} })
  await page.waitForTimeout(100)
  await page.evaluate(`(${source.slice(source.indexOf('async ()'))})()`)
  for (const faction of ['roman', 'viking']) for (const mounted of [false, true]) for (const shield of [false, true]) {
    const spec = { faction, mounted, shield }, name = `${faction}-${mounted ? 'mounted' : 'foot'}-${shield ? 'shield' : 'no-shield'}`
    let start
    for (const [phase, time] of [['ready', 0], ['windup', .2], ['thrust', .43], ['peak', .38/.7], ['recovery', .8], ['return', 1]]) {
      const r = await page.evaluate(s => window.equipmentProbe(s), { ...spec, time, attack: true })
      if (!start) start = r
      assert.deepEqual(r.attachment, start.attachment)
      assert.ok(r.gripError < .01 && r.forwardDot > .96)
      if (shield) assert.ok(r.leftError < .01)
      if (phase === 'peak') { assert.ok(r.grip[2] - start.grip[2] > .18); assert.ok(Math.abs(r.grip[0] - start.grip[0]) < .05) }
      rows.push({ ...r, phase })
      for (const view of ['full', 'close']) {
        await page.evaluate(({ mounted, view }) => {
          const g = window.game, root = [...g.humanoidStudioPlayback.keys()].find(i => i.root.visible).root
          const c = root.position.clone(); c.y += view === 'close' ? 1.25 : mounted ? .75 : 1; c.z += view === 'close' ? 0 : .7
          g.studioControls.target.copy(c)
          g.camera.position.copy(c); g.camera.position.x -= view === 'close' ? 1.1 : 3.5; g.camera.position.y += view === 'close' ? .25 : .8; g.camera.position.z += view === 'close' ? 1.7 : 4.4
          g.studioControls.update(); g.renderer.render(g.scene, g.camera)
        }, { mounted, view })
        await page.screenshot({ path: `${output}/${name}-${phase}-${view}.png` })
      }
    }
    if (mounted) {
      for (const weapon of ['sword', 'lance']) {
        await page.evaluate(s => window.equipmentProbe(s), { ...spec, weapon, time: .25 })
        await page.screenshot({ path: `${output}/${name}-${weapon}-idle.png` })
      }
      const comparison = await page.evaluate(async () => {
        const T = await import('/node_modules/.vite/deps/three.js'), g = window.game
        const [instance, p] = [...g.humanoidStudioPlayback].find(([i]) => i.root.visible)
        const sword = p.sword.children[0], swordGrip = sword.localToWorld(new T.Vector3(...sword.userData.gripCenterLocal))
        const lanceGrip = p.lanceModel.localToWorld(new T.Vector3(0, .15, 0))
        const swordAxis = sword.localToWorld(new T.Vector3(0, 1, 0)).sub(swordGrip).normalize()
        const lanceAxis = p.lanceModel.localToWorld(new T.Vector3(0, 2.6, 0)).sub(lanceGrip).normalize()
        return { gripError: swordGrip.distanceTo(lanceGrip), directionDot: swordAxis.dot(lanceAxis) }
      })
      assert.ok(comparison.gripError < .00001 && comparison.directionDot > .99999)
      rows.push({ ...spec, mountedSword: comparison })
    }
    console.log(name)
  }
  fs.writeFileSync(`${output}/measurements.json`, JSON.stringify({ rows, errors }, null, 2))
  assert.equal(errors.length, 0, errors.join('\n'))
} finally { await browser.close() }
