import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { civicHallFromPlan } from '../../src/navigation/CivicExitRoute'
import { LayeredNavigationRoute, type LayeredNavigationRequest } from '../../src/navigation/LayeredNavigationRoute'
import { CIVIC_EXIT_MAX_SPEED, formationArrived, steerCivicExitRider } from '../../src/movement/CivicExitSteering'
import { steerCavalryHeading } from '../../src/movement/ContinuousCavalryCharge'
import { NavigationPathFollower, type NavigationRouteKind } from '../../src/navigation/NavigationPathFollower'
import { NavigationWorld } from '../../src/navigation/NavigationWorld'
import { architectureLocalToWorld, architectureSpec, DEEP, type ArchitectureFaction, type BuildingSpec } from '../../src/town/architecture/ArchitectureSpecs'
import { TOWN_CENTER } from '../../src/town/TownLayout'
import { surfaceBox } from '../../src/town/TownRamparts'
import { findBlockingObstacleAlongPath, getTerrainHeight, resolveObstacleCollision, type ObstacleData } from '../../src/world/Terrain'

type WalkRampSurface = Parameters<typeof surfaceBox>[0]
const SITE = { x: TOWN_CENTER.x, z: TOWN_CENTER.z, yaw: TOWN_CENTER.yaw }
const RIDER_RADIUS = 1, RIDER_HEIGHT = 2.6
/** Snow leopard base speed (m/s); the civic exit paces below it through the doorway. */
const RIDER_BASE_SPEED = 12.8
const DT = 1 / 60
/** Friendly jam length in frames; longer than the stall window so a replan happens while jammed. */
const CROWD_JAM_FRAMES = 300
/** Ramp jam: long enough for a stall replan to fire while the body is on the ramp. */
const RAMP_JAM_FRAMES = 600
const MAX_FRAMES = 900

/** Mirrors placeArchitecture's collision and walk-surface mapping, built from the same plan without meshes. */
function civicObstacles(spec: BuildingSpec, groundY: number): ObstacleData[] {
  const floorTop = groundY + spec.floorY, base = groundY - .6
  const out: ObstacleData[] = []
  for (const c of spec.colliders) {
    const [x0, y0, z0, x1, y1, z1] = c.box
    const a = architectureLocalToWorld(SITE, x0, z0), b = architectureLocalToWorld(SITE, x1, z1)
    const box = new THREE.Box3(new THREE.Vector3(Math.min(a.x, b.x), y0 <= DEEP ? base : groundY + y0, Math.min(a.z, b.z)),
      new THREE.Vector3(Math.max(a.x, b.x), groundY + y1, Math.max(a.z, b.z)))
    const navPassable = c.role === 'roof' || c.role === 'overhead' || c.role === 'post'
    out.push({ box, isBarricade: false, ...(navPassable ? { navigationPassable: true } : {}) })
  }
  for (const rect of spec.floor) {
    const a = architectureLocalToWorld(SITE, (rect.minX + rect.maxX) / 2, rect.minZ)
    const b = architectureLocalToWorld(SITE, (rect.minX + rect.maxX) / 2, rect.maxZ)
    const length = rect.maxZ - rect.minZ
    const walkSurface: WalkRampSurface = { startX: a.x, startZ: a.z, dirX: (b.x - a.x) / length, dirZ: (b.z - a.z) / length,
      halfWidth: (rect.maxX - rect.minX) / 2, length, landing: 0, startY: floorTop, topY: floorTop, mounted: true }
    const box = surfaceBox(walkSurface); box.min.y = base
    out.push({ box, walkSurface, solidBelow: base, isBarricade: false, navigationPassable: true })
  }
  for (const e of [spec.entrance, ...spec.additionalEntrances ?? []]) {
    const start = architectureLocalToWorld(SITE, e.x, e.z)
    const foot = architectureLocalToWorld(SITE, e.x + Math.sin(e.yaw) * e.approach, e.z + Math.cos(e.yaw) * e.approach)
    const footY = getTerrainHeight(foot.x, foot.z) + .03
    if (e.approach <= 0 || Math.abs(floorTop - footY) <= .05) continue
    const length = Math.hypot(start.x - foot.x, start.z - foot.z)
    const ramp: WalkRampSurface = { startX: foot.x, startZ: foot.z, dirX: (start.x - foot.x) / length, dirZ: (start.z - foot.z) / length,
      halfWidth: e.width / 2, length, landing: 0, startY: footY, topY: floorTop, mounted: true }
    const box = surfaceBox(ramp); box.min.y = Math.min(base, footY - .4)
    out.push({ box, walkSurface: ramp, solidBelow: box.min.y, isBarricade: false, navigationPassable: true })
  }
  return out
}

