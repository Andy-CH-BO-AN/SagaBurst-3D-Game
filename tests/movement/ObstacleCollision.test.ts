import * as THREE from 'three'
import { describe, expect, it, onTestFinished } from 'vitest'
import { resolveCameraDistance } from '../../src/camera/ThirdPersonCamera'
import { FallingRider, riderFallDamage } from '../../src/movement/FallingRider'
import {
  createRiverCrossingObstacleData,
  FOOT_COLLISION_RADIUS,
  getBridgeDeckHeight,
  getBridgeFiveCavalryLanePositions,
  isPointInRiverChannel,
  MOUNT_COLLISION_RADIUS,
  planNorthBankInfantryDeployment,
  planSouthBankCavalryStaging,
  RIVER_CROSSING_LAYOUT,
} from '../../src/world/RiverCrossingBattlefield'
import {
  findBlockingProjectileObstacleAlongPath,
  getFortifiedCampHeightOffset,
  getTerrainHeight,
  isRiverCrossingTerrainActive,
  PLAYABLE_WORLD_BOUND,
  resolveObstacleCollision,
  setRiverCrossingTerrainActive,
  type ObstacleData,
} from '../../src/world/Terrain'

function deck(y: number): ObstacleData {
  return {
    isBarricade: false,
    box: new THREE.Box3(new THREE.Vector3(-2, y - .35, 0), new THREE.Vector3(2, y, 10)),
    walkSurface: {
      startX: 0, startZ: 0, startY: y, topY: y,
      dirX: 0, dirZ: 1, length: 10, landing: 0, halfWidth: 2, mounted: true,
    },
  }
}

