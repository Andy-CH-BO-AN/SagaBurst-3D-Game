import * as THREE from 'three'
import { expect, it, onTestFinished } from 'vitest'
import { resolveCameraDistance } from '../../src/camera/ThirdPersonCamera'
import {
  NavigationWorld,
} from '../../src/navigation/NavigationWorld'
import { initializeTownWorldTerrain } from '../../src/town/TownWorld'
import {
  createRiverCrossingObstacleData,
  findRiverBridgeDeckHit,
  FOOT_COLLISION_RADIUS,
  getBridgeDeckHeight,
  getBridgeFiveCavalryLanePositions,
  getRiverCenterZ,
  getRiverCrossingMeshTerrainHeight,
  isPointInRiverChannel,
  MOUNT_COLLISION_RADIUS,
  planNorthBankInfantryDeployment,
  planSouthBankCavalryStaging,
  RIVER_CROSSING_LAYOUT,
  settleRiverCrossingDrowning,
  type DrownablePlayerLike,
  type DrownableNpcLike,
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
  type ObstacleData
} from '../../src/world/Terrain'

it('routes North and South bank paths exclusively through the five-lane bridge and blocks river or map-edge crossings', () => {
    const obstacles = createRiverCrossingObstacleData()
    const world = new NavigationWorld({
      minX: -PLAYABLE_WORLD_BOUND,
      maxX: PLAYABLE_WORLD_BOUND,
      // Keep both full-width river edges and the bridge/banks; distant staging
      // fields do not participate in this crossing/reconnection contract.
      minZ: -48,
      maxZ: 48,
      cellSize: 2,
    }, 4)
    world.rebuild(obstacles)
    world.beginFrame()

    const northPoint = new THREE.Vector3(-34, 0, -36)
    const southPoint = new THREE.Vector3(34, 0, 40)
    expect(world.areConnected(northPoint, southPoint)).toBe(true)

    // Direct off-bridge river crossings and map-edge river cells are blocked.
    for (const sampleX of [-PLAYABLE_WORLD_BOUND + 1, -140, -32, 32, 140, PLAYABLE_WORLD_BOUND - 1]) {
      const riverCell = world.grid.worldToCell({ x: sampleX, z: getRiverCenterZ(sampleX) })
      expect(riverCell).not.toBeNull()
      expect(world.grid.isBlocked(riverCell!)).toBe(true)
      expect(
        findBlockingObstacleAlongPath(
          new THREE.Vector3(sampleX, 0, -35),
          new THREE.Vector3(sampleX, 0, 35),
          0.5,
          2.3,
          0,
          obstacles,
        ),
      ).not.toBeNull()
    }

    // Both North -> South and South -> North paths pass through the bridge corridor.
    const northToSouth = world.queryPath(northPoint, southPoint)
    const southToNorth = world.queryPath(southPoint, northPoint)
    expect(northToSouth.status).toBe('path')
    expect(southToNorth.status).toBe('path')
    for (const result of [northToSouth, southToNorth]) {
      if (result.status !== 'path') continue
      const riverCrossingPoints = result.path
        .map(cell => world.grid.cellToWorld(cell))
        .filter(point => Math.abs(point.z) <= 16)
      expect(riverCrossingPoints.length).toBeGreaterThan(0)
      const maxAbsX = Math.max(...riverCrossingPoints.map(point => Math.abs(point.x)))
      expect(maxAbsX).toBeLessThan(RIVER_CROSSING_LAYOUT.bridge.halfClearWidth)
    }

    // Sealing the bridge corridor disconnects the banks completely (proving zero edge or river shortcuts).
    world.rebuild([
      ...obstacles,
      obstacle(-RIVER_CROSSING_LAYOUT.bridge.halfTotalWidth, -4, RIVER_CROSSING_LAYOUT.bridge.halfTotalWidth, 4),
    ])
    expect(world.areConnected(northPoint, southPoint)).toBe(false)
  })

function obstacle(
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
): ObstacleData {
  return {
    box: new THREE.Box3(
      new THREE.Vector3(minX, 0, minZ),
      new THREE.Vector3(maxX, 3, maxZ),
    ),
    isBarricade: true,
  }
}

it('五騎並排通過橋面時不被欄杆擠開，橋樑兩端與岸邊沒有階差', () => {
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
})

