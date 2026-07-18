/**
 * QuiverUI.ts
 * Manages the Skyrim-style Archery Reticle, Radial Charge Ring, and Quiver DOM UI.
 */
export class QuiverUI {
  private arrowCountEl: HTMLElement
  private crosshairEl: HTMLElement
  private aimReticleEl: HTMLElement
  private chargeRingEl: HTMLElement

  constructor() {
    this.arrowCountEl  = document.getElementById('arrow-count')!
    this.crosshairEl   = document.getElementById('crosshair')!
    this.aimReticleEl  = document.getElementById('aim-reticle')!
    this.chargeRingEl  = document.getElementById('charge-ring')!
  }

  setArrowCount(count: number): void {
    this.arrowCountEl.textContent = `${count}`
    if (count <= 0) {
      this.arrowCountEl.style.color = '#e74c3c'
    } else {
      this.arrowCountEl.style.color = '#e8c96a'
    }
  }

  setAiming(isAiming: boolean): void {
    if (isAiming) {
      this.crosshairEl.classList.add('hidden')
      this.aimReticleEl.classList.add('active')
    } else {
      this.crosshairEl.classList.remove('hidden')
      this.aimReticleEl.classList.remove('active')
      this.aimReticleEl.classList.remove('charging')
      this.chargeRingEl.classList.remove('visible')
    }
  }

  setChargeRatio(ratio: number): void {
    if (ratio > 0) {
      const degrees = ratio * 360
      this.chargeRingEl.style.setProperty('--charge-deg', `${degrees}deg`)
      this.chargeRingEl.classList.add('visible')
      this.aimReticleEl.classList.add('charging')
    } else {
      this.chargeRingEl.classList.remove('visible')
      this.aimReticleEl.classList.remove('charging')
      this.chargeRingEl.style.setProperty('--charge-deg', '0deg')
    }
  }
}
