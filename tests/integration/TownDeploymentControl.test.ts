import * as THREE from 'three'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { TownScene } from '../../src/town/TownScene'
import { Player } from '../../src/player/Player'
import { ThirdPersonCamera } from '../../src/camera/ThirdPersonCamera'
import { InventoryManager } from '../../src/rpg/InventoryManager'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { createTownDefenseMission } from '../../src/career/CareerMissionState'
import { createEnemyTownAssaultMission } from '../../src/career/EnemyTownAssault'
import { NpcSpawnScheduler, gameplayNpcSpawns } from '../../src/world/NpcSpawnScheduler'
import { NpcSpawnTestDriver } from '../helpers/npcSpawnFrames'
import { Mount, MountType } from '../../src/world/Mount'
import { getTerrainHeight } from '../../src/world/Terrain'

vi.mock('../../src/world/HorseAssetRegistry', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/world/HorseAssetRegistry')>()),
  HorseAssetRegistry: {
    ready: true,
    createInstance: (await import('../helpers/gameplayHorseVisual')).createGameplayHorseVisual,
  },
}))

/** The real TownScene frame gate and simulation dispatch, one procedural Player,
 * real camera; zero TownWorld, NPCs or GLBs. The mounted case adds one
 * real Mount with the existing visual double. Record domain consumers to
 * verify when they run; their AI/outcome internals have separate owners. */
function controlFixture() {
  const scene = new THREE.Scene(), player = new Player(scene)
  onTestFinished(() => player.dispose())
  player.group.position.set(0, getTerrainHeight(0, 0) + .9, 0)
  const camera = new THREE.PerspectiveCamera(58, 1, .1, 500)
  const orbit = new ThirdPersonCamera(camera, player)
  const scheduler = new NpcSpawnScheduler(), driver = new NpcSpawnTestDriver(scheduler)
  const batch = scheduler.batch()
  batch.enqueue('deployment:a', () => {}); batch.enqueue('deployment:b', () => {}); batch.seal()
  onTestFinished(() => batch.cancel())
  const profile = createCareerProfile('roman')
  const state = {
    player, camera, orbit, profile, panel: null as object | null, result: null as string | null,
    equipment: { visible: false }, spawnErrorShown: false, elapsed: 0,
    input: { keys: { KeyW: true, ShiftLeft: true }, isLeftMouseDown: true, isRightMouseDown: true,
      consumeLeftClick: vi.fn(() => true), consumeLeftClickRelease: vi.fn(() => true),
      consumeMouseDelta: vi.fn(() => ({ dx: 5, dy: 3 })), consumeWheelStep: () => 0 as const },
    inventory: new InventoryManager(), skills: { getRangedMultiplier: () => 1 },
    stamina: { setFill() {} }, quiver: { setShieldBlocked() {}, setAiming() {}, setChargeRatio() {} },
    world: { obstacles: [] }, residents: [], mounts: [], stableHorses: [],
    spectator: null as { update: ReturnType<typeof vi.fn> } | null,
    cat: { dead: true }, careerMounts: { update: vi.fn() },
    outskirts: { synchronizeRank: vi.fn(), mounts: [] },
    event: { hostile: false, evaluate: vi.fn(() => null) },
    mission: { get ready() { return batch.ready }, spawnBatches: [batch], evaluate: vi.fn(() => null), returnComplete: false },
    defense: { ready: true, active: false }, duel: { active: false },
    missionCombat: { update: vi.fn(), updateDepartingCavalry: vi.fn(), updateDefeatedActors: vi.fn() },
    weaponWheel: { cycle: vi.fn() },
    melee: vi.fn(), updateHostile: vi.fn(), refreshCombatMounts: vi.fn(),
    updateCareerHorseAudio: vi.fn(), resolveBodies: vi.fn(), updateShots: vi.fn(),
    persistPersonalSquad: vi.fn(), interaction: vi.fn(),
  }
  // Only expose the private caller under test; do not construct the renderer/UI.
  const town = Object.assign(Object.create(TownScene.prototype) as object, state) as typeof state & {
    updateGameplay(dt: number): void
  }
  town.inventory.equipWeapon('elven_runebow')
  const updatePlayer = vi.spyOn(player, 'update'), updateCamera = vi.spyOn(orbit, 'update')
  const combatCalls = () => [town.melee, town.missionCombat.update, town.updateShots,
    town.event.evaluate, town.mission.evaluate, town.persistPersonalSquad]
  return { town, scene, player, orbit, batch, driver, updatePlayer, updateCamera, combatCalls }
}

afterEach(() => vi.restoreAllMocks())

