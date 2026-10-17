import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { BattleSpawnPlan, NpcSpawnSpec } from '../battle/BattleSpawner'
import { resolveUnitLoadout, type UnitPresetId } from '../battle/UnitPresetCatalog'
import { Faction } from '../combat/CombatFaction'
import type { CharacterFaction } from './CharacterVisuals'
import { createPineVisual, environmentRandom, timberMaterial } from './EnvironmentVisuals'
import type { AIType } from './NPC'
import { proceduralMaterial } from './ProceduralMaterials'
import {
  getBaseProceduralTerrainHeight,
  getTerrainHeight,
  isRiverCrossingTerrainActive,
  type ObstacleData,
} from './Terrain'

export const MOUNT_COLLISION_RADIUS = 1.0
export const FOOT_COLLISION_RADIUS = 0.5

export const RIVER_CROSSING_LAYOUT = {
  worldBound: 300,
  terrainSize: 640,
  river: {
    /** Clear water channel half-width (36m total channel width, within 30–40m spec). */
    halfChannelWidth: 18.0,
    /** Outer graded riverbank half-width (44m total bank-to-bank transition). */
    halfBankWidth: 22.0,
    /** Ground movement and A* navigation blocker half-width matching the steep bank edge. */
    blockerHalfWidth: 18.5,
    riverbedY: -3.2,
    waterSurfaceY: -1.15,
    meanderStartAbsX: 38.0,
    meanderFullAbsX: 100.0,
    segmentCountPerSide: 16,
    blockerExtentX: 324.0,
  },
  bridge: {
    centerX: 0,
    centerZ: 0,
    /** 48m total length (-24m to +24m), anchoring 6m into both passable riverbanks. */
    halfLength: 24.0,
    /** 16.8m clear roadway width (-8.4m to +8.4m), fitting >= 5 cavalry abreast with margin. */
    halfClearWidth: 8.4,
    parapetWidth: 1.0,
    /** 18.8m total outer width (-9.4m to +9.4m). */
    halfTotalWidth: 9.4,
    parapetHeight: 1.05,
    archCrownHeight: 0.45,
    deckThickness: 0.42,
    laneCount: 5,
    laneXPositions: [-6.0, -3.0, 0.0, 3.0, 6.0] as const,
    pierZPositions: [-12.0, 0.0, 12.0] as const,
  },
  northDefense: {
    playerSpawn: { x: 0, z: -34, yaw: 0 },
    bridgeheadZone: { minX: -46, maxX: 46, minZ: -58, maxZ: -24 },
    wallZ: -60.4,
    wallThickness: 1.6,
    wallHeight: 1.35,
    /** 20.8m central gap (-10.4m to +10.4m) so troops and mounts can maneuver freely. */
    centralGapHalfWidth: 10.4,
    wingOuterAbsX: 46.0,
    flankReturnDepth: 5.2,
    deploymentZone: { minX: -96, maxX: 96, minZ: -148, maxZ: -28 },
  },
  southStaging: {
    bridgeheadZone: { minX: -60, maxX: 60, minZ: 24, maxZ: 68 },
    stagingZone: { minX: -115, maxX: 115, minZ: 68, maxZ: 176 },
  },
} as const

export interface RiverCrossingCollections {
  obstacles: ObstacleData[]
  obstacleMeshes: THREE.Object3D[]
}

export interface RiverCrossingBattlefieldResult {
  root: THREE.Group
  obstacles: ObstacleData[]
  obstacleMeshes: THREE.Object3D[]
}

export interface BridgeLaneSlot {
  laneIndex: number
  x: number
  y: number
  z: number
  radius: number
}

export interface DeploymentSlot {
  x: number
  y: number
  z: number
  yaw: number
}

export interface InfantrySquadDeploymentPlan {
  squadId: number
  role: 'spearman' | 'melee_infantry' | 'archer' | 'javelin'
  slots: DeploymentSlot[]
}

export interface CavalrySquadStagingPlan {
  squadId: number
  role: 'melee_cavalry' | 'lance_cavalry'
  slots: DeploymentSlot[]
}

export interface DrownableMountLike {
  readonly dead: boolean
  readonly disposed?: boolean
  readonly maxHp: number
  readonly isAirborne?: boolean
  readonly isFlyingMount?: boolean
  readonly group: { position: THREE.Vector3 }
  readonly riderPlayer?: DrownablePlayerLike | null
  readonly riderNpc?: DrownableNpcLike | null
  takeDamage(amount: number): boolean
}

export interface DrownablePlayerLike {
  readonly dead: boolean
  readonly maxHp: number
  readonly position: THREE.Vector3
  readonly isMounted: boolean
  readonly currentMount: DrownableMountLike | null
  takeFallDamage(amount: number, hpBar: { setFill(ratio: number): void }): boolean
}

export interface DrownableNpcLike {
  readonly dead: boolean
  readonly maxHp: number
  readonly position: THREE.Vector3
  readonly isMounted: boolean
  readonly mount: DrownableMountLike | null
  takeFallDamage(amount: number): boolean
}

/**
 * River centerline Z as a function of world X.
 * Straight (z = 0) across the central bridge corridor (|x| <= 38m) for clear
 * tactical command, with a natural meander on the outer flanks.
 */
export function getRiverCenterZ(x: number): number {
  const absX = Math.abs(x)
  if (absX <= RIVER_CROSSING_LAYOUT.river.meanderStartAbsX) return 0
  const mask = THREE.MathUtils.smoothstep(
    absX,
    RIVER_CROSSING_LAYOUT.river.meanderStartAbsX,
    RIVER_CROSSING_LAYOUT.river.meanderFullAbsX,
  )
  return (Math.sin(x * 0.021) * 5.2 + Math.cos(x * 0.045 + 0.8) * 2.4) * mask
}

/**
 * Smooth C1 bridge deck elevation across z in [-24, +24].
 * Ends at y = 0.0m at z = ±24m to join both graded riverbanks with zero step.
 */
export function getBridgeDeckHeight(z: number): number {
  const halfLen = RIVER_CROSSING_LAYOUT.bridge.halfLength
  const u = THREE.MathUtils.clamp(z / halfLen, -1, 1)
  const oneMinusU2 = 1 - u * u
  return RIVER_CROSSING_LAYOUT.bridge.archCrownHeight * oneMinusU2 * (1 - 0.25 * u * u)
}

