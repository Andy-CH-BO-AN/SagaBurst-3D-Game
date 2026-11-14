import { PLAYER_RADIUS } from '../../src/movement/MovementBalance'
import { crossedPrisonExit, prisonOutcome } from '../../src/career/CareerPrisonBreak'
import { prisonExitObstacles, prisonExitPlan, prisonFormation, prisonGateObstacle, prisonExitDestination, PRISON_NAV_CELL_SIZE } from '../../src/arena/PrisonBreakLayout'
import { NavigationWorld } from '../../src/navigation/NavigationWorld'
import { arenaTrialSlotClear } from '../../src/arena/ArenaTrialFormation'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  COLOSSEUM, colosseumNormal, colosseumPoint, createColosseumObstacles,
} from '../../src/arena/ColosseumLayout'
import { createValhallaObstacles } from '../../src/arena/ValhallaLayout'
import { ArenaChaseRoute, ArenaSupportTracker, arenaStairLinks, arenaStandingFeet } from '../../src/arena/DuelArenaChase'
import { ARENA_DUEL_REFEREE_SLOTS } from '../../src/arena/DuelArenaVenue'
import { arenaDuelPartyPlan } from '../../src/arena/CareerDuelArenaScene'
import { FallingRider } from '../../src/movement/FallingRider'
import { ARENA_GROUND_FALL_POLICY, groundFallDamage, GroundFallTracker } from '../../src/movement/GroundFall'
import { Player } from '../../src/player/Player'
import {
  claimFlatTerrainOverride, getFlatTerrainOverride, getTerrainHeight,
  releaseFlatTerrainOverride, resetTerrainScenePolicy, resolveObstacleCollision,
} from '../../src/world/Terrain'

// Numeric layout data only: no scene, mesh, material or arena visuals are built.
const PLAYER = { radius: 0.38, height: 1.9 }

