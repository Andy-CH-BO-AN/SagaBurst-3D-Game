import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { FallingRider } from '../../src/movement/FallingRider'
import { Mount, MountState, MountType } from '../../src/world/Mount'
import { getTerrainHeight } from '../../src/world/Terrain'

interface PresentationPort {
  state: MountState
  readonly dead: boolean
  readonly deathPresentationComplete: boolean
  readonly isAirborne: boolean
  readonly isFlyingMount: boolean
  type: MountType
  disposed: boolean
  deathTimer: number
  currentHp: number
  maxHp: number
  riderNpc: null
  riderPlayer: null
  riderFaction: null
  onDeathCallbacks: []
  group: {
    visible: boolean
    position: Vector3
    rotation: { y: number; z: number; set(x: number, y: number, z: number): void }
    add(root: object): void
  }
  eagleVisual: { root: { readonly parent: object | null; removeFromParent(): void }; update(dt: number, state: { dead: boolean }): void }
  eagleCorpseFall: FallingRider
  flight: { phase: string; speed: number; velocity: Vector3; restore(saved: { phase: string; yaw: number; velocity: { x: number; y: number; z: number } }): void }
  horseVisual: null
  proceduralVisual: null
  eagleAttack: null
  playableWorldBound: number
  onGround: boolean
  previousPosition: Vector3
  horseLanding: { reset(): void }
  impactTimes: Map<object, number>
  _pickWanderTarget(): void
}

const read = (name: 'dead' | 'deathPresentationComplete' | 'isAirborne' | 'isFlyingMount') =>
  Object.getOwnPropertyDescriptor(Mount.prototype, name)!.get!

/** Numeric state and attachment/reset ports only; no actor or Object3D is constructed. */
function presentation() {
  const events: string[] = []
  let attached = true
  const port: PresentationPort = {
    state: MountState.DEAD, type: MountType.XONGKORO, disposed: false, deathTimer: 3,
    currentHp: 0, maxHp: 200, riderNpc: null, riderPlayer: null, riderFaction: null, onDeathCallbacks: [],
    get dead() { return read('dead').call(this) },
    get deathPresentationComplete() { return read('deathPresentationComplete').call(this) },
    get isAirborne() { return read('isAirborne').call(this) },
    get isFlyingMount() { return read('isFlyingMount').call(this) },
    group: {
      visible: true, position: new Vector3(0, getTerrainHeight(0, 0), 0),
      rotation: { y: 0, z: 0, set(_x, y, z) { this.y = y; this.z = z } },
      add() { attached = true; events.push('attach') },
    },
    eagleVisual: {
      // This getter reports resource membership to the production reattach guard.
      // It has no children, matrices, traversal or substitute scene implementation.
      root: { get parent() { return attached ? port.group : null }, removeFromParent() { attached = false; events.push('detach') } },
      update(_dt, state) { events.push(state.dead ? 'dead-pose' : attached ? 'live-pose-attached' : 'live-pose-detached') },
    },
    eagleCorpseFall: new FallingRider(),
    flight: {
      phase: 'cruise', speed: 10, velocity: new Vector3(0, -1, 0),
      restore(saved) { this.phase = saved.phase; this.speed = 0; this.velocity.copy(saved.velocity); events.push('flight-reset') },
    },
    horseVisual: null, proceduralVisual: null, eagleAttack: null, playableWorldBound: 500,
    onGround: false, previousPosition: new Vector3(), horseLanding: { reset() {} },
    impactTimes: new Map(), _pickWanderTarget() {},
  }
  // One narrow seam invokes the real production methods over plain state/reset ports.
  const mount = port as unknown as Mount
  return { port, mount, events, attached: () => attached }
}

describe('mount death presentation lifetime', () => {
  it('finishes the airborne fall and ground countdown before detaching, then stops visual work', () => {
    const h = presentation()
    h.port.group.position.y += 2
    h.port.eagleCorpseFall.begin(h.port.group.position, h.port.flight.velocity)
    h.port.deathTimer = 0
    expect(h.port.deathPresentationComplete).toBe(false)
    h.port.deathTimer = 3

    Mount.prototype.update.call(h.mount, .1, [])
    expect(h.port.eagleCorpseFall.active).toBe(true)
    expect(h.port.deathTimer).toBe(3)
    expect(h.attached()).toBe(true)
    Mount.prototype.update.call(h.mount, 1, [])
    expect(h.port.eagleCorpseFall.active).toBe(false)
    expect(h.port.flight.phase).toBe('grounded')
    expect(h.port.deathTimer).toBe(3)
    expect(h.port.deathPresentationComplete).toBe(false)

    Mount.prototype.update.call(h.mount, 3, [])
    expect(h.port.deathPresentationComplete).toBe(true)
    expect(h.port.group.visible).toBe(false)
    expect(h.attached()).toBe(false)
    const complete = [...h.events]
    Mount.prototype.update.call(h.mount, 1, [])
    Mount.prototype.update.call(h.mount, 1, [])
    expect(h.events).toEqual(complete)
    expect(h.events.filter(event => event === 'detach')).toHaveLength(1)
    expect(h.port.disposed).toBe(false)
  })

  it('reattaches the retained resource before native refit and re-arms its next death', () => {
    const h = presentation()
    h.port.flight.phase = 'grounded'
    Mount.prototype.update.call(h.mount, 3, [])
    const resource = h.port.eagleVisual.root
    h.events.length = 0

    Mount.prototype.restoreForTown.call(h.mount, 4, 7, .8)
    expect(h.events).toEqual(['attach', 'flight-reset', 'live-pose-attached'])
    expect(h.port.eagleVisual.root).toBe(resource)
    expect(h.port.group.visible).toBe(true)
    expect(h.port.deathTimer).toBe(3)
    expect(h.port.deathPresentationComplete).toBe(false)
    expect(h.port.currentHp).toBe(200)
    expect(h.port.flight.phase).toBe('grounded')
    expect(h.port.disposed).toBe(false)

    expect(Mount.prototype.takeDamage.call(h.mount, 200)).toBe(true)
    expect(h.port.deathPresentationComplete).toBe(false)
    Mount.prototype.update.call(h.mount, 3, [])
    expect(h.port.deathPresentationComplete).toBe(true)
    expect(h.attached()).toBe(false)
  })
})
