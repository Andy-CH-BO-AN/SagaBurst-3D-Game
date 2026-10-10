import { Game } from '../../src/Game'
import type { ArrowProjectile } from '../../src/world/ArrowProjectile'
import * as THREE from 'three'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { Player, type ArrowLaunchEvent } from '../../src/player/Player'
import { PlayerInput } from '../../src/player/PlayerInput'
import { Mount, MountType } from '../../src/world/Mount'
import { damageMount, damagePlayer } from '../../src/combat/DamageRouter'
import { Faction } from '../../src/combat/CombatFaction'
import { type CombatEvent } from '../../src/combat/CombatAttribution'
import { InventoryManager } from '../../src/rpg/InventoryManager'
import { ThirdPersonCamera } from '../../src/camera/ThirdPersonCamera'
import { getTerrainHeight } from '../../src/world/Terrain'
import type { HeroAssetId } from '../../src/world/HeroAssetCatalog'
import { fitStandingRider } from '../../src/world/StandingRider'
import type { CharacterRig } from '../../src/world/CharacterVisuals'

vi.mock('../../src/world/XongkoroVisual', async () => {
  return { XongkoroVisual: (await import('../helpers/gameplayEagleVisual')).GameplayEagleVisualDouble }
})

function controls(values: Partial<Pick<PlayerInput, 'keys' | 'isRightMouseDown' | 'isLeftMouseDown' | 'consumeLeftClick' | 'consumeLeftClickRelease' | 'consumeMouseDelta'>> = {}) {
  // Only the public input boundary is replaced; Player owns attacks and locomotion.
  return { keys: {}, isLeftMouseDown: false, isRightMouseDown: false,
    consumeLeftClick: () => false, consumeLeftClickRelease: () => false,
    consumeMouseDelta: vi.fn(() => ({ dx: 0, dy: 0 })), ...values }
}

/** Cost: one real Player + Mount, no NPCs/GLBs/world; visual boundary only. */
function harness(height = 40, hero?: HeroAssetId) {
  const scene = new THREE.Scene()
  const player = new Player(scene, 'viking', hero)
  onTestFinished(() => player.dispose())
  player.setMaxHp(150)
  const mount = new Mount(scene, MountType.XONGKORO, 0, 0)
  onTestFinished(() => mount.dispose())
  player.mountVehicle(mount, 0)
  mount.group.position.y = getTerrainHeight(0, 1.7) + height - 2.8
  mount.flight!.restore({ phase: 'cruise', yaw: 0, pitch: 0, bank: 0, speed: 48 / 3.6, velocity: { x: 0, y: 0, z: 0 } })
  player.syncMountTransform()
  const hud = { setFill: vi.fn() }
  player.setDamageHud(hud)
  const inventory = new InventoryManager()
  inventory.equipWeapon('elven_runebow')
  const camera = new THREE.PerspectiveCamera(58, 16 / 9, .1, 500)
  const orbit = new ThirdPersonCamera(camera, player)
  const stamina = { setFill() {} }
  const quiver = { setShieldBlocked() {}, setAiming() {}, setChargeRatio() {} }
  const sound = { playBowRelease() {} }
  const update = (input = controls(), dt = 1 / 60, combatEnabled = true) => {
    orbit.update(input, dt)
    player.update(dt, input, orbit.cameraYaw, orbit.getAimPoint(new THREE.Vector3()), [], stamina, quiver, sound, inventory, 1, combatEnabled)
  }
  return { player, mount, hud, inventory, orbit, update }
}

function fitOffsetSoles(h: ReturnType<typeof harness>): THREE.Group {
  // Render boundary only: two sole sockets replace the absent GLB sockets.
  // The real fitting rule produces an offset; the real Player detach must undo it.
  const visual = (h.player as unknown as { characterVisualGroup: THREE.Group }).characterVisualGroup
  const leftFootSocket = new THREE.Object3D(), rightFootSocket = new THREE.Object3D()
  leftFootSocket.position.set(-.1, -.8, .2); rightFootSocket.position.set(.2, -.8, .2)
  visual.add(leftFootSocket, rightFootSocket)
  fitStandingRider(visual, { leftFootSocket, rightFootSocket }, h.mount.eagleVisual!.standingSocket)
  expect(Math.hypot(visual.position.x, visual.position.z)).toBeGreaterThan(.1)
  return visual
}

