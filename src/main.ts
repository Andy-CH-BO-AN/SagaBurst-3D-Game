/**
 * main.ts
 * Vite entry point. Instantiates the Game when the DOM is ready.
 */
import { Game } from './Game'

window.addEventListener('error', (e) => {
  const errDiv = document.createElement('div')
  errDiv.style.position = 'absolute'
  errDiv.style.top = '10px'
  errDiv.style.left = '10px'
  errDiv.style.color = 'red'
  errDiv.style.zIndex = '9999'
  errDiv.style.backgroundColor = 'rgba(0,0,0,0.8)'
  errDiv.style.padding = '10px'
  errDiv.innerHTML = `Error: ${e.message}<br>${e.filename}:${e.lineno}`
  document.body.appendChild(errDiv)
})

const container = document.getElementById('canvas-container')
if (!container) throw new Error('#canvas-container not found')

async function bootstrap(): Promise<void> {
try {
  const loading = document.createElement('div')
  loading.id = 'asset-loading-status'
  loading.style.cssText = 'position:absolute;inset:0;display:grid;place-items:center;color:#eee;background:#171411;z-index:9998;font:16px system-ui'
  loading.textContent = '正在載入寫實人物與戰馬資產…'
  document.body.appendChild(loading)
  ;(window as any).game = await Game.create(container!)
  loading.remove()
} catch (error: unknown) {
  const e = error instanceof Error ? error : new Error(String(error))
  document.getElementById('asset-loading-status')?.remove()
  const errDiv = document.createElement('div')
  errDiv.style.position = 'absolute'
  errDiv.style.top = '10px'
  errDiv.style.left = '10px'
  errDiv.style.color = 'red'
  errDiv.style.zIndex = '9999'
  errDiv.style.backgroundColor = 'rgba(0,0,0,0.8)'
  errDiv.style.padding = '10px'
  errDiv.textContent = `寫實資產載入失敗：${e.message}`
  document.body.appendChild(errDiv)
}
}

void bootstrap()
