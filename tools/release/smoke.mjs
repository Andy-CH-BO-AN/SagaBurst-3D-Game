import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readdir, readFile, stat, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { chromium, _electron } from 'playwright'

const desktop = process.argv.includes('--desktop')
const packagedIndex = process.argv.indexOf('--packaged')
const packaged = packagedIndex >= 0 ? process.argv[packagedIndex + 1] : undefined
if (packagedIndex >= 0 && !packaged) throw new Error('--packaged requires an executable path')
const base = desktop ? '/' : '/SagaBurst-3D-Game/'
const outDir = desktop ? 'dist-desktop' : 'dist'
async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  return (await Promise.all(entries.map(entry => entry.isDirectory()
    ? files(path.join(dir, entry.name)) : path.join(dir, entry.name)))).flat()
}
const publicFiles = await files('public')
for (const file of publicFiles) {
  const copied = path.join(outDir, path.relative('public', file))
  assert.equal((await stat(copied)).size, (await stat(file)).size, `Missing or truncated public asset: ${file}`)
}
const html = await readFile(path.join(outDir, 'index.html'), 'utf8')
assert.match(html, new RegExp(`src="${base}assets/[^" ]+\\.js"`))
assert.match(html, new RegExp(`href="${base}assets/[^" ]+\\.css"`))
const builtFiles = await files(path.join(outDir, 'assets'))
const audioSource = await readFile('src/audio/SoundManager.ts', 'utf8')
const audioCount = [...audioSource.matchAll(/new URL\('.*?\.wav'/g)].length
assert.equal(builtFiles.filter(file => file.endsWith('.wav')).length, audioCount, 'All referenced sound and voice files must be emitted')
// Fetch every runtime model, manifest, KTX2 texture and decoder from the actual origin.
const runtimeFiles = publicFiles.filter(file => /\.(glb|gltf|ktx2|wasm|js)$/.test(file) || /(?:manifest|attachment)\.json$/.test(file))
const urls = [...runtimeFiles.map(file => base + path.relative('public', file).split(path.sep).join('/')),
  ...builtFiles.map(file => base + path.relative(outDir, file).split(path.sep).join('/'))]
let server, browser, application
const userData = desktop ? await mkdtemp(path.join(os.tmpdir(), 'sagaburst-smoke-')) : undefined
try {
  let page
  if (desktop) {
    const { ELECTRON_RUN_AS_NODE, ...env } = process.env
    application = await _electron.launch({
      ...(packaged ? { executablePath: path.resolve(packaged) } : {}),
      args: [...(packaged ? [] : ['.']), `--user-data-dir=${userData}`], env, timeout: 60000,
    })
    page = await application.firstWindow()
    const preferences = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences())
    assert.equal(preferences.nodeIntegration, false)
    assert.equal(preferences.contextIsolation, true)
    assert.equal(preferences.sandbox, true)
  } else {
    server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4178', '--strictPort'], { stdio: 'pipe' })
    server.stderr.on('data', data => process.stderr.write(data))
    const address = `http://127.0.0.1:4178${base}`
    let ready = false
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(address)).ok) { ready = true; break } } catch {}
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    assert.ok(ready, 'Production preview did not start')
    browser = await chromium.launch(process.env.SMOKE_BROWSER_PATH ? { executablePath: process.env.SMOKE_BROWSER_PATH } : {})
    page = await browser.newPage()
  }
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure()?.errorText}`))
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`) })
  // Let the app's initial loadURL finish before testing a fresh navigation.
  if (desktop) {
    await page.locator('#main-menu-container').waitFor({ state: 'visible' })
    await page.waitForLoadState('load')
  }
  await page.goto(desktop ? 'sagaburst://game/' : `http://127.0.0.1:4178${base}`)
  await page.locator('#main-menu-container').waitFor({ state: 'visible' })
  await page.locator('#main-menu-custom').waitFor({ state: 'visible' })
  const failed = await page.evaluate(async urls => {
    const failed = []
    // Sequential requests bound peak memory when fetching large GLBs.
    for (const url of urls) {
      try {
        const response = await fetch(url)
        if (!response.ok) { failed.push(`${response.status} ${url}`); continue }
        const bytes = new Uint8Array(await response.arrayBuffer())
        if (!bytes.length) failed.push(`Empty ${url}`)
        if (url.endsWith('.glb') && String.fromCharCode(...bytes.slice(0, 4)) !== 'glTF') failed.push(`Invalid GLB ${url}`)
        if (url.endsWith('.json')) JSON.parse(new TextDecoder().decode(bytes))
      } catch (error) { failed.push(`${url}: ${error.message}`) }
    }
    return failed
  }, urls)
  assert.deepEqual(failed, [], 'Runtime assets must load from the production base')
  await page.evaluate(() => localStorage.setItem('sagaburst_release_smoke', 'saved'))
  await page.reload()
  await page.locator('#main-menu-container').waitFor({ state: 'visible' })
  assert.equal(await page.evaluate(() => localStorage.getItem('sagaburst_release_smoke')), 'saved')
  await page.evaluate(() => localStorage.removeItem('sagaburst_release_smoke'))
  assert.deepEqual(errors, [], 'No page errors, console errors or broken requests')
  console.log(`${desktop ? 'Desktop' : 'Pages'} smoke passed: main menu, ${publicFiles.length} public files, ${audioCount} sound/voice assets, ${urls.length} asset URLs and storage reload`)
} finally {
  await application?.close()
  await browser?.close()
  server?.kill()
  if (userData) await rm(userData, { recursive: true, force: true })
}
