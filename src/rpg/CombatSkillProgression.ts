import type { CombatDamageMethod, CombatEvent, CombatTargetType } from '../combat/CombatAttribution'
import type { WeaponData } from './WeaponDatabase'
import {
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
 * Convert one authoritative combat damage event into player skill XP.
 * NPC body and mount HP damage both count; structures never do.
 */
export function resolveSkillProgressionAward(
  event: CombatEvent,
  meleeWeapon?: Pick<WeaponData, 'animationKind'> | null,
  hasShield = false,
): SkillProgressionAward | null {
  if (event.type !== 'damage_applied') return null
  if (event.source.actorType !== 'player') return null
  if (!isSkillProgressionTarget(event.target.targetType)) return null
  if (event.appliedDamage <= 0) return null

  const skill = resolveCombatSkill(event.method, meleeWeapon, hasShield)
  if (!skill) return null

  const xp = Math.max(0, event.appliedDamage)
  return xp > 0 ? { skill, xp } : null
}

export function resolveSkillAdjustedMaxHp(
  baseMaxHp: number,
  state?: SkillState | SkillStateInput | null,
): number {
  return Math.max(1, baseMaxHp) + skillHpBonus(normalizeSkillState(state))
}

export function skillStatesEqual(a: SkillState, b: SkillState): boolean {
  return a.oneHanded.level === b.oneHanded.level
    && a.oneHanded.xp === b.oneHanded.xp
    && a.twoHanded.level === b.twoHanded.level
    && a.twoHanded.xp === b.twoHanded.xp
    && a.ranged.level === b.ranged.level
    && a.ranged.xp === b.ranged.xp
    && a.mountedImpact.level === b.mountedImpact.level
    && a.mountedImpact.xp === b.mountedImpact.xp
}