describe('obstacle walk-surface collision', () => {
  it('camera rays use slab slices rather than the empty space inside a sloped envelope', () => {
    const obstacle = deck(6)
    obstacle.box.min.y = 0
    obstacle.projectileBoxes = [new THREE.Box3(new THREE.Vector3(-2, 5.65, 0), new THREE.Vector3(2, 6, 10))]
    expect(resolveCameraDistance(new THREE.Vector3(0, 2, -2), new THREE.Vector3(0, 0, 1), 6, [obstacle])).toBe(6)
    expect(resolveCameraDistance(new THREE.Vector3(0, 5.8, -2), new THREE.Vector3(0, 0, 1), 6, [obstacle])).toBeCloseTo(1.72)
    expect(resolveCameraDistance(new THREE.Vector3(4, 5.8, -2), new THREE.Vector3(0, 0, 1), 6, [obstacle])).toBe(6)
  })

  it('limits overlapping support to one step from the original feet, independent of obstacle order', () => {
    const surfaces = [deck(.6), deck(1.2), deck(6)]
    for (const obstacles of [surfaces, [...surfaces].reverse()]) {
      const position = new THREE.Vector3(0, .98, 5)
      const collision = resolveObstacleCollision(position, new THREE.Vector3(0, 1, 5), -1, false,
        .5, 2, 1, obstacles, { walkSurfaces: true })
      expect(position.y).toBeCloseTo(1.6)
      expect(collision).toEqual({ velocityY: 0, onGround: true })
    }
  })

  it('catches a fast mounted fall only on the deck whose footprint the descent actually crosses', () => {
    const position = new THREE.Vector3(0, 4, 5)
    // The crossing of y=12 is outside the upper deck; y=6 is inside the lower deck.
    const collision = resolveObstacleCollision(position, new THREE.Vector3(-10, 15, 5), -30, false,
      1, 2.6, 0, [deck(12), deck(6)], { mountedSurfaces: true })
    expect(position.toArray()).toEqual([0, 6, 5])
    expect(collision).toEqual({ velocityY: 0, onGround: true })
  })

  it('stops a rising body at the underside without promoting it onto a higher level', () => {
    const position = new THREE.Vector3(0, 5, 5)
    const collision = resolveObstacleCollision(position, new THREE.Vector3(0, 3, 5), 8, false,
      .5, 2, 0, [deck(6), deck(12)], { walkSurfaces: true })
    expect(position.y).toBeCloseTo(3.65)
    expect(collision).toEqual({ velocityY: 0, onGround: false })
  })

  it('discards ramp support when a later wall push moves the body off its edge', () => {
    const wall: ObstacleData = { isBarricade: false,
      box: new THREE.Box3(new THREE.Vector3(-2, 0, 0), new THREE.Vector3(2, 10, 10)) }
    const position = new THREE.Vector3(1.8, 5.98, 5)
    const collision = resolveObstacleCollision(position, new THREE.Vector3(1.8, 6, 5), -1, false,
      .5, 2, 0, [wall, deck(6)], { walkSurfaces: true })
    expect(position.toArray()).toEqual([2.5, 5.98, 5])
    expect(collision).toEqual({ velocityY: -1, onGround: false })
  })

  it('lands an existing falling rider on the actual slope and preserves height-based damage', () => {
    const slope = deck(12)
    slope.walkSurface!.startY = 0
    slope.box.min.y = -.35
    const feet = new THREE.Vector3(0, 10, 5)
    const rider = new FallingRider()
    rider.begin(feet, new THREE.Vector3())
    const height = rider.update(feet, 1, [slope], 500, () => -100)
    expect(feet.toArray()).toEqual([0, 6, 5])
    expect(height).toBe(4)
    expect(riderFallDamage(90, height!)).toBe(24)
    expect(rider.active).toBe(false)
    expect(rider.update(feet, 1, [slope], 500, () => -100)).toBeNull()
  })

  it('supports five-abreast cavalry on the bridge, 200-unit bank deployments, and cross-river projectile/camera clearance', () => {
    const obstacles = createRiverCrossingObstacleData()
    const lanes = getBridgeFiveCavalryLanePositions(0, MOUNT_COLLISION_RADIUS)
    expect(lanes).toHaveLength(5)
    expect(RIVER_CROSSING_LAYOUT.bridge.halfClearWidth * 2).toBeGreaterThanOrEqual(5 * MOUNT_COLLISION_RADIUS * 2)

    for (let i = 0; i < lanes.length; i++) {
      const slot = lanes[i]
      expect(Math.abs(slot.x) + slot.radius).toBeLessThan(RIVER_CROSSING_LAYOUT.bridge.halfClearWidth)
      if (i > 0) {
        expect(slot.x - lanes[i - 1].x).toBeGreaterThanOrEqual(MOUNT_COLLISION_RADIUS * 2)
      }
      const pos = new THREE.Vector3(slot.x, slot.y, slot.z)
      resolveObstacleCollision(pos, pos.clone(), 0, true, slot.radius, 2.6, 0, obstacles, { mountedSurfaces: true })
      expect(pos.x).toBeCloseTo(slot.x)
      expect(pos.z).toBeCloseTo(slot.z)
    }

    // Bridge entrances meet both riverbanks at ground level (y = 0) with no step gap.
    expect(getBridgeDeckHeight(-RIVER_CROSSING_LAYOUT.bridge.halfLength)).toBeCloseTo(0)
    expect(getBridgeDeckHeight(RIVER_CROSSING_LAYOUT.bridge.halfLength)).toBeCloseTo(0)
    expect(isPointInRiverChannel(RIVER_CROSSING_LAYOUT.northDefense.playerSpawn.x, RIVER_CROSSING_LAYOUT.northDefense.playerSpawn.z, MOUNT_COLLISION_RADIUS)).toBe(false)

    // 200 friendly infantry (8 squads × 25) on North Bank & 200 enemy cavalry (100 melee + 100 lance) on South Bank.
    const northSquads = planNorthBankInfantryDeployment()
    const southSquads = planSouthBankCavalryStaging()
    expect(northSquads).toHaveLength(8)
    expect(southSquads).toHaveLength(8)
    const northSlots = northSquads.flatMap(squad => squad.slots)
    const southSlots = southSquads.flatMap(squad => squad.slots)
    expect(northSlots).toHaveLength(200)
    expect(southSlots).toHaveLength(200)
    expect(southSquads.filter(s => s.role === 'melee_cavalry').flatMap(s => s.slots)).toHaveLength(100)
    expect(southSquads.filter(s => s.role === 'lance_cavalry').flatMap(s => s.slots)).toHaveLength(100)

    const assertValidSlots = (slots: typeof northSlots, radius: number, bankSign: -1 | 1): void => {
      let outOfBoundsCount = 0
      let wrongBankCount = 0
      let inRiverCount = 0
      let obstacleOverlapCount = 0
      let minPairDist = Infinity
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i]
        if (Math.abs(s.x) + radius > PLAYABLE_WORLD_BOUND || Math.abs(s.z) + radius > PLAYABLE_WORLD_BOUND) {
          outOfBoundsCount++
        }
        if (Math.sign(s.z) !== bankSign) wrongBankCount++
        if (isPointInRiverChannel(s.x, s.z, radius)) inRiverCount++
        if (obstacles.some(obs =>
          s.x + radius > obs.box.min.x && s.x - radius < obs.box.max.x
          && s.z + radius > obs.box.min.z && s.z - radius < obs.box.max.z)) {
          obstacleOverlapCount++
        }
        for (let j = i + 1; j < slots.length; j++) {
          const other = slots[j]
          const dist = Math.hypot(s.x - other.x, s.z - other.z)
          if (dist < minPairDist) minPairDist = dist
        }
      }
      expect(outOfBoundsCount).toBe(0)
      expect(wrongBankCount).toBe(0)
      expect(inRiverCount).toBe(0)
      expect(obstacleOverlapCount).toBe(0)
      expect(minPairDist).toBeGreaterThanOrEqual(radius * 2)
    }
    assertValidSlots(northSlots, FOOT_COLLISION_RADIUS, -1)
    assertValidSlots(southSlots, MOUNT_COLLISION_RADIUS, 1)

    // Arrows/javelins and camera rays pass freely across the river, while parapets and defensive walls block projectiles.
    expect(findBlockingProjectileObstacleAlongPath(new THREE.Vector3(35, 1.5, -28), new THREE.Vector3(35, 1.5, 28), obstacles)).toBeNull()
    expect(resolveCameraDistance(new THREE.Vector3(35, 2.0, -24), new THREE.Vector3(0, 0, 1), 8, obstacles)).toBe(8)
    expect(findBlockingProjectileObstacleAlongPath(new THREE.Vector3(0, 0.9, 0), new THREE.Vector3(12, 0.9, 0), obstacles)).not.toBeNull()
    expect(findBlockingProjectileObstacleAlongPath(new THREE.Vector3(-25, 0.8, -56), new THREE.Vector3(-25, 0.8, -64), obstacles)).not.toBeNull()
  })

  it('isolates river crossing terrain height policy from default, fortified camp, town, and outpost scenes', () => {
    onTestFinished(() => setRiverCrossingTerrainActive(false))
    expect(isRiverCrossingTerrainActive()).toBe(false)

    const samplePoints: readonly [number, number][] = [
      [0, 0],
      [60, 0],
      [0, -24],
      [0, 24],
      [0, -144],
      [0, 144],
      [-120, 85],
    ]
    const baselineHeights = samplePoints.map(([x, z]) => getTerrainHeight(x, z))
    const romanCampOffset = getFortifiedCampHeightOffset(0, -144, 'roman')
    const vikingCampOffset = getFortifiedCampHeightOffset(0, 144, 'viking')

    setRiverCrossingTerrainActive(true)
    expect(isRiverCrossingTerrainActive()).toBe(true)
    expect(getTerrainHeight(0, 0)).toBeCloseTo(RIVER_CROSSING_LAYOUT.bridge.archCrownHeight)
    expect(getTerrainHeight(60, 0)).toBeCloseTo(RIVER_CROSSING_LAYOUT.river.riverbedY)
    expect(getTerrainHeight(0, -RIVER_CROSSING_LAYOUT.bridge.halfLength)).toBeCloseTo(0)
    expect(getTerrainHeight(0, RIVER_CROSSING_LAYOUT.bridge.halfLength)).toBeCloseTo(0)

    setRiverCrossingTerrainActive(false)
    expect(isRiverCrossingTerrainActive()).toBe(false)
    samplePoints.forEach(([x, z], index) => {
      expect(getTerrainHeight(x, z)).toBe(baselineHeights[index])
    })
    expect(getFortifiedCampHeightOffset(0, -144, 'roman')).toBe(romanCampOffset)
    expect(getFortifiedCampHeightOffset(0, 144, 'viking')).toBe(vikingCampOffset)
  })

})
