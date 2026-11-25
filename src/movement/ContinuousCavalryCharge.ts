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

export const CAVALRY_PASSTHROUGH_DURATION = 1.0 // seconds
export const CAVALRY_FORWARD_CONE_COS = 0.2 // ~78° forward cone

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

function scoreCavalryTargetWithForward(
  cx: number,
  cz: number,
  forwardX: number,
  forwardZ: number,
  tx: number,
  tz: number,
  isPassthrough: boolean,
): number {
  const dx = tx - cx
  const dz = tz - cz
  const distSq = dx * dx + dz * dz
  if (distSq < 0.0001) return isPassthrough ? Infinity : 1000

  const dist = Math.sqrt(distSq)
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
  return scoreCavalryTargetWithForward(cx, cz, Math.sin(yaw), Math.cos(yaw), tx, tz, isPassthrough)
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
  const forwardX = Math.sin(yaw)
  const forwardZ = Math.cos(yaw)
  const priorityFn = cavalry.combatTargetPriority
  const allowedFn = cavalry.combatTargetAllowed
  const minFactor = isPassthrough ? 0.5 : 0.6

  let bestPriority = Infinity
  let bestScore = Infinity
  let bestTarget: { position: THREE.Vector3; isDead: boolean; isPlayer: boolean; npc?: NPC } | null = null

  // Check player eligibility and position
  const canTargetPlayer = Boolean(
    cavalry.hostileToPlayer
    && acceptsTarget(player)
    && player.targetable
    && !player.dead
    && allowedFn?.(player) !== false
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

  const evaluateCandidate = (candidate: NPC): void => {
    if (candidate === cavalry || candidate.dead || !acceptsTarget(candidate)) return
    if (!checkHostile(cavalry, candidate)) return
    if (candidate.mount?.isFlyingMount) return
    if (allowedFn && allowedFn(candidate) === false) return

    let priority = 0
    if (priorityFn) {
      const evaluated = priorityFn(candidate)
      if (evaluated === null) return
      priority = evaluated
    }

    if (priority > bestPriority) return
    const tx = candidate.combatPosition.x
    const tz = candidate.combatPosition.z
    if (priority === bestPriority && Number.isFinite(bestScore)) {
      const dx = tx - cx
      const dz = tz - cz
      const distSq = dx * dx + dz * dz
      if (distSq >= 0.0001 && distSq * minFactor * minFactor >= bestScore * bestScore) return
    }

    const score = scoreCavalryTargetWithForward(cx, cz, forwardX, forwardZ, tx, tz, isPassthrough)
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

  // Query nearby candidates from spatial grid
  if (hostileNpcGrid) {
    if (!priorityFn && typeof hostileNpcGrid.visitNearbyRings === 'function') {
      hostileNpcGrid.visitNearbyRings(
        cavalry.combatPosition,
        searchRadius,
        evaluateCandidate,
        () => Number.isFinite(bestScore) ? bestScore / minFactor : Infinity,
      )
    } else {
      candidateBuffer.length = 0
      hostileNpcGrid.getNearbyInto(cavalry.combatPosition, searchRadius, candidateBuffer)
      for (let i = 0; i < candidateBuffer.length; i++) evaluateCandidate(candidateBuffer[i])
    }
  } else if (allNPCs) {
    for (let i = 0; i < allNPCs.length; i++) evaluateCandidate(allNPCs[i])
  }

  // Score player against candidate NPCs within the unified search range
  if (canTargetPlayer && playerPos && playerDist <= searchRadius) {
    const pScore = scoreCavalryTargetWithForward(cx, cz, forwardX, forwardZ, playerPos.x, playerPos.z, isPassthrough)
    const evaluatedPriority = priorityFn?.(player)
    const priority = evaluatedPriority ?? 0
    if (evaluatedPriority !== null && Number.isFinite(pScore)
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
