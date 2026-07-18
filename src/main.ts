/**
 * main.ts
 * Vite entry point. Instantiates the Game when the DOM is ready.
 */
import { Game } from './Game'

const container = document.getElementById('canvas-container')
if (!container) throw new Error('#canvas-container not found')

new Game(container)