interface Rig { obstacles: ObstacleData[]; world: NavigationWorld; spec: BuildingSpec; groundY: number; threshold: THREE.Vector3; outward: THREE.Vector3 }

function townCenterRig(faction: ArchitectureFaction, civicExit: boolean, extra: ObstacleData[] = []): Rig {
  const spec = architectureSpec(faction, 'town-center')
  const groundY = getTerrainHeight(SITE.x, SITE.z)
  const obstacles = [...civicObstacles(spec, groundY), ...extra]
  const world = new NavigationWorld({ minX: SITE.x - 60, maxX: SITE.x + 60, minZ: SITE.z - 60, maxZ: SITE.z + 60 })
  world.sync(obstacles)
  if (civicExit) world.setCivicHalls([civicHallFromPlan('town-center', spec, SITE, groundY + spec.floorY)])
  const door = architectureLocalToWorld(SITE, spec.entrance.x, spec.entrance.z)
  const beyond = architectureLocalToWorld(SITE, spec.entrance.x, spec.entrance.z + 1)
  const outward = new THREE.Vector3(beyond.x - door.x, 0, beyond.z - door.z).normalize()
  return { obstacles, world, spec, groundY, threshold: new THREE.Vector3(door.x, 0, door.z), outward }
}

const at = (p: THREE.Vector3): string => `(${p.x.toFixed(1)},${p.z.toFixed(1)})`

function localToGround(local: { x: number; z: number }): THREE.Vector3 {
  const p = architectureLocalToWorld(SITE, local.x, local.z)
  return new THREE.Vector3(p.x, getTerrainHeight(p.x, p.z), p.z)
}

interface Trip { reached: boolean; crossedDoor: boolean; crossedFrame: number; handBack: boolean; rampMaxSpeed: number; rampReversed: boolean; civicAfterCompletion: boolean; reenteredFrame: number; bodyInsideOnArrival: boolean; frames: number; stopped: NavigationRouteKind | null; end: string }

interface RideOptions {
  /** Physical-only body across the route (a friendly jam). Never part of the navigation grid. */
  crowd?: ObstacleData[]
  crowdUntilFrame?: number
  /** Initial heading; defaults to facing the first waypoint's direction. */
  yaw?: number
  /** Real orders, issued in sequence once `when` first holds. Each new order changes the command identity. */
  commands?: Array<{ when: (p: THREE.Vector3, frame: number) => boolean; goal: THREE.Vector3; intent?: 'chase' | 'command' }>
  /** An enemy briefly steers its goal elsewhere: no command, so no identity change. */
  enemyDetour?: { fromFrame: number; toFrame: number; goal: THREE.Vector3 }
  /** The body is pursuing combat targets: every request carries the chase intent. */
  chase?: boolean
}

/** One mounted body. Routing comes from production LayeredNavigationRoute (ground follower as fallback),
 * steering from the same helpers the NPC branches call, and collision from the production resolver. */
