import * as THREE from 'three'
import { describe, expect, it, onTestFinished } from 'vitest'
import { resolveCameraDistance } from '../../src/camera/ThirdPersonCamera'
import { FallingRider, riderFallDamage } from '../../src/movement/FallingRider'
import {
  createRiverCrossingObstacleData,
  findRiverBridgeDeckHit,
  FOOT_COLLISION_RADIUS,
  getBridgeDeckHeight,
  getBridgeFiveCavalryLanePositions,
  getRiverCrossingMeshTerrainHeight,
  isPointInRiverChannel,
  MOUNT_COLLISION_RADIUS,
  planNorthBankInfantryDeployment,
  planSouthBankCavalryStaging,
  RIVER_CROSSING_LAYOUT,
  settleRiverCrossingDrowning,
  shouldDrownInRiverCrossing,
} from '../../src/world/RiverCrossingBattlefield'
import {
  findBlockingObstacleAlongPath,
  findBlockingProjectileObstacleAlongPath,
  getBaseProceduralTerrainHeight,
  getFortifiedCampHeightOffset,
  getTerrainHeight,
  isRiverCrossingTerrainActive,
  isSceneRiverCrossing,
  PLAYABLE_WORLD_BOUND,
  resetTerrainScenePolicy,
  resolveObstacleCollision,
  setRiverCrossingTerrainActive,
  setSceneRiverCrossing,
  type ObstacleData,
} from '../../src/world/Terrain'
import { initializeTownWorldTerrain } from '../../src/town/TownWorld'

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
    onTestFinished(() => resetTerrainScenePolicy())
    setRiverCrossingTerrainActive(true)
    const obstacles = createRiverCrossingObstacleData()
    for (const sampleZ of [-14, 0, 14]) {
      const lanes = getBridgeFiveCavalryLanePositions(sampleZ, MOUNT_COLLISION_RADIUS)
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
      let heightMismatchCount = 0
      let nonFlatTerrainCount = 0
      let minPairDist = Infinity
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i]
        if (Math.abs(s.x) + radius > PLAYABLE_WORLD_BOUND || Math.abs(s.z) + radius > PLAYABLE_WORLD_BOUND) {
          outOfBoundsCount++
        }
        if (Math.sign(s.z) !== bankSign) wrongBankCount++
        if (isPointInRiverChannel(s.x, s.z, radius)) inRiverCount++
        if (Math.abs(s.y - getTerrainHeight(s.x, s.z)) > 1e-6) heightMismatchCount++
        if (Math.abs(s.y) > 0.1) nonFlatTerrainCount++
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
      expect(heightMismatchCount).toBe(0)
      expect(nonFlatTerrainCount).toBeGreaterThan(0)
      expect(minPairDist).toBeGreaterThanOrEqual(radius * 2)
    }
    assertValidSlots(northSlots, FOOT_COLLISION_RADIUS, -1)
    assertValidSlots(southSlots, MOUNT_COLLISION_RADIUS, 1)
    assertValidSlots(planSouthBankCavalryStaging(230).flatMap(squad => squad.slots), MOUNT_COLLISION_RADIUS, 1)

    // Arrows/javelins and camera rays pass freely across the river, while parapets, outer/lower bridge piers, and defensive walls block projectiles.
    expect(findBlockingProjectileObstacleAlongPath(new THREE.Vector3(35, 1.5, -28), new THREE.Vector3(35, 1.5, 28), obstacles)).toBeNull()
    expect(resolveCameraDistance(new THREE.Vector3(35, 2.0, -24), new THREE.Vector3(0, 0, 1), 8, obstacles)).toBe(8)
    expect(findBlockingProjectileObstacleAlongPath(new THREE.Vector3(0, 0.9, 0), new THREE.Vector3(12, 0.9, 0), obstacles)).not.toBeNull()
    // Outer/low stone pier segments (|x| in [9.4, 10.7], y < 0) block projectiles and camera rays without narrowing the 16.8m roadway.
    expect(findBlockingProjectileObstacleAlongPath(new THREE.Vector3(-10.2, -1.0, -5), new THREE.Vector3(-10.2, -1.0, 5), obstacles)).not.toBeNull()
    expect(findBlockingProjectileObstacleAlongPath(new THREE.Vector3(10.2, -1.0, -19), new THREE.Vector3(10.2, -1.0, -9), obstacles)).not.toBeNull()
    expect(resolveCameraDistance(new THREE.Vector3(-14, -1.0, 0), new THREE.Vector3(1, 0, 0), 8, obstacles)).toBeLessThan(4)
    expect(findBlockingProjectileObstacleAlongPath(new THREE.Vector3(-25, 0.8, -56), new THREE.Vector3(-25, 0.8, -64), obstacles)).not.toBeNull()
  })

  it('isolates river crossing terrain height policy, carves under-bridge mesh riverbed, and drowns units entering the river immediately', () => {
    onTestFinished(() => resetTerrainScenePolicy())
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
    const directTownWatchtower = initializeTownWorldTerrain()
    const romanCampOffset = getFortifiedCampHeightOffset(0, -144, 'roman')
    const vikingCampOffset = getFortifiedCampHeightOffset(0, 144, 'viking')

    const scene = {}
    setSceneRiverCrossing(scene, true)
    expect(isSceneRiverCrossing(scene)).toBe(true)
    expect(isRiverCrossingTerrainActive()).toBe(true)
    expect(getTerrainHeight(0, 0)).toBeCloseTo(RIVER_CROSSING_LAYOUT.bridge.archCrownHeight)
    expect(getTerrainHeight(60, 0)).toBeCloseTo(RIVER_CROSSING_LAYOUT.river.riverbedY)
    expect(getTerrainHeight(0, -RIVER_CROSSING_LAYOUT.bridge.halfLength)).toBeCloseTo(0)
    expect(getTerrainHeight(0, RIVER_CROSSING_LAYOUT.bridge.halfLength)).toBeCloseTo(0)

    // Under the bridge (z = 0, x = 0), rendered terrain mesh is carved to the riverbed (-3.2m < waterSurfaceY = -1.15m),
    // while getTerrainHeight(0, 0) remains the walkable bridge deck (0.45m) and findRiverBridgeDeckHit resolves bridge aiming.
    expect(getRiverCrossingMeshTerrainHeight(0, 0, getBaseProceduralTerrainHeight(0, 0))).toBeCloseTo(RIVER_CROSSING_LAYOUT.river.riverbedY)
    expect(getRiverCrossingMeshTerrainHeight(0, 0, getBaseProceduralTerrainHeight(0, 0))).toBeLessThan(RIVER_CROSSING_LAYOUT.river.waterSurfaceY)
    const bridgeAimRay = new THREE.Ray(new THREE.Vector3(0, 8, -10), new THREE.Vector3(0, -1, 1).normalize())
    const bridgeHit = findRiverBridgeDeckHit(bridgeAimRay)
    expect(bridgeHit).not.toBeNull()
    expect(bridgeHit!.hitPoint.y).toBeCloseTo(getBridgeDeckHeight(bridgeHit!.hitPoint.z), 2)

    // River blockers remain solid for navigation/path blocking, but physicalPassable allows units jumping/walking into the river to fall in and drown.
    const obstacles = createRiverCrossingObstacleData()
    expect(findBlockingObstacleAlongPath(new THREE.Vector3(35, 0, -26), new THREE.Vector3(35, 0, 26), 0.5, 2.3, 0, obstacles)).not.toBeNull()
    const intoRiverPos = new THREE.Vector3(35, 0.95, 0)
    resolveObstacleCollision(intoRiverPos, new THREE.Vector3(35, 0.95, -24), 0, false, 0.38, 1.9, 0.95, obstacles, { walkSurfaces: true })
    expect(intoRiverPos.x).toBeCloseTo(35)
    expect(intoRiverPos.z).toBeCloseTo(0)

    // Instant drowning policy checks: bridge deck, dry bank, and high-altitude eagle do NOT drown; water contact drowns immediately.
    expect(shouldDrownInRiverCrossing(0, getBridgeDeckHeight(0), 0)).toBe(false)
    expect(shouldDrownInRiverCrossing(24, 0, -32)).toBe(false)
    expect(shouldDrownInRiverCrossing(30, 8.0, 0)).toBe(false)
    expect(shouldDrownInRiverCrossing(30, RIVER_CROSSING_LAYOUT.river.waterSurfaceY, 0)).toBe(true)
    expect(shouldDrownInRiverCrossing(0, RIVER_CROSSING_LAYOUT.river.waterSurfaceY - 0.1, 0)).toBe(true)

    let playerDeaths = 0
    let mountedNpcDeaths = 0
    let footNpcDeaths = 0
    let playerMountDeaths = 0
    let npcMountDeaths = 0
    let soloMountDeaths = 0

    const makeMockMount = (x: number, y: number, z: number, onDeath: () => void, isFlyingMount = false) => {
      const mount = {
        dead: false,
        disposed: false,
        maxHp: 120,
        currentHp: 120,
        isFlyingMount,
        group: { position: new THREE.Vector3(x, y, z) },
        riderPlayer: null as any,
        riderNpc: null as any,
        takeDamage(amount: number) {
          if (this.dead) return false
          this.currentHp = Math.max(0, this.currentHp - amount)
          if (this.currentHp <= 0) {
            this.dead = true
            this.riderPlayer?.dismountFromMount?.()
            this.riderNpc?.dismountFromMount?.()
            onDeath()
          }
          return true
        },
      }
      return mount
    }

    const playerMount = makeMockMount(28, RIVER_CROSSING_LAYOUT.river.waterSurfaceY - 0.05, 0, () => { playerMountDeaths++ })
    const mockPlayer = {
      dead: false,
      spectatorOnly: false,
      isMounted: true,
      currentMount: playerMount as any,
      maxHp: 100,
      position: new THREE.Vector3(28, RIVER_CROSSING_LAYOUT.river.waterSurfaceY + 0.9, 0),
      dismountFromMount() {
        if (!this.currentMount) return
        this.currentMount.riderPlayer = null
        this.currentMount = null
        this.isMounted = false
      },
      takeFallDamage(amount: number) {
        if (this.dead || amount <= 0) return false
        this.dead = true
        playerDeaths++
        return true
      },
    }
    playerMount.riderPlayer = mockPlayer

    const npcMount = makeMockMount(-28, RIVER_CROSSING_LAYOUT.river.waterSurfaceY - 0.2, 0, () => { npcMountDeaths++ })
    const mountedNpc = {
      dead: false,
      hp: 100,
      maxHp: 100,
      isMounted: true,
      mount: npcMount as any,
      position: new THREE.Vector3(-28, RIVER_CROSSING_LAYOUT.river.waterSurfaceY, 0),
      dismountFromMount() {
        if (!this.mount) return
        this.mount.riderNpc = null
        this.mount = null
        this.isMounted = false
      },
      takeFallDamage(amount: number) {
        if (this.dead || amount <= 0) return false
        this.hp = 0
        this.dead = true
        mountedNpcDeaths++
        return true
      },
    }
    npcMount.riderNpc = mountedNpc

    const footNpcInWater = {
      dead: false,
      hp: 80,
      maxHp: 80,
      isMounted: false,
      mount: null,
      position: new THREE.Vector3(22, RIVER_CROSSING_LAYOUT.river.waterSurfaceY, 0),
      dismountFromMount() {},
      takeFallDamage(amount: number) {
        if (this.dead || amount <= 0) return false
        this.hp = 0
        this.dead = true
        footNpcDeaths++
        return true
      },
    }

    const bridgeNpc = {
      dead: false,
      hp: 80,
      maxHp: 80,
      isMounted: false,
      mount: null,
      position: new THREE.Vector3(0, getBridgeDeckHeight(0), 0),
      dismountFromMount() {},
      takeFallDamage() { this.dead = true; return true },
    }

    const soloCorgiInWater = makeMockMount(34, RIVER_CROSSING_LAYOUT.river.waterSurfaceY - 0.1, 0, () => { soloMountDeaths++ })
    const airborneEagleOverWater = makeMockMount(34, 10, 0, () => { soloMountDeaths++ }, true)

    const drownedCount = settleRiverCrossingDrowning(
      mockPlayer,
      [mountedNpc, footNpcInWater, bridgeNpc],
      [playerMount, npcMount, soloCorgiInWater, airborneEagleOverWater],
      { setFill() {} },
    )
    expect(drownedCount).toBe(6)
    expect(mockPlayer.dead).toBe(true)
    expect(mockPlayer.isMounted).toBe(false)
    expect(playerMount.dead).toBe(true)
    expect(mountedNpc.dead).toBe(true)
    expect(mountedNpc.isMounted).toBe(false)
    expect(npcMount.dead).toBe(true)
    expect(footNpcInWater.dead).toBe(true)
    expect(soloCorgiInWater.dead).toBe(true)
    expect(bridgeNpc.dead).toBe(false)
    expect(airborneEagleOverWater.dead).toBe(false)
    expect([playerDeaths, mountedNpcDeaths, footNpcDeaths, playerMountDeaths, npcMountDeaths, soloMountDeaths]).toEqual([1, 1, 1, 1, 1, 1])

    // Repeated settlement on already-drowned units does not re-trigger death callbacks.
    expect(settleRiverCrossingDrowning(
      mockPlayer,
      [mountedNpc, footNpcInWater, bridgeNpc],
      [playerMount, npcMount, soloCorgiInWater, airborneEagleOverWater],
      { setFill() {} },
    )).toBe(0)
    expect([playerDeaths, mountedNpcDeaths, footNpcDeaths, playerMountDeaths, npcMountDeaths, soloMountDeaths]).toEqual([1, 1, 1, 1, 1, 1])

    // Entering Town via the production TownWorld initialization path resets River Crossing BEFORE computing commandWatchtower layout.
    const townWatchtowerFromRiver = initializeTownWorldTerrain({ userData: {} })
    expect(isRiverCrossingTerrainActive()).toBe(false)
    expect(townWatchtowerFromRiver.groundY).toBe(directTownWatchtower.groundY)
    expect(townWatchtowerFromRiver.entrance.startY).toBe(directTownWatchtower.entrance.startY)
    expect(townWatchtowerFromRiver.entrance.topY).toBe(directTownWatchtower.entrance.topY)
    expect(townWatchtowerFromRiver.platformY).toBe(directTownWatchtower.platformY)
    expect(townWatchtowerFromRiver.entrance.startY).toBeCloseTo(
      getTerrainHeight(townWatchtowerFromRiver.entrance.startX, townWatchtowerFromRiver.entrance.startZ) + 0.03,
    )
    expect(findRiverBridgeDeckHit(bridgeAimRay)).toBeNull()
    expect(shouldDrownInRiverCrossing(30, RIVER_CROSSING_LAYOUT.river.waterSurfaceY, 0)).toBe(false)
    samplePoints.forEach(([x, z], index) => {
      expect(getTerrainHeight(x, z)).toBe(baselineHeights[index])
    })
    expect(getFortifiedCampHeightOffset(0, -144, 'roman')).toBe(romanCampOffset)
    expect(getFortifiedCampHeightOffset(0, 144, 'viking')).toBe(vikingCampOffset)
  })

})
