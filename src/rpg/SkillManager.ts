/**
 * SkillManager.ts
 * Manages persistent combat skill progression for one-handed, two-handed,
 * ranged, mounted-impact, blocking, armor-break, and unarmed combat.
 */

import type { SoundManager } from '../audio/SoundManager'
import type { WeaponData } from './WeaponDatabase'

export const MAX_SKILL_LEVEL = 50

export type SkillId = 'oneHanded' | 'twoHanded' | 'ranged' | 'mountedImpact' | 'blocking' | 'armorBreak' | 'unarmed'

/** Display and persistence order for every combat skill. */
export const SKILL_IDS: readonly SkillId[] = ['unarmed', 'oneHanded', 'twoHanded', 'ranged', 'mountedImpact', 'blocking', 'armorBreak']

export interface SkillData {
  level: number
  xp: number
}

export interface SkillState {
  unarmed: SkillData
  blocking: SkillData
  oneHanded: SkillData
  twoHanded: SkillData
  ranged: SkillData
  mountedImpact: SkillData
  armorBreak: SkillData
}

export interface SkillStateInput {
  unarmed?: Partial<SkillData>
  blocking?: Partial<SkillData>
  oneHanded?: Partial<SkillData>
  twoHanded?: Partial<SkillData>
  ranged?: Partial<SkillData>
  mountedImpact?: Partial<SkillData>
  armorBreak?: Partial<SkillData>
}

const SKILL_LABELS: Record<SkillId, string> = {
  unarmed: '🥊 徒手格鬥',
  blocking: '🛡️ 格擋',
  oneHanded: '⚔️ 單手武器',
  twoHanded: '🪓 雙手武器',
  ranged: '🏹 遠程',
  mountedImpact: '🐎 騎馬衝撞',
  armorBreak: '🔨 破甲',
}

export function createDefaultSkillState(): SkillState {
  return normalizeSkillState()
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
  return Object.fromEntries(SKILL_IDS.map(id => [id, normalizeSkillData(state?.[id])])) as unknown as SkillState
}

/** Shared 1%-per-level curve capped at 50% (Blocking overflow reduction, Armor Break penetration). */
export function skillPercentEffect(level: number | undefined): number {
  return Math.min(.5, Math.max(0, Number.isFinite(level) ? Math.floor(level!) : 0) * .01)
}

/** Fraction of shield / barding-blocked damage an attacker's Armor Break turns back into damage. */
export function armorBreakPenetration(level: number | undefined): number {
  return skillPercentEffect(level)
}

/** Combat-time skill levels the Player carries into shield and actor-ref calculations. */
export function syncPlayerSkillCombatLevels(
  player: { blockingLevel: number; armorBreakLevel: number },
  state: Pick<SkillState, 'blocking' | 'armorBreak'>,
): void {
  player.blockingLevel = state.blocking.level
  player.armorBreakLevel = state.armorBreak.level
}

/** Lv.1 = 1.0x and Lv.50 = exactly 3.0x. */
export function skillDamageMultiplier(level: number): number {
  const clamped = Math.max(1, Math.min(MAX_SKILL_LEVEL, Math.floor(level)))
  return 1 + ((clamped - 1) / (MAX_SKILL_LEVEL - 1)) * 2
}

/** Unarmed alone reaches ×5; existing weapon skills retain their ×3 curve. */
export function unarmedSkillDamageMultiplier(level: number): number {
  const clamped = Math.max(1, Math.min(MAX_SKILL_LEVEL, finiteInteger(level, 1)))
  return 1 + ((clamped - 1) / (MAX_SKILL_LEVEL - 1)) * 4
}

/** Offensive skills (Armor Break included) grant HP above Lv.1; Blocking grants its full level. */
export function skillHpBonus(state: SkillState): number {
  return SKILL_IDS.reduce((total, id) => total + state[id].level - (id === 'blocking' ? 0 : 1), 0)
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
    return Object.fromEntries(SKILL_IDS.map(id => [id, { ...this.state[id] }])) as unknown as SkillState
  }

  setSkillState(state: SkillStateInput): void {
    this.state = normalizeSkillState(state)
  }

  getXpNeeded(level: number): number {
    const clamped = Math.max(1, Math.min(MAX_SKILL_LEVEL, Math.floor(level)))
    return clamped >= MAX_SKILL_LEVEL ? 0 : clamped * 100
  }

  getMultiplier(skill: SkillId): number {
    if (skill === 'unarmed') return unarmedSkillDamageMultiplier(this.state.unarmed.level)
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
   * Offensive XP uses actual HP removed. Blocking and Armor Break use actual
   * absorbed impact scaled by SHIELD_CONFIG. Structure damage must not call this method.
   */
  addXp(skill: SkillId, amount: number, soundManager?: SoundManager): number {
    const id = skill
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
      this.levelupToast?.classList.remove('visible')
      this.toastTimer = window.setTimeout(() => this._showNextToast(), 220)
    }, 2200)
  }
}