function ride(rig: Rig, start: THREE.Vector3, goal: THREE.Vector3, options: RideOptions = {}): Trip {
  const { obstacles, world, spec } = rig
  const e = spec.entrance, rampEnd = e.approach + 1
  const layered = new LayeredNavigationRoute(new NavigationPathFollower()), ground = new NavigationPathFollower()
  const out = new THREE.Vector3(), p = start.clone()
  let commanded = goal, identity = 0, nextCommand = 0, intent: 'chase' | 'command' = options.chase ? 'chase' : 'command'
  let crossedFrame = -1, leaving = false, exitCompleted = false, rampReversed = false, civicAfterCompletion = false
  let reenteredFrame = -1, bodyInside = false
  let target = goal, yaw = options.yaw ?? 0, velocityY = 0, onGround = true, crossedDoor = false, handBack = false, rampMaxSpeed = 0
  for (let frame = 0; frame < MAX_FRAMES; frame++) {
    const order = options.commands?.[nextCommand]
    if (order && order.when(p, frame)) { nextCommand++; identity++; commanded = order.goal; intent = order.intent ?? 'command' }
    const detour = options.enemyDetour
    target = detour && frame >= detour.fromFrame && frame < detour.toFrame ? detour.goal : commanded
    world.beginFrame()
    const body = options.crowd && frame < (options.crowdUntilFrame ?? 0) ? [...obstacles, ...options.crowd] : obstacles
    const request: LayeredNavigationRequest = {
      position: p, goal: target, world, outpost: null, currentLayer: 'ground', targetLayer: 'ground', differentLayer: false,
      mounted: true, outpostMounted: true, flying: false, radius: RIDER_RADIUS, height: RIDER_HEIGHT,
      entranceId: null, sectorId: null, actorId: 'civic-exit-test', skipGroundNavigation: false, commandIdentity: identity, movementIntent: intent,
    }
    const step = layered.resolve(request, obstacles, out)
    const route: NavigationRouteKind = step?.route ?? ground.resolveMoveTarget(p, target, world,
      findBlockingObstacleAlongPath(p, target, RIDER_RADIUS, RIDER_HEIGHT, 0, obstacles) !== null, out)
    if (route === 'unreachable') return { reached: false, crossedDoor, handBack, rampMaxSpeed, crossedFrame, rampReversed, civicAfterCompletion, reenteredFrame, bodyInsideOnArrival: bodyInside, frames: frame, stopped: route, end: at(p) }
    // Leaving through the doorway, the ramp band before the safety line must stay under civic steering.
    // Only the outbound leg counts: once the exit completes, any inbound routing is ordinary.
    // The outbound leg ends at its safety line; later civic steps are the return through the doorway.
    if (step?.civicExit && !exitCompleted) leaving = true
    const along = (p.x - rig.threshold.x) * rig.outward.x + (p.z - rig.threshold.z) * rig.outward.z
    if (leaving && along > 0 && along < rampEnd && !step?.civicExit) handBack = true
    const toward = new THREE.Vector3(out.x - p.x, 0, out.z - p.z), distance = toward.length()
    const previous = p.clone()
    if (distance > 1e-4) {
      const desiredYaw = Math.atan2(toward.x, toward.z)
      if (step?.civicExit) {
        const steer = steerCivicExitRider(yaw, desiredYaw, distance, RIDER_BASE_SPEED, DT)
        yaw = steer.yaw
        if (steer.speed > 0) p.addScaledVector(toward.normalize(), Math.min(steer.speed * DT, distance))
      } else {
        yaw = steerCavalryHeading(yaw, desiredYaw, RIDER_BASE_SPEED, DT)
        // Mirrors the NPC ordinary cavalry branch: a heading whose look-ahead endpoint is blocked stops the move.
        const heading = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw))
        const endpoint = p.clone().addScaledVector(heading, RIDER_BASE_SPEED * (DT + .15))
        if (!findBlockingObstacleAlongPath(p, endpoint, RIDER_RADIUS, RIDER_HEIGHT, 0, body)) {
          p.addScaledVector(heading, Math.min(RIDER_BASE_SPEED * DT, distance))
        }
      }
    }
    // Gravity settles on the terrain, not on y = 0; otherwise a body off the ramp sinks below its surface.
    velocityY -= 22 / 60; p.y = Math.max(getTerrainHeight(p.x, p.z), p.y + velocityY / 60)
    const hit = resolveObstacleCollision(p, previous, velocityY, onGround, RIDER_RADIUS, RIDER_HEIGHT, 0, body, { mountedSurfaces: true })
    velocityY = hit.velocityY; onGround = hit.onGround
    const afterMove = (p.x - rig.threshold.x) * rig.outward.x + (p.z - rig.threshold.z) * rig.outward.z
    // Horizontal pace only: ramp snapping changes height, which the pace cap does not govern.
    if (exitCompleted && step?.civicExit) civicAfterCompletion = true
    if (leaving && afterMove > 0 && afterMove < rampEnd) {
      rampMaxSpeed = Math.max(rampMaxSpeed, Math.hypot(p.x - previous.x, p.z - previous.z) / DT)
      // Turning back on the doorway ramp is forbidden: the horizontal step must keep heading outward.
      if ((p.x - previous.x) * rig.outward.x + (p.z - previous.z) * rig.outward.z < -1e-3) rampReversed = true
    }
    if (afterMove >= rampEnd && leaving) { leaving = false; exitCompleted = true }
    if (!crossedDoor && p.clone().sub(rig.threshold).dot(rig.outward) > 0) { crossedDoor = true; crossedFrame = frame }
    bodyInside = afterMove <= -RIDER_RADIUS
    // The return is complete only once the whole body is back inside the doorway.
    if (exitCompleted && reenteredFrame < 0 && bodyInside) reenteredFrame = frame
    // Arrival is the shared formation decision: a committed exit holds it until the ramp is cleared.
    if (formationArrived(Math.hypot(p.x - target.x, p.z - target.z), 1.5, false, step?.civicExit)) return { reached: true, crossedDoor, handBack, rampMaxSpeed, crossedFrame, rampReversed, civicAfterCompletion, reenteredFrame, bodyInsideOnArrival: bodyInside, frames: frame + 1, stopped: null, end: at(p) }
  }
  return { reached: false, crossedDoor, handBack, rampMaxSpeed, crossedFrame, rampReversed, civicAfterCompletion, reenteredFrame, bodyInsideOnArrival: bodyInside, frames: MAX_FRAMES, stopped: null, end: at(p) }
}

