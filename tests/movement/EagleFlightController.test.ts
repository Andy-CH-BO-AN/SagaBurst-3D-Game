import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { EagleFlightController } from '../../src/movement/EagleFlightController'

function airborne(speed = 48 / 3.6) {
  const flight = new EagleFlightController()
  flight.restore({ phase: 'cruise', yaw: 0, pitch: 0, bank: 0, speed, velocity: { x: 0, y: 0, z: speed } })
  return { flight, position: new THREE.Vector3(0, 30, 0), rotation: new THREE.Euler() }
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
    for (let frame = 0; frame < 1200 && flight.phase !== 'grounded'; frame++) flight.update(position, rotation, 1 / 60, [], 300, () => 0)
    expect(flight.phase).toBe('grounded')
    expect(position.y).toBe(0)
    expect(flight.speed).toBe(0)
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
  it('uses the same yaw-aware 24 by 14 metre landing footprint as Career deployment', () => {
    const flight = new EagleFlightController(), position = new THREE.Vector3()
    const building = { box: new THREE.Box3(new THREE.Vector3(-2, 0, 9), new THREE.Vector3(2, 8, 10)), isBarricade: false }
    expect(flight.canLand(position, [building], () => 0)).toBe(true)
    flight.yaw = Math.PI / 2
    expect(flight.canLand(position, [building], () => 0)).toBe(false)
    expect(flight.canLand(position, [], (x, z) => x > 5 && z > 5 ? 4 : 0)).toBe(false)
    position.x = 299
    expect(flight.canLand(position, [], () => 0, 300)).toBe(false)
  })
})
