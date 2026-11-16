/**
 * ContinuousCavalryCharge.ts
 *
 * Implements continuous mobile combat and forward charge steering for ground melee cavalry.
 *
 * Cycle:
 *   Detect enemy line -> Accelerate / Charge -> Swept collision & Melee strike on the move ->
 *   Pass through enemy line (suppressing immediate 180° snap) -> Re-acquire next forward target / Re-engage.
 */
import type * as THREE from 'three'
import type { TacticalOrder } from '../battle/TacticalOrder'
import type { NPC } from '../world/NPC'
import type { Player } from '../player/Player'
import type { SpatialGrid } from '../world/SpatialGrid'
import type { ChaseTargetCoordinator } from '../navigation/ChaseTargetCoordinator'

export const CAVALRY_MAX_TURN_RATE = 2.2 // rad/s
export const CAVALRY_PASSTHROUGH_DURATION = 1.0 // seconds
export const CAVALRY_FORWARD_CONE_COS = 0.2 // ~78° forward cone

const angleDifference = (to: number, from: number): number => Math.atan2(Math.sin(to - from), Math.cos(to - from))
const clamp = (val: number, min: number, max: number): number => Math.max(min, Math.min(max, val))

/**
 * Determines whether an actor is an eligible ground melee cavalry for continuous charge combat.
 * Excludes flying mounts, ranged weapon users, siege attackers, rampart garrison, and defensive/formation orders.
 */
export function isEligibleMeleeCavalry(
  isMounted: boolean,
  mount: { isFlyingMount?: boolean } | null | undefined,
  hasActiveRangedWeapon: boolean,
  tacticalOrder: TacticalOrder,
  hasSiegeObstacle: boolean,
  holdsRampartPosition: boolean,
): boolean {
  if (!isMounted || !mount || mount.isFlyingMount) return false
  if (hasActiveRangedWeapon) return false
  if (hasSiegeObstacle || holdsRampartPosition) return false
  return tacticalOrder === 'attack' || tacticalOrder === 'charge'
}

/**
 * Calculates turning rate based on mount speed. Faster speeds turn in slightly wider arcs.
 */
export function cavalryTurnRate(speed: number): number {
  return Math.min(CAVALRY_MAX_TURN_RATE, Math.max(1.2, 18 / Math.max(1, speed)))
}

/**
 * Steers yaw toward desiredYaw with a bounded angular velocity. Prevents instant 180° snapping.
 */
export function steerCavalryHeading(
  yaw: number,
  desiredYaw: number,
  speed: number,
  dt: number,
): number {
  const step = cavalryTurnRate(speed) * clamp(dt, 0, 0.1)
  return yaw + clamp(angleDifference(desiredYaw, yaw), -step, step)
}

/**
 * Checks whether a target position lies within the forward hemisphere of the cavalry.
 */
export function isTargetInForwardCone(
  cavalryPos: THREE.Vector3,
  cavalryYaw: number,
  targetPos: THREE.Vector3,
  minCos = CAVALRY_FORWARD_CONE_COS,
): boolean {
  const dx = targetPos.x - cavalryPos.x
  const dz = targetPos.z - cavalryPos.z
  const distSq = dx * dx + dz * dz
  if (distSq < 0.0001) return true
  const dist = Math.sqrt(distSq)
  const forwardX = Math.sin(cavalryYaw)
  const forwardZ = Math.cos(cavalryYaw)
  const cosAngle = (forwardX * dx + forwardZ * dz) / dist
  return cosAngle >= minCos
}

/**
 * Scores potential charge targets. Prioritizes forward targets, penalizes rearward targets,
 * and strictly filters out rearward targets during the pass-through phase.
 */
