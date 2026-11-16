import type { CombatDamageMethod, CombatEvent, CombatTargetType } from '../combat/CombatAttribution'
import type { WeaponData } from './WeaponDatabase'
import { SHIELD_CONFIG } from '../combat/ShieldImpact'
import {
  SKILL_IDS,
  normalizeSkillState,
  resolveMeleeSkillId,
  skillHpBonus,
  type SkillId,
  type SkillState,
  type SkillStateInput,
} from './SkillManager'

export interface SkillProgressionAward {
  skill: SkillId
  xp: number
}

export interface PlayerSkillProgressionStatus {
  dead: boolean
  spectatorOnly?: boolean
  observer?: boolean
}

export function canAwardPlayerSkillProgression(status: PlayerSkillProgressionStatus): boolean {
  return !status.dead && !status.spectatorOnly && !status.observer
}

export function resolveCombatSkill(
  method: CombatDamageMethod,
  meleeWeapon?: Pick<WeaponData, 'animationKind'> | null,
  hasShield = false,
): SkillId | null {
  if (method === 'projectile') return 'ranged'
  if (method === 'mount-impact') return 'mountedImpact'
  if (method === 'melee' && meleeWeapon) return resolveMeleeSkillId(meleeWeapon, hasShield)
  return null
}

export function isSkillProgressionTarget(targetType: CombatTargetType): boolean {
  return targetType === 'npc' || targetType === 'mount'
}

/**
 * Convert one authoritative combat event into player skill XP.
 * NPC body and mount HP damage both count; structures never do.
 * Impact the player's attacks spend on an NPC shield or mount barding trains Armor Break.
 */
export function resolveSkillProgressionAward(
  event: CombatEvent,
  meleeWeapon?: Pick<WeaponData, 'animationKind'> | null,
  hasShield = false,
): SkillProgressionAward | null {
  if (event.type === 'hit_blocked') {
    if (event.source.actorType !== 'player' || !isSkillProgressionTarget(event.target.targetType)) return null
    const xp = event.blockedImpact * SHIELD_CONFIG.xpPerBlockedImpact
    return Number.isFinite(xp) && xp > 0 ? { skill: 'armorBreak', xp } : null
  }
  if (event.type !== 'damage_applied') return null
  if (event.source.actorType !== 'player') return null
  if (!isSkillProgressionTarget(event.target.targetType)) return null
  if (event.appliedDamage <= 0) return null

  if (event.method === 'melee' && event.weaponId === 'unarmed' && event.attackSource !== 'xongkoro') return { skill: 'unarmed', xp: event.appliedDamage * 2 }

  const skill = event.method === 'melee' && event.attackSource === 'xongkoro'
    ? 'mountedImpact' : resolveCombatSkill(event.method, meleeWeapon, hasShield)
  if (!skill) return null

  const xp = Math.max(0, event.appliedDamage)
  return xp > 0 ? { skill, xp } : null
}

export function resolveActivePlayerSkillProgressionAward(
  event: CombatEvent,
  status: PlayerSkillProgressionStatus,
  meleeWeapon?: Pick<WeaponData, 'animationKind'> | null,
  hasShield = false,
): SkillProgressionAward | null {
  if (!canAwardPlayerSkillProgression(status)) return null
  return resolveSkillProgressionAward(event, meleeWeapon, hasShield)
}

export function resolveSkillAdjustedMaxHp(
  baseMaxHp: number,
  state?: SkillState | SkillStateInput | null,
): number {
  return Math.max(1, baseMaxHp) + skillHpBonus(normalizeSkillState(state))
}

export function skillStatesEqual(a: SkillState, b: SkillState): boolean {
  return SKILL_IDS.every(id => a[id].level === b[id].level && a[id].xp === b[id].xp)
}
