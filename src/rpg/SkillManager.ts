/**
 * SkillManager.ts
 * Manages RPG skills: One-Handed (單手武器) and Archery (弓術).
 * XP gains on hits, level-up calculation, Skyrim-style level up toasts, and damage scaling.
 */

import type { SoundManager } from '../audio/SoundManager'

export interface SkillData {
  level: number
  xp: number
}

export class SkillManager {
  private oneHanded: SkillData = { level: 1, xp: 0 }
  private archery: SkillData   = { level: 1, xp: 0 }

  private levelupToast: HTMLElement
  private toastTimer: number | null = null

  constructor() {
    this.levelupToast = document.getElementById('levelup-toast')!
  }

  get skillState(): { oneHanded: SkillData; archery: SkillData } {
    return {
      oneHanded: { ...this.oneHanded },
      archery: { ...this.archery },
    }
  }

  setSkillState(state: { oneHanded?: Partial<SkillData>; archery?: Partial<SkillData> }): void {
    if (state.oneHanded) {
      this.oneHanded.level = state.oneHanded.level ?? 1
      this.oneHanded.xp = state.oneHanded.xp ?? 0
    }
    if (state.archery) {
      this.archery.level = state.archery.level ?? 1
      this.archery.xp = state.archery.xp ?? 0
    }
  }

  getXpNeeded(level: number): number {
    return level * 100
  }

  /** Damage multiplier based on skill level (+15% per level above 1) */
  getOneHandedMultiplier(): number {
    return 1 + (this.oneHanded.level - 1) * 0.15
  }

  getArcheryMultiplier(): number {
    return 1 + (this.archery.level - 1) * 0.15
  }

  addXp(skill: 'oneHanded' | 'archery', amount: number, soundManager?: SoundManager): void {
    const data = skill === 'oneHanded' ? this.oneHanded : this.archery
    const name = skill === 'oneHanded' ? '⚔️ 單手武器 One-Handed' : '🏹 弓術 Archery'

    data.xp += amount
    let needed = this.getXpNeeded(data.level)

    if (data.xp >= needed) {
      data.xp -= needed
      data.level += 1
      const boostPercent = Math.round((data.level - 1) * 15)
      this._showLevelUpToast(`${name} 升至 Lv.${data.level}！（攻擊力 +${boostPercent}%）`)
      if (soundManager) soundManager.playLevelUp()
    }
  }

  private _showLevelUpToast(message: string): void {
    this.levelupToast.textContent = message
    this.levelupToast.classList.add('visible')

    if (this.toastTimer !== null) clearTimeout(this.toastTimer)
    this.toastTimer = window.setTimeout(() => {
      this.levelupToast.classList.remove('visible')
    }, 3200)
  }
}
