import { Euler, Vector3 } from 'three'
import { expect, it, vi } from 'vitest'
import type { PersonalActorCheckpoint } from '../../src/career/CareerPersonalSquadMission'
import { returnPersonalMissionToHR, type PersonalSquadMission } from '../../src/career/CareerPersonalSquadMission'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { recruitPersonalSquadMember } from '../../src/career/CareerPersonalSquad'
import { addCareerItem } from '../../src/career/CareerInventory'
import { EaglePadReservations } from '../../src/career/EaglePadReservations'
import { parsePersonalMission } from '../../src/career/CareerPersonalSquadMission'
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
import { getTerrainHeight } from '../../src/world/Terrain'

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
      commandRevision: 0, eaglePads: new EaglePadReservations([]), reservedEagleOwners: new Set(), standbyIds: new Set(), standbyBatches: new Set(), homeArrivals: new Set(),
    }) as Pick<PersonalSquadRuntime, 'follow' | 'hudPendingIds' | 'ready' | 'error' | 'standbyError' | 'waitForSpawns' | 'cancelPendingSpawns' | 'actors'>
    try {
      expect(runtime.follow()).toBe(true)
      expect(runtime.hudPendingIds).toEqual(['personal:new-hero'])
      expect(scheduler.pending).toBe(0)
      const error = new Error('Commander asset unavailable')
      rejectAsset(error)
      await Promise.allSettled([assetLoad])
      await Promise.resolve()
      await expect(runtime.waitForSpawns()).rejects.toBe(error)
      // A formal deployment failure stays a deployment error; it is not an HR standby failure.
      expect([runtime.error, runtime.standbyError]).toEqual([error, undefined])
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
      eaglePads: new EaglePadReservations([{ id: 'private-eagle-pad:1', x: 30, z: 0, yaw: 0 }]), reservedEagleOwners: new Set(), standbyIds: new Set(), standbyBatches: new Set(), homeArrivals: new Set(),
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
      awaitingEaglePad: new Set(), reservedEagleOwners: new Set(), standbyIds: new Set(), standbyBatches: new Set(), homeArrivals: new Set(), checkpoint,
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
    eaglePads: new EaglePadReservations([]), reservedEagleOwners: new Set(), standbyIds: new Set(), standbyBatches: new Set(), homeArrivals: new Set(),
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

/* ───────── HR standby: hire → standby → Follow → Dismiss → standby ───────── */

interface StandbyActor {
  combatantId: string; dead: boolean; hp: number; maxHp: number; isMounted: boolean; isFalling: boolean
  mount?: Mount; tacticalOrder: string; missionMovement: boolean; formationCommandId: number | null; arrived: boolean
  combatAmmo: number; shield: { shieldImpactRemaining: number; shieldImpactMax: number }
  group: { position: Vector3; rotation: Euler }; combatPosition: Vector3; disposed: boolean
  setTacticalOrder(order: string): void; assignFormationTarget: ReturnType<typeof vi.fn<NPC['assignFormationTarget']>>
  assignFollowTarget: ReturnType<typeof vi.fn>; isFormationTargetReached(id: number): boolean
  restoreCombatHealth(hp: number): void; restoreCombatAmmo(): void; setEagleFlightOrder(): void; dispose(): void
  mountVehicle(mount: Mount): void; dismountFromMount(): void
}
/** Grounded, stopped eagle on its pad: the numeric fields `isEaglePadArrived` and checkpoints read. */
interface StandbyEagle {
  isFlyingMount: true; isAirborne: boolean; dead: boolean; currentHp: number; maxHp: number; armorImpactRemaining: number
  group: { position: Vector3; rotation: Euler }
  flight: { phase: 'grounded'; speed: number; yaw: number; velocity: { x: number; y: number; z: number }; snapshot(): unknown }
  restoreArmor(): void; dispose(): void
}
/** Numeric actor double: only the private-squad lifecycle API; no scene, mesh or asset. */
function standbyHarness(members: { id: string; mount?: 'xongkoro' }[], options: { saved?: PersonalSquadMission; failOnce?: string[] } = {}) {
  let profile = createCareerProfile('roman')
  profile.rank = 'captain'; profile.availableMerit = 100_000
  // Real hires own their equipment; an eagle rider additionally owns its xongkoro.
  for (const { id } of members) expect(recruitPersonalSquadMember(profile, 'soldier', next => { profile = next; return true }, () => id).recruited).toBe(true)
  for (const { id, mount } of members) if (mount) {
    addCareerItem(profile, mount, 1)
    profile.personalSquad!.members.find(member => member.id === id)!.equipment!.mount = mount
  }
  if (options.saved) profile.personalSquadRuntime = options.saved
  const muster = Array.from({ length: 30 }, (_, i) => ({ x: -80 + i % 5 * 4.5, y: 2.1, z: 20 + Math.floor(i / 5) * 4.5, yaw: 0 }))
  const pad = { id: 'private-eagle-pad:1', x: -85, y: 0, z: 54, yaw: Math.PI }
  const spawned: { id: string; slot: { x: number; z: number }; pad?: { x: number; z: number } }[] = []
  const actors: StandbyActor[] = [], mounts: StandbyEagle[] = []
  const failures = new Set(options.failOnce)
  const spawn = (_scene: unknown, member: { id: string; equipment?: { mount?: string | null } }, _faction: unknown, slot: { x: number; y?: number; z: number; yaw: number }, _emit: unknown, boardingPad?: { x: number; z: number }) => {
    if (failures.delete(member.id)) throw new Error(`asset unavailable: ${member.id}`)
    const position = new Vector3(slot.x, slot.y ?? 0, slot.z)
    const actor: StandbyActor = { combatantId: member.id, dead: false, hp: 100, maxHp: 100, isMounted: false, isFalling: false,
      tacticalOrder: 'defend', missionMovement: false, formationCommandId: null, arrived: false, combatAmmo: 0,
      shield: { shieldImpactRemaining: 0, shieldImpactMax: 0 }, group: { position, rotation: new Euler() }, combatPosition: position, disposed: false,
      setTacticalOrder(order) { actor.tacticalOrder = order },
      // A new walk order clears the previous arrival, as on the real NPC.
      assignFormationTarget: vi.fn<NPC['assignFormationTarget']>((id: number) => { actor.formationCommandId = id; actor.tacticalOrder = 'formation'; actor.arrived = false }),
      assignFollowTarget: vi.fn(() => { actor.tacticalOrder = 'follow' }),
      isFormationTargetReached: () => actor.arrived,
      restoreCombatHealth(hp) { actor.hp = Math.min(actor.maxHp, hp) }, restoreCombatAmmo() {}, setEagleFlightOrder() {},
      dispose() { actor.disposed = true },
      mountVehicle(mount) { actor.mount = mount; actor.isMounted = true },
      dismountFromMount() { actor.mount = undefined; actor.isMounted = false } }
    actors.push(actor); spawned.push({ id: member.id, slot: { x: slot.x, z: slot.z }, ...(boardingPad ? { pad: { x: boardingPad.x, z: boardingPad.z } } : {}) })
    if (member.equipment?.mount !== 'xongkoro') return { npc: actor as unknown as NPC }
    const at = boardingPad ?? slot
    const eagle: StandbyEagle = { isFlyingMount: true, isAirborne: false, dead: false, currentHp: 180, maxHp: 200, armorImpactRemaining: 0,
      group: { position: new Vector3(at.x, getTerrainHeight(at.x, at.z), at.z), rotation: new Euler(0, pad.yaw, 0) },
      flight: { phase: 'grounded', speed: 0, yaw: pad.yaw, velocity: { x: 0, y: 0, z: 0 },
        snapshot: () => ({ phase: 'grounded', yaw: pad.yaw, pitch: 0, bank: 0, speed: 0, velocity: { x: 0, y: 0, z: 0 } }) },
      restoreArmor() {}, dispose() {} }
    mounts.push(eagle)
    if (!boardingPad) actor.mountVehicle(eagle as unknown as Mount)
    return { npc: actor as unknown as NPC, mount: eagle as unknown as Mount }
  }
  const scheduler = new NpcSpawnScheduler()
  const player = { dead: false, combatPosition: new Vector3(), group: { rotation: { y: 0 } } }
  const runtime = new PersonalSquadRuntime({} as never, muster, () => profile, () => player as never, spawn as never,
    { scheduler, hasHR: true, eaglePads: new EaglePadReservations([pad]) })
  let frame = 0
  const flush = () => { while (scheduler.pending) scheduler.tick(++frame) }
  return { runtime, scheduler, muster, pad, spawned, actors, mounts, flush,
    get profile() { return profile }, set profile(value) { profile = value } }
}

it('materializes only saved hires at distinct HR muster slots as standby, parks eagles on their pads and never duplicates', () => {
  const h = standbyHarness(Array.from({ length: 29 }, (_, i) => ({ id: `personal:m${i}`, ...(i === 3 ? { mount: 'xongkoro' as const } : {}) })))
  // A rejected save leaves the profile, so nothing materializes for that attempt.
  const before = h.profile
  expect(recruitPersonalSquadMember(before, 'soldier', () => false, () => 'personal:late')).toMatchObject({ recruited: false, reason: 'save-failed' })
  h.runtime.materializeStandby(); h.runtime.materializeStandby()
  expect(h.scheduler.pending).toBe(29)
  // The 30th hire is saved, so the next standby pass queues exactly that member.
  const saved = recruitPersonalSquadMember(before, 'soldier', () => true, () => 'personal:late')
  expect(saved.recruited).toBe(true)
  h.profile = saved.profile
  h.runtime.materializeStandby()
  expect(h.scheduler.pending).toBe(30)
  h.flush()
  h.runtime.materializeStandby(); h.runtime.updateLifecycle()
  expect(h.scheduler.pending).toBe(0)
  expect(h.actors).toHaveLength(30)
  expect(new Set(h.spawned.map(s => `${s.slot.x},${s.slot.z}`)).size).toBe(30)
  expect(h.runtime.state).toBe('RESERVE')
  // Standby holds its own slot on the floor; nobody received a Follow order.
  for (const actor of h.actors) {
    expect(actor.assignFollowTarget).not.toHaveBeenCalled()
    const target = actor.assignFormationTarget.mock.lastCall![1]
    expect(h.spawned.some(s => s.id === actor.combatantId && s.slot.x === target.x && s.slot.z === target.z)).toBe(true)
    expect(target.y).toBe(2.1)
  }
  // The eagle rider stands at HR; its eagle is parked on the reserved pad instead of being boarded.
  expect(h.spawned.find(s => s.id === 'personal:m3')).toMatchObject({ pad: { x: h.pad.x, z: h.pad.z } })
  expect(h.runtime.checkpoint()).toMatchObject({ state: 'RESERVE', members: { 'personal:m3': { status: 'deployed', eaglePadId: h.pad.id } } })
  expect(recruitPersonalSquadMember(h.profile, 'soldier', () => true, () => 'personal:over').reason).toBe('squad-full')
})

it('keeps the same wounded actors through Follow, Dismiss and HR arrival without reviving casualties or spawning again', () => {
  const h = standbyHarness([{ id: 'personal:a' }, { id: 'personal:b' }, { id: 'personal:c' }])
  h.runtime.materializeStandby(); h.flush()
  const [a, b, c] = h.actors
  expect(h.runtime.follow()).toBe(true)
  expect(h.scheduler.pending).toBe(0)
  expect(h.runtime.state).toBe('DEPLOYING')
  expect(a.assignFollowTarget).toHaveBeenCalledOnce()
  a.hp = 40; b.dead = true; b.hp = 0
  h.runtime.updateLifecycle()
  expect(h.runtime.dismiss()).toBe(true)
  expect(h.runtime.state).toBe('RETURNING')
  h.runtime.updateLifecycle()
  expect(h.runtime.state).toBe('RETURNING')
  a.arrived = c.arrived = true
  h.runtime.updateLifecycle()
  expect(h.runtime.state).toBe('RESERVE')
  expect(h.actors.map(actor => actor.disposed)).toEqual([false, false, false])
  expect(a.hp).toBe(40)
  // The casualty stays dead in HR until a refit; standby never respawns it.
  h.runtime.updateLifecycle(); h.runtime.materializeStandby()
  expect(h.scheduler.pending).toBe(0)
  expect(h.runtime.checkpoint()?.members).toMatchObject({ 'personal:a': { status: 'deployed', hp: 40 }, 'personal:b': { status: 'dead', hp: 0 } })
  expect(h.runtime.follow()).toBe(true)
  expect(h.scheduler.pending).toBe(0)
  expect(h.actors).toHaveLength(3)
  expect(a.assignFollowTarget).toHaveBeenCalledTimes(2)
})

it('reloads a saved HR standby as RESERVE with its wounds and fills only the members that had no actor', () => {
  const saved: PersonalSquadMission = { squadId: 'personal', sceneKey: 'town-home', state: 'RESERVE',
    memberIds: ['personal:wounded', 'personal:fresh'], contribution: emptyPersonalContribution(),
    members: { 'personal:wounded': { status: 'deployed', hp: 35, order: 'defend', position: { x: -75.5, y: 2.1, z: 20, yaw: 0 } },
      'personal:fresh': { status: 'reserve' } } }
  const h = standbyHarness([{ id: 'personal:wounded' }, { id: 'personal:fresh' }], { saved })
  h.runtime.restoreMission(saved)
  expect(h.scheduler.pending).toBe(1)
  h.runtime.updateLifecycle()
  expect(h.scheduler.pending).toBe(2)
  h.flush()
  h.runtime.updateLifecycle()
  expect(h.scheduler.pending).toBe(0)
  expect(h.runtime.state).toBe('RESERVE')
  expect(h.actors.map(actor => [actor.combatantId, actor.hp])).toEqual([['personal:wounded', 35], ['personal:fresh', 100]])
  expect(h.actors.every(actor => actor.assignFollowTarget.mock.calls.length === 0)).toBe(true)
})

it('finishes an eagle return at HR standby with the same rider and parked eagle, then boards that eagle again on Follow', () => {
  const h = standbyHarness([{ id: 'personal:eagle', mount: 'xongkoro' }, { id: 'personal:foot' }])
  h.runtime.materializeStandby(); h.flush()
  const [rider, foot] = h.actors, [eagle] = h.mounts
  const onPad = () => [eagle.group.position.x, eagle.group.position.z]
  expect(onPad()).toEqual([h.pad.x, h.pad.z])
  // Follow walks the rider to its parked eagle; live contact boards it.
  expect(h.runtime.follow()).toBe(true)
  rider.group.position.copy(eagle.group.position)
  h.runtime.updateLifecycle()
  expect(rider.mount).toBe(eagle)
  // Dismiss: the eagle lands on its own pad, the rider dismounts and walks to its HR slot.
  expect(h.runtime.dismiss()).toBe(true)
  h.runtime.updateLifecycle()
  expect(rider.mount).toBeUndefined()
  expect(h.runtime.state).toBe('RETURNING')
  // Arrival on the same frame as the transfer pass must not issue a new walk order.
  rider.arrived = foot.arrived = true
  h.runtime.updateLifecycle()
  expect(h.runtime.state).toBe('RESERVE')
  h.runtime.updateLifecycle()
  expect(h.runtime.state).toBe('RESERVE')
  expect(h.scheduler.pending).toBe(0)
  expect([h.actors.length, h.mounts.length, rider.disposed]).toEqual([2, 1, false])
  expect(onPad()).toEqual([h.pad.x, h.pad.z])
  expect(h.runtime.checkpoint()?.members['personal:eagle']).toMatchObject({ status: 'deployed', eaglePadId: h.pad.id, mount: { mounted: false } })
  // The next Follow boards the same parked eagle.
  expect(h.runtime.follow()).toBe(true)
  expect(rider.assignFormationTarget.mock.lastCall![1].toArray()).toEqual(eagle.group.position.toArray())
  rider.group.position.copy(eagle.group.position)
  h.runtime.updateLifecycle()
  expect(rider.mount).toBe(eagle)
  expect(h.actors).toHaveLength(2)
})

it('keeps the Town usable after an HR standby spawn failure and retries the same saved hire once without charging again', () => {
  const h = standbyHarness([{ id: 'personal:ok' }, { id: 'personal:broken' }], { failOnce: ['personal:broken'] })
  const merit = h.profile.availableMerit, roster = structuredClone(h.profile.personalSquad)
  h.runtime.materializeStandby(); h.flush()
  expect(h.actors.map(actor => actor.combatantId)).toEqual(['personal:ok'])
  // A standby failure is not a deployment failure: no lock, Follow/refit readiness intact.
  expect(h.runtime.standbyError).toBeInstanceOf(Error)
  expect(h.runtime.error).toBeUndefined()
  expect(h.runtime.ready).toBe(true)
  expect(h.runtime.hudPendingIds).toEqual([])
  // No automatic retry loop.
  h.runtime.updateLifecycle(); h.runtime.materializeStandby()
  expect(h.scheduler.pending).toBe(0)
  // Retry queues the same identity; a cancelled batch frees it for the next retry.
  h.runtime.retryStandby()
  expect(h.scheduler.pending).toBe(1)
  h.runtime.cancelPendingSpawns()
  h.runtime.retryStandby(); h.flush()
  expect(h.actors.map(actor => actor.combatantId)).toEqual(['personal:ok', 'personal:broken'])
  expect(h.runtime.standbyError).toBeUndefined()
  h.runtime.retryStandby(); h.runtime.updateLifecycle()
  expect(h.scheduler.pending).toBe(0)
  expect(h.actors).toHaveLength(2)
  expect(h.profile.availableMerit).toBe(merit)
  expect(h.profile.personalSquad).toEqual(roster)
})

it('stands a hire made while the old squad follows at its own HR slot without changing deployed orders, then deploys it on the next Follow', () => {
  const h = standbyHarness([{ id: 'personal:old' }])
  h.runtime.materializeStandby(); h.flush()
  const [old] = h.actors
  expect(h.runtime.follow()).toBe(true)
  const oldOrders = [old.assignFollowTarget.mock.calls.length, old.assignFormationTarget.mock.calls.length]
  // Back at HR the player hires again: the saved hire appears at once beside the deployed squad.
  expect(recruitPersonalSquadMember(h.profile, 'soldier', next => { h.profile = next; return true }, () => 'personal:new').recruited).toBe(true)
  h.runtime.materializeStandby(); h.runtime.materializeStandby()
  expect(h.scheduler.pending).toBe(1)
  expect(h.runtime.hudPendingIds).toEqual([])
  h.flush(); h.runtime.updateLifecycle()
  const recruit = h.actors[1]
  expect(recruit.combatantId).toBe('personal:new')
  expect(recruit.assignFollowTarget).not.toHaveBeenCalled()
  const slot = h.spawned[1].slot
  expect(slot).not.toEqual(h.spawned[0].slot)
  expect(recruit.assignFormationTarget.mock.lastCall![1].toArray()).toEqual([slot.x, 2.1, slot.z])
  expect(h.runtime.state).toBe('DEPLOYING')
  expect([old.assignFollowTarget.mock.calls.length, old.assignFormationTarget.mock.calls.length]).toEqual(oldOrders)
  expect([h.runtime.acceptsCommand(old as unknown as NPC), h.runtime.acceptsCommand(recruit as unknown as NPC)]).toEqual([true, false])
  const saved = parsePersonalMission(JSON.parse(JSON.stringify(h.runtime.checkpoint())))!
  expect(saved.members['personal:new']).toMatchObject({ status: 'deployed', standby: true })
  // Dismiss returns only the deployed member; the recruit is already home.
  const recruitWalks = recruit.assignFormationTarget.mock.calls.length
  expect(h.runtime.dismiss()).toBe(true)
  expect(recruit.assignFormationTarget.mock.calls.length).toBe(recruitWalks)
  expect(h.runtime.hudReturningIds).toEqual(['personal:old'])
  old.arrived = true; h.runtime.updateLifecycle()
  expect(h.runtime.state).toBe('RESERVE')
  expect(h.runtime.follow()).toBe(true)
  expect(recruit.assignFollowTarget).toHaveBeenCalledOnce()
  expect(h.actors).toHaveLength(2)
  // Reload keeps the recruit on standby while the deployed member resumes Follow.
  const r = standbyHarness([{ id: 'personal:old' }, { id: 'personal:new' }], { saved })
  r.runtime.restoreMission(saved); r.flush()
  const [restoredOld, restoredNew] = r.actors
  expect(restoredOld.assignFollowTarget).toHaveBeenCalledOnce()
  expect(restoredNew.assignFollowTarget).not.toHaveBeenCalled()
  expect(r.runtime.acceptsCommand(restoredNew as unknown as NPC)).toBe(false)
})