describe('Player eagle production wiring', () => {
  it.each([{ dx: 200, yaw: -.4 }, { dx: -200, yaw: .4 }])('RMB mouse dx=$dx turns the rider toward the reticle without turning the eagle', ({ dx, yaw }) => {
    const h = harness()
    const before = h.mount.group.quaternion.clone()
    h.update(controls({ isRightMouseDown: true, consumeMouseDelta: () => ({ dx, dy: 0 }) }))
    for (let frame = 0; frame < 40; frame++) h.update(controls({ isRightMouseDown: true }))
    // Procedural test visuals face -Z; Euler.rotation.y is ambiguous near π.
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(h.player.group.quaternion)
    const heading = Math.atan2(forward.x, forward.z)
    expect(heading).toBeCloseTo(yaw, 4)
    const ray = h.orbit.getAimDirection(new THREE.Vector3())
    expect(heading).toBeCloseTo(Math.atan2(ray.x, ray.z), 4)
    expect(h.mount.flight!.yaw).toBe(0)
    expect(h.mount.group.quaternion.angleTo(before)).toBeLessThan(1e-8)
  })

  it('RMB release returns smoothly, re-entry has no snap, and remount clears the rider turn', () => {
    const h = harness()
    h.update(controls({ isRightMouseDown: true, consumeMouseDelta: () => ({ dx: -250, dy: 0 }) }))
    for (let frame = 0; frame < 40; frame++) h.update(controls({ isRightMouseDown: true }))
    const relativeYaw = () => {
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(h.player.group.quaternion)
        .applyQuaternion(h.mount.group.quaternion.clone().invert())
      return Math.atan2(forward.x, forward.z)
    }
    const before = relativeYaw()
    h.update()
    expect(relativeYaw()).toBeGreaterThan(0)
    expect(relativeYaw()).toBeLessThan(before)
    expect(before - relativeYaw()).toBeLessThan(.03)
    const released = relativeYaw()
    h.update(controls({ isRightMouseDown: true }))
    expect(Math.abs(relativeYaw() - released)).toBeLessThan(.03)
    for (let frame = 0; frame < 200; frame++) h.update()
    expect(relativeYaw()).toBeCloseTo(0, 4)
    h.mount.flight!.phase = 'grounded'
    h.mount.group.position.y = getTerrainHeight(0, 0)
    h.player.dismountFromMount()
    h.player.mountVehicle(h.mount, -1)
    const remounted = new THREE.Vector3(0, 0, -1).applyQuaternion(h.player.group.quaternion)
    expect(Math.atan2(remounted.x, remounted.z)).toBeCloseTo(-1)
  })

  it('turned rider soles stay on the standing socket through pitch/bank and repeated sync', () => {
    const h = harness()
    h.update() // Let the equipped tier rebuild the visual before adding sockets.
    // Typed visual boundary: no GLB; real Player must fit these offset sockets
    // after its final orientation and animation, rather than before the turn.
    const { characterVisualGroup: visual, rig } = h.player as unknown as { characterVisualGroup: THREE.Group; rig: CharacterRig }
    const leftFootSocket = new THREE.Object3D(), rightFootSocket = new THREE.Object3D()
    leftFootSocket.position.set(-.15, -.8, .2); rightFootSocket.position.set(.15, -.8, .2)
    visual.add(leftFootSocket, rightFootSocket)
    Object.assign(rig, { leftFootSocket, rightFootSocket })
    h.mount.flight!.pitch = .5; h.mount.flight!.bank = -.4
    h.mount.group.rotation.set(-.5, 0, -.4, 'YXZ')
    h.update(controls({ isRightMouseDown: true, consumeMouseDelta: () => ({ dx: -250, dy: 0 }) }))
    for (let frame = 0; frame < 40; frame++) {
      h.update(controls({ isRightMouseDown: true, keys: { KeyA: true } }))
      const midpoint = leftFootSocket.getWorldPosition(new THREE.Vector3()).add(rightFootSocket.getWorldPosition(new THREE.Vector3())).multiplyScalar(.5)
      expect(midpoint.distanceTo(h.mount.getRiderStandingSeatWorld(new THREE.Vector3()))).toBeLessThan(1e-8)
      const up = new THREE.Vector3(0, 1, 0)
      expect(up.clone().applyQuaternion(h.player.group.quaternion).distanceTo(up.applyQuaternion(h.mount.group.quaternion))).toBeLessThan(1e-8)
      const position = h.player.position.clone(), rotation = h.player.group.quaternion.clone()
      h.player.syncMountTransform()
      expect(h.player.position.distanceTo(position)).toBeLessThan(1e-8)
      expect(h.player.group.quaternion.angleTo(rotation)).toBeLessThan(1e-7)
    }
    expect(h.mount.flight!.pitch).toBeGreaterThan(.3)
    expect(Math.abs(h.mount.flight!.bank)).toBeGreaterThan(.1)
    const heading = new THREE.Vector3(0, 0, -1).applyQuaternion(h.player.group.quaternion)
    const reticle = h.orbit.getAimDirection(new THREE.Vector3())
    expect(Math.atan2(heading.x, heading.z)).toBeCloseTo(Math.atan2(reticle.x, reticle.z), 1)
  })

  it('aim crossing +π to -π takes a small rider turn while edge steering remains gradual', () => {
    const h = harness()
    h.mount.flight!.yaw = Math.PI - .02
    h.mount.group.rotation.set(0, Math.PI - .02, 0, 'YXZ')
    h.player.syncMountTransform()
    const before = h.player.group.quaternion.clone()
    h.update(controls({ isRightMouseDown: true, consumeMouseDelta: () => ({ dx: -25, dy: 0 }) }))
    expect(h.player.group.quaternion.angleTo(before)).toBeGreaterThan(.005)
    expect(h.player.group.quaternion.angleTo(before)).toBeLessThan(.05)
    for (let frame = 0; frame < 90; frame++) h.update(controls({ isRightMouseDown: true, consumeMouseDelta: () => ({ dx: -100, dy: 0 }) }))
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(h.player.group.quaternion)
    const delta = Math.atan2(forward.x, forward.z) - h.mount.flight!.yaw
    expect(Math.abs(Math.atan2(Math.sin(delta), Math.cos(delta)))).toBeLessThanOrEqual(1.25)
    expect(h.mount.flight!.yaw).toBeGreaterThan(Math.PI + .2)
  })

  it('grounded boarding synchronizes the first camera flight heading and dismount finds an unobstructed supported spot', () => {
    const h = harness()
    h.mount.flight!.phase = 'grounded'
    h.mount.group.position.set(0, getTerrainHeight(0, 0), 0)
    h.player.setMountedHeading(Math.PI)
    expect(h.mount.flight!.yaw).toBeCloseTo(Math.PI)
    h.player.syncMountTransform()
    const y = h.mount.group.position.y
    const obstacle = { box: new THREE.Box3(new THREE.Vector3(-4, y - 1, -2), new THREE.Vector3(-1.5, y + 3, 2)), isBarricade: false }
    h.mount.finishControlledFrame(0, [obstacle])
    const visual = fitOffsetSoles(h)
    h.player.dismountFromMount()
    expect(h.player.isMounted).toBe(false)
    expect(h.player.isFalling).toBe(false)
    expect(h.player.hp).toBe(150)
    expect(h.player.position.x).toBeGreaterThan(1.5)
    expect(h.player.position.y + h.player.bodyBaseOffset).toBeCloseTo(getTerrainHeight(h.player.position.x, h.player.position.z))
    expect([visual.position.x, visual.position.z]).toEqual([0, 0])
  })

  it('a grounded eagle death still releases the rider from its standing support instead of teleporting to the floor', () => {
    const h = harness()
    h.mount.flight!.phase = 'grounded'
    h.mount.group.position.set(0, getTerrainHeight(0, 0), 0)
    h.player.syncMountTransform()
    const before = h.player.position.clone()
    damageMount(h.mount, 200)
    expect(h.player.position.distanceTo(before)).toBeLessThan(.000001)
    expect(h.player.isFalling).toBe(true)
    expect(h.player.hp).toBe(150)
    for (let i = 0; i < 300 && h.player.isFalling; i++) h.update()
    expect(h.player.isFalling).toBe(false)
    expect(h.player.dead).toBe(false)
    expect(h.player.hp).toBeLessThan(150)
  })

  it('shootdown starts at the standing feet, repeated detach cannot reset it, and 14m removes 140 HP once', () => {
    const h = harness(14)
    const events: CombatEvent[] = []
    const context = { source: { actorId: 'archer', actorType: 'npc' as const, allegiance: Faction.ENEMY, characterFaction: 'roman' as const },
      method: 'projectile' as const, emit: (event: CombatEvent) => events.push(event) }
    const before = h.player.position.clone()
    damageMount(h.mount, 200, context)
    expect(h.player.position.distanceTo(before)).toBeLessThan(.000001)
    expect(h.player.hp).toBe(150)
    expect(h.player.isFalling).toBe(true)
    const saved = h.player.fallSnapshot
    h.player.dismountFromMount()
    expect(h.player.fallSnapshot).toEqual(saved)
    for (let i = 0; i < 300 && h.player.isFalling; i++) h.update()
    expect(h.player.isFalling).toBe(false)
    expect(h.player.hp).toBeCloseTo(10, 7)
    expect(h.player.dead).toBe(false)
    expect(h.hud.setFill).toHaveBeenLastCalledWith(expect.closeTo(1 / 15, 6))
    expect(events.filter(event => event.type === 'damage_applied' && event.method === 'fall')).toHaveLength(1)
    h.update()
    expect(h.player.hp).toBeCloseTo(10, 7)
  })

  it('15m fall bypasses hero defense and reports one death only at landing', () => {
    const h = harness(15, 'viking-hero-t4')
    const death = vi.fn()
    h.player.onPlayerDeath = death
    damageMount(h.mount, 200)
    expect(death).not.toHaveBeenCalled()
    for (let i = 0; i < 300 && h.player.isFalling; i++) h.update()
    expect(h.player.hp).toBe(0)
    expect(h.player.dead).toBe(true)
    expect(death).toHaveBeenCalledTimes(1)
  })

  it.each(['airborne', 'grounded'] as const)('%s rider death immediately notifies Observer while the corpse falls and living eagle survives', phase => {
    const h = harness(30)
    if (phase === 'grounded') {
      h.mount.flight!.phase = 'grounded'; h.mount.flight!.velocity.set(0, 0, 0)
      h.mount.group.position.y = getTerrainHeight(0, 0); h.player.syncMountTransform()
    }
    const death = vi.fn()
    h.player.onPlayerDeath = death
    damagePlayer(h.player, 999, h.hud, null)
    expect(death).toHaveBeenCalledTimes(1)
    expect(h.mount.dead).toBe(false)
    expect(h.mount.riderPlayer).toBeNull()
    const y = h.player.position.y
    h.update()
    expect(h.player.position.y).toBeLessThan(y)
    for (let i = 0; i < 400 && h.player.isFalling; i++) h.update()
    expect(h.player.isFalling).toBe(false)
    expect(death).toHaveBeenCalledTimes(1)
  })

  it('air dismount prevents reboarding or healing away a pending fall', () => {
    const h = harness()
    h.player.setHp(50)
    const visual = fitOffsetSoles(h)
    h.player.dismountFromMount()
    expect([visual.position.x, visual.position.z]).toEqual([0, 0])
    const fall = h.player.fallSnapshot
    h.player.mountVehicle(h.mount)
    h.player.restoreForTown()
    expect(h.player.isMounted).toBe(false)
    expect(h.player.hp).toBe(50)
    expect(h.player.fallSnapshot).toEqual(fall)
  })

  it('camera owns one mouse sample while aiming preserves exact cruise displacement and standing scale', () => {
    const h = harness()
    const input = controls({ isRightMouseDown: true })
    const before = h.mount.group.position.clone()
    h.update(input)
    expect(input.consumeMouseDelta).toHaveBeenCalledTimes(1)
    expect(h.mount.group.position.distanceTo(before)).toBeCloseTo((48 / 3.6) / 60, 5)
    expect(h.player.isMounted).toBe(true)
    expect(h.player.group.scale.toArray()).toEqual([1, 1, 1])
    const feet = h.player.position.clone().add(new THREE.Vector3(0, -.95, 0).applyQuaternion(h.player.group.quaternion))
    expect(feet.distanceTo(h.mount.getRiderStandingSeatWorld(new THREE.Vector3()))).toBeLessThan(.000001)
  })

  it.each(['airborne', 'grounded'] as const)('%s no-RMB click attacks with the unarmed eagle; unavailable RMB never falls through to eagle', phase => {
    const h = harness()
    if (phase === 'grounded') {
      h.mount.flight!.phase = 'grounded'; h.mount.flight!.velocity.set(0, 0, 0)
      h.mount.group.position.y = getTerrainHeight(0, 0); h.player.syncMountTransform()
    }
    h.inventory.meleeEnabled = false
    const attack = vi.spyOn(h.mount, 'startEagleAttack')
    h.update(controls({ consumeLeftClick: () => true }))
    expect(attack).toHaveBeenCalledTimes(1)
    expect(h.mount.eagleAttack!.weight).toBeGreaterThan(0)
    expect(h.player.swinging).toBe(false)
    h.inventory.rangedEnabled = false
    h.update(controls({ consumeLeftClick: () => true, isRightMouseDown: true }))
    expect(attack).toHaveBeenCalledTimes(1)
  })

  it.each(['elven_runebow', 'legionary_pilum'])('%s releases once from the moving rider socket and consumes ammo', weapon => {
    const h = harness()
    h.inventory.addWeapon(weapon)
    h.inventory.equipWeapon(weapon)
    const shots: ArrowLaunchEvent[] = []
    h.player.onFireArrow = shot => shots.push(shot)
    h.update(controls({ isRightMouseDown: true, consumeMouseDelta: () => ({ dx: -200, dy: 0 }) }))
    if (weapon === 'elven_runebow') {
      for (let i = 0; i < 30; i++) h.update(controls({ isRightMouseDown: true, isLeftMouseDown: true }))
      expect(shots).toHaveLength(0)
      h.update(controls({ isRightMouseDown: true, consumeLeftClickRelease: () => true }))
    } else h.update(controls({ isRightMouseDown: true, consumeLeftClick: () => true }))
    const target = h.orbit.getAimPoint(new THREE.Vector3())
    const z = h.mount.group.position.z
    for (let i = 0; i < 90; i++) h.update(controls({ isRightMouseDown: true }))
    expect(shots).toHaveLength(1)
    expect(shots[0].origin.y).toBeGreaterThan(30)
    expect(shots[0].direction.length()).toBeCloseTo(1)
    expect(shots[0].direction.angleTo(target.sub(shots[0].origin))).toBeLessThan(1e-7)
    expect(shots[0].direction.x).toBeGreaterThan(.2)
    expect(h.player.arrowCount).toBe(29)
    expect(h.mount.group.position.z).toBeGreaterThan(z + 15)
  })
})


