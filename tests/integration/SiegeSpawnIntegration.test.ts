import * as THREE from 'three'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { TownDefenseController } from '../../src/career/TownDefenseController'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { createEnemyTownAssaultMission } from '../../src/career/EnemyTownAssault'
import { createTownDefenseMission } from '../../src/career/CareerMissionState'
import { CampaignGateController } from '../../src/campaign/CampaignGate'
import { NavigationWorld } from '../../src/navigation/NavigationWorld'
import type { Player } from '../../src/player/Player'
import { TownCavalryPatrolController } from '../../src/town/TownCavalryPatrolController'
import { TownOutskirtsWarfareController } from '../../src/town/TownOutskirtsWarfareController'
import { TOWN_NAVIGATION_BOUNDS } from '../../src/town/TownBounds'
import { TOWN_GATES, type TownGateId } from '../../src/town/TownLayout'
import { DamageableObstacle } from '../../src/world/DamageableObstacle'
import { Faction } from '../../src/world/NPC'
import { Mount, MountType } from '../../src/world/Mount'
import { NpcSpawnScheduler } from '../../src/world/NpcSpawnScheduler'
import type { ObstacleData } from '../../src/world/Terrain'
import { NpcSpawnTestDriver } from '../helpers/npcSpawnFrames'
import { recording, resetSpawnRecording } from '../helpers/npcSpawnRecording'

vi.mock('../../src/world/NPC', async original => ({
  ...(await original<typeof import('../../src/world/NPC')>()),
  NPC: (await import('../helpers/npcSpawnRecording')).RecordingNpc,
}))
vi.mock('../../src/world/Mount', async original => ({
  ...(await original<typeof import('../../src/world/Mount')>()),
  Mount: (await import('../helpers/npcSpawnRecording')).RecordingMount,
}))
vi.mock('../../src/career/MissionGuide', () => ({
  MissionGuide: class { hide = vi.fn(); dispose = vi.fn(); updateTownDefense = vi.fn() },
}))

afterEach(() => { vi.restoreAllMocks(); resetSpawnRecording() })

// These identity contracts are independent of siegeRoster and the observed queue.
// TownSiegePolicy owns the full slot/tier/unit/faction matrix without actors.
const assaultIds = Array.from({ length: 119 }, (_, index) => `siege-assault:siege:${index}`)
const defenseIds = Array.from({ length: 120 }, (_, index) => `siege-defense:siege:${index}`)

/** No TownWorld, resident actors or GLB. Four mesh-free gate controllers provide
 * the finalizer's real close/listener/cleanup boundary; NPC/Mount are recordings. */
function siegeFixture(assault: boolean, survivorIds?: readonly string[]) {
  const scheduler = new NpcSpawnScheduler(), driver = new NpcSpawnTestDriver(scheduler)
  const scene = new THREE.Scene(), obstacles: ObstacleData[] = []
  const gates = new Map<TownGateId, CampaignGateController>()
  for (const spec of TOWN_GATES) {
    const root = new THREE.Group(), leftHinge = new THREE.Group(), rightHinge = new THREE.Group()
    root.add(leftHinge, rightHinge); scene.add(root)
    const damageable = new DamageableObstacle({ kind: 'gate', maxHp: 2080, root, ownerFaction: assault ? 'viking' : 'roman' })
    const obstacle: ObstacleData = { box: new THREE.Box3(
      new THREE.Vector3(spec.x - 1, -1, spec.z - 1), new THREE.Vector3(spec.x + 1, 8, spec.z + 1)),
    isBarricade: false, damageable }
    gates.set(spec.id, new CampaignGateController({ defenderFaction: assault ? 'viking' : 'roman', damageable,
      obstacle, obstacles, leftHinge, rightHinge, openRotationY: Math.PI / 2, initialState: 'open' }))
  }
  const group = new THREE.Group()
  // Player visual/input APIs are outside spawn ownership; this is the exact
  // state and placement surface read by the real finalizer and checkpoint.
  const player = { group, dead: false, hp: 100, staminaValue: 100,
    get combatPosition() { return group.position }, faceDirection: vi.fn() } as unknown as Player
  let profile = createCareerProfile('roman')
  profile.rank = 'captain'
  profile.activeMission = assault ? createEnemyTownAssaultMission('siege-assault') : createTownDefenseMission([], [], 'siege-defense')
  if (survivorIds) {
    const ids = assault ? assaultIds : defenseIds
    profile.activeMission.siege!.rosterCreated = true
    profile.activeMission.siege!.attackerIds = [...ids]
    if (assault) profile.activeMission.deadFriendlyActorIds = ids.filter(id => !survivorIds.includes(id))
    else profile.activeMission.deadTargetActorIds = ids.filter(id => !survivorIds.includes(id))
  }
  const navigation = new NavigationWorld(TOWN_NAVIGATION_BOUNDS)
  const cat = new Mount(scene, MountType.BLACK_CAT, -34, 20)
  const patrol = new TownCavalryPatrolController([])
  const context: NonNullable<ConstructorParameters<typeof TownDefenseController>[7]> = {
    gates, obstacles, patrol, closureBodies: () => [],
  }
  const controller = new TownDefenseController(scene, [], () => player, () => profile,
    next => { profile = next; return true }, cat, navigation, context, scheduler)
  onTestFinished(() => {
    controller.cleanupMission(); controller.dispose(); context.outskirts?.dispose(); cat.dispose()
    expect(scheduler.pending).toBe(0)
  })
  return { controller, scene, driver, scheduler, navigation, gates, context, profile: () => profile }
}

