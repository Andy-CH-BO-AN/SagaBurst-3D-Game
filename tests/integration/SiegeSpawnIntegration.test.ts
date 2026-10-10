import * as THREE from 'three'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { TownDefenseController } from '../../src/career/TownDefenseController'
import { TownScene } from '../../src/town/TownScene'
import { PersonalSquadRuntime } from '../../src/career/PersonalSquadRuntime'
import { snapshotPersonalMission } from '../../src/career/CareerPersonalSquadMission'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import { MemoryStorage } from '../helpers/memoryStorage'
import { CareerMountController } from '../../src/career/CareerMountController'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { acceptCaptainSiegeCommand, createEnemyTownAssaultMission } from '../../src/career/EnemyTownAssault'
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
import { getTerrainHeight, type ObstacleData } from '../../src/world/Terrain'
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
function siegeFixture(assault: boolean, survivorIds?: readonly string[], store?: CareerProfileStore) {
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
    get combatPosition() { return group.position }, get facingYaw() { return group.rotation.y }, faceDirection: vi.fn() } as unknown as Player
  let profile = createCareerProfile('roman')
  profile.rank = 'captain'
  profile.activeMission = assault ? createEnemyTownAssaultMission('siege-assault') : createTownDefenseMission([], [], 'siege-defense')
  if (survivorIds) {
    const ids = assault ? assaultIds : defenseIds
    profile.activeMission.siege!.rosterCreated = true
    profile.activeMission.siege!.attackerIds = [...ids]
    if (assault) {
      profile.activeMission.friendlyActorIds = [...ids]
      profile.activeMission.deadFriendlyActorIds = ids.filter(id => !survivorIds.includes(id))
    } else {
      profile.activeMission.targetActorIds = [...ids]
      profile.activeMission.deadTargetActorIds = ids.filter(id => !survivorIds.includes(id))
    }
  }
  const navigation = new NavigationWorld(TOWN_NAVIGATION_BOUNDS)
  const cat = new Mount(scene, MountType.BLACK_CAT, -34, 20)
  const patrol = new TownCavalryPatrolController([])
  const context: NonNullable<ConstructorParameters<typeof TownDefenseController>[7]> = {
    gates, obstacles, patrol, closureBodies: () => [],
  }
  let failNextCommit = false
  const controller = new TownDefenseController(scene, [], () => player, () => profile,
    next => { if (failNextCommit) { failNextCommit = false; return false } if (store && !store.save(next)) return false; profile = next; return true }, cat, navigation, context, scheduler)
  onTestFinished(() => {
    controller.cleanupMission(); controller.dispose(); context.outskirts?.dispose(); cat.dispose()
    expect(scheduler.pending).toBe(0)
  })
  return { controller, player, scene, driver, scheduler, navigation, gates, context, profile: () => profile, setProfile: (next: typeof profile) => { profile = next }, failNextCommit: () => { failNextCommit = true },
    reloadProfile: () => { const storage = store ?? new CareerProfileStore(new MemoryStorage()); expect(storage.save(profile)).toBe(true); profile = storage.load()! } }
}

