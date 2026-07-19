/**
 * DamageRouter.ts
 * Centralised damage routing for mounted and unmounted entities.
 * C-1: Replaces 6 duplicated "if isMounted → damage mount → dismount" blocks
 *      scattered across Game.ts and ArrowProjectile.ts.
 */
import type { NPC } from '../world/NPC'
import type { Player } from '../player/Player'
import type { HpBar } from '../ui/HpBar'
import { ARMORS } from '../rpg/ArmorDatabase'

export interface DamageResult {
  /** Whether takeDamage() returned true (target was not already dead). */
  hitSuccess: boolean
  /** Display name of the entity that actually took the hit (mount or entity). */
  targetName: string
  /** HP ratio (0-1) of the entity that took the hit. */
  hpRatio: number
  /** True when the hit went to the mount rather than the rider/player. */
  isMountHit: boolean
  /** True when the mount died as a result of this hit (triggers dismount). */
  mountDied: boolean
}

/**
 * Applies shield passive damage reduction to incoming damage.
 */
function applyShieldReduction(baseDamage: number, shieldId: string | null): number {
  if (!shieldId) return baseDamage
  const armor = ARMORS[shieldId]
  if (!armor) return baseDamage
  return baseDamage * (1 - armor.damageReduction)
}

/**
 * Apply damage to an NPC, routing to its mount when mounted.
 * Calls dismountFromMount() automatically if the mount dies.
 */
export function damageNpc(npc: NPC, damage: number): DamageResult {
  const finalDamage = applyShieldReduction(damage, npc.shieldId)

  if (npc.isMounted && npc.mount) {
    const mount = npc.mount
    const hitSuccess = mount.takeDamage(finalDamage)
    const mountDied = mount.dead
    if (mountDied) npc.dismountFromMount()
    return {
      hitSuccess,
      targetName: `${npc.name} 的${mount.mountDisplayName}`,
      hpRatio: mount.currentHp / mount.maxHp,
      isMountHit: true,
      mountDied,
    }
  }

  const hitSuccess = npc.takeDamage(finalDamage)
  return {
    hitSuccess,
    targetName: npc.name,
    hpRatio: npc.hpRatio,
    isMountHit: false,
    mountDied: false,
  }
}

/**
 * Apply damage to the Player, routing to their mount when mounted.
 * Calls player.dismountFromMount() automatically if the mount dies.
 */
export function damagePlayer(player: Player, damage: number, hpBar: HpBar, equippedShieldId: string | null): DamageResult {
  const finalDamage = applyShieldReduction(damage, equippedShieldId)

  if (player.isMounted && player.currentMount) {
    const mount = player.currentMount
    const hitSuccess = mount.takeDamage(finalDamage)
    const mountDied = mount.dead
    if (mountDied) player.dismountFromMount()
    return {
      hitSuccess,
      targetName: `坐騎：${mount.displayName}`,
      hpRatio: mount.currentHp / mount.maxHp,
      isMountHit: true,
      mountDied,
    }
  }

  const hitSuccess = player.takeDamage(finalDamage, hpBar)
  return {
    hitSuccess,
    targetName: 'Player',
    hpRatio: player.hpRatio,
    isMountHit: false,
    mountDied: false,
  }
}
