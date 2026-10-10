import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { EagleFlightController } from '../../src/movement/EagleFlightController'
import { advanceUntil } from '../helpers/simulation'
import { isEaglePadArrived } from '../../src/world/EaglePadArrival'

function airborne(speed = 48 / 3.6) {
  const flight = new EagleFlightController()
  flight.restore({ phase: 'cruise', yaw: 0, pitch: 0, bank: 0, speed, velocity: { x: 0, y: 0, z: speed } })
  return { flight, position: new THREE.Vector3(0, 30, 0), rotation: new THREE.Euler() }
}

function reachGrounded(flight: EagleFlightController, position: THREE.Vector3, step: () => void,
  maxFrames: number, scenario: string): void {
  try {
    advanceUntil(() => flight.phase === 'grounded', step, { maxFrames, failureMessage: scenario })
  } catch (error) {
    throw new Error(`${scenario}: ${JSON.stringify({ position, flight: flight.snapshot() })}`, { cause: error })
  }
}

describe('Fixed-wing shared flight controller (zero actors)', () => {
  it.each([[false, 48 / 3.6], [true, 96 / 3.6]] as const)('sprint=%s travels the actual world speed %s regardless of frame rate', (sprint, speed) => {
    const { flight, position, rotation } = airborne(speed)
    flight.setIntent({ yaw: 0, pitch: 0, sprint })
    flight.update(position, rotation, 1, [], 300, () => 0)
    expect(position.z).toBeCloseTo(speed, 7)
    expect(flight.velocity.length()).toBeCloseTo(speed, 7)
  })
  it('brakes without stopping/reversing and smoothly recovers cruise without W', () => {
    const { flight, position, rotation } = airborne()
    flight.setIntent({ yaw: 0, pitch: 0, brake: true })
    flight.update(position, rotation, 2, [], 300, () => 0)
    expect(flight.speed).toBe(7)
    const before = position.z
    flight.setIntent({ yaw: 0, pitch: 0 })
    flight.update(position, rotation, 1, [], 300, () => 0)
    expect(flight.speed).toBeCloseTo(48 / 3.6)
    expect(position.z).toBeGreaterThan(before)
  })
  it('limits turn rate and pitch while an airborne shot keeps the same flight intent', () => {
    const { flight, position, rotation } = airborne()
    flight.setIntent({ yaw: Math.PI, pitch: 1 })
    flight.update(position, rotation, .2, [], 300, () => 0)
    expect(flight.yaw).toBeCloseTo(.17)
    expect(flight.pitch).toBeCloseTo(.13)
    expect(position.length()).toBeGreaterThan(30)
    expect(flight.speed).toBeCloseTo(48 / 3.6)
  })
  it('takes off with W intention and lands through a slow low approach', () => {
    const flight = new EagleFlightController(), position = new THREE.Vector3(), rotation = new THREE.Euler()
    flight.setIntent({ yaw: 0, pitch: .32, takeoff: true })
    flight.update(position, rotation, 1.5, [], 300, () => 0)
    expect(position.y).toBeGreaterThan(3)
    expect(flight.phase).toBe('cruise')
    flight.setIntent({ yaw: 0, pitch: -.25, brake: true })
    advanceUntil(() => flight.phase === 'grounded', () => flight.update(position, rotation, 1 / 60, [], 300, () => 0),
      { maxFrames: 1200, failureMessage: 'Slow low approach landing' })
    expect(flight.phase).toBe('grounded')
    expect(position.y).toBe(0)
    expect(flight.speed).toBe(0)
  })
  it('continues a 4.5m assigned-pad touchdown until it is stopped within 2m, without snapping horizontally', () => {
    const { flight, position, rotation } = airborne(7)
    position.set(0, .02, -4.5)
    const pad = { x: 0, z: 0, yaw: 0 }
    flight.setIntent({ yaw: 0, pitch: 0, brake: true, landingTarget: pad })
    flight.update(position, rotation, 1 / 60, [], 300, () => 0)
    expect(flight.phase).toBe('landing')
    const previous = position.clone()
    reachGrounded(flight, position, () => {
      previous.copy(position)
      flight.update(position, rotation, 1 / 60, [], 300, () => 0)
      expect(Math.hypot(position.x - previous.x, position.z - previous.z)).toBeLessThanOrEqual(7 / 60 + .001)
    }, 600, 'Capture radius is not the completed pad arrival')
    expect(position.distanceTo(new THREE.Vector3())).toBeLessThan(2)
    expect(isEaglePadArrived({ position, flight, pad, groundHeight: 0, clear: true })).toBe(true)
  })
  it('sweeps a thin wall during a low-FPS sprint without crossing its solid volume', () => {
    const { flight, position, rotation } = airborne(96 / 3.6)
    flight.setIntent({ yaw: 0, pitch: 0, sprint: true })
    const wall = { box: new THREE.Box3(new THREE.Vector3(-30, 0, 10), new THREE.Vector3(30, 50, 10.1)), isBarricade: false }
    flight.update(position, rotation, 1, [wall], 300, () => 0)
    expect(position.z).toBeLessThan(10)
    expect(position.y).toBeLessThan(50)
  })
  it('keeps the footprint inside map bounds and limits altitude without increased speed', () => {
    const { flight, position, rotation } = airborne(96 / 3.6)
    position.set(0, 119, 280)
    flight.setIntent({ yaw: 0, pitch: 1, sprint: true })
    flight.update(position, rotation, 3, [], 300, () => 0)
    expect(Math.abs(position.x)).toBeLessThanOrEqual(289)
    expect(Math.abs(position.z)).toBeLessThanOrEqual(289)
    expect(position.y).toBeLessThanOrEqual(120)
    expect(flight.velocity.length()).toBeCloseTo(96 / 3.6)
  })
  it('uses the same yaw-aware 24 by 14 metre landing footprint and 14.5 metre wing clearance as Career deployment', () => {
    const flight = new EagleFlightController(), position = new THREE.Vector3()
    const building = { box: new THREE.Box3(new THREE.Vector3(-2, 0, 9), new THREE.Vector3(2, 8, 10)), isBarricade: false }
    expect(flight.canLand(position, [building], () => 0)).toBe(true)
    flight.yaw = Math.PI / 2
    expect(flight.canLand(position, [building], () => 0)).toBe(false)
    const overhead = { box: new THREE.Box3(new THREE.Vector3(-1, 13.9, -1), new THREE.Vector3(1, 14, 1)), isBarricade: false }
    expect(flight.canLand(position, [overhead], () => 0)).toBe(false)
    overhead.box.translate(new THREE.Vector3(0, .7, 0))
    expect(flight.canLand(position, [overhead], () => 0)).toBe(true)
    expect(flight.canLand(position, [], (x, z) => x > 5 && z > 5 ? 4 : 0)).toBe(false)
    position.x = 299
    expect(flight.canLand(position, [], () => 0, 300)).toBe(false)
  })
})