it('Game Player fire callback carries a shot-specific airborne bow budget into the real projectile', () => {
  const h = harness()
  const scene = new THREE.Scene(), arrows: ArrowProjectile[] = []
  // Only the scene/UI boundary is provided; the production callback creates/updates a real arrow.
  const game = Object.assign(Object.create(Game.prototype), {
    scene, arrows, player: h.player, inventoryManager: h.inventory,
    combatEvents: { emit: vi.fn() }, quiverUI: { setArrowCount: vi.fn() },
  }) as { _bindPlayerCombatCallbacks(): void }
  onTestFinished(() => arrows.forEach(arrow => arrow.destroy()))
  game._bindPlayerCombatCallbacks()
  const origin = new THREE.Vector3(0, 40, -200), direction = new THREE.Vector3(0, .4, Math.sqrt(.84))
  h.player.onFireArrow!({ origin, direction, speed: 65, damage: 52.5, visualKind: 'arrow' })
  expect(arrows).toHaveLength(1)
  expect(arrows[0].maxFlightLifetimeSeconds).toBeGreaterThan(7)
  expect(arrows[0].maxFlightLifetimeSeconds).toBeLessThan(11)
  arrows[0].update(6, h.player, [], [], vi.fn(), () => { throw new Error('Own rider must not be hit') }, undefined, true)
  expect(arrows[0].isAlive).toBe(true)
  expect(arrows[0].mesh.position.y).toBeCloseTo(40 + .4 * 65 * 6 - .5 * 9.8 * 36)
})