/**
 * Returns true if (x, z) lies inside the impassable river channel outside the bridge.
 */
export function isPointInRiverChannel(x: number, z: number, margin = 0): boolean {
  if (Math.abs(x) < RIVER_CROSSING_LAYOUT.bridge.halfClearWidth - margin) {
    return false
  }
  const centerZ = getRiverCenterZ(x)
  return Math.abs(z - centerZ) <= RIVER_CROSSING_LAYOUT.river.blockerHalfWidth + margin
}

/**
 * Returns true if (x, z) lies on the walkable stone bridge roadway.
 */
export function isPointOnBridgeDeck(x: number, z: number, radius = 0): boolean {
  return (
    Math.abs(x) <= RIVER_CROSSING_LAYOUT.bridge.halfClearWidth - radius
    && Math.abs(z) <= RIVER_CROSSING_LAYOUT.bridge.halfLength
  )
}

/**
 * Natural riverbank and recessed riverbed height across all X (including beneath the bridge).
 */
export function getRiverCrossingChannelTerrainHeight(
  x: number,
  z: number,
  baseHeight: number,
): number {
  const { river } = RIVER_CROSSING_LAYOUT
  const absX = Math.abs(x)
  const absZ = Math.abs(z)
  const centerZ = getRiverCenterZ(x)
  const riverDistZ = Math.abs(z - centerZ)

  // Flatten the central bridgehead approaches, defensive wall line, and staging grounds
  // so 200-unit formations and bridge entrances meet level ground without gaps.
  const approachFlatX = 1 - THREE.MathUtils.smoothstep(absX, 44, 155)
  const approachFlatZ = 1 - THREE.MathUtils.smoothstep(absZ, 68, 190)
  const bankEdgeFlatZ = 1 - THREE.MathUtils.smoothstep(riverDistZ, river.halfBankWidth, river.halfBankWidth + 24)
  const flattenFactor = Math.max(approachFlatX * approachFlatZ * 0.88, bankEdgeFlatZ)
  const bankGroundY = baseHeight * (1 - flattenFactor)

  if (riverDistZ < river.halfBankWidth) {
    const channelBlend = 1 - THREE.MathUtils.smoothstep(riverDistZ, 13.0, river.halfBankWidth)
    return THREE.MathUtils.lerp(bankGroundY, river.riverbedY, channelBlend)
  }
  return bankGroundY
}

/**
 * Scene-isolated terrain height policy for the River Crossing Battlefield.
 * Preserves continuous ground physics across both banks and the bridge deck
 * while carving the recessed river channel outside the bridge footprint.
 */
export function getRiverCrossingTerrainHeight(
  x: number,
  z: number,
  baseHeight: number,
): number {
  const { bridge } = RIVER_CROSSING_LAYOUT
  if (Math.abs(x) <= bridge.halfTotalWidth && Math.abs(z) <= bridge.halfLength) {
    return getBridgeDeckHeight(z)
  }
  return getRiverCrossingChannelTerrainHeight(x, z, baseHeight)
}

/**
 * Rendered terrain mesh vertex height for the River Crossing Battlefield.
 * Carves the recessed riverbed (-3.2m, below waterSurfaceY = -1.15m) all the way
 * underneath the bridge arches so soil never fills the space under the bridge,
 * while tucking the North/South bank abutments cleanly below the stone deck slab.
 */
export function getRiverCrossingMeshTerrainHeight(
  x: number,
  z: number,
  baseHeight: number,
): number {
  const { bridge } = RIVER_CROSSING_LAYOUT
  const channelY = getRiverCrossingChannelTerrainHeight(x, z, baseHeight)
  if (Math.abs(x) <= bridge.halfTotalWidth && Math.abs(z) <= bridge.halfLength) {
    return Math.min(channelY, getBridgeDeckHeight(z) - 0.28)
  }
  return channelY
}

/**
 * Pure River Crossing terrain height sampler using the formal procedural baseHeight
 * (independent of whether a River Crossing scene is currently active).
 */
export function sampleRiverCrossingTerrainHeight(x: number, z: number): number {
  return getRiverCrossingTerrainHeight(x, z, getBaseProceduralTerrainHeight(x, z, null))
}

/**
 * Ray intersection against the walkable stone bridge roadway when River Crossing
 * terrain is active (used by FormationController so aiming at the bridge hits the
 * deck at y ≈ 0..0.45m rather than the recessed riverbed mesh at y = -3.2m).
 */
export function findRiverBridgeDeckHit(
  ray: THREE.Ray,
): { hitPoint: THREE.Vector3; distance: number } | null {
  if (!isRiverCrossingTerrainActive()) return null
  const { bridge } = RIVER_CROSSING_LAYOUT
  const box = new THREE.Box3(
    new THREE.Vector3(-bridge.halfClearWidth, -0.2, -bridge.halfLength),
    new THREE.Vector3(bridge.halfClearWidth, bridge.archCrownHeight + 0.2, bridge.halfLength),
  )
  const entry = new THREE.Vector3()
  if (!ray.intersectBox(box, entry)) return null
  const minDist = Math.max(0, ray.origin.distanceTo(entry) - 1)
  const maxDist = minDist + bridge.halfLength * 2.5 + 8
  const steps = 32
  const point = new THREE.Vector3()
  let prevDist = minDist
  ray.at(prevDist, point)
  let prevGap = point.y - getBridgeDeckHeight(point.z)
  for (let i = 1; i <= steps; i++) {
    const d = minDist + ((maxDist - minDist) * i) / steps
    ray.at(d, point)
    if (Math.abs(point.x) > bridge.halfClearWidth || Math.abs(point.z) > bridge.halfLength) {
      prevDist = d
      prevGap = point.y - getBridgeDeckHeight(point.z)
      continue
    }
    const gap = point.y - getBridgeDeckHeight(point.z)
    if (prevGap >= -0.02 && gap <= 0.02) {
      const t = prevGap === gap ? 0 : THREE.MathUtils.clamp(prevGap / (prevGap - gap), 0, 1)
      const hitDist = THREE.MathUtils.lerp(prevDist, d, t)
      const hitPoint = ray.at(hitDist, new THREE.Vector3())
      hitPoint.y = getBridgeDeckHeight(hitPoint.z)
      return { hitPoint, distance: hitDist }
    }
    prevDist = d
    prevGap = gap
  }
  return null
}