describe('duel arena layout collision', () => {
  it('resumes a saved ground fall with its own apex, so a mid-air reload still lands for the full height', () => {
    const fresh = new GroundFallTracker()
    fresh.observe(18, true)
    fresh.observe(18, false)
    fresh.observe(2, false)
    const saved = fresh.apex!
    expect(saved).toBe(18)
    const resumed = new GroundFallTracker()
    resumed.restore(saved)
    expect(resumed.observe(0, true)).toBe(18)
    expect(groundFallDamage(150, 18, ARENA_GROUND_FALL_POLICY)).toBe(150)
    // A scene reset without the saved fall is exactly what used to erase it.
    const reset = new GroundFallTracker()
    reset.reset()
    expect(reset.observe(0, true)).toBeNull()
    const cleared = new GroundFallTracker()
    cleared.restore(Number.NaN)
    expect(cleared.apex).toBeNull()
  })

  it('lets a jump over the outer parapet complete a lethal fall to the outside ground without an invisible wall', () => {
    const obstacles = createColosseumObstacles()
    const theta = -Math.PI / 2 + 0.3
    const normal = colosseumNormal(theta)
    // Feet just above the parapet coping with a running jump's outward velocity.
    const feet = colosseumPoint(theta, 37.7)
    feet.y = 19.05
    const rider = new FallingRider({ radius: PLAYER.radius, height: PLAYER.height })
    rider.begin(feet, new THREE.Vector3(normal.x * 8, 4, normal.z * 8))
    const tracker = new GroundFallTracker()
    tracker.observe(19, true)
    let landed: number | null = null
    let trackedHeight: number | null = null
    for (let frame = 0; frame < 300 && landed === null; frame++) {
      landed = rider.update(feet, 1 / 60, obstacles, 500, () => COLOSSEUM.groundY)
      trackedHeight = tracker.observe(feet.y, landed !== null)
    }
    expect(feet.y).toBe(0)
    // Landed beyond the outer facade on open ground: nothing stopped the outward flight.
    const outward = (feet.x - colosseumPoint(theta, 38).x) * normal.x + (feet.z - colosseumPoint(theta, 38).z) * normal.z
    expect(outward).toBeGreaterThan(5)
    expect(landed).toBeGreaterThanOrEqual(15)
    expect(trackedHeight).toBeCloseTo(landed!, 1)
    expect(groundFallDamage(150, trackedHeight!, ARENA_GROUND_FALL_POLICY)).toBe(150)
    // Low falls stay harmless; mid falls scale linearly.
    expect(groundFallDamage(150, ARENA_GROUND_FALL_POLICY.safeHeight - 0.5, ARENA_GROUND_FALL_POLICY)).toBe(0)
    const midDamage = groundFallDamage(150, 10.5, ARENA_GROUND_FALL_POLICY)
    expect(midDamage).toBeGreaterThan(0)
    expect(midDamage).toBeLessThan(150)
  })

  it('hands an airborne ground-mount fall to the dismounted rider and keeps grounded dismounts harmless', () => {
    // Narrow ports drive the real Player mount/dismount methods; no Player, Mount or scene is constructed.
    const methods = Player.prototype as unknown as {
      mountVehicle(this: object, mount: object, heading?: number): void
      dismountFromMount(this: object, options?: { preserveWorldPosition?: boolean }): void
      setMountedHeading(this: object, heading: number): void
    }
    const horse = {
      group: { position: new THREE.Vector3(0, 21.2, 0), rotation: new THREE.Euler() },
      isFlyingMount: false, isAirborne: false, dead: false, disposed: false, riderNpc: null, riderPlayer: null as object | null,
      onGround: false, velY: -9,
      setPlayerRider(player: object) { this.riderPlayer = player },
      releaseRider() { this.riderPlayer = null },
    }
    const rider = {
      unarmedDuelOnly: false, isDead: false, isFalling: false, spectatorOnly: false, isMounted: false, onGround: true,
      currentMount: null as typeof horse | null, facingYaw: 0, velY: 0,
      group: { position: new THREE.Vector3(), rotation: new THREE.Euler() }, fallFeet: new THREE.Vector3(),
      rig: { equipmentGripFrames: {} }, animator: { setLocomotion() {} },
      footGroundFall: new GroundFallTracker(), mountGroundFall: new GroundFallTracker(),
      setMountedHeading: methods.setMountedHeading,
      _characterYaw: (heading: number) => heading, _alignExternalVisualToMount() {},
    }
    const ride = () => {
      methods.mountVehicle.call(rider, horse)
      rider.mountGroundFall.observe(19.2, true) // Grounded on the gallery: nothing in progress.
      rider.mountGroundFall.observe(horse.group.position.y, false) // Ridden off the parapet, still high.
    }
    ride()
    // A repeated mountVehicle() for the mount already ridden keeps the fall in progress.
    methods.mountVehicle.call(rider, horse)
    expect(rider.mountGroundFall.observe(0, true)).toBeCloseTo(21.2)
    ride()
    // E pressed mid-fall: the rider keeps falling at the mount's speed from the gallery apex.
    methods.dismountFromMount.call(rider)
    expect([rider.currentMount, rider.onGround, rider.velY]).toEqual([null, false, -9])
    expect(rider.group.position.y).toBeCloseTo(21.2 + 0.95, 5) // At the mount's feet plus half height, never teleported.
    const landing = rider.footGroundFall.observe(0, true)!
    expect(landing).toBeCloseTo(21.2)
    expect(groundFallDamage(150, landing, ARENA_GROUND_FALL_POLICY)).toBe(150)
    // Catching the mount again mid-air does not erase the fall either.
    rider.footGroundFall.observe(18, false)
    rider.onGround = false
    horse.onGround = false
    methods.mountVehicle.call(rider, horse)
    expect(rider.mountGroundFall.observe(0, true)).toBeCloseTo(21.2)
    // A dismount on solid ground clears both trackers and the vertical speed.
    methods.dismountFromMount.call(rider)
    horse.onGround = true
    ride()
    horse.velY = 0
    methods.dismountFromMount.call(rider)
    expect([rider.velY, rider.footGroundFall.observe(0, true), rider.mountGroundFall.observe(0, true)]).toEqual([0, null, null])
  })

  it('lets only the arena that owns the flat-ground policy release it, so a late dispose keeps the newer arena', () => {
    resetTerrainScenePolicy()
    const procedural = getTerrainHeight(140, 90)
    expect(Math.abs(procedural)).toBeGreaterThan(0.01)
    const colosseum = {}, valhalla = {}
    claimFlatTerrainOverride(colosseum, 0)
    claimFlatTerrainOverride(valhalla, 0) // A → B: the second arena replaces the first.
    releaseFlatTerrainOverride(colosseum) // The replaced arena disposes late.
    expect([getFlatTerrainOverride(), getTerrainHeight(140, 90)]).toEqual([0, 0])
    releaseFlatTerrainOverride(valhalla) // Leaving the last arena restores the battlefield.
    expect([getFlatTerrainOverride(), getTerrainHeight(140, 90)]).toEqual([null, procedural])
    releaseFlatTerrainOverride(valhalla)
    expect(getFlatTerrainOverride()).toBeNull()
  })

  it('keeps a pursuer on its chosen stair until the far end instead of ending the route mid-flight', () => {
    const route = new ArenaChaseRoute('roman-colosseum')
    expect(route.next({ x: 0, y: 0, z: 9 }, { x: 3, y: 0, z: -4 })).toBeNull()
    const player = { x: 9.5, y: 17.9, z: 36 } // Top gallery above the +Z stair.
    const link = arenaStairLinks('roman-colosseum').find(candidate => candidate.low.x === 9.5 && candidate.low.z > 0)!
    const approach = route.next({ x: 0, y: 0, z: 9 }, player)!
    expect(approach.x).toBeCloseTo(9.5)
    expect(approach.z).toBeLessThan(link.low.z) // In front of the flight, never beside its solid sides.
    const mouth = route.next({ x: approach.x, y: 0, z: approach.z }, player)!
    expect(mouth.z).toBeGreaterThan(link.low.z)
    // Drifting back past the approach radius does not flip the target back and forth.
    expect(route.next({ x: 9.5, y: 0, z: approach.z - 1.5 }, player)).toEqual(mouth)
    // Halfway up (1.3 m, already "raised") the route still climbs to the landing.
    for (const y of [0.6, 1.3, 2.2]) expect(route.next({ x: 9.5, y, z: (link.low.z + link.high.z) / 2 }, player), `y ${y}`).toEqual(link.high)
    expect(route.active).toBe(true)
    // At the landing, ordinary pursuit takes over for the continuous stands.
    expect(route.next({ x: 9.5, y: 2.6, z: link.high.z + 0.3 }, player)).toBeNull()
    expect(route.active).toBe(false)
    // Coming down, the landing end is the entry and the sand end the exit, even below 1.2 m.
    expect(route.next({ x: 9.5, y: 2.6, z: link.high.z - 0.5 }, { x: 0, y: 0, z: 0 })).toEqual(link.low)
    expect(route.next({ x: 9.5, y: 0.8, z: (link.low.z + link.high.z) / 2 }, { x: 0, y: 0, z: 0 })).toEqual(link.low)
    // The target climbing back up re-plans from the flight: the chaser turns to the landing.
    expect(route.next({ x: 9.5, y: 1.3, z: (link.low.z + link.high.z) / 2 }, player)).toEqual(link.high)
    route.reset()
    const hall = new ArenaChaseRoute('viking-valhalla')
    const dais = { x: 0, y: 3, z: 31 }
    const [throne] = arenaStairLinks('viking-valhalla')
    hall.next({ x: 0, y: 0, z: 0 }, dais)
    expect(hall.next({ x: 0, y: 0, z: throne.low.z - 1 }, dais)!.z).toBeGreaterThan(throne.low.z)
    expect(hall.next({ x: 0, y: 1.5, z: (throne.low.z + throne.high.z) / 2 }, dais)).toEqual(throne.high)
    expect(hall.next({ x: 0, y: 3, z: throne.high.z + 0.2 }, dais)).toBeNull()
    // Standing on the landing beside its far end never re-opens the route frame to frame.
    for (const x of [1.1, 1.2, 1.3]) expect([hall.next({ x, y: 3, z: throne.high.z + 0.1 }, dais), hall.active]).toEqual([null, false])
  })

  it('judges a rider by its ground mount, not by pelvis height, so a floor-level rider is never sent up the stairs', () => {
    const riderPelvis = { x: 0, y: 2.6, z: 5 } // Seat height: far above the 1.2 m raised threshold
    const floorMount = { x: 0, y: 0, z: 5 }
    for (const id of ['roman-colosseum', 'viking-valhalla'] as const) {
      const raised = arenaStairLinks(id)[0].topY
      expect(new ArenaChaseRoute(id).next({ x: 0, y: 0, z: -4 }, arenaStandingFeet(riderPelvis, floorMount, 0.95)), id).toBeNull()
      expect(new ArenaChaseRoute(id).next({ x: 0, y: 0, z: -4 }, arenaStandingFeet({ ...riderPelvis, y: raised + 1.6 }, { ...floorMount, y: raised }, 0.95)), id).not.toBeNull()
    }
    expect(arenaStandingFeet({ x: 1, y: 0.95, z: 2 }, null, 0.95)).toEqual({ x: 1, y: 0, z: 2 })
  })

  it('keeps the support level while airborne: a floor jump never reads as raised, a dais jump stays raised, and countdown preserves support', () => {
    const floor = new ArenaSupportTracker()
    floor.observe({ x: 0, y: 0, z: 5 }, true)
    const jump = floor.observe({ x: 0, y: 4.7, z: 5 }, false) // Mounted jump apex, above both raised levels
    expect([jump.y, new ArenaChaseRoute('viking-valhalla').next({ x: 0, y: 0, z: -4 }, jump)]).toEqual([0, null])

    const dais = new ArenaSupportTracker()
    for (const z of [30, 31, 32]) dais.observe({ x: 0, y: 3, z }, true) // PREPARING: walking on the dais, no chase yet
    const leap = dais.observe({ x: 0, y: 4.5, z: 32 }, false)
    expect(new ArenaChaseRoute('viking-valhalla').next({ x: 0, y: 0, z: -4 }, leap)).not.toBeNull()
    expect(leap.y).toBe(3)
    expect(dais.observe({ x: 0, y: 0, z: 20 }, true).y).toBe(0) // Landing on the floor updates the level.
  })

  it('builds the bodies each saved duel borrowed and keeps the referee off the obstacles beside the duel lane', () => {
    const base = { duelCaptainActorId: 'captain', duelMode: 'armed' as const }
    expect(arenaDuelPartyPlan({ ...base, duelPresetId: 'roman_sword_cavalry', duelTier: 2, duelOpponentActorId: 'cavalry-training:melee_cavalry:0', duelRefereeActorId: 'captain' }))
      .toEqual({ opponent: 'ordinary', opponentBorrowsMount: true, referee: 'captain', captain: false })
    expect(arenaDuelPartyPlan({ ...base, duelPresetId: 'roman_horse_archer', duelTier: 4, duelOpponentActorId: 'ranger', duelRefereeActorId: 'captain' }))
      .toEqual({ opponent: 'ranger', opponentBorrowsMount: false, referee: 'captain', captain: false })
    expect(arenaDuelPartyPlan({ ...base, duelPresetId: 'viking_berserker', duelTier: 4, duelOpponentActorId: 'captain', duelRefereeActorId: 'ranger' }))
      .toEqual({ opponent: 'captain', opponentBorrowsMount: true, referee: 'ranger', captain: false })
    expect(arenaDuelPartyPlan({ ...base, duelPresetId: 'viking_heavy_cavalry', duelTier: 5, duelOpponentActorId: 'commander', duelRefereeActorId: 'captain' }))
      .toEqual({ opponent: 'commander', opponentBorrowsMount: false, referee: 'captain', captain: false })
    expect(arenaDuelPartyPlan({ ...base, duelMode: 'unarmed', duelPresetId: 'roman_sword_cavalry', duelTier: 1, duelOpponentActorId: 'soldier', duelRefereeActorId: 'captain' }).opponentBorrowsMount).toBe(false)
    const shell = { colosseum: createColosseumObstacles(), valhalla: createValhallaObstacles() }
    for (const [id, obstacles] of [['roman-colosseum', shell.colosseum], ['viking-valhalla', shell.valhalla]] as const) {
      const slot = ARENA_DUEL_REFEREE_SLOTS[id]
      const point = new THREE.Vector3(slot.x, slot.y + 0.9, slot.z)
      expect(obstacles.some(obstacle => !obstacle.walkSurface && obstacle.box.clone().expandByScalar(0.5).containsPoint(point)), id).toBe(false)
      expect(Math.abs(slot.x)).toBeGreaterThan(5) // Beside, never inside, the player/opponent lane.
    }
  })
})