describe('Shared assigned eagle-pad arrival (zero actors)', () => {
  it.each([
    ['outside radius', { x: 3, y: 0, z: 0 }, 'grounded', 0, 0, true, 0],
    ['above terrain', { x: 0, y: .06, z: 0 }, 'grounded', 0, 0, true, 0],
    ['airborne phase', { x: 0, y: 0, z: 0 }, 'landing', 0, 0, true, 0],
    ['moving', { x: 0, y: 0, z: 0 }, 'grounded', .1, 0, true, 0],
    ['residual velocity', { x: 0, y: 0, z: 0 }, 'grounded', 0, 0, true, .1],
    ['wrong heading', { x: 0, y: 0, z: 0 }, 'grounded', 0, Math.PI, true, 0],
    ['blocked footprint', { x: 0, y: 0, z: 0 }, 'grounded', 0, 0, false, 0],
  ] as const)('does not complete %s', (_scenario, position, phase, speed, yaw, clear, velocityX) => {
    expect(isEaglePadArrived({ position, flight: { phase, speed, yaw, velocity: { x: velocityX, y: 0, z: 0 } },
      pad: { x: 0, z: 0, yaw: 0 }, groundHeight: 0, clear })).toBe(false)
  })
})

import { EagleFlightAI, type EagleFlightCommand } from '../../src/movement/EagleFlightAI'