/**
 * Returns true if an actor at (x, feetY, z) has entered the river water in the
 * River Crossing Battlefield and should immediately drown.
 * - Actors standing on the stone bridge structure or on dry riverbanks above water do not drown.
 * - Giant Eagles flying above the water surface do not drown unless they drop into the water.
 */
export function shouldDrownInRiverCrossing(
  x: number,
  feetY: number,
  z: number,
  options: { isAirborneEagle?: boolean } = {},
): boolean {
  if (!isRiverCrossingTerrainActive()) return false
  const { river, bridge } = RIVER_CROSSING_LAYOUT
  const waterContactY = river.waterSurfaceY + 0.08
  if (options.isAirborneEagle && feetY > waterContactY) return false
  if (
    Math.abs(x) <= bridge.halfTotalWidth
    && Math.abs(z) <= bridge.halfLength
    && feetY >= getBridgeDeckHeight(z) - 0.35
  ) {
    return false
  }
  const centerZ = getRiverCenterZ(x)
  if (Math.abs(z - centerZ) > river.blockerHalfWidth) return false
  return feetY <= waterContactY
}

/**
 * Applies instant drowning to any living Player, NPC, or Mount that touches or
 * falls below the river water surface in the River Crossing Battlefield.
 * Mounted actors settle both mount and rider in the same step so no living rider
 * or ownerless living mount remains in the river, with once-only death callbacks.
 */
export function settleRiverCrossingDrowning(
  player: DrownablePlayerLike | null | undefined,
  npcs: readonly DrownableNpcLike[],
  mounts: readonly DrownableMountLike[],
  hpBar: { setFill(ratio: number): void } = { setFill() {} },
): number {
  if (!isRiverCrossingTerrainActive()) return 0
  const waterSurfaceY = RIVER_CROSSING_LAYOUT.river.waterSurfaceY
  let drownedCount = 0

  const drownMountAndRider = (mount: DrownableMountLike): void => {
    const riderPlayer = mount.riderPlayer ?? (player?.currentMount === mount ? player : null)
    const riderNpc = mount.riderNpc ?? null
    if (!mount.dead && !mount.disposed) {
      if (mount.takeDamage(mount.maxHp * 100)) drownedCount++
    }
    if (riderPlayer && !riderPlayer.dead) {
      riderPlayer.position.y = Math.min(riderPlayer.position.y, waterSurfaceY + 0.95)
      if (riderPlayer.takeFallDamage(riderPlayer.maxHp * 100, hpBar)) drownedCount++
    }
    if (riderNpc && !riderNpc.dead) {
      riderNpc.position.y = Math.min(riderNpc.position.y, waterSurfaceY)
      if (riderNpc.takeFallDamage(riderNpc.maxHp * 100)) drownedCount++
    }
  }

  for (const mount of mounts) {
    if (mount.dead || mount.disposed) continue
    const pos = mount.group.position
    const isAirborneEagle = Boolean(mount.isFlyingMount && mount.isAirborne)
    if (shouldDrownInRiverCrossing(pos.x, pos.y, pos.z, { isAirborneEagle })) {
      drownMountAndRider(mount)
    }
  }

  if (player && !player.dead) {
    const mount = player.isMounted ? player.currentMount : null
    if (mount && !mount.dead && !mount.disposed) {
      const mPos = mount.group.position
      const isAirborneEagle = Boolean(mount.isFlyingMount && mount.isAirborne)
      if (shouldDrownInRiverCrossing(mPos.x, mPos.y, mPos.z, { isAirborneEagle })) {
        drownMountAndRider(mount)
      }
    } else {
      const feetY = player.position.y - 0.95
      if (shouldDrownInRiverCrossing(player.position.x, feetY, player.position.z)) {
        if (player.takeFallDamage(player.maxHp * 100, hpBar)) drownedCount++
      }
    }
  }

  for (const npc of npcs) {
    if (npc.dead) continue
    const mount = npc.isMounted ? npc.mount : null
    if (mount && !mount.dead && !mount.disposed) {
      const mPos = mount.group.position
      const isAirborneEagle = Boolean(mount.isFlyingMount && mount.isAirborne)
      if (shouldDrownInRiverCrossing(mPos.x, mPos.y, mPos.z, { isAirborneEagle })) {
        drownMountAndRider(mount)
      }
    } else {
      const pos = npc.position
      if (shouldDrownInRiverCrossing(pos.x, pos.y, pos.z)) {
        if (npc.takeFallDamage(npc.maxHp * 100)) drownedCount++
      }
    }
  }

  return drownedCount
}

/**
 * Soil/road wear factor in [0, 1] used by Meadow.ts to suppress grass tufts
 * inside the river channel, on the stone bridge, and along the main approach road.
 */
export function getRiverCrossingMeadowWear(x: number, z: number): number {
  if (!isRiverCrossingTerrainActive()) return 0
  const { bridge, river, northDefense } = RIVER_CROSSING_LAYOUT
  const absX = Math.abs(x)
  const absZ = Math.abs(z)

  if (absX <= bridge.halfTotalWidth + 1.5 && absZ <= bridge.halfLength + 2.5) {
    return 1
  }

  if (
    Math.abs(z - northDefense.wallZ) <= 2.4
    && absX >= northDefense.centralGapHalfWidth - 1.5
    && absX <= northDefense.wingOuterAbsX + 2.5
  ) {
    return 1
  }

  const riverDistZ = Math.abs(z - getRiverCenterZ(x))
  if (riverDistZ <= river.halfBankWidth + 0.5) {
    return 1
  }
  const bankWear = 1 - THREE.MathUtils.smoothstep(riverDistZ, river.halfBankWidth, river.halfBankWidth + 5.5)

  if (absX <= 7.8 && absZ <= 85) {
    return 1
  }
  const roadMaskZ = 1 - THREE.MathUtils.smoothstep(absZ, 24, 155)
  const roadWear = (1 - THREE.MathUtils.smoothstep(absX, 7.8, 11.8)) * roadMaskZ * 0.92

  return Math.max(bankWear, roadWear)
}

