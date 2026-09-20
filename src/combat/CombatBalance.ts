/**
 * CombatBalance.ts
 * Authoritative Single Source of Truth (SSOT) for gameplay combat rules,
 * balance multipliers, attack ranges, cooldowns, and pure combat helpers.
 */
import type { CharacterFaction } from '../world/CharacterVisuals'
import type { WeaponCombatKind } from '../rpg/WeaponDatabase'

export type RangedCombatKind = 'bow' | 'javelin'

export const COMBAT_BALANCE = {
  hp: {
    npcDefault: 200,
    playerDefault: 200,
  },
  bow: {
    damageMultiplier: 0.5,
    attackRateMultiplier: 1.3,
    footAttackRange: 50,
    mountedAttackRange: 15,
    baseCooldown: 1.5,
  },
  javelin: {
    damageMultiplier: 1.5,
    attackRateMultiplier: 0.7,
    footAttackRange: 30,
    mountedAttackRange: 15,
    baseCooldown: 1.5,
  },
  lance: {
    unmountedVsMountedDamageMultiplier: 2.0,
    mountedChargeSpeedThreshold: 10,
    mountedChargeDamageMultiplier: 3.0,
  },
  berserker: {
    moveSpeedMultiplier: 1.3,
    meleeDamageMultiplier: 1.2,
    meleeAttackRateMultiplier: 1.2,
  },
  mountImpact: {
    minSpeed: 4,
    baseDamage: 8,
    speedDamageMultiplier: 1.5,
    sprintDamageMultiplier: 1.5,
    sameTargetCooldown: 0.6,
  },
} as const

export interface BerserkerModifiers {
  active: boolean
  moveSpeedMultiplier: number
  meleeDamageMultiplier: number
  meleeAttackRateMultiplier: number
}

export interface LanceChargeResult {
  damage: number
  isCharge: boolean
  skipImpact: boolean
}

/**
 * Resolves whether a weapon or combat kind maps to bow or javelin.
 */
export function getRangedCombatKind(
  weaponOrKind: { combatKind?: WeaponCombatKind } | WeaponCombatKind | string | null | undefined
): RangedCombatKind | null {
  if (!weaponOrKind) return null
  if (typeof weaponOrKind === 'string') {
    if (weaponOrKind === 'bow' || weaponOrKind.includes('bow')) return 'bow'
    if (weaponOrKind === 'javelin' || weaponOrKind.includes('pilum')) return 'javelin'
    return null
  }
  const kind = weaponOrKind.combatKind
  if (kind === 'bow') return 'bow'
  if (kind === 'javelin') return 'javelin'
  return null
}

/**
 * Returns balance rules for a ranged combat kind.
 */
export function getRangedCombatRules(kind: RangedCombatKind) {
  return COMBAT_BALANCE[kind]
}

/**
 * Returns the authoritative NPC AI engagement range for a ranged weapon kind.
 * Note: These are NPC AI engagement distances, not max projectile flight distances.
 */
export function getNpcRangedAttackRange(kind: RangedCombatKind, isMounted: boolean): number {
  const rules = COMBAT_BALANCE[kind]
  return isMounted ? rules.mountedAttackRange : rules.footAttackRange
}

/**
 * Returns the damage multiplier for a ranged combat kind.
 */
export function getRangedDamageMultiplier(kind: RangedCombatKind | null | undefined): number {
  if (!kind) return 1.0
  return COMBAT_BALANCE[kind].damageMultiplier
}

/**
 * Returns the effective cooldown between projectile releases.
 * Bow: 1.5 / 1.3 ≈ 1.1538s
 * Javelin: 1.5 / 0.7 ≈ 2.142857s
 */
export function getRangedCooldown(kind: RangedCombatKind | null | undefined, baseCooldown = 1.5): number {
  if (!kind) return baseCooldown
  const rules = COMBAT_BALANCE[kind]
  return baseCooldown / rules.attackRateMultiplier
}

/**
 * Calculates Lance anti-cavalry damage multiplier:
 * Attacker currently using Lance AND currently NOT mounted AND target currently mounted => 2.0x
 * Otherwise => 1.0x
 */
