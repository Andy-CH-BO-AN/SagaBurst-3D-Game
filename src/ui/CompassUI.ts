/**
 * CompassUI.ts
 * Manages the top Norse-Rune aesthetic compass bar.
 * Dynamically slides N / NE / E / SE / S / SW / W / NW markers based on camera yaw.
 */
import * as THREE from 'three'

interface CompassMarker {
  label: string
  angle: number // degrees (0=N, 90=E, 180=S, 270=W)
}

const MARKERS: CompassMarker[] = [
  { label: 'N',  angle: 0 },
  { label: 'NE', angle: 45 },
  { label: 'E',  angle: 90 },
  { label: 'SE', angle: 135 },
  { label: 'S',  angle: 180 },
  { label: 'SW', angle: 225 },
  { label: 'W',  angle: 270 },
  { label: 'NW', angle: 315 },
]

export class CompassUI {
  private strip: HTMLElement

  constructor() {
    this.strip = document.getElementById('compass-strip')!
    this._buildStrip()
  }

  private _buildStrip(): void {
    // Build 3 repeated loops of markers for seamless infinite scrolling
    this.strip.innerHTML = ''
    for (let loop = -1; loop <= 1; loop++) {
      for (const m of MARKERS) {
        const span = document.createElement('span')
        span.className = 'compass-mark'
        span.textContent = m.label
        if (m.label === 'N') span.style.color = '#e74c3c' // North marked red
        this.strip.appendChild(span)
      }
    }
  }

  /**
   * Update compass rotation position.
   * @param cameraYaw camera yaw in radians
   */
  update(cameraYaw: number): void {
    // Convert radians to degrees [0, 360)
    let deg = THREE.MathUtils.radToDeg(cameraYaw) % 360
    if (deg < 0) deg += 360

    // 80px per 45 degrees = 1.777px per degree
    const pixelsPerDegree = 80 / 45
    const offsetPx = -(deg * pixelsPerDegree)

    this.strip.style.transform = `translateX(calc(-50% + ${offsetPx}px))`
  }
}