it('岸邊部署保留完整步兵與騎兵容量，所有位置合法且互不重疊', () => {
  onTestFinished(() => resetTerrainScenePolicy())
  setRiverCrossingTerrainActive(true)
  const obstacles = createRiverCrossingObstacleData()
  expect(isPointInRiverChannel(RIVER_CROSSING_LAYOUT.northDefense.playerSpawn.x, RIVER_CROSSING_LAYOUT.northDefense.playerSpawn.z, MOUNT_COLLISION_RADIUS)).toBe(false)
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
  assertValidSlots(planSouthBankCavalryStaging(230, 6).flatMap(squad => squad.slots), MOUNT_COLLISION_RADIUS, 1)
})

it('河面不遮擋投射物與相機，但橋上欄杆及水下橋墩仍阻擋射線', () => {
  onTestFinished(() => resetTerrainScenePolicy())
  setRiverCrossingTerrainActive(true)
  const obstacles = createRiverCrossingObstacleData()
  // Arrows/javelins and camera rays pass freely across the river, while parapets, outer/lower bridge piers, and defensive walls block projectiles.
  expect(findBlockingProjectileObstacleAlongPath(new THREE.Vector3(35, 1.5, -28), new THREE.Vector3(35, 1.5, 28), obstacles)).toBeNull()
  expect(resolveCameraDistance(new THREE.Vector3(35, 2.0, -24), new THREE.Vector3(0, 0, 1), 8, obstacles)).toBe(8)
  expect(findBlockingProjectileObstacleAlongPath(new THREE.Vector3(0, 0.9, 0), new THREE.Vector3(12, 0.9, 0), obstacles)).not.toBeNull()
  // Outer/low stone pier segments (|x| in [9.4, 10.7], y < 0) block projectiles and camera rays without narrowing the 16.8m roadway.
  expect(findBlockingProjectileObstacleAlongPath(new THREE.Vector3(-10.2, -1.0, -5), new THREE.Vector3(-10.2, -1.0, 5), obstacles)).not.toBeNull()
  expect(findBlockingProjectileObstacleAlongPath(new THREE.Vector3(10.2, -1.0, -19), new THREE.Vector3(10.2, -1.0, -9), obstacles)).not.toBeNull()
  expect(resolveCameraDistance(new THREE.Vector3(-14, -1.0, 0), new THREE.Vector3(1, 0, 0), 8, obstacles)).toBeLessThan(4)
  // North defense obstacles removed: path across former wall line is unobstructed
  expect(findBlockingProjectileObstacleAlongPath(new THREE.Vector3(-25, 0.8, -56), new THREE.Vector3(-25, 0.8, -64), obstacles)).toBeNull()
})

it('進入河流場景後由正式 Town 初始化還原地形與瞭望塔高度', () => {
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
  expect(shouldDrownInRiverCrossing(30, RIVER_CROSSING_LAYOUT.river.waterSurfaceY, 0)).toBe(false)
  samplePoints.forEach(([x, z], index) => {
    expect(getTerrainHeight(x, z)).toBe(baselineHeights[index])
  })
  expect(getFortifiedCampHeightOffset(0, -144, 'roman')).toBe(romanCampOffset)
  expect(getFortifiedCampHeightOffset(0, 144, 'viking')).toBe(vikingCampOffset)
})

it('可行走橋面保留拱頂與岸邊高度，橋下河床數值低於水面', () => {
  onTestFinished(() => resetTerrainScenePolicy())
  setRiverCrossingTerrainActive(true)
  expect(getTerrainHeight(0, 0)).toBeCloseTo(RIVER_CROSSING_LAYOUT.bridge.archCrownHeight)
  expect(getTerrainHeight(60, 0)).toBeCloseTo(RIVER_CROSSING_LAYOUT.river.riverbedY)
  expect(getTerrainHeight(0, -RIVER_CROSSING_LAYOUT.bridge.halfLength)).toBeCloseTo(0)
  expect(getTerrainHeight(0, RIVER_CROSSING_LAYOUT.bridge.halfLength)).toBeCloseTo(0)

  // Under the bridge (z = 0, x = 0), rendered terrain mesh is carved to the riverbed (-3.2m < waterSurfaceY = -1.15m),
  // while getTerrainHeight(0, 0) remains the walkable bridge deck (0.45m) and findRiverBridgeDeckHit resolves bridge aiming.
  expect(getRiverCrossingMeshTerrainHeight(0, 0, getBaseProceduralTerrainHeight(0, 0))).toBeCloseTo(RIVER_CROSSING_LAYOUT.river.riverbedY)
  expect(getRiverCrossingMeshTerrainHeight(0, 0, getBaseProceduralTerrainHeight(0, 0))).toBeLessThan(RIVER_CROSSING_LAYOUT.river.waterSurfaceY)
})

