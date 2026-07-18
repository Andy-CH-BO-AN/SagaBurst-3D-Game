/**
 * HpBar.ts
 * Controls the DOM HP bar fill width (0–1).
 * Phase 2 will hook this up to actual damage; for now it stays full.
 */
export class HpBar {
  private fill: HTMLElement

  constructor() {
    this.fill = document.getElementById('hp-fill')!
  }

  /** @param ratio 0.0 (dead) → 1.0 (full health) */
  setFill(ratio: number): void {
    const clamped = Math.max(0, Math.min(1, ratio))
    this.fill.style.width = `${clamped * 100}%`
  }
}
