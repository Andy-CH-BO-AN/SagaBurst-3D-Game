/** Scene-owned target HUD lifetime; matching the battle HUD's four-second last-hit window. */
export class CombatTargetHud {
  private timer: ReturnType<typeof setTimeout> | null = null

  show(name: string, ratio: number): void {
    if (typeof document === 'undefined') return
    const hud = document.getElementById('enemy-hud'), label = document.getElementById('enemy-name'), fill = document.getElementById('enemy-hp-fill')
    if (label) label.textContent = name
    if (fill) fill.style.width = `${Math.max(0, ratio * 100)}%`
    hud?.classList.add('visible')
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      hud?.classList.remove('visible')
      this.timer = null
    }, 4000)
  }

  dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    if (typeof document !== 'undefined') document.getElementById('enemy-hud')?.classList.remove('visible')
  }
}
