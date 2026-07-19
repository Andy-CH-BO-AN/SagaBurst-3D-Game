/**
 * DamageNumbers.ts
 * Manages floating 3D-projected DOM damage numbers.
 * Displays yellow/gold numbers that float upward and fade out.
 */
import * as THREE from 'three'

interface DamageItem {
  element: HTMLDivElement
  worldPos: THREE.Vector3
  life: number
  maxLife: number
}

export class DamageNumbers {
  private container: HTMLElement
  private items: DamageItem[] = []
  
  // ── Reusable temporary vectors (P-1: avoid per-frame GC pressure) ──
  private readonly _tmpOffset = new THREE.Vector3()
  private readonly _tmpProject = new THREE.Vector3()


  constructor() {
    this.container = document.getElementById('damage-container')!
  }

  /**
   * Spawn a new floating damage number at world location
   */
  spawn(amount: number, worldPos: THREE.Vector3): void {
    const el = document.createElement('div')
    el.className = 'damage-number'
    el.textContent = `-${Math.round(amount)}`

    // Random slight offset so numbers don't stack perfectly
    this._tmpOffset.set(
      (Math.random() - 0.5) * 0.6,
      (Math.random() - 0.5) * 0.4 + 1.2,
      (Math.random() - 0.5) * 0.6
    )
    const pos = worldPos.clone().add(this._tmpOffset)

    this.container.appendChild(el)
    this.items.push({
      element: el,
      worldPos: pos,
      life: 0.8,
      maxLife: 0.8,
    })
  }

  update(dt: number, camera: THREE.Camera): void {
    const widthHalf = window.innerWidth / 2
    const heightHalf = window.innerHeight / 2

    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i]
      item.life -= dt

      if (item.life <= 0) {
        item.element.remove()
        this.items.splice(i, 1)
        continue
      }

      // Float upward in world space
      item.worldPos.y += dt * 1.5

      // Project 3D world position to 2D normalized device coordinates (NDC)
      const proj = this._tmpProject.copy(item.worldPos).project(camera)

      // Behind camera check
      if (proj.z > 1) {
        item.element.style.display = 'none'
        continue
      } else {
        item.element.style.display = 'block'
      }

      const x = (proj.x * widthHalf) + widthHalf
      const y = -(proj.y * heightHalf) + heightHalf

      const alpha = item.life / item.maxLife
      item.element.style.left = `${x}px`
      item.element.style.top = `${y}px`
      item.element.style.opacity = `${alpha}`
      item.element.style.transform = `translate(-50%, -50%) scale(${0.8 + (1 - alpha) * 0.4})`
    }
  }
}
