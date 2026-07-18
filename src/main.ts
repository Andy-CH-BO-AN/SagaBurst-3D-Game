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

try {
  (window as any).game = new Game(container)
} catch (e: any) {
  const errDiv = document.createElement('div')
  errDiv.style.position = 'absolute'
  errDiv.style.top = '10px'
  errDiv.style.left = '10px'
  errDiv.style.color = 'red'
  errDiv.style.zIndex = '9999'
  errDiv.style.backgroundColor = 'rgba(0,0,0,0.8)'
  errDiv.style.padding = '10px'
  errDiv.innerHTML = `Init Error: ${e.message}<br>${e.stack}`
  document.body.appendChild(errDiv)
}