it('橋面選點射線命中橋面而非河床，切回 Town 後不再命中', () => {
  onTestFinished(() => resetTerrainScenePolicy())
  setRiverCrossingTerrainActive(true)
  const bridgeAimRay = new THREE.Ray(new THREE.Vector3(0, 8, -10), new THREE.Vector3(0, -1, 1).normalize())
  const bridgeHit = findRiverBridgeDeckHit(bridgeAimRay)
  expect(bridgeHit).not.toBeNull()
  expect(bridgeHit!.hitPoint.y).toBeCloseTo(getBridgeDeckHeight(bridgeHit!.hitPoint.z), 2)
  initializeTownWorldTerrain({ userData: {} })
  expect(findRiverBridgeDeckHit(bridgeAimRay)).toBeNull()
})

it('河道阻擋導航但不以隱形牆攔住落水身體', () => {
  onTestFinished(() => resetTerrainScenePolicy())
  setRiverCrossingTerrainActive(true)
  // River blockers remain solid for navigation/path blocking, but physicalPassable allows units jumping/walking into the river to fall in and drown.
  const obstacles = createRiverCrossingObstacleData()
  expect(findBlockingObstacleAlongPath(new THREE.Vector3(35, 0, -26), new THREE.Vector3(35, 0, 26), 0.5, 2.3, 0, obstacles)).not.toBeNull()
  const intoRiverPos = new THREE.Vector3(35, 0.95, 0)
  resolveObstacleCollision(intoRiverPos, new THREE.Vector3(35, 0.95, -24), 0, false, 0.38, 1.9, 0.95, obstacles, { walkSurfaces: true })
  expect(intoRiverPos.x).toBeCloseTo(35)
  expect(intoRiverPos.z).toBeCloseTo(0)
})

it('落水判定以水面接觸為界，橋面、乾岸與高空角色不溺水', () => {
  onTestFinished(() => resetTerrainScenePolicy())
  setRiverCrossingTerrainActive(true)
  // Instant drowning policy checks: bridge deck, dry bank, and high-altitude eagle do NOT drown; water contact drowns immediately.
  expect(shouldDrownInRiverCrossing(0, getBridgeDeckHeight(0), 0)).toBe(false)
  expect(shouldDrownInRiverCrossing(24, 0, -32)).toBe(false)
  expect(shouldDrownInRiverCrossing(30, 8.0, 0)).toBe(false)
  expect(shouldDrownInRiverCrossing(30, RIVER_CROSSING_LAYOUT.river.waterSurfaceY, 0)).toBe(true)
  expect(shouldDrownInRiverCrossing(0, RIVER_CROSSING_LAYOUT.river.waterSurfaceY - 0.1, 0)).toBe(true)
})

/** 僅準備生命與上下馬依賴；是否溺水、結算順序與冪等性全部由 production owner 決定。 */
function drowningParty() {
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
      riderPlayer: null as (DrownablePlayerLike & { dismountFromMount(): void }) | null,
      riderNpc: null as (DrownableNpcLike & { dismountFromMount(): void }) | null,
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
    currentMount: playerMount as typeof playerMount | null,
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
    mount: npcMount as typeof npcMount | null,
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
  return {
    mockPlayer, playerMount, mountedNpc, npcMount, footNpcInWater, bridgeNpc, soloCorgiInWater, airborneEagleOverWater,
    deaths: () => [playerDeaths, mountedNpcDeaths, footNpcDeaths, playerMountDeaths, npcMountDeaths, soloMountDeaths],
  }
}

it('溺水同時結算玩家、騎士與坐騎且只致死一次，橋上角色與空中巨鷹維持存活', () => {
  onTestFinished(() => resetTerrainScenePolicy())
  setRiverCrossingTerrainActive(true)
  const { mockPlayer, playerMount, mountedNpc, npcMount, footNpcInWater, bridgeNpc, soloCorgiInWater, airborneEagleOverWater, deaths } = drowningParty()
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
  expect(deaths()).toEqual([1, 1, 1, 1, 1, 1])

  // Repeated settlement on already-drowned units does not re-trigger death callbacks.
  expect(settleRiverCrossingDrowning(
    mockPlayer,
    [mountedNpc, footNpcInWater, bridgeNpc],
    [playerMount, npcMount, soloCorgiInWater, airborneEagleOverWater],
    { setFill() {} },
  )).toBe(0)
  expect(deaths()).toEqual([1, 1, 1, 1, 1, 1])
})
