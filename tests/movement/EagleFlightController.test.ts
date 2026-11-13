import assert from 'node:assert/strict'
import { Box3, Euler, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { EagleFlightController, parseEagleFlightSnapshot, type EagleFlightIntent } from '../../src/movement/EagleFlightController'
import { EagleFlightAI, type EagleFlightCommand } from '../../src/movement/EagleFlightAI'
import { XONGKORO } from '../../src/movement/XongkoroConfig'
import { isEaglePadArrived } from '../../src/world/EaglePadArrival'
import { Player } from '../../src/player/Player'
import { Mount, MountState } from '../../src/world/Mount'
import type { CombatActorRef } from '../../src/combat/CombatAttribution'
import type { ObstacleData } from '../../src/world/Terrain'

interface EaglePort {
  group: { position: Vector3; rotation: Euler }
  flight: EagleFlightController
  isFlyingMount: boolean; isAirborne: boolean; dead: boolean; disposed: boolean
  state: MountState; currentHp: number
  riderPlayer: RiderPort | null; riderNpc: null; riderFaction: null
  combatOwner?: CombatActorRef
  setPlayerRider(player: RiderPort): void
  releaseRider(): void
  alignGroundFlightHeading(): void
  setFlightIntent(intent: EagleFlightIntent): void
}
interface RiderPort {
  isDead: boolean; dead: boolean; isFalling: boolean; spectatorOnly: boolean; isMounted: boolean
  currentMount: EaglePort | null; facingYaw: number; characterFaction: 'roman'
  group: { position: Vector3; rotation: Euler }
  fallFeet: Vector3; velY: number
  rig: { equipmentGripFrames: object }
  animator: { setLocomotion(): void }
  dismountFromMount(options?: { preserveWorldPosition?: boolean }): void
  setMountedHeading(heading: number): void
  syncMountTransform(): void
  _characterYaw(heading: number): number
  _alignExternalVisualToMount(): void
}
// Narrow ports invoke the real boarding/detach methods; model and animation
// boundaries are inert. No Player, Mount, scene graph or asset is constructed.
const methods = { player: Player.prototype, mount: Mount.prototype } as unknown as {
  player: {
    mountVehicle(this: RiderPort, mount: EaglePort, heading?: number): void
    dismountFromMount(this: RiderPort, options?: { preserveWorldPosition?: boolean }): void
    setMountedHeading(this: RiderPort, heading: number): void
  }
  mount: {
    setPlayerRider(this: EaglePort, player: RiderPort): void
    releaseRider(this: EaglePort): void
    alignGroundFlightHeading(this: EaglePort): void
    setFlightIntent(this: EaglePort, intent: EagleFlightIntent): void
  }
}
function parkedEagle() {
  const flight = new EagleFlightController()
  const eagle: EaglePort = {
    group: { position: new Vector3(), rotation: new Euler() }, flight,
    isFlyingMount: true, get isAirborne() { return flight.phase !== 'grounded' },
    dead: false, disposed: false, state: MountState.IDLE, currentHp: 127,
    riderPlayer: null, riderNpc: null, riderFaction: null,
    setPlayerRider: methods.mount.setPlayerRider,
    releaseRider: methods.mount.releaseRider,
    alignGroundFlightHeading: methods.mount.alignGroundFlightHeading,
    setFlightIntent: methods.mount.setFlightIntent,
  }
  const rider: RiderPort = {
    isDead: false, dead: false, isFalling: false, spectatorOnly: false, isMounted: false,
    currentMount: null, facingYaw: Math.PI / 2, characterFaction: 'roman',
    group: { position: new Vector3(), rotation: new Euler() }, fallFeet: new Vector3(), velY: 0,
    rig: { equipmentGripFrames: {} }, animator: { setLocomotion() {} },
    dismountFromMount: methods.player.dismountFromMount,
    setMountedHeading: methods.player.setMountedHeading,
    syncMountTransform() {}, _characterYaw(heading) { return heading }, _alignExternalVisualToMount() {},
  }
  return { eagle, rider, flight }
}
const flatGround = () => 0
const rearWall: ObstacleData = { isBarricade: false,
  box: new Box3(new Vector3(-20, 0, -10), new Vector3(20, 20, -8)) }

function step(eagle: EaglePort, obstacles: ObstacleData[]) {
  eagle.flight.update(eagle.group.position, eagle.group.rotation, .1, obstacles, 3000, flatGround)
}

describe('Eagle flight boarding clearance', () => {
  it('keeps one landed eagle flight controller flyable after remount and checkpoint reload', () => {
    const { eagle, rider, flight } = parkedEagle()
    // Exercise initial boarding, an ordinary remount, and a remount after
    // checkpoint reload. These are the distinct state boundaries; extra full
    // flights repeat the same transition. Wall clearance is covered below.
    const obstacles: ObstacleData[] = []
    assert.equal(flight.canLand(eagle.group.position, obstacles, flatGround, 3000), true)
    methods.player.mountVehicle.call(rider, eagle)
    for (let cycle = 0; cycle < 3; cycle++) {
      assert.equal(rider.currentMount, eagle)
      assert.equal(eagle.group.rotation.y, 0)
      assert.deepEqual([flight.intent.yaw, flight.intent.pitch, flight.intent.brake, flight.intent.takeoff], [0, 0, false, false])
      flight.setIntent({ yaw: 0, pitch: 0, takeoff: true })
      step(eagle, obstacles)
      assert.equal(flight.snapshot().phase, 'takeoff')
      for (let frame = 0; frame < 80 && flight.phase !== 'cruise'; frame++) step(eagle, obstacles)
      assert.equal(flight.snapshot().phase, 'cruise')
      flight.setIntent({ yaw: 0, pitch: -.45, brake: true })
      for (let frame = 0; frame < 120 && flight.phase !== 'grounded'; frame++) step(eagle, obstacles)
      assert.deepEqual(flight.snapshot(), { phase: 'grounded', yaw: 0, pitch: 0, bank: 0, speed: 0,
        velocity: { x: 0, y: 0, z: 0 } })
      // Detaching preserves the world pose; the seat/ground-position search is
      // an unchanged collision boundary and is not part of boarding heading.
      rider.dismountFromMount({ preserveWorldPosition: true })
      assert.equal(eagle.riderPlayer, null)
      assert.equal(rider.currentMount, null)
      if (cycle === 1) {
        const saved = parseEagleFlightSnapshot(JSON.parse(JSON.stringify(flight.snapshot())))!
        flight.restore(saved)
      }
      methods.player.mountVehicle.call(rider, eagle)
    }
    flight.setIntent({ yaw: 0, pitch: 0, takeoff: true })
    step(eagle, obstacles)
    assert.equal(flight.snapshot().phase, 'takeoff')
    assert.equal(eagle.flight, flight)
    assert.equal(eagle.currentHp, 127)
  })

  it('still blocks takeoff when an explicitly requested heading puts the wings into a wall', () => {
    const { eagle, rider, flight } = parkedEagle()
    methods.player.mountVehicle.call(rider, eagle, Math.PI / 2)
    expect(eagle.group.rotation.y).toBe(Math.PI / 2)
    flight.setIntent({ yaw: Math.PI / 2, pitch: 0, takeoff: true })
    step(eagle, [rearWall])
    expect(flight.phase).toBe('grounded')
    expect(eagle.group.position).toEqual(new Vector3())
    expect(flight.velocity.length()).toBe(0)
  })
})

/** The real pilot steering the real controller; only terrain and time are fixed. */
function pilotedEagle(position: Vector3, yaw = 0) {
  const pilot = new EagleFlightAI(), flight = new EagleFlightController(), rotation = new Euler(0, yaw, 0)
  const obstacles: ObstacleData[] = []
  let elapsed = 0
  const advance = (command: EagleFlightCommand) => {
    flight.setIntent(pilot.update(.1, flight, position, command, [], obstacles, 3000, flatGround))
    flight.update(position, rotation, .1, obstacles, 3000, flatGround)
    elapsed += .1
  }
  // Read through the snapshot: the controller mutates its phase behind TypeScript's narrowing.
  return { pilot, flight, position, obstacles, advance, get elapsed() { return elapsed },
    get phase() { return flight.snapshot().phase } }
}
const pad = { x: 60, z: 40, yaw: Math.PI / 2 }
const returnToPad = (): EagleFlightCommand => ({ kind: 'return', destination: new Vector3(pad.x, 0, pad.z), landingYaw: pad.yaw, vertical: true })
const arrived = (eagle: ReturnType<typeof pilotedEagle>) => isEaglePadArrived({ position: eagle.position,
  flight: eagle.flight.snapshot(), pad, groundHeight: 0, clear: true })

describe('Vertical private-eagle pad takeoff and landing', () => {
  it('lifts on the spot, then flies back from cruise and settles near-vertically onto the assigned pad', () => {
    const eagle = pilotedEagle(new Vector3())
    const follow: EagleFlightCommand = { kind: 'follow', destination: new Vector3(0, 0, 220), vertical: true }
    eagle.advance(follow)
    expect([eagle.phase, eagle.flight.speed]).toEqual(['takeoff', 0])
    while (eagle.phase === 'takeoff' && eagle.elapsed < 10) eagle.advance(follow)
    // Forward speed is only gained above the pad clearance, never as a ground roll.
    expect(eagle.phase).toBe('cruise')
    expect(eagle.position.y).toBeGreaterThanOrEqual(XONGKORO.verticalTakeoffHeight)
    expect(Math.hypot(eagle.position.x, eagle.position.z)).toBeLessThan(.5)
    while (eagle.elapsed < 12) eagle.advance(follow)
    expect(eagle.position.y).toBeGreaterThan(25)
    expect(eagle.position.z).toBeGreaterThan(60)

    const dismissedAt = eagle.elapsed, order = returnToPad()
    let lowDrift = 0
    while (eagle.phase !== 'grounded' && eagle.elapsed - dismissedAt < 60) {
      eagle.advance(order)
      // Below the alignment hold the eagle may only sink, not glide across the pad.
      if (eagle.position.y < XONGKORO.verticalHoldHeight - .5) lowDrift = Math.max(lowDrift, Math.hypot(eagle.position.x - pad.x, eagle.position.z - pad.z))
    }
    expect(arrived(eagle)).toBe(true)
    expect(lowDrift).toBeLessThan(1)
    expect(eagle.elapsed - dismissedAt).toBeLessThan(40)
  })

  it('aborts a settle whose pad column becomes blocked, keeps flying, and lands once it clears', () => {
    const eagle = pilotedEagle(new Vector3(pad.x - 70, 30, pad.z), Math.PI / 2)
    eagle.flight.phase = 'cruise'; eagle.flight.speed = XONGKORO.cruiseSpeed
    const order = returnToPad()
    while (eagle.phase !== 'landing' && eagle.elapsed < 20) eagle.advance(order)
    expect(eagle.phase).toBe('landing')
    eagle.obstacles.push({ isBarricade: false,
      box: new Box3(new Vector3(pad.x - 3, 0, pad.z - 3), new Vector3(pad.x + 3, 4, pad.z + 3)) })
    const blockedAt = eagle.elapsed
    let lowest = Infinity
    while (eagle.elapsed - blockedAt < 20) {
      eagle.advance(order)
      lowest = Math.min(lowest, eagle.position.y)
      expect(eagle.phase).not.toBe('grounded')
      expect(eagle.phase).not.toBe('landing')
    }
    // It left the column under power instead of hovering over, or sinking into, the blockage.
    expect(lowest).toBeGreaterThan(15)
    expect(eagle.flight.speed).toBeGreaterThan(XONGKORO.minimumSpeed - .5)
    eagle.obstacles.length = 0
    const clearedAt = eagle.elapsed
    while (eagle.phase !== 'grounded' && eagle.elapsed - clearedAt < 60) eagle.advance(order)
    expect(arrived(eagle)).toBe(true)
  })
})
