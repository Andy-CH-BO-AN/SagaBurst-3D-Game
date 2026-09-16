import fs from 'node:fs'
import { chromium } from 'playwright'
const output = process.argv[2] ?? 'output/playwright/equipment-pose'
fs.mkdirSync(output, { recursive: true })
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto('http://127.0.0.1:5173/?devmodels=humans&nolock')
  await page.waitForFunction(() => !!window.game, undefined, { timeout: 120000 })
  const source = fs.readFileSync('tools/equipment-browser-probe.js', 'utf8')
  await page.evaluate(`(${source.slice(source.indexOf('async ()'))})()`)
  const cases = []
  for (const mounted of [false, true]) {
    cases.push({ mounted, weapon: 'none', shield: true, motion: 'idle' }, { mounted, weapon: 'sword', shield: true, motion: 'idle' })
    for (const shield of [false, true]) for (const motion of mounted ? ['idle'] : ['idle', 'walk', 'run']) cases.push({ mounted, weapon: 'lance', shield, motion })
    for (const shield of [false, true]) cases.push({ mounted, weapon: 'lance', shield, motion: 'idle', attack: true })
  }
  const rows = [], failures = []
  for (const faction of ['roman', 'viking']) for (const spec of cases) {
    const name = `${faction}-${spec.mounted ? 'mounted' : 'foot'}-${spec.weapon}-${spec.shield ? 'shield' : 'no-shield'}-${spec.motion}${spec.attack ? '-attack' : ''}`
    const phases = spec.attack ? [0, .15, .42, spec.mounted ? .228/.42 : .38/.70, .8, 1] : [0, .25, .75]
    const readings = await page.evaluate(({ faction, spec, phases }) => {
      const result = []
      for (const lod of [0,1,2]) for (const time of phases) result.push(window.equipmentProbe({faction,...spec,lod,time}))
      return result
    }, { faction, spec, phases })
    rows.push(...readings)
    const initial = readings[0]
    for (const r of readings) {
      if (spec.weapon === 'lance' && (r.gripError > .01 || r.forwardDot < Math.cos(Math.PI/12))) failures.push({name,reason:'主握點／朝向',r})
      if (spec.shield && r.leftError > .01) failures.push({name,reason:'盾牌接觸',r})
      if (JSON.stringify(r.attachment)!==JSON.stringify(initial.attachment)) failures.push({name,reason:'attachment 變動',r})
    }
    if (spec.attack) {
      const peak = readings.find(r=>r.lod===0 && r.time===(spec.mounted?.228/.42:.38/.70))
      if (peak.tip[2]-initial.tip[2]<.18 || Math.abs(peak.tip[0]-initial.tip[0])>.05) failures.push({name,reason:'前刺距離／側移',peak})
    }
    for (const time of spec.attack ? phases : [.25]) for (const view of ['hands','top', ...(spec.mounted || spec.motion==='idle' ? ['full'] : [])]) {
      const png = await page.evaluate(({faction,spec,time,view}) => {
        window.equipmentProbe({faction,...spec,time,view})
        return window.game.renderer.domElement.toDataURL('image/png').split(',')[1]
      }, {faction,spec,time,view})
      fs.writeFileSync(`${output}/${name}-${time.toFixed(3)}-${view}.png`,Buffer.from(png,'base64'))
    }
    console.log(`已取樣 ${name}`)
  }
  const turning = await page.evaluate(() => ['roman','viking'].flatMap(faction=>[0,Math.PI/2,Math.PI,-Math.PI/2].flatMap(yaw=>[false,true].map(mounted=>window.equipmentProbe({faction,yaw,mounted})))) )
  rows.push(...turning)
  if (turning.some(r=>r.forwardDot<.96)) failures.push({reason:'轉向後槍未跟隨'})
  fs.writeFileSync(`${output}/measurements.json`,JSON.stringify({errors,failures,rows},null,2))
  console.log(JSON.stringify({取樣數:rows.length,錯誤:errors,失敗數:failures.length,最大主握點誤差:Math.max(...rows.filter(r=>r.weapon==='lance').map(r=>r.gripError))}))
  if (errors.length || failures.length) process.exitCode = 1
} finally { await browser.close() }