export function getAntiCavalryMultiplier(
  attackerCombatKind: WeaponCombatKind | string | null | undefined,
  isAttackerMounted: boolean,
  isTargetMounted: boolean
): number {
  if (attackerCombatKind === 'lance' && !isAttackerMounted && isTargetMounted) {
    return COMBAT_BALANCE.lance.unmountedVsMountedDamageMultiplier
  }
  return 1.0
}

/**
 * Dynamic Berserker buff evaluation:
 * Viking + currently NOT mounted + currently using Sword + currently NO shield =>
 *   movement ×1.3, melee damage ×1.2, melee attack rate ×1.2
 */
export function getBerserkerModifiers(
  faction: CharacterFaction,
  isMounted: boolean,
  combatKind: WeaponCombatKind | string | null | undefined,
  hasShield: boolean
): BerserkerModifiers {
  if (faction === 'viking' && !isMounted && combatKind === 'sword' && !hasShield) {
    return {
      active: true,
      moveSpeedMultiplier: COMBAT_BALANCE.berserker.moveSpeedMultiplier,
      meleeDamageMultiplier: COMBAT_BALANCE.berserker.meleeDamageMultiplier,
      meleeAttackRateMultiplier: COMBAT_BALANCE.berserker.meleeAttackRateMultiplier,
    }
  }
  return {
    active: false,
    moveSpeedMultiplier: 1.0,
    meleeDamageMultiplier: 1.0,
    meleeAttackRateMultiplier: 1.0,
  }
}

/**
 * Pure calculation for Lance charge damage when mounted and moving above speed threshold:
 * speed > 10 => 3.0x damage and sets skipImpact = true
 */
export function calculateLanceChargeDamage(
  baseDamage: number,
  combatKind: WeaponCombatKind | string | boolean | null | undefined,
  isMounted: boolean,
  movementSpeed: number
): LanceChargeResult
export function calculateLanceChargeDamage(
  combatKind: WeaponCombatKind | string | boolean | null | undefined,
  isMounted: boolean,
  movementSpeed: number,
  baseDamage: number
): LanceChargeResult
export function calculateLanceChargeDamage(
  arg1: any,
  arg2: any,
  arg3?: any,
  arg4?: any
): LanceChargeResult {
  let baseDamage: number
  let combatKind: WeaponCombatKind | string | boolean | null | undefined
  let isMounted: boolean
  let movementSpeed: number

  if (typeof arg1 === 'number') {
    baseDamage = arg1
    combatKind = arg2
    isMounted = Boolean(arg3)
    movementSpeed = Number(arg4 ?? 0)
  } else {
    combatKind = arg1
    isMounted = Boolean(arg2)
    movementSpeed = Number(arg3 ?? 0)
    baseDamage = Number(arg4 ?? 0)
  }

  const isLance = combatKind === true || combatKind === 'lance'
  if (isLance && isMounted && movementSpeed > COMBAT_BALANCE.lance.mountedChargeSpeedThreshold) {
    return {
      damage: baseDamage * COMBAT_BALANCE.lance.mountedChargeDamageMultiplier,
      isCharge: true,
      skipImpact: true,
    }
  }
  return {
    damage: baseDamage,
    isCharge: false,
    skipImpact: false,
  }
}

/**
 * Calculates mount impact damage based on movement speed and sprint state:
 * movementSpeed <= 4 => 0
 * movementSpeed > 4 => Math.round((8 + movementSpeed * 1.5) * (isSprinting ? 1.5 : 1.0))
 */
export function calculateMountImpactDamage(movementSpeed: number, isSprinting: boolean): number {
  const cfg = COMBAT_BALANCE.mountImpact
  if (movementSpeed <= cfg.minSpeed) return 0
  const sprintMult = isSprinting ? cfg.sprintDamageMultiplier : 1.0
  return Math.round((cfg.baseDamage + movementSpeed * cfg.speedDamageMultiplier) * sprintMult)
}