export function scoreCavalryTarget(
  cx: number,
  cz: number,
  yaw: number,
  tx: number,
  tz: number,
  isPassthrough: boolean,
): number {
  const dx = tx - cx
  const dz = tz - cz
  const distSq = dx * dx + dz * dz
  if (distSq < 0.0001) return isPassthrough ? Infinity : 1000

  const dist = Math.sqrt(distSq)
  const forwardX = Math.sin(yaw)
  const forwardZ = Math.cos(yaw)
  const dot = (forwardX * dx + forwardZ * dz) / dist

  if (isPassthrough) {
    // In pass-through, ignore targets behind or far to the sides
    if (dot < CAVALRY_FORWARD_CONE_COS) return Infinity
    return dist * (1.2 - 0.7 * dot)
  }

  // Normal charge selection:
  if (dot > 0) {
    return dist * (1.2 - 0.6 * dot)
  }

  // Targets behind are heavily penalized so forward enemies take precedence
  return dist * (3.5 - 2.0 * dot)
}

/**
 * Finds the optimal forward charge target from nearby hostile NPCs and player.
 */
export function findCavalryChargeTarget(
  cavalry: NPC,
  player: Player,
  hostileNpcGrid: SpatialGrid<NPC> | null,
  chaseTargetCoordinator: ChaseTargetCoordinator | null,
  candidateBuffer: NPC[],
  isPassthrough: boolean,
  isHostile?: (a: any, b: any) => boolean,
  allNPCs?: NPC[],
  acceptsTarget: (target: NPC | Player) => boolean = () => true,
): { position: THREE.Vector3; isDead: boolean; isPlayer: boolean; npc?: NPC } | null {
  const checkHostile = isHostile ?? ((a: any, b: any) => a?.faction !== b?.faction || a?.isFriendly !== b?.isFriendly)
  const cx = cavalry.combatPosition.x
  const cz = cavalry.combatPosition.z
  const yaw = cavalry.mount ? cavalry.mount.group.rotation.y : cavalry.group.rotation.y

  let bestPriority = Infinity
  let bestScore = Infinity
  let bestTarget: { position: THREE.Vector3; isDead: boolean; isPlayer: boolean; npc?: NPC } | null = null

  // Check player eligibility and position
  const canTargetPlayer = Boolean(
    cavalry.hostileToPlayer
    && acceptsTarget(player)
    && player.targetable
    && !player.dead
    && cavalry.combatTargetAllowed?.(player) !== false
    && !player.currentMount?.isFlyingMount,
  )

  const playerPos = canTargetPlayer
    ? (player.isMounted && player.currentMount && !player.currentMount.isFlyingMount
      ? player.currentMount.group.position
      : (player.group?.position ?? player.position))
    : null

  const playerDist = playerPos ? Math.hypot(playerPos.x - cx, playerPos.z - cz) : Infinity

  // Candidate search radius: ensures player and nearby NPCs compete within a consistent, fair range.
  // When player is eligible, candidate range expands to cover the player (up to 120m) so NPCs closer than the player are not overlooked.
  const searchRadius = Math.max(64, Math.min(120, canTargetPlayer ? playerDist + 10 : 64))

  // Query nearby candidates from spatial grid
  if (hostileNpcGrid) {
    candidateBuffer.length = 0
    hostileNpcGrid.getNearbyInto(cavalry.combatPosition, searchRadius, candidateBuffer)

    for (let i = 0; i < candidateBuffer.length; i++) {
      const candidate = candidateBuffer[i]
      if (candidate === cavalry || candidate.dead || !acceptsTarget(candidate)) continue
      if (!checkHostile(cavalry, candidate)) continue
      if (candidate.mount?.isFlyingMount) continue
      if (cavalry.combatTargetAllowed && cavalry.combatTargetAllowed(candidate) === false) continue

      const score = scoreCavalryTarget(
        cx,
        cz,
        yaw,
        candidate.combatPosition.x,
        candidate.combatPosition.z,
        isPassthrough,
      )
      const priority = cavalry.combatTargetPriority?.(candidate) ?? 0
      if (cavalry.combatTargetPriority?.(candidate) === null) continue
      if (Number.isFinite(score) && (priority < bestPriority || priority === bestPriority && score < bestScore)) {
        bestPriority = priority
        bestScore = score
        bestTarget = {
          position: candidate.combatPosition,
          isDead: false,
          isPlayer: false,
          npc: candidate,
        }
      }
    }
  } else if (allNPCs) {
    for (let i = 0; i < allNPCs.length; i++) {
      const candidate = allNPCs[i]
      if (candidate === cavalry || candidate.dead || !acceptsTarget(candidate)) continue
      if (!checkHostile(cavalry, candidate)) continue
      if (candidate.mount?.isFlyingMount) continue
      if (cavalry.combatTargetAllowed && cavalry.combatTargetAllowed(candidate) === false) continue

      const score = scoreCavalryTarget(
        cx,
        cz,
        yaw,
        candidate.combatPosition.x,
        candidate.combatPosition.z,
        isPassthrough,
      )
      const priority = cavalry.combatTargetPriority?.(candidate) ?? 0
      if (cavalry.combatTargetPriority?.(candidate) === null) continue
      if (Number.isFinite(score) && (priority < bestPriority || priority === bestPriority && score < bestScore)) {
        bestPriority = priority
        bestScore = score
        bestTarget = {
          position: candidate.combatPosition,
          isDead: false,
          isPlayer: false,
          npc: candidate,
        }
      }
    }
  }

  // Score player against candidate NPCs within the unified search range
  if (canTargetPlayer && playerPos && playerDist <= searchRadius) {
    const pScore = scoreCavalryTarget(cx, cz, yaw, playerPos.x, playerPos.z, isPassthrough)
    const priority = cavalry.combatTargetPriority?.(player) ?? 0
    if (cavalry.combatTargetPriority?.(player) !== null && Number.isFinite(pScore)
      && (priority < bestPriority || priority === bestPriority && pScore < bestScore)) {
      bestPriority = priority
      bestScore = pScore
      bestTarget = { position: playerPos, isDead: false, isPlayer: true }
    }
  }

  if (bestTarget !== null) return bestTarget

  // If in passthrough and no forward targets found, do not snap back
  if (isPassthrough) return null

  // Mission ranking belongs to shared acquisition, including distant sectors.
  if (cavalry.combatTargetPriority) return null

  // Fallback to group coordinator or nearest if nothing scored in forward cone
  if (hostileNpcGrid) {
    const sharedTarget = chaseTargetCoordinator && !cavalry.combatTargetAllowed && !cavalry.combatTargetPriority
      ? chaseTargetCoordinator.findGroupTarget(cavalry, hostileNpcGrid, true) : null
    const fallbackNpc = sharedTarget && acceptsTarget(sharedTarget) ? sharedTarget : hostileNpcGrid.findNearest(cavalry.combatPosition, candidate => !candidate.dead
        && acceptsTarget(candidate) && cavalry.combatTargetPriority?.(candidate) !== null
        && checkHostile(cavalry, candidate)
        && cavalry.combatTargetAllowed?.(candidate) !== false
        && !candidate.mount?.isFlyingMount)
    if (fallbackNpc) {
      return {
        position: fallbackNpc.combatPosition,
        isDead: false,
        isPlayer: false,
        npc: fallbackNpc,
      }
    }
  } else if (allNPCs) {
    let nearestCandidate: NPC | null = null
    let nearestDistSq = Infinity
    for (let i = 0; i < allNPCs.length; i++) {
      const candidate = allNPCs[i]
      if (candidate === cavalry || candidate.dead || !acceptsTarget(candidate)) continue
      if (!checkHostile(cavalry, candidate)) continue
      if (candidate.mount?.isFlyingMount) continue
      if (cavalry.combatTargetAllowed && cavalry.combatTargetAllowed(candidate) === false) continue
      const distSq = (candidate.combatPosition.x - cx) ** 2 + (candidate.combatPosition.z - cz) ** 2
      if (distSq < nearestDistSq) {
        nearestDistSq = distSq
        nearestCandidate = candidate
      }
    }
    if (nearestCandidate) {
      return {
        position: nearestCandidate.combatPosition,
        isDead: false,
        isPlayer: false,
        npc: nearestCandidate,
      }
    }
  }

  return null
}
