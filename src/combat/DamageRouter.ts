/**
 * DamageRouter.ts
 * Centralised damage routing for mounted/unmounted entities and destructible structures.
 */
import type { NPC } from '../world/NPC'
import type { Mount } from '../world/Mount'
import type { Player } from '../player/Player'
import type { HpBar } from '../ui/HpBar'
import { weaponShieldImpact } from './ShieldBlocking'
import type { DamageReceiver } from './DamageReceiver'
import type {
  DamageableObstacle,
  DamageableObstacleHitResult,
} from '../world/DamageableObstacle'
import {
  createMountCombatTargetRef,
  createNpcCombatActorRef,
  createNpcCombatTargetRef,
  createPlayerCombatTargetRef,
  createPlayerCombatActorRef,
  type CombatActorRef,
  createStructureCombatTargetRef,
  emitActorKilled,
  emitDamageApplied,
  emitStructureDamage,
  type CombatDamageContext,
} from './CombatAttribution'

export interface DamageResult {
  /** Whether takeDamage() accepted the hit (target was not already dead). */
  hitSuccess: boolean
  /** Requested damage before physical shield absorption / HP clamping. */
  requestedDamage: number
  /** Actual HP removed after reduction and overkill clamping. */
  appliedDamage: number
  /** Actual shield impact absorbed, including a successful block that removes no HP. */
  blockedImpact: number
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

/** Receiver owns its lifetime; combat callers retain their existing damage formulas. */
export function damageReceiver(target: DamageReceiver, damage: number, context?: CombatDamageContext): DamageResult {
  const appliedDamage = target.receiveDamage(damage)
  emitDamageApplied(context, target.damageTarget, damage, appliedDamage)
  return {
    hitSuccess: appliedDamage > 0, requestedDamage: damage, appliedDamage, blockedImpact: 0,
    targetId: target.damageTarget.targetId, targetName: target.damageTarget.name,
    killed: false, hpRatio: 1, isMountHit: false, mountDied: false,
  }
}

/** Only an authoritative geometric SHIELD_HIT can consume durability. */
function shieldDamage(target: NPC | Player, damage: number, context?: CombatDamageContext): { damage: number; blockedImpact: number } {
  if (target.dead || context?.contact?.kind !== 'shield'
    || (context.method !== 'melee' && context.method !== 'projectile') || !target.shield?.active) return { damage, blockedImpact: 0 }
  const player = 'blockingLevel' in target ? target : null
  const result = target.shield.absorb(damage, context.method === 'projectile' || (context.attackSource ?? context.contact?.attackSource) === 'xongkoro' ? 1 : weaponShieldImpact(context.weaponId, context.source.isMounted), player?.blockingLevel ?? 0)
  target.shieldCollider?.refreshVisibility()
  const hostile = context.hostileToTarget ?? context.source.allegiance === 'ENEMY'
  if (player && !player.spectatorOnly && hostile && context.source.actorType !== 'player' && result.blockedImpact > 0) {
    player.onShieldBlock?.(result.blockedImpact)
  }
  return { damage: result.damage, blockedImpact: result.blockedImpact }
}

function routedMount(attached: Mount | null, context?: CombatDamageContext): Mount | undefined {
  if (context?.method === 'mount-impact') return attached && !attached.dead ? attached : undefined
  if ((context?.method === 'melee' || context?.method === 'projectile') && context.contact?.kind === 'mount') {
    return context.contact.mount ?? attached ?? undefined
  }
  return undefined
}

/** Independent mount target: no rider HP damage, shield mitigation or actor-killed event. */
export function damageMount(mount: Mount, damage: number, context?: CombatDamageContext, owner: CombatActorRef | undefined = mount.combatOwner): DamageResult {
  const target = createMountCombatTargetRef(mount, owner)
  const beforeHp = mount.currentHp, wasDead = mount.dead
  // Capture the original attacker before Mount releases its rider. The later
  // landing is a distinct environmental event, never another projectile hit.
  if (!wasDead && mount.isFlyingMount && damage >= beforeHp) mount.knockdownContext = context
  const hitSuccess = mount.takeDamage(damage)
  const appliedDamage = Math.max(0, beforeHp - mount.currentHp)
  const mountDied = !wasDead && mount.dead
  emitDamageApplied(context, target, damage, appliedDamage)
  return {
    hitSuccess, requestedDamage: damage, appliedDamage, blockedImpact: 0, targetId: target.targetId,
    targetName: target.name, killed: mountDied, hpRatio: mount.currentHp / mount.maxHp,
    isMountHit: true, mountDied,
  }
}

/** Physical contact controls melee/projectiles; mount-impact explicitly targets a living mount. */
export function damageNpc(
  npc: NPC,
  damage: number,
  context?: CombatDamageContext,
): DamageResult {
  const requestedDamage = damage
  const shield = shieldDamage(npc, damage, context), finalDamage = shield.damage

  const mount = routedMount(npc.mount, context)
  if (mount) {
    const result = damageMount(mount, damage, context, mount.combatOwner ?? (mount === npc.mount ? createNpcCombatActorRef(npc) : undefined))
    if (result.mountDied && npc.mount === mount) npc.dismountFromMount()
    return result
  }

  const target = createNpcCombatTargetRef(npc)
  const beforeHp = npc.hp
  const wasDead = npc.dead
  const hitSuccess = finalDamage === 0 ? !npc.dead : context?.method === 'fall' ? npc.takeFallDamage(finalDamage) : npc.takeDamage(finalDamage)
  const appliedDamage = Math.max(0, beforeHp - npc.hp)
  const killed = !wasDead && npc.dead

  emitDamageApplied(context, target, requestedDamage, appliedDamage)
  if (killed) emitActorKilled(context, target)

  return {
    hitSuccess,
    requestedDamage,
    appliedDamage,
    blockedImpact: shield.blockedImpact,
    targetId: target.targetId,
    targetName: npc.name,
    killed,
    hpRatio: npc.hpRatio,
    isMountHit: false,
    mountDied: false,
  }
}

/** Apply a hit to the actual contacted entity, independently of Player mounted state. */
export function damagePlayer(
  player: Player,
  damage: number,
  hpBar: Pick<HpBar, 'setFill'>,
  _equippedShieldId: string | null,
  context?: CombatDamageContext,
): DamageResult {
  const requestedDamage = damage
  if (player.spectatorOnly || player.dead) {
    return {
      hitSuccess: false,
      requestedDamage,
      appliedDamage: 0,
      blockedImpact: 0,
      targetId: 'player',
      targetName: 'Player',
      killed: false,
      hpRatio: player.hpRatio,
      isMountHit: false,
      mountDied: false,
    }
  }

  const shieldHit = player.shield?.active && context?.contact?.kind === 'shield' && (context.method === 'melee' || context.method === 'projectile')
  const shield = shieldDamage(player, damage, context), finalDamage = shield.damage

  const mount = routedMount(player.currentMount, context)
  if (mount) {
    const result = damageMount(mount, damage, context, mount.combatOwner ?? (mount === player.currentMount ? createPlayerCombatActorRef(player) : undefined))
    if (result.mountDied && player.currentMount === mount) player.dismountFromMount()
    return result
  }

  const target = createPlayerCombatTargetRef(player)
  const beforeHp = player.hp
  const wasDead = player.dead
  const hitSuccess = finalDamage === 0 ? !player.dead : context?.method === 'fall' ? player.takeFallDamage(finalDamage, hpBar) : player.takeDamage(finalDamage, hpBar, Boolean(shieldHit))
  const appliedDamage = Math.max(0, beforeHp - player.hp)
  const killed = !wasDead && player.dead

  emitDamageApplied(context, target, requestedDamage, appliedDamage)
  if (killed) emitActorKilled(context, target)

  return {
    hitSuccess,
    requestedDamage,
    appliedDamage,
    blockedImpact: shield.blockedImpact,
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
