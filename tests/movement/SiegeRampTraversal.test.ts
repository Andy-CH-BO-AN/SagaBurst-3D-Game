import { describe, expect, it, onTestFinished, vi } from 'vitest'
import * as THREE from 'three'
import { ArrowProjectile } from '../../src/world/ArrowProjectile'
import { Mount, MountType } from '../../src/world/Mount'
import { Player } from '../../src/player/Player'
import type { PlayerInput } from '../../src/player/PlayerInput'
import type { StaminaBar } from '../../src/ui/StaminaBar'
import type { QuiverUI } from '../../src/ui/QuiverUI'
import type { SoundManager } from '../../src/audio/SoundManager'
import { AIType, Faction, NPC } from '../../src/world/NPC'
import { getTerrainHeight, getWalkRampHeight } from '../../src/world/Terrain'
import { siegeActorRecord, siegeAssaultFixture } from '../helpers/siegeAssaultFixture'
import { MovingPlatformSupport } from '../../src/movement/MovingPlatformSupport'

vi.mock('../../src/world/HorseAssetRegistry', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/world/HorseAssetRegistry')>()),
  HorseAssetRegistry: { ready: true, createInstance: (await import('../helpers/gameplayHorseVisual')).createGameplayHorseVisual },
}))
vi.mock('../../src/world/CorgiVisual', async () => ({
  CorgiVisual: (await import('../helpers/gameplayQuadrupedVisual')).GameplayQuadrupedVisualDouble,
}))
vi.mock('../../src/world/BlackCatVisual', async () => ({
  BlackCatVisual: (await import('../helpers/gameplayQuadrupedVisual')).GameplayQuadrupedVisualDouble,
}))

