import type { UnitPreset } from '../battle/UnitPresetCatalog'
import { careerDuelClassOptions } from './CareerDuelClasses'
import { CAREER_DUEL_TIERS, duelCombatSeconds, DUEL_COUNTDOWN_SECONDS, isCareerDuelUnlocked, isUnarmedDuelUnlocked, type CareerDuelTier } from './CareerDuelState'
import type { CareerHeroClass } from './CareerHeroClasses'
import type { CareerProfile } from './CareerProfile'

/** What a Duel is fought as: bare fists, or one faction unit type. Both share the same Tier ladder. */
export type CareerDuelSubject = { kind: 'unarmed' } | { kind: 'unit'; preset: UnitPreset }
export type CareerDuelTierStatus = 'completed' | 'available' | 'locked'

export interface CareerDuelTierEntry {
  tier: CareerDuelTier
  status: CareerDuelTierStatus
  /** Only for a locked tier: the challenge that must be won first. */
  requirement?: string
  /** Who stands across the ring. */
  opponent: string
  /** T4/T5 with a choice: the player picks the opponent's class on the tier row itself. */
  classes: readonly CareerHeroClass[]
}

export const CAREER_DUEL_SUBJECT_LABEL_UNARMED = '空手對戰'

/** Highest tier already won for the subject; 0 when none. */
export function careerDuelHighestWon(profile: CareerProfile, subject: CareerDuelSubject): number {
  return subject.kind === 'unarmed' ? profile.unarmedDuelHighestDefeatedTier ?? 0
    : profile.duelHighestDefeatedTierByPreset?.[subject.preset.id] ?? 0
}

/** Per-tier presentation state. Unlock rules stay owned by CareerDuelState; this only reads them. */
export function careerDuelTierEntries(profile: CareerProfile, subject: CareerDuelSubject): CareerDuelTierEntry[] {
  const highest = careerDuelHighestWon(profile, subject)
  const name = subject.kind === 'unarmed' ? '空手對手' : subject.preset.nameZh
  return CAREER_DUEL_TIERS.map(tier => {
    const unlocked = subject.kind === 'unarmed' ? isUnarmedDuelUnlocked(profile, tier) : isCareerDuelUnlocked(profile, subject.preset.id, tier)
    const status: CareerDuelTierStatus = !unlocked ? 'locked' : highest >= tier ? 'completed' : 'available'
    const classes = subject.kind === 'unit' ? careerDuelClassOptions(profile.faction, subject.preset.id, tier) : []
    const ranger = subject.kind === 'unit' && tier === 4 && subject.preset.traits.includes('bow_fire')
    const opponent = subject.kind === 'unarmed' ? '同樣空手的對手'
      : tier === 5 ? '指揮官（隊長擔任裁判）' : tier === 4 ? ranger ? '遊俠' : '隊長（遊俠擔任裁判）' : `${subject.preset.nameZh}`
    return { tier, status, opponent, classes,
      ...(status === 'locked' ? { requirement: `需先擊敗 T${tier - 1} ${name}` } : {}) }
  })
}

/** The rules every tier of a subject shares, stated once above the ladder. */
export function careerDuelSubjectRules(subject: CareerDuelSubject): string {
  const mode = subject.kind === 'unarmed' ? 'unarmed' : 'armed'
  return `${DUEL_COUNTDOWN_SECONDS} 秒準備 · ${duelCombatSeconds(mode)} 秒內擊敗對手`
    + (subject.kind === 'unarmed' ? '\n雙方空手、無盾牌與坐騎；只准拳擊，使用其他傷害即判負' : '')
}

/** "已完成 2/5": a single glanceable progress figure per subject. */
export function careerDuelProgressLabel(profile: CareerProfile, subject: CareerDuelSubject): string {
  const done = careerDuelTierEntries(profile, subject).filter(entry => entry.status === 'completed').length
  return `${done}/${CAREER_DUEL_TIERS.length}`
}

/** Player-facing name of the running Duel's opponent type; unarmed Duels borrow a preset internally and must never show it. */
export function careerDuelMissionLabel(mission: { duelMode?: 'armed' | 'unarmed'; duelTier?: number; duelPresetId?: string }, presetNameZh: (id: string) => string): string {
  const what = mission.duelMode === 'unarmed' ? CAREER_DUEL_SUBJECT_LABEL_UNARMED : mission.duelPresetId ? presetNameZh(mission.duelPresetId) : ''
  return `T${mission.duelTier} ${what}`.trim()
}
