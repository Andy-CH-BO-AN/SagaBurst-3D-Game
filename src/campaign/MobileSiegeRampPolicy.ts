import { INFANTRY_MOVE_SPEED } from '../movement/MovementBalance'
import * as THREE from 'three'
import type { NpcSpawnSpec } from '../battle/BattleSpawner'
import { AIType } from '../world/NPC'
import { getTerrainHeight, TERRAIN_MIN_HEIGHT, type EntityCollisionBody, type ObstacleData, type WalkRampSurface } from '../world/Terrain'
import { getDefenseCampaignStagingZ, type DefenseCampaignLaunchConfig } from './DefenseCampaignLaunch'
import { isOutpostWalkwayEnabled, type OutpostWalkwayLayout, type OutpostWalkwaySide } from './CampaignOutpostWalkways'

export const SIEGE_RAMP = {
  halfWidth: 2.5,
  platformLength: 6,
  chassisOverhang: .5,
  maxSlope: .45,
  speed: INFANTRY_MOVE_SPEED,
  bridgeLength: 4,
  dockSeconds: 1.5,
} as const

export type SiegeRampId = 'siege-ramp-left' | 'siege-ramp-right'
export type TownSiegeRampId = `town-siege-ramp:${import('../town/TownLayout').TownGateId}:${'left' | 'right'}`
export type MobileSiegeRampId = SiegeRampId | TownSiegeRampId
export interface SiegeRampAssignment<Id extends MobileSiegeRampId = SiegeRampId> {
  id: Id
  side: OutpostWalkwaySide
  pusherIds: string[]
  assaultIds: string[]
}
export interface SiegeRampPlacement<Id extends MobileSiegeRampId = SiegeRampId> {
  id: Id
  side: OutpostWalkwaySide
  start: THREE.Vector3
  dock: THREE.Vector3
  surface: WalkRampSurface
  deckConnection: THREE.Vector3
  /** Omitted by the legacy Outpost placement; defaults to zero. */
  dirX?: number
  dirZ: number
  /** Opt-in long approaches follow the ground under the tower, not the distant ramp tail. */
  terrainAnchor?: 'deck'
}

/** One height owner for planning, movement and checkpoint validation. Legacy carriers keep their rigid rear anchor. */
export function siegeRampDeckHeightAt(placement: SiegeRampPlacement<MobileSiegeRampId>, x: number, z: number): number {
  const dx = placement.dirX ?? 0, dz = placement.dirZ
  if (placement.terrainAnchor === 'deck') {
    const offset = SIEGE_RAMP.platformLength / 2
    return getTerrainHeight(x - dx * offset, z - dz * offset) + placement.dock.y
      - getTerrainHeight(placement.dock.x - dx * offset, placement.dock.z - dz * offset)
  }
  const rearX = placement.surface.startX + x - placement.dock.x
  const rearZ = placement.surface.startZ + z - placement.dock.z
  return getTerrainHeight(rearX, rearZ) + .04 + placement.surface.topY - placement.surface.startY
}

/** The articulated tail rests above its whole cross-section on long, uneven approaches. */
export function siegeRampRearHeightAt(placement: SiegeRampPlacement<MobileSiegeRampId>, x: number, z: number): number {
  if (placement.terrainAnchor !== 'deck') return getTerrainHeight(x, z) + .04
  const lateralX = placement.dirZ * SIEGE_RAMP.halfWidth, lateralZ = -(placement.dirX ?? 0) * SIEGE_RAMP.halfWidth
  return Math.max(getTerrainHeight(x, z), getTerrainHeight(x + lateralX, z + lateralZ),
    getTerrainHeight(x - lateralX, z - lateralZ)) + .04
}

/** Local chassis-frame bounds; reused by the existing side rails, without new moving obstacles.
 * Vertical skirts seal the undercroft while leaving the walk lane and rear pushers clear. */
export function siegeRampSideSkirtBox(out: THREE.Box3, surface: WalkRampSurface,
  along: number, length: number, side: number, groundHeight = getTerrainHeight): THREE.Box3 {
  const lateral = side * (surface.halfWidth + .1)
  let bottom = Infinity
  for (let sample = 0; sample < 3; sample++) {
    const distance = along + length * sample / 2
    const x = surface.startX + surface.dirX * distance + surface.dirZ * lateral
    const z = surface.startZ + surface.dirZ * distance - surface.dirX * lateral
    bottom = Math.min(bottom, groundHeight(x, z))
  }
  const highAlong = surface.topY >= surface.startY ? along + length : along
  const top = surface.startY + (surface.topY - surface.startY) * Math.min(1, highAlong / surface.length) + .9
  const rear = -surface.length - surface.landing
  out.min.set(lateral - .1, bottom - surface.topY - .15, rear + along)
  out.max.set(lateral + .1, top - surface.topY, rear + along + length)
  return out
}