describe('Siege spawn caller protocol', () => {
  it.each([
    { assault: true, count: 119, mounts: 79, ids: assaultIds, faction: Faction.TOWN, characterFaction: 'roman' },
    { assault: false, count: 120, mounts: 80, ids: defenseIds, faction: Faction.ENEMY, characterFaction: 'viking' },
  ])('queues all $count independent identities, registers the final actor and then unlocks preparation, assault=$assault', ({ assault, count, mounts, ids, faction, characterFaction }) => {
    const h = siegeFixture(assault), mountStart = recording.mounts.length
    expect(h.controller.startActiveMission()).toBe(true)
    const batch = h.controller.spawnBatches[0]
    if (assault) expect(h.player.group.position.z).toBeLessThan(-100)
    h.player.group.position.set(14, 32, 16)
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
    expect(h.player.group.position.toArray()).toEqual([14, 32, 16])
    expect(h.controller.ready).toBe(true)
    expect(recording.npcs.map(npc => npc.combatantId)).toEqual(ids)
    expect(new Set(recording.npcs.map(npc => npc.combatantId)).size).toBe(count)
    expect(h.controller.enemies.map(npc => npc.combatantId)).toEqual(ids)
    expect(h.profile().activeMission!.siege!.attackerIds).toEqual(ids)
    expect(assault ? h.profile().activeMission!.friendlyActorIds : h.profile().activeMission!.targetActorIds).toEqual(ids)
    expect(recording.mounts).toHaveLength(mountStart + mounts)
    expect(recording.npcs.filter(npc => !npc.mountedInput)).toHaveLength(40)
    for (const npc of recording.npcs) {
      expect(npc).toMatchObject({ faction, characterFaction, missionAerialDefense: true })
      expect(npc.mountedInput).toBe(Boolean(npc.loadout?.mountId))
      if (npc.mountedInput) expect(npc.mountVehicle).toHaveBeenCalledExactlyOnceWith(npc.mount)
      else { expect(npc.mount).toBeNull(); expect(npc.mountVehicle).not.toHaveBeenCalled() }
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


  it.each([
    { assault: false, version: undefined, ids: defenseIds, rangedIndex: 20, expectedPreset: 'viking_horse_archer', mounted: true },
    { assault: true, version: undefined, ids: assaultIds, rangedIndex: 19, expectedPreset: 'roman_horse_archer', mounted: true },
    { assault: false, version: 2, ids: defenseIds, rangedIndex: 20, expectedPreset: 'viking_archer', mounted: false },
    { assault: true, version: 2, ids: assaultIds, rangedIndex: 19, expectedPreset: 'roman_archer', mounted: false },
  ] as const)('reloads version=$version assault=$assault without converting saved soldiers or reviving dead riders/mounts', ({ assault, version, ids, rangedIndex, expectedPreset, mounted }) => {
    const h = siegeFixture(assault, [ids[2], ids[3], ids[rangedIndex]])
    const active = h.profile().activeMission!
    if (version === undefined) delete active.siege!.rosterVersion
    else active.siege!.rosterVersion = version
    active.siege!.crossedActorIds = [ids[rangedIndex]]
    active.actorHealth = { [ids[2]]: { hp: 43, mountHp: 0 }, [ids[3]]: { hp: 0, mountHp: 70 }, [ids[rangedIndex]]: { hp: 61 } }
    h.reloadProfile()
    expect(h.controller.startActiveMission()).toBe(true)
    expect([...h.controller.spawnBatches[0].actors.keys()]).toEqual([ids[2], ids[rangedIndex]])
    h.driver.drain()
    expect(h.controller.enemies.map(npc => npc.combatantId)).toEqual([ids[2], ids[rangedIndex]])
    expect(recording.npcs[0]).toMatchObject({ hp: 43, mount: null,
      presetId: `${assault ? 'roman' : 'viking'}_${version === undefined ? 'sword_cavalry' : 'lancer'}` })
    expect(recording.npcs[1]).toMatchObject({ hp: 61, presetId: expectedPreset, mountedInput: mounted })
    expect(Boolean(recording.npcs[1].mount)).toBe(mounted)
    expect(recording.npcs[1].tacticalOrder).toBe(version === 2 ? 'attack' : 'charge')
    expect(h.controller.enemyMounts).toHaveLength(mounted ? 1 : 0)
    expect(h.profile().activeMission!.siege!.attackerIds).toEqual(ids)
    expect(h.profile().activeMission!.siege!.rosterVersion).toBe(version ?? 1)
    expect(assault ? h.profile().activeMission!.deadFriendlyActorIds : h.profile().activeMission!.deadTargetActorIds).toContain(ids[3])
  })

  it.each([false, true])('accounts for saved zero-HP attackers without constructing dead soldiers, initial commit fails=%s', failFirstCommit => {
    const h = siegeFixture(false, [defenseIds[2]])
    h.profile().activeMission!.actorHealth = { [defenseIds[2]]: { hp: 0 } }
    h.reloadProfile()
    if (failFirstCommit) {
      h.failNextCommit()
      expect(h.controller.startActiveMission()).toBe(false)
      expect(h.controller.ready).toBe(false)
      expect(h.controller.evaluate(false)).toBeNull()
      expect(h.profile().activeMission!.deadTargetActorIds).toHaveLength(119)
    }
    expect(h.controller.startActiveMission()).toBe(true)
    expect(recording.npcs).toHaveLength(0)
    expect(h.scheduler.pending).toBe(0)
    expect(h.profile().activeMission!.deadTargetActorIds).toHaveLength(120)
    h.controller.updateFlow(10, 0)
    expect(h.controller.evaluate(false)).toBe('victory')
  })

  it('keeps a Viking bow infantry bow order when crossing a breached gate while lancers still charge', () => {
    const ids = [defenseIds[2], defenseIds[20]]
    const h = siegeFixture(false, ids)
    const active = h.profile().activeMission!
    active.phase = 'ATTACKING'
    active.siege!.approachedActorIds = [...ids]
    active.siege!.destroyedGateIds = ['north']
    active.actorPositions = Object.fromEntries(ids.map(id => [id, { x: 0, z: -103, yaw: 0 }]))
    expect(h.controller.startActiveMission()).toBe(true)
    h.driver.drain()
    expect(recording.npcs[0]).toMatchObject({ presetId: 'viking_lancer', tacticalOrder: 'charge', missionMovement: false })
    expect(recording.npcs[1]).toMatchObject({ presetId: 'viking_archer', tacticalOrder: 'attack', missionMovement: false })
    expect(h.profile().activeMission!.siege!.crossedActorIds).toEqual(ids)
  })

  it('does not append phantom actors to a saved shortened identity roster', () => {
    const h = siegeFixture(false, [defenseIds[0]])
    h.profile().activeMission!.siege!.attackerIds = [defenseIds[0]]
    h.reloadProfile()
    expect(h.controller.startActiveMission()).toBe(true)
    expect([...h.controller.spawnBatches[0].actors.keys()]).toEqual([defenseIds[0]])
    h.driver.drain()
    expect(h.controller.enemies.map(npc => npc.combatantId)).toEqual([defenseIds[0]])
    expect(h.profile().activeMission!.siege!.attackerIds).toEqual([defenseIds[0]])
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
    const committed = structuredClone(h.profile())
    h.player.group.position.set(30, 0, 34)
    h.controller.persistRuntimeProgress(true, { activeMountId: 'horse', hp: { horse: 61 }, unavailable: [] })
    expect(h.profile()).toEqual(committed)
    expect(h.controller.deploymentPositions).toEqual([])
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

  it('keeps an unsaved Captain roster unclaimed and retries with the same rider identities and health', () => {
    // Zero real actors: actual preview, Store and scheduler callers use constructor recordings.
    const store = new CareerProfileStore(new MemoryStorage()), h = siegeFixture(true, undefined, store)
    const accepted = acceptCaptainSiegeCommand({ ...h.profile(), totalMerit: 5000, activeMission: undefined }, 'siege-assault')!
    // Only the borrowed North cavalry and one fresh South cavalry survive this checkpoint.
    accepted.activeMission!.friendlyActorIds = [...assaultIds]
    accepted.activeMission!.officialSquad!.actorIds = assaultIds.slice(0, 29)
    accepted.activeMission!.deadFriendlyActorIds = assaultIds.filter(id => id !== assaultIds[30])
    h.setProfile(accepted); h.reloadProfile()
    const outskirts = new TownOutskirtsWarfareController(h.scene, 'viking', h.profile, [], h.navigation,
      undefined, [], h.scheduler)
    h.context.outskirts = outskirts
    for (const batch of outskirts.batches) if (!batch.actors.has('outskirts:cavalry:a:0')) batch.cancel()
    h.driver.advanceFrame()
    const rider = outskirts.actors[0], original = recording.npcs[0], horse = recording.mounts[1]
    original.hp = 63; horse.currentHp = 41
    const position = rider.combatPosition.clone(), savedBefore = store.load()!, pendingBefore = h.scheduler.pending
    const sourceBatch = outskirts.batches.find(batch => batch.actors.has('outskirts:cavalry:a:0'))!
    expect(pendingBefore).toBe(9)
    expect(outskirts.owns(rider)).toBe(true)

    h.failNextCommit()
    const started = h.controller.startActiveMission()
    expect(h.controller.enemies).toEqual([])
    expect(h.scheduler.pending).toBe(pendingBefore)
    expect(started).toBe(false)
    expect(h.controller.ready).toBe(false)
    expect(h.controller.spawnBatches).toEqual([])
    expect(sourceBatch.status).toBe('pending')
    expect(outskirts.owns(rider)).toBe(true)
    expect(outskirts.squadMembersFor(rider)).toEqual([rider])
    expect(original.applyTemporaryCombatLoadout).not.toHaveBeenCalled()
    expect(original.bindCombatEventSink).not.toHaveBeenCalled()
    expect(original.dispose).not.toHaveBeenCalled()
    expect(horse.dispose).not.toHaveBeenCalled()
    expect(recording.npcs).toEqual([original])
    expect(rider.combatPosition).toEqual(position)
    expect(rider.mount).toBe(horse)
    expect(rider.hp).toBe(63)
    expect(horse.currentHp).toBe(41)
    h.controller.updateFlow(100, 0)
    expect(h.controller.evaluate(false)).toBeNull()
    h.controller.persistRuntimeProgress(true)
    expect(h.profile()).toEqual(savedBefore)
    expect(store.load()).toEqual(savedBefore)
    expect(h.controller.snapshot().player).toMatchObject({ damageDealt: 0, kills: 0, structureDamage: 0, gateBreaches: 0 })
    expect(h.profile().totalMerit).toBe(savedBefore.totalMerit)

    expect(h.controller.startActiveMission()).toBe(true)
    const ids = [...assaultIds]; ids[1] = 'outskirts:cavalry:a:0'
    // Retry transfers only the saved selection; unborrowed pending riders retain their owner.
    expect(sourceBatch.status).toBe('pending')
    expect(h.scheduler.pending).toBe(pendingBefore + 1)
    expect(outskirts.owns(rider)).toBe(false)
    expect(h.controller.enemies).toEqual([rider])
    expect([...h.controller.spawnBatches[0].actors.keys()]).toEqual([assaultIds[30]])
    const committed = store.load()!.activeMission!
    expect(committed.siege!.attackerIds).toEqual(ids)
    expect(committed.friendlyActorIds).toEqual(ids)
    expect(committed.officialSquad!.actorIds).toEqual(ids.slice(0, 29))
    expect(committed.actorHealth!['outskirts:cavalry:a:0']).toEqual({ hp: 63, mountHp: 41 })
    expect(original.applyTemporaryCombatLoadout).toHaveBeenCalledOnce()
    expect(original.bindCombatEventSink).toHaveBeenCalledExactlyOnceWith(h.controller.events.emit)
    expect(rider.combatPosition).toEqual(position)
    expect(rider.mount).toBe(horse)
    expect(rider.hp).toBe(63)
    expect(horse.currentHp).toBe(41)
    h.driver.drain()
    expect(h.controller.ready).toBe(true)
    expect(recording.npcs.filter(npc => npc.combatantId === rider.combatantId)).toEqual([original])
    expect(h.controller.enemies.map(npc => npc.combatantId)).toEqual(['outskirts:cavalry:a:0', assaultIds[30]])
    expect(store.load()!.activeMission!.officialSquad!.actorIds).toEqual(ids.slice(0, 29))
    expect(h.profile().totalMerit).toBe(savedBefore.totalMerit)
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
    expect(original.applyTemporaryCombatLoadout).toHaveBeenCalledExactlyOnceWith({ meleeWeaponId: 'heavy_lance', rangedWeaponId: null, shieldId: null, mountId: 'horse' }, 3, 1, 'viking_lancer')
    expect(original).toMatchObject({ presetId: 'viking_lancer', missionAerialDefense: true })
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

// Placement is a caller/finalizer contract, so use a two-survivor checkpoint and
// recording constructors, not a second 119/120-actor deployment integration.
it.each([true, false])('places the saved rider before deployment and preserves movement/HP through finalization, assault=%s', assault => {
  const ids = assault ? assaultIds : defenseIds
  const h = siegeFixture(assault, [ids[2], ids[3]])
  const active = h.profile().activeMission!
  active.siege!.playerPosition = { x: 11, z: 13, yaw: .4 }
  active.playerHp = 71; active.playerStamina = 42
  const mountGroup = new THREE.Group()
  const riderOffset = new THREE.Vector3(0, 2.5, 0)
  // Transform/binding surface only; true seat physics is covered by Player/Mount.
  Object.assign(h.player, {
    currentMount: { group: mountGroup },
    syncMountTransform() { h.player.group.position.copy(mountGroup.position).add(riderOffset) },
    setHp(hp: number) { Object.assign(h.player, { hp }) },
    setStamina(staminaValue: number) { Object.assign(h.player, { staminaValue }) },
  })
  expect(h.controller.startActiveMission()).toBe(true)
  expect(h.controller.ready).toBe(false)
  expect(mountGroup.position.toArray()).toEqual([11, getTerrainHeight(11, 13), 13])
  expect(h.player.group.position.clone().sub(mountGroup.position)).toEqual(riderOffset)
  expect(h.player.hp).toBe(71)
  expect(h.player.staminaValue).toBe(42)
  mountGroup.position.set(25, 40, 28)
  h.player.group.position.copy(mountGroup.position).add(riderOffset)
  Object.assign(h.player, { hp: 63, staminaValue: 30 })
  const before = h.player.group.position.clone()
  h.driver.drain()
  expect(h.controller.ready).toBe(true)
  expect(h.player.group.position).toEqual(before)
  expect(mountGroup.position.toArray()).toEqual([25, 40, 28])
  expect(h.player.hp).toBe(63)
  expect(h.player.staminaValue).toBe(30)
  expect(h.profile().activeMission!.siege!.playerPosition).toMatchObject({ x: 25, z: 28 })
})


it('restores a private member around the complete queued official plan and retains spacing after deployment', () => {
  // Two official survivors + one private member, all recording constructors.
  const h = siegeFixture(true, [assaultIds[2], assaultIds[3]])
  const profile = h.profile()
  profile.activeMission!.actorPositions = {
    [assaultIds[2]]: { x: 0, z: 13, yaw: 0 }, [assaultIds[3]]: { x: 12, z: 13, yaw: 0 },
  }
  profile.personalSquad = { members: [{ id: 'personal:one', type: 'soldier' }] }
  const saved = snapshotPersonalMission(profile, 'town-home')!
  h.navigation.sync([])
  const personal = new PersonalSquadRuntime(h.scene, [], h.profile, () => h.player, undefined,
    { sceneKey: 'enemy-town', hasHR: false, scheduler: h.scheduler })
  onTestFinished(() => personal.cleanup())
  h.controller.startActiveMission()
  h.player.group.position.set(0, 0, 19)
  const town = Object.assign(Object.create(TownScene.prototype) as { preparePersonalFieldDeployment(value: typeof saved): void; restorePersonalSquad(value: typeof saved): void }, {
    player: h.player, profile: h.profile(), defense: h.controller, personalSquad: personal,
    world: { obstacles: [] }, navigation: h.navigation,
  })
  // Foreign-town layout is prepared before restore by the production mission caller.
  town.preparePersonalFieldDeployment(saved)
  town.restorePersonalSquad(saved)
  expect(h.controller.ready).toBe(false)
  expect(h.controller.enemies).toHaveLength(0)
  h.driver.drain()
  expect(h.controller.ready).toBe(true)
  expect(personal.actors).toHaveLength(1)
  const slot = personal.actors[0].combatPosition
  // Without the queued reservations, the first private ring slot is (0, 13).
  for (const npc of h.controller.enemies) expect(Math.hypot(slot.x - npc.combatPosition.x, slot.z - npc.combatPosition.z)).toBeGreaterThanOrEqual(4.8)
})

it.each([false, true])('returns home while pending and reloads Player state without checkpointing partial NPCs, mounted=%s', mounted => {
  const storage = new MemoryStorage(), store = new CareerProfileStore(storage)
  const h = siegeFixture(false, [defenseIds[2], defenseIds[3]], store)
  h.profile().activeMission!.actorPositions = { [defenseIds[3]]: { x: 14, z: 17, yaw: .2 } }
  h.profile().activeMission!.actorHealth = { [defenseIds[3]]: { hp: 57, mountHp: 41 } }
  Object.assign(h.player, { isFalling: false,
    setHp(hp: number) { Object.assign(h.player, { hp }) },
    setStamina(staminaValue: number) { Object.assign(h.player, { staminaValue }) },
  })
  h.controller.startActiveMission(); h.driver.advanceFrame()
  // No locomotion assertion here: Player/Mount suites own those physics.
  const root = new THREE.Group(); root.position.set(31, 8, 34)
  const mount = { group: root, currentHp: 67 }
  h.player.group.position.set(31, 10.5, 34); h.player.group.rotation.y = .3
  Object.assign(h.player, { hp: 61, staminaValue: 29, currentMount: mounted ? mount : null })
  const mounts = new CareerMountController(h.scene, () => h.player, h.profile, () => true, () => [], () => [])
  // Install the owned-mount boundary only; real checkpoint() must read its live HP/identity.
  if (mounted) Object.assign(mounts, { active: { id: 'horse', mount } })
  expect(store.save(h.profile())).toBe(true)
  const officialBefore = store.load()!.activeMission!
  storage.failWrites = true
  h.controller.persistRuntimeProgress(true, mounts.checkpoint())
  expect(store.load()!.activeMission).toEqual(officialBefore)
  storage.failWrites = false
  const onHome = vi.fn()
  const town = Object.assign(Object.create(TownScene.prototype) as { returnHome(): void }, {
    player: h.player, defense: h.controller, careerMounts: mounts,
    disposed: false, careerSaveFailures: 0, flushCareerSkillProgression: () => true,
    persistPersonalSquad: () => {},
    commit(next: ReturnType<typeof h.profile>) { if (!store.save(next)) return false; h.setProfile(next); return true },
    dispose: vi.fn(), onHome,
  })
  Object.defineProperty(town, 'profile', { get: h.profile })
  town.returnHome()
  expect(onHome).toHaveBeenCalledOnce()
  const loaded = store.load()!
  const { siege, playerHp, playerStamina, playerDead, mountState, ...official } = loaded.activeMission!
  const { siege: oldSiege, playerHp: _hp, playerStamina: _stamina, playerDead: _dead, mountState: _mount, ...oldOfficial } = officialBefore
  expect(official).toEqual(oldOfficial)
  expect({ ...siege, playerPosition: undefined }).toEqual({ ...oldSiege, playerPosition: undefined })
  expect({ playerHp, playerStamina, playerDead }).toEqual({ playerHp: 61, playerStamina: 29, playerDead: false })
  expect(siege!.playerPosition).toEqual({ x: 31, z: 34, yaw: .3 })
  if (mounted) expect(mountState).toEqual({ activeMountId: 'horse', hp: { horse: 67 }, unavailable: [] })
  // Restart the same mission from a genuine store round-trip, still only two queued survivors.
  h.controller.cleanupMission(); h.setProfile(loaded)
  h.player.group.position.set(0, 0, 0)
  if (mounted) root.position.set(0, 0, 0)
  Object.assign(h.player, { syncMountTransform() { h.player.group.position.copy(root.position).y += 2.5 } })
  expect(h.controller.startActiveMission()).toBe(true)
  expect(h.controller.ready).toBe(false)
  expect(h.player.group.position.x).toBe(31); expect(h.player.group.position.z).toBe(34)
  if (mounted) expect(root.position.toArray()).toEqual([31, getTerrainHeight(31, 34), 34])
  expect(h.player.hp).toBe(61); expect(h.player.staminaValue).toBe(29)
  h.driver.drain()
  expect(h.player.group.position.x).toBe(31); expect(h.player.group.position.z).toBe(34)
})
