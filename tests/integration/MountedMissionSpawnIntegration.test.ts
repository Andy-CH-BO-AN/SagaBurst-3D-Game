import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BanditMissionController } from '../../src/career/BanditMissionController'
import { acceptCavalrySweep, createSweepRoster, sweepPlayerSpawn } from '../../src/career/CavalrySweep'
import { createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { VETERAN_MISSION_IDS } from '../../src/career/VeteranMission'
import { NavigationWorld } from '../../src/navigation/NavigationWorld'
import type { Player } from '../../src/player/Player'
import { TownScene } from '../../src/town/TownScene'
import { townRoster } from '../../src/town/TownRules'
import type { TownWorld } from '../../src/town/TownWorld'
import { MountType } from '../../src/world/Mount'
import { Faction, type NPC } from '../../src/world/NPC'
import { NpcSpawnTestDriver } from '../helpers/npcSpawnFrames'
import { recording, RecordingMount, RecordingNpc, resetSpawnRecording } from '../helpers/npcSpawnRecording'
import { FieldTestMount, FieldTestNpc } from '../helpers/veteranFieldActors'
import { createVeteranFieldFixture, type VeteranFieldFixture } from '../helpers/veteranFieldFixture'

vi.mock('../../src/world/NPC', async original => ({
  ...(await original<typeof import('../../src/world/NPC')>()),
  NPC: (await import('../helpers/npcSpawnRecording')).RecordingNpc,
}))
vi.mock('../../src/world/Mount', async original => ({
  ...(await original<typeof import('../../src/world/Mount')>()),
  Mount: (await import('../helpers/npcSpawnRecording')).RecordingMount,
}))
vi.mock('../../src/career/MissionGuide', async original => ({
  ...(await original<typeof import('../../src/career/MissionGuide')>()),
  MissionGuide: class { update() {} hide() {} dispose() {} },
}))

const cleanup: (() => void)[] = []
afterEach(() => {
  cleanup.splice(0).reverse().forEach(dispose => dispose())
  vi.restoreAllMocks()
  resetSpawnRecording()
})

function sequence(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}${index}`)
}

/** Full IDs stay authoritative. All construction is recorded; no real NPC/Mount/TownWorld/GLB.
 * The controller owns its instance scheduler; its unrelated two ambient doubles load explicitly.
 * Position inputs below exercise phase gates, not locomotion or NPC.mountVehicle internals.
 */
function sweep(options: { livingSlots?: number[]; enemyCount?: number } = {}) {
  const driver = new NpcSpawnTestDriver(), scene = new THREE.Scene()
  const roster = createSweepRoster('roman'), town = townRoster()
  const borrowedSlots = [0, 1, 29]
  const residents = borrowedSlots.map(slot => {
    const spec = town.find(actor => actor.id === (slot === 0 ? 'captain' : slot === 29 ? 'ranger' : 'cavalry-training:melee_cavalry:0'))!
    const spawn = roster[slot]
    const npc = new RecordingNpc(scene, spec.x, spec.z, Faction.TOWN, 'roman', spawn.aiType,
      spawn.name, spawn.tier, true, spawn.loadout, spawn.presetId, spawn.squadId, `garrison:${slot}`)
    const homeMount = new RecordingMount(scene, slot === 29 ? MountType.BLACK_CAT : MountType.HORSE, spec.x, spec.z)
    npc.mountVehicle(homeMount)
    npc.respawnEnabled = true
    cleanup.push(() => { npc.dispose(); homeMount.dispose() })
    return { spec, npc, homeMount }
  })
  const selected = Array.from({ length: 59 }, (_, slot) => borrowedSlots.includes(slot) ? `garrison:${slot}` : undefined)
  let profile = acceptCavalrySweep({ ...createCareerProfile('roman'), ownedHorseTiers: [1] }, 'sweep', selected)!
  if (options.livingSlots) profile.activeMission!.deadFriendlyActorIds = profile.activeMission!.friendlyActorIds.filter((_, slot) => !options.livingSlots!.includes(slot))
  if (options.enemyCount !== undefined) profile.activeMission!.deadTargetActorIds = profile.activeMission!.targetActorIds.slice(options.enemyCount)
  const player = { dead: false, combatPosition: sweepPlayerSpawn() }
  const controller = new BanditMissionController(scene,
    { camps: [{ spawnPoints: [new THREE.Vector3()] }], obstacles: [] } as unknown as TownWorld,
    new NavigationWorld(), residents[0].npc as unknown as NPC,
    residents as unknown as ConstructorParameters<typeof BanditMissionController>[4],
    () => player as unknown as Player, () => profile, next => { profile = next; return true }, {}, driver.scheduler)
  cleanup.push(() => { controller.dispose(); driver.drain() })
  driver.drain()
  const onMarchStarted = vi.fn()
  controller.onMarchStarted = onMarchStarted
  return { controller, driver, residents, scene, onMarchStarted, profile: () => profile }
}

function field(options: Parameters<typeof createVeteranFieldFixture>[0]): VeteranFieldFixture {
  const fixture = createVeteranFieldFixture(options)
  cleanup.push(() => fixture.dispose())
  return fixture
}

/** Keep the existing lightweight Veteran factories. Full resident specs feed real Town selection. */
function officialScout() {
  const residents = townRoster().filter(spec => spec.mounted || spec.role === 'ranger').map(spec => {
    const npc = new FieldTestNpc(spec.id, spec.role === 'ranger' ? 'Maki' : 'Town cavalry', Faction.TOWN,
      'roman', spec.tier ?? 4, undefined, spec.x, spec.z)
    const homeMount = new FieldTestMount()
    homeMount.group.position.copy(npc.group.position)
    npc.mountVehicle(homeMount)
    return { spec, npc, homeMount }
  })
  const fixture = field({ templateId: 'veteran-scout-hunters', residents, ownResidents: true, autoStart: false })
  const fresh: CareerProfile = { ...createCareerProfile('roman'), rank: 'veteran', totalMerit: 900,
    availableMerit: 900, ownedMounts: ['horse'], completedCareerMissionTemplateIds: [...VETERAN_MISSION_IDS] }
  // Only the private UI entry needs an adapter; acceptance, reserve selection and startup stay real.
  interface TownMissionEntry { acceptVeteranCareerMission(templateId: string): void }
  const town = Object.assign(Object.create(TownScene.prototype) as TownMissionEntry, {
    profile: fresh, residents, mission: fixture.controller, player: fixture.player, event: { hostile: false },
    store: { loadChecked: () => ({ profile: fresh }) },
    commit: (next: CareerProfile) => { Object.assign(fixture.profile(), next); town.profile = next; return true },
    careerMounts: { activate: vi.fn() }, inventory: { prepareForCombat: vi.fn() },
    closePanel: vi.fn(), playMissionVoice: vi.fn(), openPanel: vi.fn(),
  })
  const borrow = vi.fn()
  fixture.controller.onBorrowMountedActor = borrow
  return { fixture, town, borrow }
}

describe('mounted mission spawn caller contracts', () => {
  it('queues the complete Sweep roster once, reuses three residents and finalizes registration only after the last missing rider', () => {
    const h = sweep(), before = recording.npcs.length
    const expectedEnemies = sequence('sweep:bandit:', 40)
    const expectedFriendlies = sequence('sweep:cavalry:', 59)
    expectedFriendlies[0] = 'garrison:0'; expectedFriendlies[1] = 'garrison:1'; expectedFriendlies[29] = 'garrison:29'
    const expectedQueued = [...expectedEnemies, ...expectedFriendlies.filter(id => !id.startsWith('garrison:'))]
    expect(h.controller.startActiveMission()).toBe(true)
    expect(h.controller.startActiveMission()).toBe(true)
    expect(recording.npcs).toHaveLength(before)
    expect(h.controller.spawnBatches.flatMap(batch => [...batch.actors.keys()]).filter(id => !id.startsWith('ambient:'))).toEqual(expectedQueued)
    expect(expectedQueued).toHaveLength(96)
    expect(h.controller.friendlies).toEqual(h.residents.map(resident => resident.npc))

    for (const resident of h.residents) resident.npc.isFormationTargetReached.mockReturnValue(true)
    const expectLoading = () => {
      expect(h.controller.ready).toBe(false)
      expect(h.controller.evaluate(true)).toBeNull()
      h.controller.updateFlow(600, 0)
      expect(h.controller.phase).toBe('ASSEMBLING')
      expect(h.onMarchStarted).not.toHaveBeenCalled()
    }
    expectLoading()
    h.driver.advanceFrame()
    expect(h.controller.missionBandits.map(npc => npc.combatantId)).toEqual(['sweep:bandit:0'])
    expectLoading()
    for (let remaining = 1; remaining < 95; remaining++) h.driver.advanceFrame()
    expect(h.controller.friendlies).toHaveLength(58)
    expect(h.controller.missionBandits).toHaveLength(40)
    expectLoading()
    h.driver.advanceFrame()

    expect(h.controller.ready).toBe(true)
    expect(h.controller.friendlies.map(npc => npc.combatantId)).toEqual(expectedFriendlies)
    expect(h.controller.missionBandits.map(npc => npc.combatantId)).toEqual(expectedEnemies)
    expect(recording.npcs.slice(before).map(npc => npc.combatantId)).toEqual(expectedQueued)
    const createdRiders = recording.npcs.slice(before).filter(npc => npc.faction === Faction.TOWN)
    expect(createdRiders).toHaveLength(56)
    for (const rider of createdRiders) {
      expect(rider).toMatchObject({ characterFaction: 'roman', tier: 1, mountedInput: true })
      expect(rider.mountVehicle).toHaveBeenCalledExactlyOnceWith(rider.mount)
    }
    for (const enemy of recording.npcs.slice(before).filter(npc => npc.faction === Faction.BANDIT)) {
      expect(enemy).toMatchObject({ characterFaction: 'viking', tier: 1, loadout: { meleeWeaponId: 'rusty_dagger' } })
    }
    h.controller.dispose()
    for (const resident of h.residents) {
      expect(resident.npc.dispose).not.toHaveBeenCalled()
      expect(resident.homeMount.dispose).not.toHaveBeenCalled()
      expect(resident.npc.restoreCombatLoadout).toHaveBeenCalledOnce()
      expect(resident.npc.respawnEnabled).toBe(true)
    }
  })

  it('cancels partial Sweep ownership without disposing borrowed riders or materializing the remaining job', () => {
    const h = sweep({ livingSlots: [0, 1, 2, 3, 29], enemyCount: 1 }), before = recording.npcs.length
    expect(h.controller.startActiveMission()).toBe(true)
    const batch = h.controller.spawnBatches.find(candidate => candidate.actors.has('sweep:cavalry:3'))!
    h.driver.advanceFrame(); h.driver.advanceFrame()
    const owned = recording.npcs.slice(before), ownedMount = owned.find(npc => npc.mount)!.mount!
    expect(owned.map(npc => npc.combatantId)).toEqual(['sweep:bandit:0', 'sweep:cavalry:2'])
    h.controller.dispose(); h.controller.dispose(); h.driver.advanceFrame()
    expect(batch.status).toBe('cancelled')
    expect(h.driver.scheduler.pending).toBe(0)
    expect(h.controller.friendlies).toHaveLength(0)
    expect(h.controller.missionBandits).toHaveLength(0)
    expect(recording.npcs).toHaveLength(before + 2)
    owned.forEach(npc => expect(npc.dispose).toHaveBeenCalledOnce())
    expect(ownedMount.dispose).toHaveBeenCalledOnce()
    for (const resident of h.residents) {
      expect(resident.npc.dispose).not.toHaveBeenCalled()
      expect(resident.homeMount.dispose).not.toHaveBeenCalled()
      expect(resident.npc.restoreCombatLoadout).toHaveBeenCalledOnce()
      expect(resident.npc.group.parent).toBe(h.scene)
    }
  })

  it('accepts and registers the official Scout IDs while borrowing 98 residents and recording only one friendly Ranger plus forty enemies', () => {
    const { fixture: h, town, borrow } = officialScout()
    const positions = new Map(h.residents.map(({ npc }) => [npc.combatantId, npc.combatPosition.clone()]))
    h.residents.forEach(({ npc }) => { npc.hp = 41 })
    town.acceptVeteranCareerMission('veteran-scout-hunters')
    expect(town.openPanel).not.toHaveBeenCalled()
    const active = h.profile().activeMission!
    const expectedBorrowed = ['captain', 'ranger', 'town-patrol:a:captain',
      ...sequence('cavalry-training:melee_cavalry:', 20), ...sequence('cavalry-training:lancer_cavalry:', 20),
      ...sequence('cavalry-training:ranged_cavalry:', 20), ...sequence('town-patrol:a:', 19), ...sequence('town-patrol:b:', 16)]
    const expectedEnemies = sequence(`${active.id}:mission:enemy:`, 40)
    const expectedTemporary = `${active.id}:temporary:friendly:3`
    expect(active.borrowedActorIds).toHaveLength(98)
    expect([...active.borrowedActorIds!].sort()).toEqual([...expectedBorrowed].sort())
    expect([...active.friendlyActorIds].sort()).toEqual([...expectedBorrowed, expectedTemporary].sort())
    expect(active.targetActorIds).toEqual(expectedEnemies)
    expect(h.controller.startActiveMission()).toBe(true)
    expect(h.npcFactories).toHaveLength(0)
    expect(h.controller.spawnBatches.flatMap(batch => [...batch.actors.keys()])).toEqual([expectedTemporary, ...expectedEnemies])
    const march = vi.fn()
    h.controller.onMarchStarted = march
    const expectLoading = () => {
      // Assembly completion is an explicit actor-double input; readiness must still block it.
      for (const actor of h.actors) if (actor.formationTarget) actor.formationTarget.reached = true
      h.controller.updateFlow(600, 0)
      expect(h.controller.ready).toBe(false)
      expect(h.controller.phase).toBe('ASSEMBLING')
      expect(h.controller.evaluate(true)).toBeNull()
      expect(march).not.toHaveBeenCalled()
    }
    expectLoading()
    h.spawnDriver.advanceFrame()
    expect(h.npcFactories.map(({ npc }) => npc.combatantId)).toEqual([expectedTemporary])
    expectLoading()
    for (let frame = 1; frame < 40; frame++) h.spawnDriver.advanceFrame()
    expect(h.npcFactories).toHaveLength(40)
    expect(h.enemies).toHaveLength(39)
    expectLoading()
    h.spawnDriver.advanceFrame()
    expect(h.controller.ready).toBe(true)
    expect(h.actors.map(npc => npc.combatantId)).toEqual(active.friendlyActorIds)
    expect(h.enemies.map(npc => npc.combatantId)).toEqual(expectedEnemies)
    expect(h.npcFactories.map(({ npc }) => npc.combatantId)).toEqual([expectedTemporary, ...expectedEnemies])
    expect(h.actors.filter(npc => npc.tier === 4)).toHaveLength(4)
    expect(h.actors.filter(npc => npc.tier === 3)).toHaveLength(95)
    expect(h.npcFactories[0].spec).toMatchObject({ name: 'Maki / Mounted Ranger', presetId: 'roman_archer',
      combatProfileId: 'ranger', specialCombatProfile: 'maki-ranger', loadout: { mountId: 'black-cat' } })
    expect(borrow).toHaveBeenCalledTimes(98)
    for (const id of expectedBorrowed) {
      const npc = h.residents.find(resident => resident.npc.combatantId === id)!.npc
      expect(h.actors).toContain(npc)
      expect(npc.hp).toBe(41)
      expect(npc.combatPosition).toEqual(positions.get(id))
      expect(npc.formationCommandId).toBe(9000)
    }
    expect(h.controller.snapshot().squads.map(squad => [squad.squadId, squad.startingMembers])).toEqual([[1, 24], [2, 25], [3, 25], [4, 25]])
  })

  it('cancels the Veteran caller and restores borrowed loadouts while disposing each completed owned actor once', () => {
    const h = field({ templateId: 'veteran-scout-hunters', autoStart: false })
    expect(h.controller.startActiveMission()).toBe(true)
    h.spawnDriver.advanceFrame()
    const batch = h.controller.spawnBatches[0], npc = h.npcFactories[0].npc, mount = h.mountFactories[0]
    const disposeNpc = vi.spyOn(npc, 'dispose'), disposeMount = vi.spyOn(mount, 'dispose')
    h.controller.dispose(); h.controller.dispose(); h.spawnDriver.advanceFrame()
    expect(batch.status).toBe('cancelled')
    expect(h.scheduler.pending).toBe(0)
    expect(h.npcFactories).toHaveLength(1)
    expect(disposeNpc).toHaveBeenCalledOnce()
    expect(disposeMount).toHaveBeenCalledOnce()
    for (const resident of h.residents) {
      expect(resident.npc.disposed).toBe(false)
      expect(resident.homeMount?.disposed).toBe(false)
      expect(resident.npc.restoreCombatLoadout).toHaveBeenCalledOnce()
      expect(resident.npc.temporaryTier).toBeUndefined()
      expect(resident.npc.respawnEnabled).toBe(true)
    }
  })
})
