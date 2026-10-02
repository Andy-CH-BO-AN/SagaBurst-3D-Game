/**
 * SkillManager.ts
 * Manages persistent combat skill progression for one-handed, two-handed,
 * ranged, and mounted-impact combat.
 */

import type { SoundManager } from '../audio/SoundManager'
import type { WeaponData } from './WeaponDatabase'

export const MAX_SKILL_LEVEL = 50

export type SkillId = 'oneHanded' | 'twoHanded' | 'ranged' | 'mountedImpact'
export type LegacySkillId = SkillId | 'archery'

export interface SkillData {
  level: number
  xp: number
}

export interface SkillState {
  oneHanded: SkillData
  twoHanded: SkillData
  ranged: SkillData
  mountedImpact: SkillData
}

export interface SkillStateInput {
  oneHanded?: Partial<SkillData>
  twoHanded?: Partial<SkillData>
  ranged?: Partial<SkillData>
  mountedImpact?: Partial<SkillData>
  /** Legacy save compatibility. */
  archery?: Partial<SkillData>
}

const SKILL_LABELS: Record<SkillId, string> = {
  oneHanded: '⚔️ 單手武器',
  twoHanded: '🪓 雙手武器',
  ranged: '🏹 遠程',
  mountedImpact: '🐎 騎馬衝撞',
}

export function createDefaultSkillState(): SkillState {
  return {
    oneHanded: { level: 1, xp: 0 },
    twoHanded: { level: 1, xp: 0 },
    ranged: { level: 1, xp: 0 },
    mountedImpact: { level: 1, xp: 0 },
  }
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function finiteInteger(value: unknown, fallback: number): number {
  return Math.floor(finiteNumber(value, fallback))
}

function normalizeSkillData(value?: Partial<SkillData>): SkillData {
  const level = Math.max(1, Math.min(MAX_SKILL_LEVEL, finiteInteger(value?.level, 1)))
  if (level >= MAX_SKILL_LEVEL) return { level, xp: 0 }
  const needed = level * 100
  const xp = Math.max(0, Math.min(needed - Number.EPSILON, finiteNumber(value?.xp, 0)))
  return { level, xp }
}

export function normalizeSkillState(state?: SkillStateInput | null): SkillState {
  const ranged = state?.ranged ?? state?.archery
  return {
    oneHanded: normalizeSkillData(state?.oneHanded),
    twoHanded: normalizeSkillData(state?.twoHanded),
    ranged: normalizeSkillData(ranged),
    mountedImpact: normalizeSkillData(state?.mountedImpact),
  }
}

/** Lv.1 = 1.0x and Lv.50 = exactly 3.0x. */
export function skillDamageMultiplier(level: number): number {
  const clamped = Math.max(1, Math.min(MAX_SKILL_LEVEL, Math.floor(level)))
  return 1 + ((clamped - 1) / (MAX_SKILL_LEVEL - 1)) * 2
}

/** Every level above Lv.1 grants +1 max HP. Four Lv.50 skills => +196 HP. */
export function skillHpBonus(state: SkillState): number {
  return (state.oneHanded.level - 1)
    + (state.twoHanded.level - 1)
    + (state.ranged.level - 1)
    + (state.mountedImpact.level - 1)
}

/**
 * Classify the actual melee stance, not just the weapon name.
 * Axes without a shield use the two-handed animation; greatswords are always two-handed.
 * Lances and the remaining melee weapons are one-handed for progression purposes.
 */
export function resolveMeleeSkillId(
  weapon: Pick<WeaponData, 'animationKind'>,
  hasShield: boolean,
): 'oneHanded' | 'twoHanded' {
  if (weapon.animationKind === 'greatsword') return 'twoHanded'
  if (weapon.animationKind === 'axe' && !hasShield) return 'twoHanded'
  return 'oneHanded'
}

export class SkillManager {
  private state: SkillState = createDefaultSkillState()

  private levelupToast: HTMLElement | null
  private toastTimer: number | null = null
  private readonly toastQueue: string[] = []

  constructor() {
    this.levelupToast = typeof document !== 'undefined' ? document.getElementById('levelup-toast') : null
  }

  get skillState(): SkillState {
    return {
      oneHanded: { ...this.state.oneHanded },
      twoHanded: { ...this.state.twoHanded },
      ranged: { ...this.state.ranged },
      mountedImpact: { ...this.state.mountedImpact },
    }
  }

  setSkillState(state: SkillStateInput): void {
    this.state = normalizeSkillState(state)
  }

  getXpNeeded(level: number): number {
    const clamped = Math.max(1, Math.min(MAX_SKILL_LEVEL, Math.floor(level)))
    return clamped >= MAX_SKILL_LEVEL ? 0 : clamped * 100
  }

  getMultiplier(skill: SkillId): number {
    return skillDamageMultiplier(this.state[skill].level)
  }

  getOneHandedMultiplier(): number {
    return this.getMultiplier('oneHanded')
  }

  getTwoHandedMultiplier(): number {
    return this.getMultiplier('twoHanded')
  }

  getRangedMultiplier(): number {
    return this.getMultiplier('ranged')
  }

  /** Legacy API retained for existing non-Career callers. */
  getArcheryMultiplier(): number {
    return this.getRangedMultiplier()
  }

  getMountedImpactMultiplier(): number {
    return this.getMultiplier('mountedImpact')
  }

  getMaxHpBonus(): number {
    return skillHpBonus(this.state)
  }

  /**
   * XP is expected to be actual NPC or mount HP removed, after shield reduction
   * and overkill clamping. Structure damage must not call this method.
   */
  addXp(skill: LegacySkillId, amount: number, soundManager?: SoundManager): number {
    const id: SkillId = skill === 'archery' ? 'ranged' : skill
    const data = this.state[id]
    if (data.level >= MAX_SKILL_LEVEL) return 0

    const gained = finiteNumber(amount, 0)
    if (gained <= 0) return 0
    data.xp += gained

    let levelsGained = 0
    while (data.level < MAX_SKILL_LEVEL) {
      const needed = this.getXpNeeded(data.level)
      if (data.xp < needed) break
      data.xp -= needed
      data.level += 1
      levelsGained += 1
      this._showLevelUpToast(`${SKILL_LABELS[id]}技能升到第 ${data.level} 級！`)
      soundManager?.playLevelUp()
    }

    if (data.level >= MAX_SKILL_LEVEL) data.xp = 0
    return levelsGained
  }

  private _showLevelUpToast(message: string): void {
    if (!this.levelupToast) return
    this.toastQueue.push(message)
    if (this.toastTimer === null) this._showNextToast()
  }

  private _showNextToast(): void {
    if (!this.levelupToast) {
      this.toastQueue.length = 0
      this.toastTimer = null
      return
    }
    const message = this.toastQueue.shift()
    if (!message) {
      this.levelupToast.classList.remove('visible')
      this.toastTimer = null
      return
    }

    this.levelupToast.textContent = message
    this.levelupToast.classList.add('visible')
    this.toastTimer = window.setTimeout(() => {
      this.levelupToast.classList.remove('visible')
      this.toastTimer = window.setTimeout(() => this._showNextToast(), 220)
    }, 2200)
  }
}
