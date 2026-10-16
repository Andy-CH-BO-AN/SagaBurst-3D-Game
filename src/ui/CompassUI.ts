import type { Camera } from 'three'
import { CompassHeading } from './CompassHeading'

const MARKERS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const
const MARKER_WIDTH = 80
const TURN_WIDTH = MARKER_WIDTH * MARKERS.length

/** Scene-owned Norse compass; updated by the existing gameplay loop. */
export class CompassUI {
  private readonly container = document.createElement('div')
  private readonly strip = document.createElement('div')
  private readonly heading = new CompassHeading()
  private readonly topHudObserver?: ResizeObserver
  private lastOffset = NaN

  constructor(camera: Pick<Camera, 'getWorldDirection'>, topHud?: HTMLElement | null) {
    this.container.id = 'compass-container'
    this.container.setAttribute('aria-hidden', 'true')
    this.strip.id = 'compass-strip'
    for (let loop = 0; loop < 3; loop++) {
      for (const label of MARKERS) {
        const mark = document.createElement('span')
        mark.className = label === 'N' ? 'compass-mark compass-north' : 'compass-mark'
        mark.textContent = label
        this.strip.appendChild(mark)
      }
    }
    const indicator = document.createElement('div')
    indicator.id = 'compass-indicator'
    this.container.append(this.strip, indicator)
    this.update(camera)
    document.getElementById('hud')!.appendChild(this.container)
    if (topHud) {
      const placeBelowHud = () => {
        this.container.style.top = `${Math.max(104, topHud.getBoundingClientRect().bottom + 12)}px`
      }
      placeBelowHud()
      // Campaign titles, phase text and squad counts can wrap or change height.
      // Observe layout changes instead of measuring the HUD every frame.
      this.topHudObserver = new ResizeObserver(placeBelowHud)
      this.topHudObserver.observe(topHud)
    }
  }

  update(camera: Pick<Camera, 'getWorldDirection'>): void {
    const heading = this.heading.update(camera)
    const offset = Math.round((TURN_WIDTH + MARKER_WIDTH / 2 + heading * TURN_WIDTH / (Math.PI * 2)) * 100) / 100
    if (offset === this.lastOffset) return
    this.lastOffset = offset
    // Repeated turns make 0/360 visually identical. No CSS interpolation across
    // the wrap: it would scroll the long way round after crossing north.
    this.strip.style.transform = `translateX(${-offset}px)`
  }

  dispose(): void {
    this.topHudObserver?.disconnect()
    this.container.remove()
  }
}
