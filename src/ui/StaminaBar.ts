/**
 * StaminaBar.ts
 * Controls the DOM stamina bar fill width (0–1).
 * Turns the bar red when critically low.
 */
export class StaminaBar {
  private fill: HTMLElement

  constructor() {
    this.fill = document.getElementById('stam-fill')!
  }

  /** @param ratio 0.0 (empty) → 1.0 (full) */
  setFill(ratio: number): void {
    const clamped = Math.max(0, Math.min(1, ratio))
    this.fill.style.width = `${clamped * 100}%`
    // Turn red when below 20 %
    if (clamped < 0.2) {
      this.fill.style.background = 'linear-gradient(90deg, #7b0a0a, #c0392b)'
    } else {
      this.fill.style.background = 'linear-gradient(90deg, #d4870a, #f39c12)'
    }
  }
}