describe('Siege spawn caller protocol', () => {
  it.each([
    { assault: true, count: 119, ids: assaultIds, faction: Faction.TOWN, characterFaction: 'roman' },
    { assault: false, count: 120, ids: defenseIds, faction: Faction.ENEMY, characterFaction: 'viking' },
  ])('queues all $count independent identities, registers the final actor and then unlocks preparation, assault=$assault', ({ assault, count, ids, faction, characterFaction }) => {
    const h = siegeFixture(assault), mountStart = recording.mounts.length
    expect(h.controller.startActiveMission()).toBe(true)
    const batch = h.controller.spawnBatches[0]
    expect(h.controller.startActiveMission()).toBe(true)
    expect(h.controller.spawnBatches).toEqual([batch])
    expect([...batch.actors.keys()]).toEqual(ids)
    expect(h.scheduler.pending).toBe(count)
    expect(recording.npcs).toHaveLength(0)
    expect(recording.mounts).toHaveLength(mountStart)
    expect(h.controller.ready).toBe(false)
    expect(h.controller.releasedEnemies).toHaveLength(0)
    h.controller.updateFlow(100, 0)
    expect(h.controller.preparationRemaining).toBe(10)
    expect(h.controller.phase).toBe('PREPARING')
    expect(h.controller.evaluate(true)).toBeNull()
    h.driver.advanceFrame()
    expect(h.controller.enemies.map(npc => npc.combatantId)).toEqual([ids[0]])
    expect(h.controller.ready).toBe(false)
    for (let frame = 1; frame < count - 1; frame++) h.driver.advanceFrame()
    expect(recording.npcs).toHaveLength(count - 1)
    expect(h.controller.ready).toBe(false)
    expect(batch.ready).toBe(false)
    h.controller.updateFlow(100, 0)
    expect(h.controller.preparationRemaining).toBe(10)
    expect(h.controller.evaluate(true)).toBeNull()
    h.driver.advanceFrame()
    expect(batch.status).toBe('complete')
    expect(h.controller.ready).toBe(true)
    expect(recording.npcs.map(npc => npc.combatantId)).toEqual(ids)
    expect(new Set(recording.npcs.map(npc => npc.combatantId)).size).toBe(count)
    expect(h.controller.enemies.map(npc => npc.combatantId)).toEqual(ids)
    expect(h.profile().activeMission!.siege!.attackerIds).toEqual(ids)
    expect(assault ? h.profile().activeMission!.friendlyActorIds : h.profile().activeMission!.targetActorIds).toEqual(ids)
    expect(recording.mounts).toHaveLength(mountStart + count)
    for (const npc of recording.npcs) {
      expect(npc).toMatchObject({ faction, characterFaction, mountedInput: true })
      expect(npc.mountVehicle).toHaveBeenCalledExactlyOnceWith(npc.mount)
    }
    expect(h.controller.enemyMounts).toEqual(recording.mounts.slice(mountStart))
    expect([...h.gates.values()].every(gate => gate.state === 'closed')).toBe(true)
    expect(h.controller.preparationRemaining).toBe(10)
    expect(h.controller.releasedEnemies).toHaveLength(0)
    h.controller.updateFlow(9.9, 0)
    expect(h.controller.phase).toBe('PREPARING')
    expect(h.controller.releasedEnemies).toHaveLength(0)
    h.controller.updateFlow(.1, 0)
    expect(h.controller.phase).toBe('ATTACKING')
    expect(h.controller.releasedEnemies.map(npc => npc.combatantId)).toEqual(ids)
    h.controller.cleanupMission()
    expect(h.controller.enemies).toHaveLength(0)
    expect(h.controller.enemyMounts).toHaveLength(0)
    expect(recording.npcs.every(npc => npc.dispose.mock.calls.length === 1)).toBe(true)
    expect(recording.mounts.slice(mountStart).every(mount => mount.dispose.mock.calls.length === 1)).toBe(true)
    expect([...h.gates.values()].every(gate => gate.state === 'open')).toBe(true)
  })

  it('keeps failed deployment finalization unready, rolls back caller registrations and does not consume countdown', () => {
    const h = siegeFixture(false, ['siege-defense:siege:2', 'siege-defense:siege:119'])
    expect(h.controller.startActiveMission()).toBe(true)
    const batch = h.controller.spawnBatches[0]
    expect([...batch.actors.keys()]).toEqual(['siege-defense:siege:2', 'siege-defense:siege:119'])
    vi.spyOn(h.navigation, 'sync').mockImplementation(() => { throw new Error('Siege navigation finalizer failed') })
    h.driver.advanceFrame()
    expect(h.controller.ready).toBe(false)
    h.driver.advanceFrame()
    expect(batch.status).toBe('failed')
    expect(batch.error).toEqual(new Error('Siege navigation finalizer failed'))
    expect(h.controller.ready).toBe(false)
    expect(h.controller.enemies).toHaveLength(0)
    expect(h.controller.enemyMounts).toHaveLength(0)
    expect(recording.npcs.every(npc => npc.dispose.mock.calls.length > 0)).toBe(true)
    expect(recording.mounts.slice(1).every(mount => mount.dispose.mock.calls.length > 0)).toBe(true)
    h.controller.updateFlow(100, 0)
    expect(h.controller.preparationRemaining).toBe(10)
    expect(h.controller.phase).toBe('PREPARING')
    expect(h.controller.evaluate(true)).toBeNull()
    expect(h.scheduler.pending).toBe(0)
    h.gates.get('north')!.destroy()
    expect(h.controller.reserveHasCharged).toBe(false)
  })

  it('cancels its pending Siege identities and disposes registered actors when the owner cleans up', () => {
    const h = siegeFixture(false, ['siege-defense:siege:2', 'siege-defense:siege:119'])
    expect(h.controller.startActiveMission()).toBe(true)
    const batch = h.controller.spawnBatches[0]
    h.driver.advanceFrame()
    expect(recording.npcs.map(npc => npc.combatantId)).toEqual(['siege-defense:siege:2'])
    h.controller.cleanupMission()
    expect(batch.status).toBe('cancelled')
    expect(batch.actors.get('siege-defense:siege:119')).toBe('cancelled')
    expect(h.controller.enemies).toHaveLength(0)
    expect(h.controller.enemyMounts).toHaveLength(0)
    expect(recording.npcs[0].dispose).toHaveBeenCalledOnce()
    expect(recording.mounts[1].dispose).toHaveBeenCalledOnce()
    h.driver.advanceFrame()
    expect(recording.npcs.map(npc => npc.combatantId)).toEqual(['siege-defense:siege:2'])
    expect(h.scheduler.pending).toBe(0)
    expect([...h.gates.values()].every(gate => gate.state === 'open')).toBe(true)
  })

  it('reuses a partially loaded outskirts rider once and transfers its lifetime to Siege cleanup', () => {
    const h = siegeFixture(false)
    const outskirts = new TownOutskirtsWarfareController(h.scene, 'roman', h.profile, [], h.navigation,
      undefined, [], h.scheduler)
    h.context.outskirts = outskirts
    // A reduced candidate source: unrelated background batches are cancelled,
    // and only one rider is materialized before the real claim cancels its tail.
    for (const batch of outskirts.batches) if (!batch.actors.has('outskirts:cavalry:a:0')) batch.cancel()
    h.driver.advanceFrame()
    const claimed = outskirts.actors[0], mount = claimed.mount!
    const original = recording.npcs[0], originalMount = recording.mounts[1]
    const position = claimed.combatPosition.clone()
    expect(claimed.combatantId).toBe('outskirts:cavalry:a:0')
    expect(h.controller.startActiveMission()).toBe(true)
    const ids = [...defenseIds]; ids[1] = 'outskirts:cavalry:a:0'
    expect(h.controller.enemies).toEqual([claimed])
    expect([...h.controller.spawnBatches[0].actors.keys()]).toEqual(ids.filter(id => id !== claimed.combatantId))
    expect(h.profile().activeMission!.siege!.attackerIds).toEqual(ids)
    expect(outskirts.owns(claimed)).toBe(false)
    expect(claimed.combatPosition).toEqual(position)
    expect(claimed.mount).toBe(mount)
    expect(original.dispose).not.toHaveBeenCalled()
    expect(originalMount.dispose).not.toHaveBeenCalled()
    expect(h.controller.startActiveMission()).toBe(true)
    h.driver.drain()
    expect(h.controller.ready).toBe(true)
    expect(recording.npcs.filter(npc => npc.combatantId === claimed.combatantId)).toEqual([original])
    expect(new Set(h.controller.enemies.map(npc => npc.combatantId))).toEqual(new Set(ids))
    expect(original.applyTemporaryCombatLoadout).toHaveBeenCalledOnce()
    expect(original.dispose).not.toHaveBeenCalled()
    expect(originalMount.dispose).not.toHaveBeenCalled()
    h.controller.cleanupMission()
    expect(original.dispose).toHaveBeenCalledOnce()
    expect(originalMount.dispose).toHaveBeenCalledOnce()
    // Cleanup gives the real outskirts owner permission to enqueue replacements.
    expect(outskirts.batches.some(batch => batch.actors.has('outskirts:cavalry:a:0:wave:1'))).toBe(true)
    outskirts.dispose()
    expect(original.dispose).toHaveBeenCalledOnce()
    expect(originalMount.dispose).toHaveBeenCalledOnce()
  })
})