/**
 * Tree clearance zones ensuring default terrain pine trees never spawn inside
 * the river channel, bridge approaches, defensive walls, or 200-unit staging areas.
 */
export function getRiverCrossingTreeClearances(): THREE.Box3[] {
  return [
    new THREE.Box3(new THREE.Vector3(-325, -10, -40), new THREE.Vector3(325, 20, 40)),
    new THREE.Box3(new THREE.Vector3(-110, -10, -160), new THREE.Vector3(110, 20, 180)),
  ]
}

/**
 * Pure collision and navigation obstacle builder for the River Crossing Battlefield.
 * Can be called in unit tests without creating any Three.js Scene or Mesh.
 */
export function createRiverCrossingObstacleData(): ObstacleData[] {
  const obstacles: ObstacleData[] = []
  const { river, bridge, northDefense } = RIVER_CROSSING_LAYOUT

  // 1. River channel navigation & AI blockers (West and East of the bridge).
  // A* navigation, NPC pathfinding, obstacle avoidance, and formation placement
  // treat the river as impassable across the full playable width, while
  // physicalPassable: true lets any unit that manually jumps off the bridge or
  // walks off the bank enter the water and immediately drown.
  const spanLength = river.blockerExtentX - bridge.halfClearWidth
  const stepX = spanLength / river.segmentCountPerSide
  for (const side of [-1, 1] as const) {
    for (let i = 0; i < river.segmentCountPerSide; i++) {
      const innerX = bridge.halfClearWidth + i * stepX - (i > 0 ? 0.15 : 0)
      const outerX = bridge.halfClearWidth + (i + 1) * stepX + 0.15
      const minX = side < 0 ? -outerX : innerX
      const maxX = side < 0 ? -innerX : outerX
      const midX = (minX + maxX) * 0.5
      const centerZ = getRiverCenterZ(midX)

      obstacles.push({
        box: new THREE.Box3(
          new THREE.Vector3(minX, -8.0, centerZ - river.blockerHalfWidth),
          new THREE.Vector3(maxX, 4.0, centerZ + river.blockerHalfWidth),
        ),
        isBarricade: false,
        physicalPassable: true,
        projectilePassable: true,
        projectileBoxes: [],
      })
    }
  }

  // 2. Bridge stone parapets (strictly outside the 16.8m clear roadway) and
  // separate stone pier obstacles (so each pier's broad-phase box matches its projectileBoxes).
  const deckPeakY = bridge.archCrownHeight
  const parapetTopY = deckPeakY + bridge.parapetHeight
  for (const side of [-1, 1] as const) {
    const minX = side < 0 ? -bridge.halfTotalWidth : bridge.halfClearWidth
    const maxX = side < 0 ? -bridge.halfClearWidth : bridge.halfTotalWidth
    const parapetBox = new THREE.Box3(
      new THREE.Vector3(minX, -0.4, -bridge.halfLength),
      new THREE.Vector3(maxX, parapetTopY, bridge.halfLength),
    )
    obstacles.push({
      box: parapetBox,
      isBarricade: false,
      projectileBoxes: [parapetBox.clone()],
    })

    for (const pierZ of bridge.pierZPositions) {
      const pierMinX = side < 0 ? minX - 1.3 : minX
      const pierMaxX = side < 0 ? maxX : maxX + 1.3
      const pierBox = new THREE.Box3(
        new THREE.Vector3(pierMinX, river.riverbedY, pierZ - 2.2),
        new THREE.Vector3(pierMaxX, deckPeakY + 0.25, pierZ + 2.2),
      )
      obstacles.push({
        box: pierBox,
        isBarricade: false,
        projectileBoxes: [pierBox.clone()],
      })
    }
  }

  // 3. North Bank military defensive walls (two wing walls with a 20.8m central passage).
  const wallHalfThick = northDefense.wallThickness * 0.5
  const wallMinZ = northDefense.wallZ - wallHalfThick
  const wallMaxZ = northDefense.wallZ + wallHalfThick
  for (const side of [-1, 1] as const) {
    const wingMinX = side < 0 ? -northDefense.wingOuterAbsX : northDefense.centralGapHalfWidth
    const wingMaxX = side < 0 ? -northDefense.centralGapHalfWidth : northDefense.wingOuterAbsX
    const wingBox = new THREE.Box3(
      new THREE.Vector3(wingMinX, -0.3, wallMinZ),
      new THREE.Vector3(wingMaxX, northDefense.wallHeight, wallMaxZ),
    )
    obstacles.push({
      box: wingBox,
      isBarricade: false,
      projectileBoxes: [wingBox.clone()],
    })

    const flankMinX = side < 0 ? -northDefense.wingOuterAbsX - northDefense.wallThickness : northDefense.wingOuterAbsX
    const flankMaxX = side < 0 ? -northDefense.wingOuterAbsX : northDefense.wingOuterAbsX + northDefense.wallThickness
    const flankBox = new THREE.Box3(
      new THREE.Vector3(flankMinX, -0.3, wallMinZ - northDefense.flankReturnDepth),
      new THREE.Vector3(flankMaxX, northDefense.wallHeight, wallMaxZ),
    )
    obstacles.push({
      box: flankBox,
      isBarricade: false,
      projectileBoxes: [flankBox.clone()],
    })
  }

  return obstacles
}

/**
 * Returns the 5 side-by-side cavalry lane positions across the bridge at a given Z.
 */
export function getBridgeFiveCavalryLanePositions(
  z = 0,
  mountRadius = MOUNT_COLLISION_RADIUS,
): BridgeLaneSlot[] {
  const clampedZ = THREE.MathUtils.clamp(
    z,
    -RIVER_CROSSING_LAYOUT.bridge.halfLength,
    RIVER_CROSSING_LAYOUT.bridge.halfLength,
  )
  const y = getBridgeDeckHeight(clampedZ)
  return RIVER_CROSSING_LAYOUT.bridge.laneXPositions.map((x, laneIndex) => ({
    laneIndex,
    x,
    y,
    z: clampedZ,
    radius: mountRadius,
  }))
}

