import { Euler, Vector3 } from 'three'
import { expect, it, vi } from 'vitest'
import type { PersonalActorCheckpoint } from '../../src/career/CareerPersonalSquadMission'
import { returnPersonalMissionToHR, type PersonalSquadMission } from '../../src/career/CareerPersonalSquadMission'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { EaglePadReservations } from '../../src/career/EaglePadReservations'
import { PersonalSquadRuntime, spawnPersonalSquadActor } from '../../src/career/PersonalSquadRuntime'
import { emptyPersonalContribution } from '../../src/combat/CommandMerit'
import { MountArmor } from '../../src/combat/MountArmor'
import { migratePersonalTownLayout } from '../../src/town/TownLayoutMigration'
import * as HighTierEquipment from '../../src/world/HighTierEquipment'
import { HumanoidAssetRegistry } from '../../src/world/HumanoidAssetRegistry'
import { MountType, type Mount } from '../../src/world/Mount'
import type { NPC } from '../../src/world/NPC'
import { NpcSpawnScheduler } from '../../src/world/NpcSpawnScheduler'
import * as PaladinEquipment from '../../src/world/PaladinEquipment'

it('keeps a newly recruited hero pending until assets load and propagates asset failure without materialization', async () => {
    let rejectAsset!: (error: Error) => void
    const assetLoad = new Promise<void>((_, reject) => { rejectAsset = reject })
    const spies = [vi.spyOn(HumanoidAssetRegistry, 'preload').mockResolvedValue(),
      vi.spyOn(HumanoidAssetRegistry, 'preloadAsset').mockReturnValue(assetLoad),
      vi.spyOn(HighTierEquipment, 'preloadHighTierEquipment').mockResolvedValue(),
      vi.spyOn(PaladinEquipment, 'preloadPaladinEquipment').mockResolvedValue()]
    const profile = createCareerProfile('roman')
    profile.personalSquad = { members: [{ id: 'personal:new-hero', type: 'commander', characterTier: 5, heroArchetype: 'commander',
      equipment: { melee: 'gladius_standard', ranged: null, shield: 'scutum_t2', mount: 'horse' } }] }
    const scheduler = new NpcSpawnScheduler()
    const runtime = Object.assign(Object.create(PersonalSquadRuntime.prototype), {
      actors: [], mounts: [], state: 'RESERVE', read: () => profile, spawn: spawnPersonalSquadActor,
      player: () => ({ dead: false, combatPosition: new Vector3(), group: { rotation: { y: 0 } } }),
      options: { scheduler }, muster: [{ x: 0, z: 0, yaw: 0 }], pending: new Map(), batches: [],
      commandRevision: 0, eaglePads: new EaglePadReservations([]), reservedEagleOwners: new Set(),
    }) as Pick<PersonalSquadRuntime, 'follow' | 'hudPendingIds' | 'ready' | 'waitForSpawns' | 'cancelPendingSpawns' | 'actors'>
    try {
      expect(runtime.follow()).toBe(true)
      expect(runtime.hudPendingIds).toEqual(['personal:new-hero'])
      expect(scheduler.pending).toBe(0)
      const error = new Error('Commander asset unavailable')
      rejectAsset(error)
      await Promise.allSettled([assetLoad])
      await Promise.resolve()
      await expect(runtime.waitForSpawns()).rejects.toBe(error)
      expect(runtime.ready).toBe(false)
      expect(runtime.actors).toHaveLength(0)
      expect(scheduler.pending).toBe(0)
    } finally {
      runtime.cancelPendingSpawns()
      for (const spy of spies) spy.mockRestore()
    }
  })