it('關押場景可分開部署 5 或 10 名看守，側牆仍阻擋且不移除原場景碰撞資料', () => {
  for (const [id, shell] of [['roman-colosseum', createColosseumObstacles()], ['viking-valhalla', createValhallaObstacles()]] as const) {
    const originalLength = shell.length
    const obstacles = prisonExitObstacles(id, shell), gate = prisonExitPlan(id)
    const blocked = [...obstacles, prisonGateObstacle(id)]
    for (const count of [5, 10] as const) {
      const formation = prisonFormation(id, count)
      expect(formation.enemy).toHaveLength(count)
      const slots = [formation.player, ...formation.friendly, ...formation.enemy]
      expect(slots.filter(slot => !arenaTrialSlotClear(slot.x, slot.z, 0, blocked)), id).toEqual([])
      let closest = Infinity
      for (let i = 0; i < slots.length; i++) for (let j = i + 1; j < slots.length; j++)
        closest = Math.min(closest, Math.hypot(slots[i].x - slots[j].x, slots[i].z - slots[j].z))
      expect(closest, `${id} ${count} guards`).toBeGreaterThan(2)
    }
    expect(arenaTrialSlotClear(3, gate.gateZ - .3, 0, obstacles)).toBe(false)
    expect(shell).toHaveLength(originalLength)
  }
})