/** Enemy positions outside the hall, relative to the front door: in front, beside, and behind the building. */
function outsideGoals(rig: Rig): Record<'front' | 'side' | 'rear', THREE.Vector3> {
  const e = rig.spec.entrance
  return {
    front: localToGround({ x: e.x, z: e.z + e.approach + 10 }),
    side: localToGround({ x: e.x + 14, z: e.z + e.approach }),
    rear: localToGround({ x: 0, z: rig.spec.envelope.minZ - 10 }),
  }
}

function mountedAt(rig: Rig, postId: string): THREE.Vector3 {
  const post = rig.spec.anchors.find(a => a.id === postId)!
  const p = localToGround(post)
  return new THREE.Vector3(p.x, rig.groundY + rig.spec.floorY, p.z)
}

/** Physical box across the route between two local z lines, for a temporary friendly jam. */
function localBox(rig: Rig, halfX: number, zMin: number, zMax: number): ObstacleData {
  const a = architectureLocalToWorld(SITE, -halfX, zMin), b = architectureLocalToWorld(SITE, halfX, zMax)
  return { box: new THREE.Box3(new THREE.Vector3(Math.min(a.x, b.x), rig.groundY, Math.min(a.z, b.z)),
    new THREE.Vector3(Math.max(a.x, b.x), rig.groundY + rig.spec.floorY + RIDER_HEIGHT, Math.max(a.z, b.z))), isBarricade: false }
}