describe('Career deployment control dispatch', () => {
  it('moves and orbits while pending, freezes simulation/time/outcomes, then updates Player only once when complete', () => {
    const h = controlFixture(), before = h.player.position.clone(), yaw = h.orbit.cameraYaw
    h.town.updateGameplay(.05)
    expect(h.player.position.distanceTo(before)).toBeGreaterThan(.1)
    expect(h.orbit.cameraYaw).not.toBe(yaw)
    expect(h.player.isAiming).toBe(false)
    expect(h.player.swinging).toBe(false)
    expect(h.town.elapsed).toBe(0)
    expect(h.updatePlayer).toHaveBeenCalledTimes(1)
    expect(h.updatePlayer.mock.calls[0][10]).toBe(false)
    for (const consumer of h.combatCalls()) expect(consumer).not.toHaveBeenCalled()
    expect(h.town.careerMounts.update).toHaveBeenCalledOnce()
    expect(h.town.interaction).toHaveBeenCalledOnce()

    h.driver.drain()
    h.town.input.isLeftMouseDown = false
    h.town.input.consumeLeftClick.mockReturnValue(false)
    h.town.input.consumeLeftClickRelease.mockReturnValue(false)
    h.town.updateGameplay(.05)
    expect(h.updatePlayer).toHaveBeenCalledTimes(2)
    expect(h.updatePlayer.mock.calls[1][10]).toBe(true)
    expect(h.player.isAiming).toBe(true)
    expect(h.town.elapsed).toBe(.05)
    for (const consumer of h.combatCalls()) expect(consumer).toHaveBeenCalledOnce()
  })

  it('uses the existing ground-mount movement/jump and preserves rider synchronization while pending', () => {
    const h = controlFixture(), mount = new Mount(h.scene, MountType.HORSE, 0, 0)
    onTestFinished(() => mount.dispose())
    mount.group.position.y = getTerrainHeight(0, 0)
    mount.beginControlledFrame(); mount.finishControlledFrame(0, [])
    h.player.mountVehicle(mount)
    const before = mount.group.position.clone()
    Object.assign(h.town.input.keys, { Space: true })
    h.town.updateGameplay(.05)
    expect(mount.group.position.distanceTo(before)).toBeGreaterThan(.1)
    expect(mount.group.position.y).toBeGreaterThan(before.y)
    const rider = h.player.position.clone()
    h.player.syncMountTransform()
    expect(h.player.position.distanceTo(rider)).toBeLessThan(.000001)
    expect(h.player.currentMount).toBe(mount)
    for (const consumer of h.combatCalls()) expect(consumer).not.toHaveBeenCalled()
  })

  it('keeps panels, equipment, pause/results and failed deployment stopped even after the error panel closes', () => {
    const h = controlFixture()
    for (const block of ['panel', 'equipment', 'result'] as const) {
      h.town.panel = block === 'panel' ? {} : null
      h.town.equipment.visible = block === 'equipment'
      h.town.result = block === 'result' ? 'failed' : null
      h.town.updateGameplay(.05)
    }
    // A real failed batch blocks dispatch independently of the visible error panel.
    h.town.result = null
    h.batch.fail(undefined, new Error('spawn failed'))
    h.town.updateGameplay(.05)
    h.town.spawnErrorShown = true; h.town.panel = null
    h.town.updateGameplay(.05)
    expect(h.updatePlayer).not.toHaveBeenCalled()
    expect(h.updateCamera).not.toHaveBeenCalled()
    for (const consumer of h.combatCalls()) expect(consumer).not.toHaveBeenCalled()
    expect(h.town.elapsed).toBe(0)
  })

  it('does not update a dead Player again and lets Observer move while mission deployment is pending', () => {
    const h = controlFixture()
    h.player.takeDamage(10000, { setFill() {} })
    h.town.spectator = { update: vi.fn() }
    h.town.updateGameplay(.05)
    expect(h.updatePlayer).not.toHaveBeenCalled()
    expect(h.updateCamera).not.toHaveBeenCalled()
    expect(h.town.spectator.update).toHaveBeenCalledOnce()
    for (const consumer of h.combatCalls()) expect(consumer).not.toHaveBeenCalled()
  })
})

it.each([true, false])('restores equipment and synchronizes a restored rider at the saved siege position without waiting, assault=%s', async assault => {
  const scheduler = new NpcSpawnScheduler()
  const batch = scheduler.batch()
  batch.enqueue('pending-entry', () => {}); batch.seal()
  onTestFinished(() => batch.cancel())
  const profile = createCareerProfile('roman')
  profile.activeMission = assault ? createEnemyTownAssaultMission('entry-assault') : createTownDefenseMission([], [], 'entry-defense')
  profile.activeMission.siege!.playerPosition = { x: 12, z: 14, yaw: .4 }
  profile.activeMission.mountState = { activeMountId: 'horse', hp: { horse: 67 }, unavailable: [] }
  const group = new THREE.Group(); group.position.set(12, 1, 14)
  // Transform-only restore boundary: existing real Player/Mount tests own seat physics.
  const mount = { group: new THREE.Group() }, offset = new THREE.Vector3(0, 2.5, 0)
  const player = { group, combatPosition: group.position, currentMount: null as typeof mount | null, facingYaw: .4,
    faceDirection(x: number, z: number) { mount.group.rotation.y = Math.atan2(x, z) },
    syncMountTransform() { group.position.copy(mount.group.position).add(offset) },
  }
  const state = {
    profile, player,
    mission: { spawnBatches: [] },
    defense: { startActiveMission: vi.fn(() => true), spawnBatches: [batch] },
    inventory: { prepareForCombat: vi.fn() }, careerMounts: { restoreActiveMount: vi.fn(() => {
      // Mount creation initially chooses a nearby safe point, then TownScene must
      // apply the saved anchor and resynchronize its rider before controls resume.
      mount.group.position.set(15, 0, 17); player.currentMount = mount
      player.syncMountTransform()
    }) },
    restorePersonalSquad: vi.fn(),
  }
  const town = Object.assign(Object.create(TownScene.prototype) as object, state) as typeof state & {
    restoreActiveCareerMission(): Promise<void>
  }
  const wait = vi.spyOn(gameplayNpcSpawns, 'wait')
  await town.restoreActiveCareerMission()
  expect(batch.status).toBe('pending')
  expect(town.inventory.prepareForCombat).toHaveBeenCalledOnce()
  expect(town.careerMounts.restoreActiveMount).toHaveBeenCalledOnce()
  expect(wait).not.toHaveBeenCalled()
  expect(mount.group.position.toArray()).toEqual([12, getTerrainHeight(12, 14), 14])
  expect(mount.group.rotation.y).toBeCloseTo(.4)
  expect(group.position.clone().sub(mount.group.position)).toEqual(offset)
})