it('restores a formal HR return without actors and queues the full equipped reserve only once on Follow', () => {
    const profile = createCareerProfile('roman')
    profile.personalSquad = { members: [
      { id: 'personal:foot', type: 'soldier' },
      { id: 'personal:cat', type: 'captain', equipment: { melee: null, ranged: null, shield: null, mount: 'black-cat' } },
      { id: 'personal:eagle', type: 'ranger', equipment: { melee: null, ranged: null, shield: null, mount: 'xongkoro' } },
    ] }
    const saved = returnPersonalMissionToHR({ squadId: 'personal', sceneKey: 'battle', state: 'ACTIVE',
      memberIds: profile.personalSquad.members.map(member => member.id), contribution: emptyPersonalContribution(),
      members: { 'personal:foot': { status: 'dead', hp: 0 }, 'personal:cat': { status: 'deployed', hp: 7, ammo: 0 },
        'personal:eagle': { status: 'deployed', hp: 9, eaglePadId: 'private-eagle-pad:1' } } })!
    const scheduler = new NpcSpawnScheduler()
    const runtime = Object.assign(Object.create(PersonalSquadRuntime.prototype), {
      actors: [], mounts: [], state: 'RESERVE', read: () => profile,
      player: () => ({ dead: false, combatPosition: new Vector3(), group: { rotation: { y: 0 } } }),
      options: { scheduler }, muster: profile.personalSquad.members.map((_, index) => ({ x: index * 5, z: 0, yaw: 0 })),
      pending: new Map(), batches: [], commandRevision: 0, returnCommand: -1000,
      boarding: new Map(), returningOnFoot: new Set(), awaitingEaglePad: new Set(),
      eaglePads: new EaglePadReservations([{ id: 'private-eagle-pad:1', x: 30, z: 0, yaw: 0 }]), reservedEagleOwners: new Set(),
    }) as Pick<PersonalSquadRuntime, 'restoreMission' | 'follow' | 'checkpoint' | 'hudPendingIds' | 'cancelPendingSpawns' | 'actors' | 'mounts'>
    const equipment = structuredClone(profile.personalSquad)
    try {
      runtime.restoreMission(saved)
      expect(runtime.checkpoint()).toMatchObject({ state: 'RESERVE', members: {
        'personal:foot': { status: 'reserve' }, 'personal:cat': { status: 'reserve' },
        'personal:eagle': { status: 'reserve', eaglePadId: 'private-eagle-pad:1' },
      } })
      expect(scheduler.pending).toBe(0)
      expect(runtime.actors).toHaveLength(0)
      expect(runtime.mounts).toHaveLength(0)
      expect(runtime.follow()).toBe(true)
      expect(runtime.follow()).toBe(true)
      expect(runtime.hudPendingIds).toEqual(['personal:foot', 'personal:cat', 'personal:eagle'])
      expect(scheduler.pending).toBe(3)
      expect(runtime.checkpoint()?.state).toBe('DEPLOYING')
      expect(profile.personalSquad).toEqual(equipment)
    } finally { runtime.cancelPendingSpawns() }
  })

it('returns a ground private soldier to the HR floor height on Dismiss', () => {
    const slot = { x: -72, y: 2.4, z: 16, yaw: .5 }
    const actor = { dead: false, mount: undefined, combatantId: 'personal:floor', missionMovement: false,
      assignFormationTarget: vi.fn<NPC['assignFormationTarget']>() }
    // Numeric actor boundary only; Dismiss and return routing are real, checkpoint persistence has its own owner.
    const checkpoint = vi.fn()
    const runtime = Object.assign(Object.create(PersonalSquadRuntime.prototype), {
      options: { hasHR: true }, state: 'ACTIVE', returnCommand: -1000, actors: [actor],
      slots: new Map([[actor, slot]]), pending: new Map(), boarding: new Map(), returningOnFoot: new Set(),
      awaitingEaglePad: new Set(), reservedEagleOwners: new Set(), checkpoint,
    }) as Pick<PersonalSquadRuntime, 'dismiss'>
    expect(runtime.dismiss()).toBe(true)
    expect(actor.assignFormationTarget.mock.lastCall![1].toArray()).toEqual([slot.x, slot.y, slot.z])
    expect(actor.missionMovement).toBe(true)
  })

it('restores a migrated off-base boarding target, follows a moving mount and boards only at live contact', () => {
    const h = boardingHarness()
    const saved: PersonalSquadMission = {
      squadId: 'personal', sceneKey: 'town-home', layoutVersion: 3, state: 'ACTIVE',
      memberIds: ['personal:eagle'], contribution: emptyPersonalContribution(),
      members: { 'personal:eagle': { status: 'deployed', boarding: true, hp: 49,
        eaglePadId: h.home.id, position: { x: h.home.x, y: 0, z: h.home.z, yaw: 0 },
        mount: { hp: 73, mounted: false, position: { x: 20, y: 0, z: 30, yaw: 0 },
          flight: { phase: 'grounded', yaw: 0, pitch: 0, bank: 0, speed: 0, velocity: { x: 0, y: 0, z: 0 } } } } },
    }
    const migrated = migratePersonalTownLayout(saved, 'town-home', { eaglePads: [h.home], muster: [] }, () => 0)!
    h.runtime.restoreActor(h.npc, migrated.members['personal:eagle'], false, 0)
    expect(h.actor.assignFormationTarget.mock.lastCall![1].toArray()).toEqual([20, 0, 30])
    h.mount.group.position.set(24, 3, 31)
    h.runtime.updateEagleTransfers()
    expect(h.actor.mountVehicle).not.toHaveBeenCalled()
    expect(h.actor.assignFormationTarget.mock.lastCall![1].toArray()).toEqual([24, 3, 31])
    h.actor.group.position.set(23, 3, 31)
    h.runtime.updateEagleTransfers()
    expect(h.actor.mountVehicle).toHaveBeenCalledExactlyOnceWith(h.mount)
    expect(h.actor.setTacticalOrder).toHaveBeenCalledWith('defend')
  })