/**
 * Pure deployment planner for 8 friendly infantry squads (25 soldiers each = 200 total)
 * on the North Bank (-Z) around the bridgehead and defensive walls.
 */
export function planNorthBankInfantryDeployment(faction?: CharacterFaction): InfantrySquadDeploymentPlan[] {
  const configs: ReadonlyArray<{
    squadId: number
    role: InfantrySquadDeploymentPlan['role']
    centerX: number
    frontZ: number
  }> = [
    // Front bridgehead shield/spear line ahead of the defensive wall
    { squadId: 1, role: 'spearman', centerX: -14, frontZ: -34 },
    { squadId: 2, role: 'spearman', centerX: 14, frontZ: -34 },
    // Wing melee infantry holding the outer bridgehead flanks
    { squadId: 3, role: 'melee_infantry', centerX: -42, frontZ: -40 },
    { squadId: 4, role: 'melee_infantry', centerX: 42, frontZ: -40 },
    // Ranged firing lines stationed immediately behind the West and East defensive walls
    { squadId: 5, role: 'archer', centerX: -28, frontZ: -65 },
    { squadId: 6, role: 'javelin', centerX: 28, frontZ: -65 },
    // Rear reserve infantry behind the central passage
    { squadId: 7, role: 'melee_infantry', centerX: -18, frontZ: -88 },
    { squadId: 8, role: 'archer', centerX: 18, frontZ: -88 },
  ]

  const columns = 5
  const rows = 5
  const spacingX = 2.6
  const spacingZ = 2.6

  return configs.map(cfg => {
    const slots: DeploymentSlot[] = []
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < columns; col++) {
        const x = cfg.centerX + (col - (columns - 1) * 0.5) * spacingX
        const z = cfg.frontZ - row * spacingZ
        const y = sampleRiverCrossingTerrainHeight(x, z)
        slots.push({ x, y, z, yaw: 0 })
      }
    }
    return {
      squadId: cfg.squadId,
      role: faction ? cfg.squadId <= 2 ? 'spearman' : cfg.squadId <= 4 ? 'melee_infantry'
        : faction === 'roman' && cfg.squadId <= 6 ? 'javelin' : 'archer' : cfg.role,
      slots,
    }
  })
}

/**
 * Pure staging planner for 8 enemy cavalry squads (25 riders each = 200 total:
 * 100 sword/axe melee cavalry + 100 lance cavalry) on the South Bank (+Z).
 */
export function planSouthBankCavalryStaging(): CavalrySquadStagingPlan[] {
  const configs: ReadonlyArray<{
    squadId: number
    role: CavalrySquadStagingPlan['role']
    centerX: number
    frontZ: number
  }> = [
    // First echelon: 4 squads × 25 = 100 sword/axe cavalry
    { squadId: 1, role: 'melee_cavalry', centerX: -66, frontZ: 74 },
    { squadId: 2, role: 'melee_cavalry', centerX: -22, frontZ: 74 },
    { squadId: 3, role: 'melee_cavalry', centerX: 22, frontZ: 74 },
    { squadId: 4, role: 'melee_cavalry', centerX: 66, frontZ: 74 },
    // Second echelon: 4 squads × 25 = 100 lance cavalry
    { squadId: 5, role: 'lance_cavalry', centerX: -66, frontZ: 116 },
    { squadId: 6, role: 'lance_cavalry', centerX: -22, frontZ: 116 },
    { squadId: 7, role: 'lance_cavalry', centerX: 22, frontZ: 116 },
    { squadId: 8, role: 'lance_cavalry', centerX: 66, frontZ: 116 },
  ]

  const columns = 5
  const rows = 5
  const spacingX = 3.8
  const spacingZ = 4.2

  return configs.map(cfg => {
    const slots: DeploymentSlot[] = []
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < columns; col++) {
        const x = cfg.centerX + (col - (columns - 1) * 0.5) * spacingX
        const z = cfg.frontZ + row * spacingZ
        const y = sampleRiverCrossingTerrainHeight(x, z)
        slots.push({ x, y, z, yaw: Math.PI })
      }
    }
    return {
      squadId: cfg.squadId,
      role: cfg.role,
      slots,
    }
  })
}

/**
 * Lightweight DEV preview spawn plan (?bridgepreview=1) with 5 friendly infantry
 * on the North Bank and 5 enemy cavalry on the South Bank to validate bridge
 * navigation and 5-abreast cavalry crossing without launching a 200v200 mission.
 */
export function createBridgePreviewSpawnPlan(
  playerFaction: CharacterFaction = 'viking',
): BattleSpawnPlan {
  const enemyFaction: CharacterFaction = playerFaction === 'viking' ? 'roman' : 'viking'
  const npcSpecs: NpcSpawnSpec[] = []

  // 5 friendly infantry on the North Bank (spread across the bridgehead flank to demonstrate A* entry onto the bridge)
  const friendlyPositions: readonly [number, number][] = [
    [-22, -44],
    [-16, -44],
    [0, -42],
    [16, -44],
    [22, -44],
  ]
  friendlyPositions.forEach(([x, z], index) => {
    const isSpear = index < 3
    const presetId: UnitPresetId = playerFaction === 'viking'
      ? (isSpear ? 'viking_spearman' : 'viking_berserker')
      : (isSpear ? 'roman_spearman' : 'roman_heavy_infantry')
    npcSpecs.push({
      faction: Faction.PLAYER,
      characterFaction: playerFaction,
      presetId,
      aiType: 'MELEE' as AIType,
      name: `Bridge Vanguard ${index + 1}`,
      tier: 2,
      cavalry: false,
      respawnEnabled: false,
      x,
      z,
      loadout: resolveUnitLoadout(presetId, 2),
      squadId: 1,
    })
  })

  // 5 enemy cavalry on the South Bank lined up across the 5 lanes
  const laneXs = RIVER_CROSSING_LAYOUT.bridge.laneXPositions
  laneXs.forEach((x, index) => {
    const isLancer = index === 1 || index === 3
    const presetId: UnitPresetId = enemyFaction === 'viking'
      ? (isLancer ? 'viking_lancer' : 'viking_sword_cavalry')
      : (isLancer ? 'roman_lancer' : 'roman_sword_cavalry')
    npcSpecs.push({
      faction: Faction.ENEMY,
      characterFaction: enemyFaction,
      presetId,
      aiType: 'MELEE' as AIType,
      name: `Bridge Raider ${index + 1}`,
      tier: 2,
      cavalry: true,
      respawnEnabled: false,
      x,
      z: 62,
      loadout: resolveUnitLoadout(presetId, 2),
      squadId: 1,
    })
  })

  return {
    playerSpawn: {
      x: RIVER_CROSSING_LAYOUT.northDefense.playerSpawn.x,
      z: RIVER_CROSSING_LAYOUT.northDefense.playerSpawn.z,
    },
    npcSpecs,
    pickupSpecs: [],
    horseSpecs: [],
  }
}