describe('Siege surface movement: real actor/physics consumers', () => {
  it('carries one real NPC in world space without locomotion drift and detaches without changing position', () => {
    const scene = new THREE.Scene()
    const npc = new NPC(scene, 0, 0, Faction.ENEMY, 'viking', AIType.MELEE, 'Passenger', 1, false)
    onTestFinished(() => npc.dispose())
    npc.position.set(1, 8, 2)
    const support = new MovingPlatformSupport<NPC>(new THREE.Vector3(0, 8, 0))
    support.attach(npc)
    for (let i = 1; i <= 30; i++) support.moveTo(new THREE.Vector3(0, 8, i / 10))
    expect(npc.position.distanceTo(new THREE.Vector3(1, 8, 5))).toBeLessThan(1e-12)
    npc.group.updateWorldMatrix(true, true)
    expect(npc.group.getWorldPosition(new THREE.Vector3()).distanceTo(new THREE.Vector3(1, 8, 5))).toBeLessThan(1e-12)
    expect(npc.combatPosition.distanceTo(new THREE.Vector3(1, 8, 5))).toBeLessThan(1e-12)
    const hp = npc.hp
    const shooter = { targetable: false, currentMount: null, characterFaction: 'roman' } as Player
    const arrow = new ArrowProjectile(scene, new THREE.Vector3(1, 9, 3), new THREE.Vector3(0, 0, 1), 40, 10, Faction.PLAYER, true)
    onTestFinished(() => arrow.destroy())
    arrow.update(.1, shooter, [npc], [], () => {}, () => { throw new Error('unexpected Player hit') })
    expect(npc.hp).toBe(hp - 10)
    const before = npc.position.clone()
    support.detach(npc.combatantId)
    support.moveTo(new THREE.Vector3(0, 8, 10))
    expect(npc.position.equals(before)).toBe(true)
  })

  it('a real initially elevated passenger leaves only after Dock and charges across the physical bridge', () => {
    const h = siegeAssaultFixture('roman', false, false)
    const spec = h.specs[4]
    let initialSceneY: number | undefined
    h.scene.addEventListener('childadded', event => {
      if (event.child.name.startsWith('npc_')) initialSceneY = event.child.position.y
    })
    const npc = new NPC(h.scene, spec.x, spec.z, spec.faction, spec.characterFaction, spec.aiType, spec.name, spec.tier, false, spec.loadout, undefined, undefined, spec.actorId, undefined, undefined, undefined, undefined, undefined, undefined, { y: spec.spawnY! })
    const defender = new Player(h.scene)
    onTestFinished(() => { npc.dispose(); defender.dispose() })
    expect(initialSceneY).toBe(spec.spawnY)
    for (const candidate of h.specs) {
      const actor = candidate === spec ? npc : siegeActorRecord(candidate)
      h.actors.push(actor); h.owner.register(actor, candidate)
    }
    const ramp = h.owner.ramps[0]
    defender.position.copy(ramp.placement.deckConnection).add(new THREE.Vector3(4, .95, 0))
    const step = () => {
      h.navigation.beginFrame()
      npc.update(1 / 30, defender, [npc], [], h.obstacles, { setFill() {} }, () => {}, () => {}, false, 0, null, null, h.navigation)
    }
    const relative = npc.position.clone().sub(ramp.position)
    for (let i = 0; i < 100; i++) { ramp.update(.1, h.actors); step() }
    expect(npc.position.clone().sub(ramp.position).distanceTo(relative)).toBeLessThan(1e-8)
    expect(npc.siegeTransport).toBe('siege-ramp-left')
    for (let i = 0; i < 160; i++) ramp.update(.1, h.actors)
    expect(npc.siegeTransport).toBeNull()
    expect(npc.tacticalOrder).toBe('charge')
    for (let frame = 0; frame < 300 && h.navigation.outpostNav!.getNavLayer(npc.position) !== 'rampart_left'; frame++) step()
    expect(h.navigation.outpostNav!.getNavLayer(npc.position), `passenger stalled at ${npc.position.toArray()}`).toBe('rampart_left')
    expect(npc.position.y).toBeCloseTo(ramp.placement.deckConnection.y, 1)
  })

  it.each([MountType.HORSE, MountType.BLACK_CAT, MountType.CORGI])('%s: real Player input climbs the docked ramp to deck and descends continuously', type => {
    // Only one Player + one Mount; the convoy fixture uses zero real actors.
    const h = siegeAssaultFixture()
    const ramp = h.owner.ramps[0]
    for (let i = 0; i < 260; i++) ramp.update(.1, h.actors)
    expect(ramp.controller.state).toBe('DOCKED')
    const surface = ramp.surface
    const startZ = surface.startZ - surface.dirZ * 2
    const mount = new Mount(h.scene, type, surface.startX, startZ)
    const player = new Player(h.scene)
    onTestFinished(() => { player.dispose(); mount.dispose() })
    player.mountVehicle(mount, surface.dirZ > 0 ? 0 : Math.PI)
    const input = { keys: { KeyW: true }, isLeftMouseDown: false, isRightMouseDown: false,
      consumeLeftClick: () => false, consumeLeftClickRelease: () => false, consumeRightClick: () => false } as unknown as PlayerInput
    const stamina = { setFill() {} } as unknown as StaminaBar
    const quiver = { setAiming() {}, setChargeRatio() {} } as unknown as QuiverUI
    const sound = { playSwing() {}, playBowRelease() {} } as unknown as SoundManager
    const step = (direction: number) => {
      const before = mount.group.position.clone()
      const yaw = direction > 0 ? Math.PI : 0 // Player forward is camera -Z.
      player.update(1 / 60, input, yaw, ramp.placement.deckConnection, h.obstacles, stamina, quiver, sound)
      expect(mount.group.position.distanceTo(before)).toBeLessThan(.7)
    }
    let frames = 0
    while ((ramp.placement.deckConnection.z - mount.group.position.z) * surface.dirZ > .25 && frames++ < 900) step(surface.dirZ)
    expect(frames, `stalled at ${mount.group.position.toArray()}`).toBeLessThan(900)
    expect(mount.group.position.y).toBeCloseTo(ramp.placement.deckConnection.y, 1)
    expect(h.navigation.outpostNav!.getNavLayer(mount.group.position)).toBe('rampart_left')
    const deckZ = mount.group.position.z
    let crossFrames = 0
    while (mount.group.position.x < 6 && crossFrames++ < 600) {
      player.update(1 / 60, input, -Math.PI / 2, ramp.placement.deckConnection, h.obstacles, stamina, quiver, sound)
    }
    expect(crossFrames, `bridge stalled at ${mount.group.position.toArray()}`).toBeLessThan(600)
    expect(h.navigation.outpostNav!.getNavLayer(mount.group.position)).toBe('rampart_right')
    crossFrames = 0
    while (mount.group.position.x > surface.startX + .1 && crossFrames++ < 600) {
      player.update(1 / 60, input, Math.PI / 2, ramp.placement.deckConnection, h.obstacles, stamina, quiver, sound)
    }
    expect(crossFrames).toBeLessThan(600)
    expect(mount.group.position.z).toBeCloseTo(deckZ, 1)
    frames = 0
    while ((mount.group.position.z - startZ) * surface.dirZ > .25 && frames++ < 900) step(-surface.dirZ)
    expect(frames, `descent stalled at ${mount.group.position.toArray()}`).toBeLessThan(900)
    expect(mount.group.position.y).toBeCloseTo(getTerrainHeight(mount.group.position.x, mount.group.position.z), 1)
  })

  it.each(['formation', 'follow', 'charge'] as const)('real mounted NPC %s reaches the deck; removal revokes routing and stairs stay foot-only', command => {
    const h = siegeAssaultFixture('viking')
    const ramp = h.owner.ramps[0]
    const nav = h.navigation.outpostNav!
    const goal = ramp.placement.deckConnection.clone()
    const before = nav.resolveMoveTarget(ramp.placement.start, goal, true, new THREE.Vector3())
    expect(before.step).toBe('ground_approach')
    expect(before.target.y).toBe(getTerrainHeight(goal.x, goal.z))
    for (let i = 0; i < 260; i++) ramp.update(.1, h.actors)
    const surface = ramp.surface
    const z = surface.startZ - surface.dirZ * 3
    const rider = new NPC(h.scene, surface.startX, z, command === 'charge' ? Faction.ENEMY : Faction.PLAYER, 'roman', AIType.MELEE, 'Rider', 1, false)
    const mount = new Mount(h.scene, MountType.HORSE, surface.startX, z)
    const leader = new Player(h.scene)
    onTestFinished(() => { rider.dispose(); mount.dispose(); leader.dispose() })
    rider.mountVehicle(mount)
    leader.position.copy(goal).add(new THREE.Vector3(0, .95, 0))
    if (command === 'formation') rider.assignFormationTarget(1, goal, new THREE.Vector3(0, 0, 1), 3)
    else if (command === 'follow') rider.assignFollowTarget(leader, 0)
    else rider.setTacticalOrder('charge')
    let highest = -Infinity
    for (let frame = 0; frame < 900; frame++) {
      h.navigation.beginFrame()
      rider.update(1 / 30, leader, [rider], [], h.obstacles, { setFill() {} }, () => {}, () => {}, false, 0, null, null, h.navigation)
      highest = Math.max(highest, mount.group.position.y)
      if (nav.getNavLayer(mount.group.position) === 'rampart_left') break
    }
    expect(nav.getNavLayer(mount.group.position), `mounted NPC ${command} stalled at ${mount.group.position.toArray()}`).toBe('rampart_left')
    expect(highest).toBeGreaterThan(surface.startY + 2)
    expect(getWalkRampHeight(surface, surface.startX, surface.startZ + surface.dirZ * 2)).not.toBeNull()
    ramp.damageable.destroy()
    expect(nav.entrances.hasMountedRamp).toBe(false)
    const stair = nav.getStair(1)!
    const blocked = nav.resolveMoveTarget(new THREE.Vector3(stair.ramp.startX, stair.ramp.startY, stair.ramp.startZ), goal, true, new THREE.Vector3())
    expect(blocked.step).toBe('ground_approach')
    expect(blocked.target.y).toBe(getTerrainHeight(goal.x, goal.z))
  })
})
