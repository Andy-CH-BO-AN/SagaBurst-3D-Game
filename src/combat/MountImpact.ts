/**
 * MountImpact.ts
 * Centralised swept-sphere mount impact detection and damage resolution.
 * Handles:
 *  1. Player-owned mount -> Enemy NPCs (spawns damage numbers, HUD, sound)
 *  2. NPC-owned mount -> Player (routes through onDamagePlayer / damagePlayer + shield + HP bar)
 *  3. NPC-owned mount -> Hostile NPCs (no floating damage numbers, friendly fire strictly prohibited)
 */
import * as THREE from 'three'
import { Mount, MountState } from '../world/Mount'
import { Faction, type NPC } from '../world/NPC'
import type { Player } from '../player/Player'
import { COMBAT_BALANCE, calculateMountImpactDamage } from './CombatBalance'
import { damageNpc, damagePlayer, type DamageResult } from './DamageRouter'
import type { SpatialGrid } from '../world/SpatialGrid'

/** Swept line-segment collision check between mount trajectory and a target sphere. */
export function checkMountImpact(mount: Mount, targetPos: THREE.Vector3, targetRadius: number): boolean {
  if (mount.skipImpactThisFrame) return false
  const dx = mount.group.position.x - mount.previousPosition.x
  const dz = mount.group.position.z - mount.previousPosition.z
  const px = targetPos.x - mount.previousPosition.x
  const pz = targetPos.z - mount.previousPosition.z
  const lineLenSq = dx * dx + dz * dz
  if (lineLenSq < 0.0001) return false
  let t = (px * dx + pz * dz) / lineLenSq
  t = Math.max(0, Math.min(1, t))
  const closestX = mount.previousPosition.x + t * dx
  const closestZ = mount.previousPosition.z + t * dz
  const distSq = (closestX - targetPos.x) ** 2 + (closestZ - targetPos.z) ** 2
  return distSq <= (targetRadius + 1.0) ** 2
}

/** Evaluates vertical elevation, min speed, and same-target cooldown before invoking onHit. */
export function applyMountImpactDamage(
  mount: Mount,
  target: object,
  targetPos: THREE.Vector3,
  now: number,
  onHit: (damage: number) => void
): boolean {
  if (Math.abs(mount.group.position.y - targetPos.y) > 2.0) return false
  if (mount.movementSpeed > COMBAT_BALANCE.mountImpact.minSpeed && mount.canImpact(target, now)) {
    const damage = calculateMountImpactDamage(mount.movementSpeed, mount.isSprinting)
    if (damage > 0) {
      onHit(damage)
      return true
    }
  }
  return false
}

export interface MountImpactOptions {
  /** Optional spatial grid for bounding nearby candidate queries to avoid O(M x N) scans. */
  npcGrid?: SpatialGrid<NPC>
  /** Reusable candidate array to prevent per-frame garbage collection. */
  candidateBuffer?: NPC[]
  /** Authoritative player damage callback (supplies player hpBar and equipped shield). */
  onDamagePlayer?: (damage: number) => DamageResult
  /** Side-effects for Player mount impacting an enemy NPC (damage numbers, HUD, sound). */
  onPlayerMountHitNpc?: (damage: number, npc: NPC, result: DamageResult) => void
  /** Side-effects for Enemy mount impacting the Player (mount HP fill, hit sound). */
  onEnemyMountHitPlayer?: (damage: number, result: DamageResult) => void
  /** Side-effects for NPC mount impacting a hostile NPC (sound only, NO damage numbers). */
  onNpcMountHitNpc?: (damage: number, attackerMount: Mount, targetNpc: NPC, result: DamageResult) => void
}

/**
 * Resolves mount impacts across all controlled living mounts.
 * Explicitly distinguishes Player-owned mount vs NPC-owned mounts.
 */
export function resolveMountImpacts(
  mounts: Mount[],
  player: Player,
  npcs: NPC[],
  now: number,
  options?: MountImpactOptions
): void {
  const candidateBuffer = options?.candidateBuffer ?? []

  for (const mount of mounts) {
    if (mount.state !== MountState.CONTROLLED || mount.dead) continue
    if (mount.skipImpactThisFrame) continue
    if (mount.movementSpeed <= COMBAT_BALANCE.mountImpact.minSpeed) continue

    // ── Case A: Player-Owned Mount ──
    if (mount === player.currentMount) {
      let candidates: NPC[]
      if (options?.npcGrid) {
        const sweepDist = mount.group.position.distanceTo(mount.previousPosition)
        const queryRadius = Math.max(6.0, sweepDist + 2.0)
        candidates = options.npcGrid.getNearbyInto(mount.group.position, queryRadius, candidateBuffer)
      } else {
        candidates = npcs
      }

      for (const targetNpc of candidates) {
        if (targetNpc.dead || targetNpc.faction !== Faction.ENEMY) continue

        if (checkMountImpact(mount, targetNpc.combatPosition, 0.5)) {
          applyMountImpactDamage(mount, targetNpc, targetNpc.combatPosition, now, (damage) => {
            const result = damageNpc(targetNpc, damage)
            if (result.hitSuccess) {
              options?.onPlayerMountHitNpc?.(damage, targetNpc, result)
            }
          })
        }
      }
      continue
    }

    // ── Case B: NPC-Owned Mount ──
    const riderFaction = mount.riderFaction
    if (riderFaction === null) continue

    // 1. NPC Mount -> Player (only if rider is ENEMY and player is targetable)
    if (riderFaction === Faction.ENEMY && player.targetable) {
      if (checkMountImpact(mount, player.position, 0.38)) {
        applyMountImpactDamage(mount, player, player.position, now, (damage) => {
          const result = options?.onDamagePlayer
            ? options.onDamagePlayer(damage)
            : damagePlayer(player, damage, (player as any)._hpBar ?? { setFill: () => {} } as any, null)
          if (result.hitSuccess) {
            options?.onEnemyMountHitPlayer?.(damage, result)
          }
        })
      }
    }

    // 2. NPC Mount -> Hostile NPCs
    let candidates: NPC[]
    if (options?.npcGrid) {
      const sweepDist = mount.group.position.distanceTo(mount.previousPosition)
      const queryRadius = Math.max(6.0, sweepDist + 2.0)
      candidates = options.npcGrid.getNearbyInto(mount.group.position, queryRadius, candidateBuffer)
    } else {
      candidates = npcs
    }

    for (const targetNpc of candidates) {
      if (targetNpc.dead) continue
      if (targetNpc.faction === riderFaction) continue // Friendly fire strictly prevented
      if (targetNpc.isMounted && targetNpc.mount === mount) continue // Do not damage own rider

      if (checkMountImpact(mount, targetNpc.combatPosition, 0.5)) {
        applyMountImpactDamage(mount, targetNpc, targetNpc.combatPosition, now, (damage) => {
          const result = damageNpc(targetNpc, damage)
          if (result.hitSuccess) {
            // NPC -> NPC: does NOT spawn floating damage numbers or change player HUD
            options?.onNpcMountHitNpc?.(damage, mount, targetNpc, result)
          }
        })
      }
    }
  }
}