describe('Eagle tactical steering through shared flight physics (zero actors)', () => {
  it.each([20, 25, 30, 35, 40])('holds %sm terrain-relative idle cruise without accumulating its current altitude', altitude => {
    const { flight, position, rotation } = airborne()
    const ai = new EagleFlightAI(); ai.setCruiseAltitude(altitude)
    const terrain = (x: number, z: number) => 8 + Math.sin(x / 90) * 2 + Math.sin(z / 100) * 2
    position.y = terrain(0, 0) + altitude
    const command: EagleFlightCommand = { kind: 'cruise', destination: new THREE.Vector3(0, position.y, 0) }
    let min = Infinity, max = -Infinity
    // The 30m case owns 60-second accumulated drift. Other heights cover one
    // orbital window (18 seconds after a 2-second lead-in), not five long sentinels.
    const frames = altitude === 30 ? 3600 : 1200
    for (let frame = 0; frame < frames; frame++) {
      flight.setIntent(ai.update(1 / 60, flight, position, command, [], [], 300, terrain))
      flight.update(position, rotation, 1 / 60, [], 300, terrain)
      if (frame >= 120) { min = Math.min(min, position.y - terrain(position.x, position.z)); max = Math.max(max, position.y - terrain(position.x, position.z)) }
    }
    expect(min).toBeGreaterThan(altitude - 1.5)
    expect(max).toBeLessThan(altitude + 1.5)
    expect(flight.phase).toBe('cruise')
  })

  it.each([false, true])('airborneTarget=%s keeps a ranged tactic through a turn instead of alternating ranged and dive', targetAirborne => {
    const { flight, position, rotation } = airborne()
    const ai = new EagleFlightAI(), target = new THREE.Vector3(0, targetAirborne ? 32 : 0, -80)
    const command: EagleFlightCommand = { kind: 'combat', destination: target, target, targetAirborne, rangedAvailable: true, rangedDistance: 400, targetVelocity: new THREE.Vector3(4, 0, 0) }
    for (let frame = 0; frame < 300; frame++) {
      flight.setIntent(ai.update(1 / 60, flight, position, command, [], [], 300, () => 0))
      flight.update(position, rotation, 1 / 60, [], 300, () => 0)
      expect(ai.tactic).toBe(targetAirborne ? 'RANGED_AIR' : 'RANGED_GROUND')
      expect(ai.canUseRanged).toBe(true)
    }
    expect(position.x).toBeGreaterThan(1)
    expect(position.y).toBeCloseTo(30)
  })

  it('nearby ranged target swaps preserve the decision deadline, then a new target waits for dive recovery', () => {
    const { flight, position, rotation } = airborne()
    position.set(0, 30, -80)
    const ai = new EagleFlightAI(), destination = new THREE.Vector3()
    const command: EagleFlightCommand = { kind: 'combat', destination, target: {}, rangedAvailable: true }
    let frames = 0
    const tick = () => {
      flight.setIntent(ai.update(1 / 60, flight, position, command, [], [], 300, () => 0))
      flight.update(position, rotation, 1 / 60, [], 300, () => 0)
    }
    advanceUntil(() => ai.tactic === 'DIVE_GROUND', () => {
      if (frames++ % 60 === 0) command.target = {}
      tick()
    }, { maxFrames: 600, failureMessage: 'Dive opportunity despite one target swap per second' })
    expect(frames).toBeGreaterThanOrEqual(360)
    advanceUntil(() => ai.canUseMelee, tick, { maxFrames: 1800, failureMessage: 'Committed dive before target replacement' })
    command.target = {}
    tick()
    expect(ai.maneuver).toBe('recover')
    expect(ai.tactic).toBe('DIVE_GROUND')
    expect(ai.canUseRanged).toBe(false)
    advanceUntil(() => ai.canUseRanged, tick, { maxFrames: 1800, failureMessage: 'New target after completed physical recovery' })
    expect(position.y).toBeGreaterThanOrEqual(29)
  })

  it.each([[false, false], [true, false], [false, true], [true, true]])('airborneTarget=%s rangedAvailable=%s completes a committed dive and recovery', (targetAirborne, rangedAvailable) => {
    const { flight, position, rotation } = airborne()
    position.set(0, 30, -80)
    const ai = new EagleFlightAI(), target = new THREE.Vector3(0, targetAirborne ? 15 : 0, 0)
    const command: EagleFlightCommand = { kind: 'combat', destination: target, target, targetAirborne, targetVelocity: new THREE.Vector3(0, 0, 0), rangedAvailable }
    let attacked = false, recovered = false, minY = Infinity
    advanceUntil(() => recovered, () => {
      flight.setIntent(ai.update(1 / 60, flight, position, command, [], [], 300, () => 0))
      if (!attacked && ai.canUseMelee && position.distanceTo(target) < 6.5) { ai.attacked(); attacked = true }
      flight.update(position, rotation, 1 / 60, [], 300, () => 0)
      minY = Math.min(minY, position.y)
      recovered = attacked && ai.maneuver === 'recover' && position.y >= 29
    }, { maxFrames: 7200, failureMessage: `Dive and pullout: airborne=${targetAirborne}, ranged=${rangedAvailable}` })
    expect(attacked, JSON.stringify({ position, tactic: ai.tactic, maneuver: ai.maneuver })).toBe(true)
    expect(recovered).toBe(true)
    expect(minY).toBeGreaterThanOrEqual(.2)
    expect(flight.phase).toBe('cruise')
    if (rangedAvailable) {
      advanceUntil(() => ai.canUseRanged, () => {
        flight.setIntent(ai.update(1 / 60, flight, position, command, [], [], 300, () => 0))
        flight.update(position, rotation, 1 / 60, [], 300, () => 0)
      }, { maxFrames: 600, failureMessage: 'Ranged tactic after completed pullout' })
      for (let frame = 0; frame < 300; frame++) {
        flight.setIntent(ai.update(1 / 60, flight, position, command, [], [], 300, () => 0))
        flight.update(position, rotation, 1 / 60, [], 300, () => 0)
        expect(ai.canUseRanged).toBe(true)
      }
    }
  })

  it('separates true 3D neighbors and detects a thin obstruction along the whole lookahead corridor', () => {
    const { flight, position } = airborne()
    const ai = new EagleFlightAI()
    const command: EagleFlightCommand = { kind: 'formation', destination: new THREE.Vector3(0, 30, 100), altitude: 30 }
    const unobstructed = { ...ai.update(1 / 60, flight, position, command, [], [], 300, () => 0) }
    const neighbor = new THREE.Vector3(4, 30, 5)
    const separated = { ...ai.update(1 / 60, flight, position, command, [neighbor], [], 300, () => 0) }
    expect(separated.yaw).toBeLessThan(unobstructed.yaw)
    const farAbove = { ...ai.update(1 / 60, flight, position, command, [new THREE.Vector3(0, 80, 0)], [], 300, () => 0) }
    expect(farAbove.yaw).toBe(unobstructed.yaw)
    const wall = { box: new THREE.Box3(new THREE.Vector3(-8, 0, 8), new THREE.Vector3(8, 60, 8.1)), isBarricade: false }
    const avoided = ai.update(1 / 60, flight, position, command, [], [wall], 300, () => 0)
    expect(Math.abs(avoided.yaw)).toBeGreaterThan(.1)
  })

  it.each([0, Math.PI / 2, Math.PI])('formation remains airborne while an explicit return physically approaches and lands at its own pad with yaw %s', landingYaw => {
    const { flight, position, rotation } = airborne()
    position.set(0, 30, 70)
    const ai = new EagleFlightAI(), destination = new THREE.Vector3()
    const command: EagleFlightCommand = { kind: 'formation', destination }
    const tick = () => {
      flight.setIntent(ai.update(1 / 60, flight, position, command, [], [], 300, () => 0))
      flight.update(position, rotation, 1 / 60, [], 300, () => 0)
    }
    // Reach the formation arrival/orbit zone before checking that it stays aloft.
    advanceUntil(() => Math.hypot(position.x, position.z) < 24, tick,
      { maxFrames: 1200, failureMessage: `Formation arrival before return yaw=${landingYaw}` })
    for (let frame = 0; frame < 120; frame++) tick()
    expect(flight.phase).toBe('cruise'); expect(position.y).toBeCloseTo(30)
    command.kind = 'return'; command.landingYaw = landingYaw
    const previous = new THREE.Vector3()
    let maximumStep = 0
    advanceUntil(() => flight.phase === 'grounded', () => {
      previous.copy(position)
      tick()
      maximumStep = Math.max(maximumStep, previous.distanceTo(position))
    }, { maxFrames: 7200, failureMessage: `Return landing yaw=${landingYaw}` })
    expect(maximumStep).toBeLessThan(.5)
    expect(flight.phase, JSON.stringify({ position, flight: flight.snapshot() })).toBe('grounded')
    expect(position.distanceTo(destination), JSON.stringify({ position, flight: flight.snapshot() })).toBeLessThan(3)
    expect(Math.abs(Math.atan2(Math.sin(flight.yaw - landingYaw), Math.cos(flight.yaw - landingYaw)))).toBeLessThan(.3)
  })
})