it('兩場景開門後 ±1.05 可穿越並結算、±1.25 被門框擋住，關門時中央與門邊皆無法穿越', () => {
  for (const [id, shell] of [['roman-colosseum', createColosseumObstacles()], ['viking-valhalla', createValhallaObstacles()]] as const) {
    const gate = prisonExitPlan(id), obstacles = prisonExitObstacles(id, shell)
    for (const open of [true, false]) for (const x of [-1.25, -1.05, 0, 1.05, 1.25]) {
      const from = new THREE.Vector3(x, .95, gate.gateZ + 1), to = new THREE.Vector3(x, .95, gate.crossingZ - .2)
      const collision = open ? obstacles : [...obstacles, prisonGateObstacle(id)]
      resolveObstacleCollision(to, from, 0, true, PLAYER_RADIUS, 1.9, .95, collision, { walkSurfaces: true })
      const passes = open && Math.abs(x) <= 1.05
      if (passes) expect(to.x).toBeCloseTo(x)
      else expect(to.z, `${id}: ${open ? '開門門框' : '關門'} x=${x}`).toBeGreaterThan(gate.crossingZ)
      const crossed = crossedPrisonExit(id, from, to)
      expect(crossed).toBe(passes)
      expect(prisonOutcome({ playerDead: false, friendlyAlive: 0, gateOpen: open, playerCrossed: crossed, friendlyCrossed: false })).toBe(passes ? 'victory' : null)
    }
    const outside = gate.halfWidth - PLAYER_RADIUS + .01
    expect(crossedPrisonExit(id, { x: outside, y: .95, z: gate.gateZ + 1 }, { x: outside, y: .95, z: gate.crossingZ - 1 })).toBe(false)
    expect(crossedPrisonExit(id, { x: 0, y: .95, z: gate.crossingZ - .1 }, { x: 0, y: .95, z: gate.crossingZ - 1 })).toBe(false)
  }
})