function createDeformedSlabGeometry(
  widthX: number,
  thicknessY: number,
  lengthZ: number,
  centerX: number,
  centerZ: number,
  segmentsZ: number,
  heightAtZ: (worldZ: number) => number,
  yOffset = 0,
): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(widthX, thicknessY, lengthZ, 2, 1, segmentsZ)
  const pos = geometry.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const worldX = pos.getX(i) + centerX
    const worldZ = pos.getZ(i) + centerZ
    const surfaceY = heightAtZ(worldZ) + yOffset
    pos.setXYZ(i, worldX, surfaceY + pos.getY(i), worldZ)
  }
  geometry.computeVertexNormals()
  return geometry
}

function createRiverWaterMesh(): THREE.Mesh {
  const { river, terrainSize } = RIVER_CROSSING_LAYOUT
  const segmentsX = 160
  const segmentsZ = 18
  const waterWidthZ = river.halfChannelWidth * 2 + 3.2
  const geometry = new THREE.PlaneGeometry(terrainSize, waterWidthZ, segmentsX, segmentsZ)
  geometry.rotateX(-Math.PI / 2)

  const pos = geometry.attributes.position
  const colors: number[] = []
  const deepColor = new THREE.Color(0x1f4e5f)
  const midColor = new THREE.Color(0x2d6a78)
  const shallowColor = new THREE.Color(0x4f8987)
  const foamColor = new THREE.Color(0xbfd6d4)
  const color = new THREE.Color()

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const localZ = pos.getZ(i)
    const worldZ = localZ + getRiverCenterZ(x)
    pos.setXYZ(i, x, river.waterSurfaceY, worldZ)

    const edgeRatio = Math.min(1, Math.abs(localZ) / (waterWidthZ * 0.5))
    const nearBridgePier = Math.abs(x) < 11.5 && (
      Math.abs(worldZ + 12) < 2.8 || Math.abs(worldZ) < 2.8 || Math.abs(worldZ - 12) < 2.8
    )
    color.copy(deepColor).lerp(midColor, edgeRatio * 0.65).lerp(shallowColor, edgeRatio * edgeRatio * 0.85)
    if (nearBridgePier || edgeRatio > 0.88) {
      color.lerp(foamColor, nearBridgePier ? 0.32 : (edgeRatio - 0.88) * 2.2)
    }
    colors.push(color.r, color.g, color.b)
  }

  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.computeVertexNormals()

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.24,
    metalness: 0.12,
  })
  const time = { value: 0 }
  material.onBeforeCompile = shader => {
    shader.uniforms.riverTime = time
    shader.vertexShader = 'uniform float riverTime;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      transformed.y += sin(riverTime * 1.8 + position.x * 0.18 + position.z * 0.35) * 0.035;`,
    )
  }

  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'river-water-surface'
  mesh.receiveShadow = true
  mesh.castShadow = false
  mesh.onBeforeRender = () => {
    time.value = performance.now() * 0.001
  }
  return mesh
}

/**
 * Builds and attaches the River Crossing Battlefield meshes (Five-Lane Military Stone Bridge,
 * river water surface, bank boulders, approach roads, and North Bank defensive walls)
 * and populates the shared obstacles/obstacleMeshes collections.
 */