describe('Eagle tactical safety aborts (zero actors)', () => {
  it('abandons an established air dive when the moving target drops below safe interception altitude', () => {
    const { flight, position, rotation } = airborne()
    position.set(0, 30, -80)
    const ai = new EagleFlightAI(), target = new THREE.Vector3(0, 15, 0)
    const command: EagleFlightCommand = { kind: 'combat', destination: target, target, targetAirborne: true, rangedAvailable: false }
    advanceUntil(() => ai.canUseMelee, () => {
      flight.setIntent(ai.update(1 / 60, flight, position, command, [], [], 300, () => 0))
      flight.update(position, rotation, 1 / 60, [], 300, () => 0)
    }, { maxFrames: 3600, failureMessage: 'Established air dive before target drops' })
    expect(ai.canUseMelee).toBe(true)
    target.y = 1
    const intent = ai.update(1 / 60, flight, position, command, [], [], 300, () => 0)
    expect(ai.maneuver).toBe('recover')
    expect(ai.canUseMelee).toBe(false)
    expect(intent.pitch).toBeGreaterThanOrEqual(0)
  })

  it('flies around a tall thin wall and returns to terrain cruise instead of climbing indefinitely', () => {
    const { flight, position, rotation } = airborne()
    position.set(0, 30, -60)
    const ai = new EagleFlightAI()
    const command: EagleFlightCommand = { kind: 'formation', destination: new THREE.Vector3(0, 0, 100) }
    const wall = { box: new THREE.Box3(new THREE.Vector3(-8, 0, 0), new THREE.Vector3(8, 70, .1)), isBarricade: false }
    let passed = false, maxY = 0
    advanceUntil(() => passed && Math.abs(position.y - 30) < .05 && Math.abs(flight.pitch) < .05, () => {
      flight.setIntent(ai.update(1 / 60, flight, position, command, [], [wall], 300, () => 0))
      flight.update(position, rotation, 1 / 60, [wall], 300, () => 0)
      passed ||= position.z > 20
      maxY = Math.max(maxY, position.y)
    }, { maxFrames: 3600, failureMessage: 'Pass tall wall and settle to terrain cruise' })
    expect(passed).toBe(true)
    expect(maxY).toBeLessThan(40)
    expect(position.y).toBeCloseTo(30, 1)
  })
})