/** Physical box across the front doorway. */
function doorwayBlock(rig: Rig, zOffset: number): ObstacleData {
  const e = rig.spec.entrance
  return localBox(rig, e.doorWidth / 2 + .2, e.z + zOffset, e.z + zOffset + .8)
}

/** Physical box across the ramp near its foot, so the body clears the threshold before it jams. */
function rampBlock(rig: Rig): ObstacleData {
  const e = rig.spec.entrance, mid = e.z + e.approach * .85
  return localBox(rig, e.width / 2 + .2, mid - .3, mid + .3)
}

describe('mounted civic exit from the Town Center', () => {
  // Outside pursuit that rounds a building corner (Roman side wing, Viking rear passage) currently deadlocks
  // under the ordinary cavalry branch's endpoint check. That is outside this doorway exit; not claimed here.
  it('roman: the commander rides out the front door to enemies in front of the hall', () => {
    const rig = townCenterRig('roman', true)
    const start = mountedAt(rig, 'service:commander')
    for (const [name, goal] of Object.entries({ front: outsideGoals(rig).front })) {
      const trip = ride(rig, start, goal)
      expect(trip.reached, `roman ${name}: stopped=${trip.stopped} frames=${trip.frames} end=${trip.end}`).toBe(true)
      expect(trip.crossedDoor, `roman ${name}: must pass the threshold first`).toBe(true)
    }
  })

  it('viking: the sergeant post rides out the front door to enemies in front and beside the hall', () => {
    const rig = townCenterRig('viking', true)
    const start = mountedAt(rig, 'service:deployment')
    const { front, side } = outsideGoals(rig)
    for (const [name, goal] of Object.entries({ front, side })) {
      const trip = ride(rig, start, goal)
      expect(trip.reached, `viking deployment ${name}: stopped=${trip.stopped} frames=${trip.frames} end=${trip.end}`).toBe(true)
      expect(trip.crossedDoor, `viking deployment ${name}: must pass the threshold first`).toBe(true)
    }
  })

  it('viking: the commander post, in front of the front-row posts on the right, rides out to enemies in front and beside', () => {
    const rig = townCenterRig('viking', true)
    const start = mountedAt(rig, 'service:commander')
    const { front, side } = outsideGoals(rig)
    for (const [name, goal] of Object.entries({ front, side })) {
      const trip = ride(rig, start, goal)
      expect(trip.reached, `viking commander ${name}: stopped=${trip.stopped} frames=${trip.frames} end=${trip.end}`).toBe(true)
      expect(trip.crossedDoor, `viking commander ${name}: must pass the threshold first`).toBe(true)
    }
  })

  it('a friendly jam in the doorway longer than the stall window does not fail the exit; it rides out once the jam clears', () => {
    const rig = townCenterRig('viking', true)
    const trip = ride(rig, mountedAt(rig, 'service:commander'), outsideGoals(rig).front,
      { crowd: [doorwayBlock(rig, 0)], crowdUntilFrame: CROWD_JAM_FRAMES })
    expect(trip.stopped, `frames=${trip.frames}`).toBeNull()
    expect(trip.reached, `frames=${trip.frames}`).toBe(true)
    expect(trip.crossedDoor).toBe(true)
  })

  it('a jam on the ramp after the doorframe keeps civic steering until the ramp safety line, then completes', () => {
    const rig = townCenterRig('viking', true)
    const trip = ride(rig, mountedAt(rig, 'service:commander'), outsideGoals(rig).front,
      { crowd: [rampBlock(rig)], crowdUntilFrame: RAMP_JAM_FRAMES })
    expect(trip.handBack, 'ordinary chase took over on the ramp').toBe(false)
    expect(trip.stopped, `frames=${trip.frames}`).toBeNull()
    expect(trip.reached, `frames=${trip.frames} end=${trip.end}`).toBe(true)
    expect(trip.crossedDoor).toBe(true)
  })

  it('a real indoor command issued before the doorway cancels the exit, so the superseded route never carries the rider out', () => {
    const rig = townCenterRig('viking', true)
    const indoor = localToGround({ x: -6, z: -6 })
    const trip = ride(rig, mountedAt(rig, 'service:commander'), outsideGoals(rig).front,
      { commands: [{ when: (_, frame) => frame === 20, goal: indoor }] })
    expect(trip.crossedDoor, `end=${trip.end}`).toBe(false)
  })

  it('an enemy briefly steering into the hall, with no command, keeps the exit to the safety line', () => {
    const rig = townCenterRig('viking', true)
    const trip = ride(rig, mountedAt(rig, 'service:commander'), outsideGoals(rig).front,
      { chase: true, enemyDetour: { fromFrame: 20, toFrame: 400, goal: localToGround({ x: -6, z: -6 }) } })
    // The exit must reach the threshold while the detour is still steering the goal inside.
    expect(trip.crossedFrame, `end=${trip.end}`).toBeGreaterThanOrEqual(0)
    expect(trip.crossedFrame, 'the exit must not stall while the enemy steers inside').toBeLessThan(400)
    expect(trip.handBack).toBe(false)
  })

  it('a command issued on the ramp takes effect at once, but the body never turns back on the ramp and at the safety line heads for the new indoor target', () => {
    const rig = townCenterRig('viking', true)
    // An indoor point the clearance route reaches; points behind the post rows have no route for a radius-1 body.
    const indoor = localToGround({ x: 0, z: 4 })
    const trip = ride(rig, mountedAt(rig, 'service:commander'), outsideGoals(rig).front,
      { commands: [{ when: p => (p.x - rig.threshold.x) * rig.outward.x + (p.z - rig.threshold.z) * rig.outward.z > .3, goal: indoor }] })
    expect(trip.rampReversed, 'turned back on the doorway ramp').toBe(false)
    expect(trip.handBack, 'ordinary chase took over on the ramp').toBe(false)
    expect(trip.crossedDoor).toBe(true)
    expect(trip.reached, `frames=${trip.frames} stopped=${trip.stopped} end=${trip.end}`).toBe(true)
  })

  it('a new indoor formation point within arrival range just past the doorway does not end the exit early', () => {
    const rig = townCenterRig('viking', true)
    const nearIndoor = rig.threshold.clone().addScaledVector(rig.outward, -.8)
    const trip = ride(rig, mountedAt(rig, 'service:commander'), outsideGoals(rig).front,
      { commands: [{ when: p => (p.x - rig.threshold.x) * rig.outward.x + (p.z - rig.threshold.z) * rig.outward.z > .3, goal: nearIndoor }] })
    expect(trip.crossedDoor, `arrived early: end=${trip.end}`).toBe(true)
    // The exit completes first, and only then does the newest indoor command bring the body back in.
    expect(trip.civicAfterCompletion, `end=${trip.end}`).toBe(true)
    expect(trip.handBack).toBe(false)
    expect(trip.rampReversed).toBe(false)
    expect(trip.reached, `frames=${trip.frames} stopped=${trip.stopped} end=${trip.end}`).toBe(true)
    // Arrival counts only once the whole body is back inside, and the crossing happened before arrival.
    expect(trip.bodyInsideOnArrival, `arrived with the body still outside: end=${trip.end}`).toBe(true)
    expect(trip.reenteredFrame, 'the body never crossed back in').toBeGreaterThanOrEqual(0)
    expect(trip.reenteredFrame, 'arrival came before the crossing').toBeLessThan(trip.frames - 1)
  })

  it('an enemy chasing into the hall after the exit never starts the indoor return, which needs a real command', () => {
    const rig = townCenterRig('viking', true)
    const trip = ride(rig, mountedAt(rig, 'service:commander'), outsideGoals(rig).front,
      { chase: true, enemyDetour: { fromFrame: 20, toFrame: 400, goal: localToGround({ x: 0, z: 4 }) } })
    expect(trip.crossedDoor).toBe(true)
    expect(trip.civicAfterCompletion, 'a combat chase took the indoor return branch').toBe(false)
  })

  it('a real indoor command followed by a combat chase order before the safety line cancels the return', () => {
    const rig = townCenterRig('viking', true)
    const trip = ride(rig, mountedAt(rig, 'service:commander'), outsideGoals(rig).front,
      { commands: [
        { when: p => (p.x - rig.threshold.x) * rig.outward.x + (p.z - rig.threshold.z) * rig.outward.z > .3, goal: localToGround({ x: 0, z: 4 }) },
        { when: p => (p.x - rig.threshold.x) * rig.outward.x + (p.z - rig.threshold.z) * rig.outward.z > 1.2, goal: outsideGoals(rig).front, intent: 'chase' },
      ] })
    expect(trip.crossedDoor).toBe(true)
    expect(trip.civicAfterCompletion, 'a superseded indoor order still brought the body back').toBe(false)
  })

  it('a real indoor command followed by an outdoor command before the safety line cancels the return', () => {
    const rig = townCenterRig('viking', true)
    const trip = ride(rig, mountedAt(rig, 'service:commander'), outsideGoals(rig).front,
      { commands: [
        { when: p => (p.x - rig.threshold.x) * rig.outward.x + (p.z - rig.threshold.z) * rig.outward.z > .3, goal: localToGround({ x: 0, z: 4 }) },
        { when: p => (p.x - rig.threshold.x) * rig.outward.x + (p.z - rig.threshold.z) * rig.outward.z > 1.2, goal: outsideGoals(rig).side },
      ] })
    expect(trip.crossedDoor).toBe(true)
    expect(trip.civicAfterCompletion, 'a superseded indoor order still brought the body back').toBe(false)
  })

  it('a new outdoor order after the threshold keeps the committed exit at narrow pace to the safety line', () => {
    const rig = townCenterRig('viking', true)
    const trip = ride(rig, mountedAt(rig, 'service:commander'), outsideGoals(rig).front,
      { commands: [{ when: p => (p.x - rig.threshold.x) * rig.outward.x + (p.z - rig.threshold.z) * rig.outward.z > .3, goal: outsideGoals(rig).front }] })
    expect(trip.handBack, 'a new order took the ramp back from civic steering').toBe(false)
    expect(trip.rampMaxSpeed, `ramp speed ${trip.rampMaxSpeed.toFixed(2)} m/s`).toBeLessThanOrEqual(CIVIC_EXIT_MAX_SPEED + 1e-6)
    expect(trip.reached, `frames=${trip.frames} stopped=${trip.stopped}`).toBe(true)
    expect(trip.crossedDoor).toBe(true)
  })

  it('a commander facing away from the doorway turns in place before stepping toward it', () => {
    const rig = townCenterRig('viking', true)
    const trip = ride(rig, mountedAt(rig, 'service:commander'), outsideGoals(rig).front, { yaw: Math.PI })
    expect(trip.reached, `frames=${trip.frames}`).toBe(true)
    expect(trip.crossedDoor).toBe(true)
  })

  it('a sealed doorway is rejected by the static clearance route at once, so ordinary target fallback runs', () => {
    const probe = townCenterRig('viking', true)
    const rig = townCenterRig('viking', true, [doorwayBlock(probe, -.4)])
    const trip = ride(rig, mountedAt(rig, 'service:commander'), outsideGoals(rig).front)
    expect(trip.stopped).toBe('unreachable')
    expect(trip.frames).toBe(0)
    expect(trip.crossedDoor).toBe(false)
  })
})
