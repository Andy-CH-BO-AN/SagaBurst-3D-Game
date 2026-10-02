import { DUEL_COMBAT_SECONDS } from '../career/CareerDuelState'
import type { CareerMissionPhase } from '../career/CareerMissionState'

/** Dedicated, large countdown above the duel; independent of the town's text HUD. */
export class CareerDuelHUD {
  private readonly root = document.createElement('div')
  private readonly label = document.createElement('div')
  private readonly value = document.createElement('div')

  constructor() {
    this.root.id = 'career-duel-hud'
    this.root.setAttribute('role', 'timer')
    this.label.className = 'duel-countdown-label'
    this.value.className = 'duel-countdown-value'
    this.root.append(this.label, this.value)
    document.body.append(this.root)
    this.root.hidden = true
  }

  update(phase: CareerMissionPhase | null, countdownRemaining: number, combatRemaining: number): void {
    this.root.hidden = phase !== 'PREPARING' && phase !== 'ENGAGING'
    if (this.root.hidden) return
    const preparing = phase === 'PREPARING'
    this.label.textContent = preparing ? '單挑即將開始' : '單挑剩餘時間'
    this.value.textContent = preparing ? String(Math.ceil(countdownRemaining))
      : combatRemaining > DUEL_COMBAT_SECONDS - 1 ? 'FIGHT' : `${combatRemaining.toFixed(1)}s`
  }

  dispose(): void { this.root.remove() }
}