it('movement-only deployment keeps eagle steering/flight and rider binding while cancelling its attack', () => {
  const h = harness(), before = h.mount.group.position.clone()
  const fire = vi.fn(); h.player.onFireArrow = fire
  h.update(controls({ consumeLeftClick: () => true }))
  expect(h.mount.eagleAttack!.weight).toBeGreaterThan(0)
  h.update(controls({ keys: { KeyW: true, ShiftLeft: true }, consumeLeftClick: () => true,
    isLeftMouseDown: true, isRightMouseDown: true }), .05, false)
  expect(h.mount.group.position.distanceTo(before)).toBeGreaterThan(.1)
  expect(h.mount.flight!.phase).toBe('cruise')
  expect(h.mount.eagleAttack!.active).toBe(false)
  expect(h.player.isAiming).toBe(false)
  expect(fire).not.toHaveBeenCalled()
  expect(h.player.currentMount).toBe(h.mount)
  const rider = h.player.position.clone()
  h.player.syncMountTransform()
  expect(h.player.position.distanceTo(rider)).toBeLessThan(.000001)
  for (let frame = 0; frame < 60; frame++) h.update(controls(), .05, false)
  h.update(controls({ consumeLeftClick: () => true }), .05, true)
  expect(h.mount.eagleAttack!.weight).toBeGreaterThan(0)
})