it('兩場景開門後的友軍步兵導航穿過實際門洞，門楣不封住地面路徑且抵達點越過出口', () => {
  for (const [id, shell] of [['roman-colosseum', createColosseumObstacles()], ['viking-valhalla', createValhallaObstacles()]] as const) {
    const gate = prisonExitPlan(id), obstacles = prisonExitObstacles(id, shell), destination = prisonExitDestination(id)
    // Same cell size and alignment as the host, bounded to the door's numeric neighborhood.
    const nav = new NavigationWorld({ minX: -10, maxX: 10, minZ: -44, maxZ: -10, cellSize: PRISON_NAV_CELL_SIZE })
    nav.sync(obstacles); nav.beginFrame()
    const position = new THREE.Vector3(4, 0, gate.gateZ + 4)
    const route = nav.queryPath(position, destination)
    expect(route.status, id).toBe('path')
    if (route.status !== 'path') throw new Error(`${id} 出口無導航路徑`)
    let crossed = false
    for (const target of [...nav.grid.pathToWorld(route.path), destination]) {
      const previous = position.clone()
      position.copy(target)
      resolveObstacleCollision(position, previous, 0, true, .5, 2.3, 0, obstacles, { walkSurfaces: true })
      expect(position.distanceTo(target), JSON.stringify({ id, previous, target, position })).toBeLessThan(.01)
      crossed ||= crossedPrisonExit(id, { x: previous.x, y: previous.y + .95, z: previous.z }, { x: position.x, y: position.y + .95, z: position.z })
    }
    expect(crossed, id).toBe(true)
    expect(position.z, id).toBeLessThan(gate.crossingZ - .4)
  }
})