/** The nose panel ends below the deck; walking across the deployed bridge stays clear. */
export function siegeRampFrontSkirtBox(out: THREE.Box3, surface: WalkRampSurface,
  groundHeight = getTerrainHeight): THREE.Box3 {
  const along = surface.length + surface.landing
  let bottom = Infinity
  for (let sample = -1; sample <= 1; sample++) {
    const lateral = sample * surface.halfWidth
    bottom = Math.min(bottom, groundHeight(surface.startX + surface.dirX * along + surface.dirZ * lateral,
      surface.startZ + surface.dirZ * along - surface.dirX * lateral))
  }
  out.min.set(-surface.halfWidth, bottom - surface.topY - .15, -.25)
  out.max.set(surface.halfWidth, -.25, 0)
  return out
}

/** Reuse the ramp plank's body record for one continuous slope/deck solid.
 * Call after restoring its mesh bounds; the side margin clears the outer skirts
 * when recovering an actor loaded into the hull, including at the deck seam. */
export function siegeRampUnderfillBounds(out: THREE.Box3, deck: THREE.Box3, surface: WalkRampSurface): THREE.Box3 {
  out.union(deck)
  out.min.y = TERRAIN_MIN_HEIGHT - .15
  const marginX = Math.abs(surface.dirZ) * .2, marginZ = Math.abs(surface.dirX) * .2
  out.min.x -= marginX; out.max.x += marginX
  out.min.z -= marginZ; out.max.z += marginZ
  return out
}

/** One ground-only navigation record covers the complete chassis, including its
 * side braces and front overhang. Actual body/projectile collision stays with
 * the original parts; layered routes separately admit the upper walk lane. */
export function updateSiegeRampGroundObstacle(obstacle: ObstacleData, parts: readonly ObstacleData[]): void {
  obstacle.box.makeEmpty()
  for (const part of parts) obstacle.box.union(part.box)
  obstacle.navigationPassable = false
  obstacle.physicalPassable = true
  obstacle.projectilePassable = true
  obstacle.dynamic = true
}

/** The moving shell must not enclose a body wholly inside its hollow-looking
 * panels. Test the swept solid below the actual walking plane in O(1). */
export function intersectsSiegeRampUnderfill(body: EntityCollisionBody, surface: WalkRampSurface, travel: number): boolean {
  const dx = body.position.x - surface.startX, dz = body.position.z - surface.startZ
  const lateral = dx * surface.dirZ - dz * surface.dirX
  const along = dx * surface.dirX + dz * surface.dirZ
  if (Math.abs(lateral) >= surface.halfWidth + .2 + body.radius
    || along + body.radius < 0 || along - body.radius > surface.length + surface.landing + travel) return false
  // Forward motion decreases the body's relative along coordinate. The highest
  // overlap is its current front edge (or the approaching flat deck).
  const highestAlong = surface.topY >= surface.startY ? along + body.radius : along - travel - body.radius
  const ceiling = surface.startY + (surface.topY - surface.startY) * Math.max(0, Math.min(1, highestAlong / surface.length))
  const bottom = body.position.y - body.bottomOffset
  return bottom < ceiling - .001 && bottom + body.height > TERRAIN_MIN_HEIGHT - .15
}

export function isMobileSiegeRampEnabled(config: DefenseCampaignLaunchConfig | undefined): boolean {
  return isOutpostWalkwayEnabled(config, false)
}

export function isSiegeRampCrewCandidate(spec: NpcSpawnSpec, attackerFaction?: NpcSpawnSpec['characterFaction']): boolean {
  return (!attackerFaction || spec.characterFaction === attackerFaction)
    && !spec.cavalry && !spec.loadout?.mountId && spec.aiType === AIType.MELEE && spec.tier !== 4
}

/** Allocates existing identities only. Missing/duplicate identities are invalid input. */
export function allocateSiegeRampCrews(specs: readonly NpcSpawnSpec[], attackerFaction?: NpcSpawnSpec['characterFaction']): SiegeRampAssignment[] {
  const ids = new Set<string>()
  for (const spec of specs) {
    if (!spec.actorId || ids.has(spec.actorId)) throw new Error('Siege roster requires unique actor IDs')
    ids.add(spec.actorId)
  }
  const infantry = specs.filter(spec => isSiegeRampCrewCandidate(spec, attackerFaction))
  return ([-1, 1] as const).slice(0, Math.min(2, Math.floor(infantry.length / 10))).map((side, i) => ({
    id: side < 0 ? 'siege-ramp-left' : 'siege-ramp-right', side,
    pusherIds: infantry.slice(i * 10, i * 10 + 4).map(spec => spec.actorId!),
    assaultIds: infantry.slice(i * 10 + 4, i * 10 + 10).map(spec => spec.actorId!),
  }))
}

