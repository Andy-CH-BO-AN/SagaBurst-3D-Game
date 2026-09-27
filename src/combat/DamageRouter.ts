/**
 * DamageRouter.ts
 * Centralised damage routing for mounted/unmounted entities and destructible structures.
 */
import type { NPC } from '../world/NPC'
import type { Player } from '../player/Player'
import type { HpBar } from '../ui/HpBar'
import { ARMORS } from '../rpg/ArmorDatabase'
import type {
  DamageableObstacle,
  DamageableObstacleHitResult,
} from '../world/DamageableObstacle'
import {
  createMountCombatTargetRef,
  createNpcCombatActorRef,
  createNpcCombatTargetRef,
  createPlayerCombatActorRef,
  createPlayerCombatTargetRef,
  createStructureCombatTargetRef,
  emitActorKilled,
  emitDamageApplied,
  emitStructureDamage,
  type CombatDamageContext,
} from './CombatAttribution'

export interface DamageResult {
  /** Whether takeDamage() accepted the hit (target was not already dead). */
  hitSuccess: boolean
  /** Requested incoming damage before shield reduction / HP clamping. */
  requestedDamage: number
  /** Actual HP removed after reduction and overkill clamping. */
  appliedDamage: number
  /** Stable runtime identity for the entity that actually took the hit. */
  targetId: string
  /** Display name of the entity that actually took the hit (mount or entity). */
  targetName: string
  /** True only when this hit caused the actual damage target to die. */
  killed: boolean
  /** HP ratio (0-1) of the entity that took the hit. */
  hpRatio: number
  /** True when the hit went to the mount rather than the rider/player. */
  isMountHit: boolean
  /** True when the mount died as a result of this hit (triggers dismount). */
  mountDied: boolean
}

/** Applies shield passive damage reduction to incoming damage. */
function applyShieldReduction(baseDamage: number, shieldId: string | null): number {
  if (!shieldId) return baseDamage
  const armor = ARMORS[shieldId]
  if (!armor) return baseDamage
  return baseDamage * (1 - armor.damageReduction)
}

/** Apply damage to an NPC, routing to its mount when mounted. */
export function damageNpc(
  npc: NPC,
  damage: number,
  context?: CombatDamageContext,
): DamageResult {
  const requestedDamage = damage
  const finalDamage = applyShieldReduction(damage, npc.shieldId)

  if (npc.isMounted && npc.mount) {
    const mount = npc.mount
    const beforeHp = mount.currentHp
    const wasDead = mount.dead
    const owner = createNpcCombatActorRef(npc)
    const targetName = `${npc.name} 的${mount.mountDisplayName}`
    const target = createMountCombatTargetRef(mount, owner, targetName)
    const hitSuccess = mount.takeDamage(finalDamage)
    const appliedDamage = Math.max(0, beforeHp - mount.currentHp)
    const mountDied = !wasDead && mount.dead

    emitDamageApplied(context, target, requestedDamage, appliedDamage)

    if (mountDied) npc.dismountFromMount()
    return {
      hitSuccess,
      requestedDamage,
      appliedDamage,
      targetId: target.targetId,
      targetName,
      killed: mountDied,
      hpRatio: mount.currentHp / mount.maxHp,
      isMountHit: true,
      mountDied,
    }
  }

  const target = createNpcCombatTargetRef(npc)
  const beforeHp = npc.hp
  const wasDead = npc.dead
  const hitSuccess = npc.takeDamage(finalDamage)
  const appliedDamage = Math.max(0, beforeHp - npc.hp)
  const killed = !wasDead && npc.dead

  emitDamageApplied(context, target, requestedDamage, appliedDamage)
  if (killed) emitActorKilled(context, target)

  return {
    hitSuccess,
    requestedDamage,
    appliedDamage,
    targetId: target.targetId,
    targetName: npc.name,
    killed,
    hpRatio: npc.hpRatio,
    isMountHit: false,
    mountDied: false,
  }
}

/** Apply damage to the Player, routing to their mount when mounted. */
export function damagePlayer(
  player: Player,
  damage: number,
  hpBar: HpBar,
  equippedShieldId: string | null,
  context?: CombatDamageContext,
): DamageResult {
  const requestedDamage = damage
  if (player.spectatorOnly || player.dead) {
    return {
      hitSuccess: false,
      requestedDamage,
      appliedDamage: 0,
      targetId: 'player',
      targetName: 'Player',
      killed: false,
      hpRatio: player.hpRatio,
      isMountHit: false,
      mountDied: false,
    }
  }

  const finalDamage = applyShieldReduction(damage, equippedShieldId)

  if (player.isMounted && player.currentMount) {
    const mount = player.currentMount
    const beforeHp = mount.currentHp
    const wasDead = mount.dead
    const owner = createPlayerCombatActorRef(player)
    const targetName = `坐騎：${mount.displayName}`
    const target = createMountCombatTargetRef(mount, owner, targetName)
    const hitSuccess = mount.takeDamage(finalDamage)
    const appliedDamage = Math.max(0, beforeHp - mount.currentHp)
    const mountDied = !wasDead && mount.dead

    emitDamageApplied(context, target, requestedDamage, appliedDamage)

    if (mountDied) player.dismountFromMount()
    return {
      hitSuccess,
      requestedDamage,
      appliedDamage,
      targetId: target.targetId,
      targetName,
      killed: mountDied,
      hpRatio: mount.currentHp / mount.maxHp,
      isMountHit: true,
      mountDied,
    }
  }

  const target = createPlayerCombatTargetRef(player)
  const beforeHp = player.hp
  const wasDead = player.dead
  const hitSuccess = player.takeDamage(finalDamage, hpBar)
  const appliedDamage = Math.max(0, beforeHp - player.hp)
  const killed = !wasDead && player.dead

  emitDamageApplied(context, target, requestedDamage, appliedDamage)
  if (killed) emitActorKilled(context, target)

  return {
    hitSuccess,
    requestedDamage,
    appliedDamage,
    targetId: target.targetId,
    targetName: 'Player',
    killed,
    hpRatio: player.hpRatio,
    isMountHit: false,
    mountDied: false,
  }
}

/** Apply structure damage and emit the structure-specific attribution events. */
export function damageObstacle(
  obstacle: DamageableObstacle,
  damage: number,
  context?: CombatDamageContext,
): DamageableObstacleHitResult {
  const result = obstacle.takeDamage(damage)
  const target = createStructureCombatTargetRef(obstacle)
  emitStructureDamage(
    context,
    target,
    damage,
    result.appliedDamage,
    result.hpRatio,
    result.destroyed,
  )
  return result
}