it('lands at a legal edge pad along its authored in-bounds approach without boundary steering pushing it away', () => {
  const { flight, position, rotation } = airborne()
  position.set(190, 30, 50)
  const ai = new EagleFlightAI(), destination = new THREE.Vector3(280, 0, 50)
  const command: EagleFlightCommand = { kind: 'return', destination, landingYaw: Math.PI / 2 }
  reachGrounded(flight, position, () => {
    flight.setIntent(ai.update(1 / 60, flight, position, command, [], [], 300, () => 0))
    flight.update(position, rotation, 1 / 60, [], 300, () => 0)
  }, 7200, 'Authored edge-pad landing')
  expect(flight.phase, JSON.stringify({ position, state: flight.snapshot() })).toBe('grounded')
  expect(position.distanceTo(destination)).toBeLessThan(3)
  expect(Math.abs(Math.atan2(Math.sin(flight.yaw - Math.PI / 2), Math.cos(flight.yaw - Math.PI / 2)))).toBeLessThan(.3)
})

it('keeps flying when the authored edge-pad corridor is outside the map instead of reversing the parked heading', () => {
  const { flight, position, rotation } = airborne()
  position.set(190, 30, 50)
  const ai = new EagleFlightAI(), destination = new THREE.Vector3(280, 0, 50)
  const command: EagleFlightCommand = { kind: 'return', destination, landingYaw: -Math.PI / 2 }
  for (let frame = 0; frame < 7200; frame++) {
    flight.setIntent(ai.update(1 / 60, flight, position, command, [], [], 300, () => 0))
    flight.update(position, rotation, 1 / 60, [], 300, () => 0)
    expect(flight.phase).not.toBe('grounded')
  }
  expect(position.y).toBeGreaterThan(20)
})