it('resumes Follow with the same parked HR eagle and boards only after touchdown and live contact', () => {
    const h = boardingHarness('follow')
    h.actor.hp = 49; h.mount.currentHp = 73
    h.runtime.restoreActor(h.npc, { status: 'deployed' }, false, 0)
    h.runtime.applyCommand(h.npc, 0)
    expect(h.actor.assignFormationTarget.mock.lastCall![1].toArray()).toEqual([-85, 0, 54])
    h.mount.flight.phase = 'cruise'
    h.runtime.updateEagleTransfers()
    expect(h.actor.mountVehicle).not.toHaveBeenCalled()
    h.mount.flight.phase = 'grounded'; h.mount.group.position.y = 8
    h.runtime.updateEagleTransfers()
    expect(h.actor.mountVehicle).not.toHaveBeenCalled()
    h.mount.group.position.y = 0
    h.runtime.updateEagleTransfers()
    expect(h.actor.mountVehicle).toHaveBeenCalledExactlyOnceWith(h.mount)
    expect(h.actor.assignFollowTarget).toHaveBeenCalledOnce()
    expect(h.actor.hp).toBe(49); expect(h.mount.currentHp).toBe(73)
  })

function boardingHarness(command: 'defend' | 'follow' = 'defend') {
  const home = { id: 'private-eagle-pad:1', x: -85, y: 0, z: 54, yaw: 0 }
  const eaglePads = new EaglePadReservations([home]); eaglePads.reserve('personal:eagle')
  const mount = {
    dead: false, currentHp: 200, maxHp: 200, isFlyingMount: true,
    armor: new MountArmor(MountType.XONGKORO),
    get armorImpactMax() { return this.armor.max },
    get armorImpactRemaining() { return this.armor.remaining },
    restoreArmor(value?: number) { this.armor.restore(value) },
    group: { position: new Vector3(home.x, 0, home.z), rotation: new Euler() },
    flight: { phase: 'grounded', restore: vi.fn() },
    get isAirborne() { return this.flight.phase !== 'grounded' },
  }
  const point = new Vector3(home.x, 0, home.z)
  const actor = {
    combatantId: 'personal:eagle', dead: false, hp: 100, missionMovement: false,
    group: { position: point, rotation: new Euler() }, combatPosition: point,
    mount: undefined as Mount | undefined,
    restoreCombatHealth: vi.fn(), restoreCombatAmmo: vi.fn(), setTacticalOrder: vi.fn(),
    setEagleFlightOrder: vi.fn(), assignFormationTarget: vi.fn<NPC['assignFormationTarget']>(),
    assignFollowTarget: vi.fn<NPC['assignFollowTarget']>(),
    mountVehicle: vi.fn((vehicle: Mount) => { actor.mount = vehicle }),
  }
  // Typed seams adapt only the actor/mount API consumed by these private owners.
  const npc = actor as unknown as NPC, vehicle = mount as unknown as Mount
  interface RestoreTransferSeam {
    restoreActor(npc: NPC, saved: PersonalActorCheckpoint, changedScene: boolean, index: number): void
    applyCommand(npc: NPC, index: number): void
    updateEagleTransfers(): void
  }
  const runtime = Object.assign(Object.create(PersonalSquadRuntime.prototype), {
    state: 'ACTIVE', command, returnCommand: -1000, eaglePads, options: {}, player: () => ({}),
    memberMounts: new Map([[actor.combatantId, vehicle]]), boarding: new Map(),
  }) as RestoreTransferSeam
  return { home, mount, actor, npc, runtime }
}

it('locks HR reserves and refit in the final stand without replacing casualties or advancing return cleanup', () => {
  const profile = createCareerProfile('roman')
  profile.personalSquad = { members: [{ id: 'personal:fallen', type: 'soldier' }] }
  const mission: PersonalSquadMission = { squadId: 'personal', sceneKey: 'town-home', state: 'RETURNING',
    memberIds: ['personal:fallen'], contribution: emptyPersonalContribution(),
    members: { 'personal:fallen': { status: 'dead', hp: 0 } } }
  const scheduler = new NpcSpawnScheduler()
  const runtime = Object.assign(Object.create(PersonalSquadRuntime.prototype) as Pick<PersonalSquadRuntime,
    'follow' | 'checkpoint' | 'canRefit' | 'updateLifecycle' | 'cancelPendingSpawns'>, {
    actors: [], mission, state: 'RETURNING', read: () => profile,
    player: () => ({ dead: false, combatPosition: new Vector3(), group: { rotation: { y: 0 } } }),
    options: { scheduler }, pending: new Map(), batches: [], commandRevision: 0,
    boarding: new Map(), returningOnFoot: new Set(), awaitingEaglePad: new Set(),
    eaglePads: new EaglePadReservations([]), reservedEagleOwners: new Set(),
  })
  try {
    expect(runtime.canRefit).toBe(true)
    const savedBefore = runtime.checkpoint()!
    profile.careerRetirement = { version: 1, phase: 'final-stand', acceptedAt: 1, combatElapsedSeconds: 12 }
    expect(runtime.follow()).toBe(false)
    expect(runtime.canRefit).toBe(false)
    expect(scheduler.pending).toBe(0)
    expect(runtime.checkpoint()?.members).toEqual(savedBefore.members)
    runtime.updateLifecycle()
    expect(runtime.checkpoint()?.members).toEqual(savedBefore.members)
    expect(runtime.checkpoint()?.state).toBe('ACTIVE')
    expect(profile.personalSquad.members).toHaveLength(1)
  } finally { runtime.cancelPendingSpawns() }
})