/** Flat platform stops outside the wall. A separate bridge reaches the deck centre. */
export function getSiegeRampPlacement(layout: OutpostWalkwayLayout, side: OutpostWalkwaySide, stagingZ?: number): SiegeRampPlacement {
  const deck = layout.decks.find(candidate => candidate.side === side)!
  const x = (deck.slab.min.x + deck.slab.max.x) / 2
  const deckZ = (deck.slab.min.z + deck.slab.max.z) / 2
  const dockZ = deckZ - layout.zSign * SIEGE_RAMP.bridgeLength
  const dockY = deck.topY
  const frontZ = layout.zSign > 0 ? deck.slab.min.z : deck.slab.max.z
  const startZ = stagingZ ?? getDefenseCampaignStagingZ(frontZ, layout.zSign)
  let length = 12
  for (let i = 0; i < 20; i++) {
    const rearZ = dockZ - layout.zSign * (SIEGE_RAMP.platformLength + length)
    length = Math.max(length, (dockY - getTerrainHeight(x, rearZ) + .1) / SIEGE_RAMP.maxSlope)
  }
  const rearZ = dockZ - layout.zSign * (SIEGE_RAMP.platformLength + length)
  const surface: WalkRampSurface = {
    startX: x, startZ: rearZ, dirX: 0, dirZ: layout.zSign,
    halfWidth: SIEGE_RAMP.halfWidth, length, landing: SIEGE_RAMP.platformLength,
    startY: getTerrainHeight(x, rearZ) + .04, topY: dockY,
  }
  const dock = new THREE.Vector3(x, dockY, dockZ)
  const startRearZ = rearZ + startZ - dockZ
  const start = new THREE.Vector3(x,
    getTerrainHeight(x, startRearZ) + .04 + dockY - surface.startY, startZ)
  return {
    id: side < 0 ? 'siege-ramp-left' : 'siege-ramp-right', side, start, dock, surface,
    deckConnection: new THREE.Vector3(x, dockY, deckZ), dirZ: layout.zSign,
  }
}

/** Placement is applied to spawn data before actor construction/registration. */
export function placeSiegeRampCrew<Id extends MobileSiegeRampId>(specs: NpcSpawnSpec[], crew: SiegeRampAssignment<Id>, placement: SiegeRampPlacement<Id>): void {
  const dz = placement.start.z - placement.dock.z
  const dx = placement.start.x - placement.dock.x
  const dirX = placement.dirX ?? 0
  const lateralX = placement.dirX === undefined ? 1 : placement.dirZ
  const lateralZ = -dirX
  const byId = new Map(specs.map(spec => [spec.actorId, spec]))
  for (const [index, id] of crew.assaultIds.entries()) {
    const spec = byId.get(id)!
    spec.x = placement.start.x + lateralX * (index % 2 === 0 ? -1 : 1) - dirX * (1 + Math.floor(index / 2) * 1.5)
    spec.z = placement.start.z + lateralZ * (index % 2 === 0 ? -1 : 1) - placement.dirZ * (1 + Math.floor(index / 2) * 1.5)
    spec.spawnY = placement.start.y
    spec.siegeRamp = { id: crew.id, role: 'assault' }
  }
  for (const [index, id] of crew.pusherIds.entries()) {
    const spec = byId.get(id)!
    spec.x = placement.surface.startX + dx + lateralX * (index % 2 === 0 ? -1 : 1) - dirX * (1.6 + Math.floor(index / 2) * 1.6)
    spec.z = placement.surface.startZ + dz + lateralZ * (index % 2 === 0 ? -1 : 1) - placement.dirZ * (1.6 + Math.floor(index / 2) * 1.6)
    spec.spawnY = getTerrainHeight(spec.x, spec.z)
    spec.siegeRamp = { id: crew.id, role: 'pusher' }
  }
}


/** Reserve the complete approach footprint before vegetation is materialized. */
export function getSiegeApproachClearances(layout: OutpostWalkwayLayout, stagingZ?: number): THREE.Box3[] {
  return ([-1, 1] as const).map(side => {
    const placement = getSiegeRampPlacement(layout, side, stagingZ)
    const rearZ = placement.surface.startZ + placement.start.z - placement.dock.z
    return new THREE.Box3(
      new THREE.Vector3(placement.start.x - SIEGE_RAMP.halfWidth - 1, -Infinity, Math.min(rearZ, placement.dock.z) - 4),
      new THREE.Vector3(placement.start.x + SIEGE_RAMP.halfWidth + 1, Infinity, Math.max(rearZ, placement.dock.z) + 4),
    )
  })
}
