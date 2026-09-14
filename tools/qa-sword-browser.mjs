import fs from 'node:fs'
import { chromium } from 'playwright'

const output = process.argv.slice(2).find(arg => !arg.startsWith('--')) ?? 'output/playwright/sword-attachment'
fs.mkdirSync(output, { recursive: true })
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('http://127.0.0.1:5173/?devmodels=humans&nolock')
  await page.waitForFunction(() => !!window.game, undefined, { timeout: 90000 })
  const probe = fs.readFileSync('tools/sword-browser-probe.js', 'utf8')
  await page.evaluate(`(${probe.slice(probe.indexOf('async ()'))})()`)
  const states = process.argv.includes('--attack') ? ['swordSlash'] : ['idle', 'walk', 'run']
  const measurements = await page.evaluate(states => {
    const results = []
    for (const f of ['roman', 'viking']) for (const state of states) for (let step = 0; step <= 60; step++) for (const lod of [0, 1, 2]) {
      results.push(window.swordProbe(f, state, step / 60, lod, 'top'))
    }
    return results
  }, states)
  const views = process.argv.includes('--fingers') ? ['fingers'] : ['palm', 'back', 'side', 'fingers', 'full', 'top']
  for (const f of ['roman', 'viking']) for (const state of states) for (const lod of [0, 1, 2]) for (const view of views) {
    if (process.argv.includes('--review') && (['palm', 'side'].includes(view) || (lod > 0 && ['full', 'top'].includes(view)))) continue
    const png = await page.evaluate(({ f, state, lod, view }) => {
      window.swordProbe(f, state, .25, lod, view)
      return window.game.renderer.domElement.toDataURL('image/png').split(',')[1]
    }, { f, state, lod, view })
    fs.writeFileSync(`${output}/${f}-${state}-lod${lod}-${view}.png`, Buffer.from(png, 'base64'))
    console.log(`${f} ${state} LOD${lod} ${view}`)
  }
  fs.writeFileSync(`${output}/measurements.json`, JSON.stringify({ errors, measurements }, null, 2))
  const maxError = Math.max(...measurements.map(row => row.gripErrorM))
  console.log(JSON.stringify({ 畫面: output, 取樣數: measurements.length, 最大握點誤差公尺: maxError, 應用程式錯誤: errors }))
  if (errors.length || maxError > .005) process.exitCode = 1
} finally { await browser.close() }