export function createRiverCrossingBattlefield(
  scene: THREE.Scene,
  collections?: RiverCrossingCollections,
): RiverCrossingBattlefieldResult {
  const root = new THREE.Group()
  root.name = 'river-crossing-battlefield'
  scene.add(root)

  const obstacles = collections?.obstacles ?? []
  const obstacleMeshes = collections?.obstacleMeshes ?? []

  const staticObstacles = createRiverCrossingObstacleData()
  obstacles.push(...staticObstacles)

  const { bridge, river, northDefense } = RIVER_CROSSING_LAYOUT

  const stoneWallMaterial = proceduralMaterial({
    kind: 'leather',
    color: 0x8a877e,
    roughness: 0.88,
    metalness: 0.04,
    repeat: [4, 4],
  })
  const darkStoneMaterial = proceduralMaterial({
    kind: 'leather',
    color: 0x67645c,
    roughness: 0.92,
    metalness: 0.05,
    repeat: [3, 3],
  })
  const roadStoneMaterial = proceduralMaterial({
    kind: 'leather',
    color: 0x787368,
    roughness: 0.9,
    metalness: 0.03,
    repeat: [6, 6],
  })
  const woodMaterial = timberMaterial(0x6e5842)

  const bridgeRoadParts: THREE.BufferGeometry[] = []
  const bridgeStoneParts: THREE.BufferGeometry[] = []
  const bridgeTrimParts: THREE.BufferGeometry[] = []
  const defenseWallParts: THREE.BufferGeometry[] = []
  const defenseTimberParts: THREE.BufferGeometry[] = []
  const bankRockParts: THREE.BufferGeometry[] = []

  // 1. Crowned stone bridge deck slab + North/South stone approach aprons.
  bridgeRoadParts.push(
    createDeformedSlabGeometry(
      bridge.halfClearWidth * 2 + 0.4,
      bridge.deckThickness,
      bridge.halfLength * 2,
      0,
      0,
      24,
      z => getBridgeDeckHeight(z),
      -bridge.deckThickness * 0.5 + 0.02,
    ),
  )
  // Stone lane dividers / wheel-rut kerbs subtly inlaid flush with the deck
  for (const laneBoundaryX of [-4.5, -1.5, 1.5, 4.5]) {
    bridgeTrimParts.push(
      createDeformedSlabGeometry(
        0.18,
        0.04,
        bridge.halfLength * 2 - 1.2,
        laneBoundaryX,
        0,
        24,
        z => getBridgeDeckHeight(z),
        0.01,
      ),
    )
  }

  // North & South stone threshold sills flush with the terrain road at z = ±24
  for (const zSign of [-1, 1] as const) {
    const sillCenterZ = zSign * (bridge.halfLength + 0.7)
    bridgeTrimParts.push(
      createDeformedSlabGeometry(
        bridge.halfTotalWidth * 2,
        0.16,
        1.6,
        0,
        sillCenterZ,
        2,
        z => getTerrainHeight(0, z),
        -0.075,
      ),
    )
  }

  // 2. Bridge parapets, coping stones, side arch spandrels, piers, and cutwaters.
  for (const side of [-1, 1] as const) {
    const parapetCenterX = side * (bridge.halfClearWidth + bridge.parapetWidth * 0.5)

    // Continuous sloped stone parapet wall following the bridge deck arch
    bridgeStoneParts.push(
      createDeformedSlabGeometry(
        bridge.parapetWidth,
        bridge.parapetHeight,
        bridge.halfLength * 2,
        parapetCenterX,
        0,
        24,
        z => getBridgeDeckHeight(z),
        bridge.parapetHeight * 0.5,
      ),
    )

    // Heavy stone coping cap along the top of the parapet
    bridgeTrimParts.push(
      createDeformedSlabGeometry(
        bridge.parapetWidth + 0.16,
        0.16,
        bridge.halfLength * 2 + 0.3,
        parapetCenterX,
        0,
        24,
        z => getBridgeDeckHeight(z),
        bridge.parapetHeight + 0.04,
      ),
    )

    // Outer stone fascia cornice under the parapet
    bridgeTrimParts.push(
      createDeformedSlabGeometry(
        0.88,
        0.46,
        bridge.halfLength * 2,
        parapetCenterX - side * 0.05,
        0,
        24,
        z => getBridgeDeckHeight(z),
        -0.24,
      ),
    )

    // Periodic stone merlons & pilasters along the parapet
    for (let z = -20; z <= 20; z += 5) {
      const deckY = getBridgeDeckHeight(z)
      bridgeStoneParts.push(
        new THREE.BoxGeometry(bridge.parapetWidth + 0.24, 1.32, 1.1).translate(
          parapetCenterX + side * 0.06,
          deckY + 0.66,
          z,
        ),
      )
    }

    // Flared bridgehead entry pylons at North (z = -24) and South (z = +24) ends
    for (const endSign of [-1, 1] as const) {
      const pylonZ = endSign * (bridge.halfLength - 0.8)
      const deckY = getBridgeDeckHeight(pylonZ)
      bridgeStoneParts.push(
        new THREE.BoxGeometry(1.55, 1.85, 1.8).translate(
          parapetCenterX + side * 0.2,
          deckY + 0.92,
          pylonZ,
        ),
      )
      bridgeTrimParts.push(
        new THREE.BoxGeometry(1.75, 0.24, 2.0).translate(
          parapetCenterX + side * 0.2,
          deckY + 1.92,
          pylonZ,
        ),
      )
    }

    // Heavy stone side piers & triangular cutwaters anchored into the riverbed
    for (const pierZ of bridge.pierZPositions) {
      const deckY = getBridgeDeckHeight(pierZ)
      const pierHeight = deckY - river.riverbedY + 0.2
      const pierCenterY = river.riverbedY + pierHeight * 0.5
      const pierX = side * (bridge.halfTotalWidth + 0.35)
      bridgeTrimParts.push(
        new THREE.BoxGeometry(2.2, pierHeight, 3.6).translate(pierX, pierCenterY, pierZ),
      )
      // Triangular cutwater nose pointing upstream/downstream
      const cutwater = new THREE.CylinderGeometry(1.1, 1.35, pierHeight - 0.15, 4)
      cutwater.rotateY(Math.PI / 4)
      cutwater.scale(1.15, 1, 1.35)
      cutwater.translate(side * (bridge.halfTotalWidth + 1.35), pierCenterY - 0.08, pierZ)
      bridgeStoneParts.push(cutwater)
    }

    // Side bank abutment retaining wing walls at z = ±19.8
    for (const bankSign of [-1, 1] as const) {
      const abutmentZ = bankSign * 19.8
      bridgeTrimParts.push(
        new THREE.BoxGeometry(3.6, 3.4, 2.4).translate(
          side * (bridge.halfTotalWidth + 1.4),
          -1.2,
          abutmentZ,
        ),
      )
    }
  }

  // Full-width stone piers anchored into the riverbed at z = -12, 0, 12
  for (const pierZ of bridge.pierZPositions) {
    const deckY = getBridgeDeckHeight(pierZ)
    const pierHeight = deckY - river.riverbedY + 0.05
    const pierCenterY = river.riverbedY + pierHeight * 0.5
    bridgeTrimParts.push(
      new THREE.BoxGeometry(bridge.halfTotalWidth * 2, pierHeight, 2.8).translate(0, pierCenterY, pierZ),
    )
  }

  // Full-width North & South bank stone abutments at z = ±20.2
  for (const bankSign of [-1, 1] as const) {
    const abutmentZ = bankSign * 20.2
    const deckY = getBridgeDeckHeight(abutmentZ)
    const abutmentHeight = deckY - river.riverbedY + 0.05
    const abutmentCenterY = river.riverbedY + abutmentHeight * 0.5
    bridgeTrimParts.push(
      new THREE.BoxGeometry(bridge.halfTotalWidth * 2 + 0.4, abutmentHeight, 3.4).translate(
        0,
        abutmentCenterY,
        abutmentZ,
      ),
    )
  }

  // Four vaulted stone arch barrels spanning between the piers and bank abutments over open water
  const archSpans: readonly [number, number][] = [
    [-18.8, -13.2],
    [-10.8, -1.2],
    [1.2, 10.8],
    [13.2, 18.8],
  ]
  for (const [spanMinZ, spanMaxZ] of archSpans) {
    const spanCenterZ = (spanMinZ + spanMaxZ) * 0.5
    const spanLenZ = spanMaxZ - spanMinZ
    bridgeStoneParts.push(
      createDeformedSlabGeometry(
        bridge.halfTotalWidth * 2 - 0.15,
        0.28,
        spanLenZ,
        0,
        spanCenterZ,
        10,
        worldZ => {
          const u = THREE.MathUtils.clamp((worldZ - spanCenterZ) / (spanLenZ * 0.5), -1, 1)
          const archRise = (1 - u * u) * 0.88
          return -1.02 + archRise + getBridgeDeckHeight(worldZ) * 0.35
        },
        0,
      ),
    )
  }

  // 3. North Bank military defensive walls (West and East wings with firing steps).
  const wallHalfThick = northDefense.wallThickness * 0.5
  for (const side of [-1, 1] as const) {
    const wingMinX = side < 0 ? -northDefense.wingOuterAbsX : northDefense.centralGapHalfWidth
    const wingMaxX = side < 0 ? -northDefense.centralGapHalfWidth : northDefense.wingOuterAbsX
    const wingWidth = wingMaxX - wingMinX
    const wingCenterX = (wingMinX + wingMaxX) * 0.5

    defenseWallParts.push(
      new THREE.BoxGeometry(wingWidth, northDefense.wallHeight, northDefense.wallThickness).translate(
        wingCenterX,
        northDefense.wallHeight * 0.5 - 0.05,
        northDefense.wallZ,
      ),
    )
    // Stone coping and low embrasure blocks along the breastwork
    for (let x = wingMinX + 2.0; x <= wingMaxX - 2.0; x += 4.0) {
      defenseWallParts.push(
        new THREE.BoxGeometry(1.8, 0.28, northDefense.wallThickness + 0.16).translate(
          x,
          northDefense.wallHeight + 0.08,
          northDefense.wallZ,
        ),
      )
    }
    // Timber firing step / brace along the defender (-Z) face of the wall
    defenseTimberParts.push(
      new THREE.BoxGeometry(wingWidth - 0.8, 0.32, 0.85).translate(
        wingCenterX,
        0.16,
        northDefense.wallZ - wallHalfThick - 0.42,
      ),
    )

    // Central passage bastion pillar
    const innerPillarX = side * (northDefense.centralGapHalfWidth + 0.7)
    defenseWallParts.push(
      new THREE.BoxGeometry(1.8, northDefense.wallHeight + 0.45, northDefense.wallThickness + 0.5).translate(
        innerPillarX,
        (northDefense.wallHeight + 0.45) * 0.5 - 0.05,
        northDefense.wallZ,
      ),
    )

    // Outer angled flank return wall
    const flankX = side * (northDefense.wingOuterAbsX + wallHalfThick)
    const flankZ = northDefense.wallZ - northDefense.flankReturnDepth * 0.5
    defenseWallParts.push(
      new THREE.BoxGeometry(
        northDefense.wallThickness,
        northDefense.wallHeight,
        northDefense.flankReturnDepth + northDefense.wallThickness,
      ).translate(flankX, northDefense.wallHeight * 0.5 - 0.05, flankZ),
    )
  }

  // 4. Riverbank boulders / stones (batched into a single mesh for zero draw-call bloat).
  const random = environmentRandom(9041)
  for (let i = 0; i < 64; i++) {
    const side = i % 2 === 0 ? -1 : 1
    const absX = 12 + random() * 260
    const x = side * absX
    const bankSide = i % 4 < 2 ? -1 : 1
    const zOffset = bankSide * (river.halfChannelWidth - 1.5 + random() * 3.2)
    const z = getRiverCenterZ(x) + zOffset
    const y = getTerrainHeight(x, z) - 0.12
    const radius = 0.38 + random() * 0.55
    const rock = new THREE.DodecahedronGeometry(radius, 0)
    rock.scale(1.2 + random() * 0.4, 0.55 + random() * 0.25, 0.9 + random() * 0.35)
    rock.rotateY(random() * Math.PI * 2)
    rock.translate(x, y, z)
    bankRockParts.push(rock)
  }

  const addMergedMesh = (
    name: string,
    parts: THREE.BufferGeometry[],
    material: THREE.Material,
    castShadow: boolean,
    registerAimHit: boolean,
  ): void => {
    if (parts.length === 0) return
    const merged = mergeGeometries(parts, false)
    parts.forEach(part => part.dispose())
    if (!merged) return
    const mesh = new THREE.Mesh(merged, material)
    mesh.name = name
    mesh.castShadow = castShadow
    mesh.receiveShadow = true
    root.add(mesh)
    if (registerAimHit) {
      obstacleMeshes.push(mesh)
    }
  }

  addMergedMesh('river-bridge-roadway', bridgeRoadParts, roadStoneMaterial, false, true)
  addMergedMesh('river-bridge-masonry', bridgeStoneParts, stoneWallMaterial, true, true)
  addMergedMesh('river-bridge-trim', bridgeTrimParts, darkStoneMaterial, true, true)
  addMergedMesh('river-north-defense-walls', defenseWallParts, stoneWallMaterial, true, true)
  addMergedMesh('river-north-defense-timber', defenseTimberParts, woodMaterial, true, true)
  addMergedMesh('river-bank-boulders', bankRockParts, darkStoneMaterial, false, false)

  // 5. River water surface mesh
  root.add(createRiverWaterMesh())

  // 6. A few scenic riverside pine trees on the outer banks (well outside deployment/staging zones)
  const riversideTrees: readonly [number, number][] = [
    [-78, -28],
    [82, -29],
    [-128, 30],
    [134, 28],
    [-175, -27],
    [180, -31],
  ]
  riversideTrees.forEach(([tx, tz], index) => {
    const ty = getTerrainHeight(tx, tz)
    const tree = createPineVisual(700 + index, false)
    tree.name = `riverbank-pine-${index + 1}`
    tree.position.set(tx, ty, tz)
    root.add(tree)
  })

  return {
    root,
    obstacles,
    obstacleMeshes,
  }
}