it('re-enters the authored approach after loading an overshot low landing instead of stopping beyond its pad', () => {
  const { flight, position, rotation } = airborne(7)
  flight.restore({ ...flight.snapshot(), phase: 'landing' })
  position.set(0, 1, 8)
  const ai = new EagleFlightAI(), destination = new THREE.Vector3()
  const command: EagleFlightCommand = { kind: 'return', destination, landingYaw: 0 }
  let restaged = false
  reachGrounded(flight, position, () => {
    flight.setIntent(ai.update(1 / 60, flight, position, command, [], [], 300, () => 0))
    flight.update(position, rotation, 1 / 60, [], 300, () => 0)
    restaged ||= position.z < -40 && position.y > 20
  }, 7200, 'Re-entry after an overshot saved landing')
  expect(restaged).toBe(true)
  expect(isEaglePadArrived({ position, flight, pad: { x: 0, z: 0, yaw: 0 }, groundHeight: 0, clear: true })).toBe(true)
})

it.each([20, 40])('returns from %sm cruise above an earlier parked eagle and wall, then lands within 2m without phase cycling', cruiseAltitude => {
  const { flight, position, rotation } = airborne()
  position.set(25, cruiseAltitude, -140)
  const ai = new EagleFlightAI(); ai.setCruiseAltitude(cruiseAltitude)
  const destination = new THREE.Vector3(), pad = { x: 0, z: 0, yaw: 0 }
  const command: EagleFlightCommand = { kind: 'return', destination, landingYaw: 0 }
  const parkedEagle = { box: new THREE.Box3(new THREE.Vector3(-12, .2, -57), new THREE.Vector3(12, 14.5, -43)), isBarricade: false }
  const wall = { box: new THREE.Box3(new THREE.Vector3(-130, 0, -40.1), new THREE.Vector3(130, 12, -39.9)), isBarricade: false }
  const obstacles = [parkedEagle, wall]
  let crossedEagle = false, crossedWall = false, landingEntries = 0
  reachGrounded(flight, position, () => {
    const previousPhase = flight.phase, previousZ = position.z
    flight.setIntent(ai.update(1 / 60, flight, position, command, [], obstacles, 300, () => 0))
    flight.update(position, rotation, 1 / 60, obstacles, 300, () => 0)
    if (Math.abs(position.x) < 12 && position.z >= -57 && position.z <= -43) {
      crossedEagle = true
      expect(position.y, '14.5m resting envelope + 7.46m downstroke + 2m tracking clearance').toBeGreaterThan(23.96)
    }
    if (previousZ < -40 && position.z >= -40 && Math.abs(position.x) < 130) {
      crossedWall = true
      expect(position.y, '12m wall + 7.46m downstroke + 2m tracking clearance').toBeGreaterThan(21.46)
    }
    if (previousPhase !== 'landing' && flight.phase === 'landing') landingEntries++
    if (previousPhase === 'landing') expect(flight.phase).not.toBe('cruise')
  }, 7200, `Parked eagle and city-wall approach at cruise=${cruiseAltitude}`)
  expect(crossedEagle).toBe(true); expect(crossedWall).toBe(true)
  expect(landingEntries).toBe(1)
  expect(position.distanceTo(destination)).toBeLessThan(2)
  expect(isEaglePadArrived({ position, flight, pad, groundHeight: 0, clear: true })).toBe(true)
})

it('rebuilds an outward dive stage on the in-bounds side of an edge target and reaches the attack window', () => {
  const { flight, position, rotation } = airborne()
  position.set(-285, 30, 0)
  const ai = new EagleFlightAI(), target = new THREE.Vector3(-280, 0, 0)
  const command: EagleFlightCommand = { kind: 'combat', destination: target, target, rangedAvailable: false }
  let reached = false
  advanceUntil(() => reached, () => {
    flight.setIntent(ai.update(1 / 60, flight, position, command, [], [], 300, () => 0))
    flight.update(position, rotation, 1 / 60, [], 300, () => 0)
    reached = ai.canUseMelee && position.distanceTo(target) < 6.5
  }, { maxFrames: 3600, failureMessage: 'In-bounds edge-target attack run' })
  expect(reached, JSON.stringify({ position, maneuver: ai.maneuver })).toBe(true)
})
