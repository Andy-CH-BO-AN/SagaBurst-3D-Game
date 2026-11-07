import { afterEach, describe, expect, it, vi } from 'vitest'
import * as MountModule from '../../src/world/Mount'
import { HorseAssetRegistry, horseVariantForStableKey } from '../../src/world/HorseAssetRegistry'
import { TownScene } from '../../src/town/TownScene'
import { gameplayNpcSpawns, type NpcSpawnBatch } from '../../src/world/NpcSpawnScheduler'
import type { TownCombatResident } from '../../src/town/TownMissionCombat'
import { resolveTownActorEquipment, type TownEquipmentRef } from '../../src/career/CareerTownEquipment'
import type { CareerMountId, CareerProfile } from '../../src/career/CareerProfile'
import { CareerMountController } from '../../src/career/CareerMountController'
import { CommanderFourGateDefenseController } from '../../src/career/CommanderFourGateDefenseController'
import { BanditMissionController } from '../../src/career/BanditMissionController'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { addCareerItem } from '../../src/career/CareerInventory'
import type { NpcSpawnSpec } from '../../src/battle/BattleSpawner'
import type { RaceRider } from '../../src/career/CareerRaceState'

// The render constructor is the external boundary: capture arguments only, with data
// needed for HP/heading restoration. No scene, actor, model or visual is constructed.
function captureMountConstruction() {
  return vi.spyOn(MountModule, 'Mount').mockImplementation(function () {
    return { maxHp: 100, currentHp: 100, group: { rotation: { y: 0 } }, onDeathCallbacks: [], restoreArmor: vi.fn(), dispose() {} } as unknown as MountModule.Mount
  })
}
const spawnBatches: NpcSpawnBatch[] = []
let mountFrame = 10000
afterEach(() => { for (const batch of spawnBatches) batch.cancel(); spawnBatches.length = 0; vi.restoreAllMocks() })

describe('Career horse spawn appearance forwarding', () => {
  it('restores a race horse using the persisted player coat while retaining saved HP and heading', () => {
    const create = captureMountConstruction()
    const profile = createCareerProfile('roman'); addCareerItem(profile, 'horse', 1); profile.horseAppearanceVariant = 2
    const owner = Object.assign(Object.create(CareerMountController.prototype) as Pick<CareerMountController, 'restoreRaceMount' | 'activeMount'>, {
      readProfile: () => profile, hp: new Map(), armorImpact: new Map(), unavailable: new Set(), active: null,
    })
    const saved: RaceRider = { actorId: 'player', mountId: 'horse', hp: 80, stamina: 50, mountHp: 37,
      mounted: true, dead: false, checkpoint: 1, position: { x: 1, y: 0, z: 2, yaw: .5 },
      mountPosition: { x: 3, y: 4, z: 5, yaw: 1.2 } }
    expect(owner.restoreRaceMount(saved)).toBe(true)
    expect(create).toHaveBeenCalledExactlyOnceWith(undefined, MountModule.MountType.HORSE, 3, 5, 4, 2)
    expect(owner.activeMount?.currentHp).toBe(37)
    expect(owner.activeMount?.group.rotation.y).toBe(1.2)
  })

  it('passes distinct stable actor coats to mission mounts independently of spawn position/order', () => {
    const create = captureMountConstruction()
    interface MountEntry { createVeteranMount(spec: NpcSpawnSpec): MountModule.Mount }
    const owner = Object.assign(Object.create(BanditMissionController.prototype) as MountEntry, { veteranFieldFactories: {} })
    // One roster's invariant: coats vary and an actor retains
    // its assigned coat when reconstructed at a different checkpoint position.
    const colors = new Set<number>()
    for (const actorId of ['mission:cavalry:1', 'mission:cavalry:2', 'mission:cavalry:3']) {
      const spec = { actorId, x: 1, z: 2, loadout: { mountId: 'horse' } } as NpcSpawnSpec
      owner.createVeteranMount(spec)
      const variant = create.mock.calls.at(-1)![5]!
      colors.add(variant)
      expect(variant).toBe(horseVariantForStableKey(actorId))
      owner.createVeteranMount({ ...spec, x: 20, z: 30 })
      expect(create.mock.calls.at(-1)![5]).toBe(variant)
    }
    expect(colors.size).toBeGreaterThan(1)
  })

  it('forwards stable Commander V lancer coats through its real mount materializer on reconstruction', () => {
    const create = captureMountConstruction()
    interface MountEntry { materializeMount(spec: NpcSpawnSpec): MountModule.Mount }
    const owner = Object.assign(Object.create(CommanderFourGateDefenseController.prototype) as MountEntry,
      { enemyMounts: [], actorMounts: new Map() })
    const colors = new Set<number>()
    for (const actorId of ['four-gate-save:north:lancer:t3:1', 'four-gate-save:north:lancer:t3:2', 'four-gate-save:north:lancer:t3:3']) {
      const spec = { actorId, x: 1, z: 2, loadout: { mountId: 'horse' } } as NpcSpawnSpec
      owner.materializeMount(spec)
      const variant = create.mock.calls.at(-1)![5]!
      expect(variant).toBe(horseVariantForStableKey(actorId)); colors.add(variant)
      owner.materializeMount({ ...spec, x: 25, z: -30 })
      expect(create.mock.calls.at(-1)![5]).toBe(variant)
    }
    expect(colors.size).toBeGreaterThan(1)
  })

})

// Exercise the startup mount boundary directly; the TownScene constructor is never run.
interface ResidentMountEntry {
  initializeResidentMount(resident: TownCombatResident, id: CareerMountId, ref: TownEquipmentRef | null, faction: CareerProfile['faction']): void
  restoreDeferredResidentMounts(time: number): void
  disposed: boolean
}
function residentMountOwner() {
  const profile = createCareerProfile('roman'), actorId = 'cavalry-training:melee_cavalry:0'
  addCareerItem(profile, 'armored-horse', 1)
  profile.townEquipment = { roman: { version: 1, nativeReserve: [], actors: {
    [actorId]: { melee: null, ranged: null, shield: null, mount: { itemId: 'armored-horse', source: 'inventory' } },
  } } }
  const npc = { dead: false, inCombat: false, mount: null as MountModule.Mount | null,
    mountVehicle: vi.fn((mount: MountModule.Mount) => { npc.mount = mount }) }
  const resident: TownCombatResident = { spec: { id: actorId, role: 'melee_cavalry', duty: 'training', mounted: true,
    training: true, assaultObjective: false, tier: 3, index: 0, x: 10, z: 20, yaw: .7 }, npc: npc as unknown as TownCombatResident['npc'], cycle: -1, walkTime: 0 }
  const mounts: MountModule.Mount[] = [], residents = [resident]
  const owner = Object.assign(Object.create(TownScene.prototype) as ResidentMountEntry, {
    profile, scene: {}, renderer: {}, mounts, residents, disposed: false,
    deferredResidentMounts: new Map(), residentMountLoadPending: false, residentMountRetryAt: 0,
  })
  const create = captureMountConstruction()
  let ready = false
  vi.spyOn(HorseAssetRegistry, 'armoredReady', 'get').mockImplementation(() => ready)
  let resolve!: () => void, reject!: (error: Error) => void
  const preload = vi.spyOn(HorseAssetRegistry, 'preloadArmored').mockImplementation(() => new Promise<void>((ok, fail) => {
    resolve = () => { ready = true; ok() }; reject = fail
  }))
  const realBatch = gameplayNpcSpawns.batch.bind(gameplayNpcSpawns)
  vi.spyOn(gameplayNpcSpawns, 'batch').mockImplementation((failure) => {
    const batch = realBatch(failure); spawnBatches.push(batch); return batch
  })
  const ref = resolveTownActorEquipment(profile, 'roman', actorId).refs.mount
  return { owner, resident, npc, mounts, residents, profile, create, preload, ref,
    resolve: () => resolve(), reject: () => reject(new Error('asset unavailable')) }
}
async function flushMountLoads() { for (let turn = 0; turn < 6; turn++) await Promise.resolve() }

it('keeps NPC startup and ordinary mounts working through armored failure, retries, and mounts the original resident once', async () => {
  const h = residentMountOwner()
  h.owner.initializeResidentMount(h.resident, 'armored-horse', h.ref, 'roman')
  expect(h.create).not.toHaveBeenCalled()
  const ordinary = { ...h.resident, spec: { ...h.resident.spec, id: 'other-resident' }, npc: { ...h.npc, mountVehicle: vi.fn() } as unknown as TownCombatResident['npc'] }
  h.owner.initializeResidentMount(ordinary, 'horse', null, 'roman')
  expect(h.create).toHaveBeenCalledExactlyOnceWith(expect.anything(), MountModule.MountType.HORSE, 10, 20, undefined, expect.any(Number))
  h.owner.restoreDeferredResidentMounts(0); h.owner.restoreDeferredResidentMounts(1)
  expect(h.preload).toHaveBeenCalledTimes(1)
  h.reject(); await flushMountLoads()
  expect(h.resident.homeMount).toBeUndefined(); expect(h.residents).toEqual([h.resident])
  h.owner.restoreDeferredResidentMounts(performance.now() + 1001)
  expect(h.preload).toHaveBeenCalledTimes(2)
  h.resolve(); await flushMountLoads()
  h.owner.restoreDeferredResidentMounts(2000)
  gameplayNpcSpawns.tick(++mountFrame)
  h.owner.restoreDeferredResidentMounts(2002); gameplayNpcSpawns.tick(++mountFrame)
  expect(h.create).toHaveBeenCalledTimes(2)
  expect(h.create.mock.calls[1][1]).toBe(MountModule.MountType.ARMORED_HORSE)
  expect(h.npc.mountVehicle).toHaveBeenCalledExactlyOnceWith(h.resident.homeMount)
  expect(h.resident.homeMount?.group.rotation.y).toBe(.7)
  expect(h.mounts).toHaveLength(2); expect(h.residents).toEqual([h.resident])
})

it.each(['scene-disposed', 'equipment-changed'] as const)('drops deferred NPC armor after %s before materialization', async reason => {
  const h = residentMountOwner()
  h.owner.initializeResidentMount(h.resident, 'armored-horse', h.ref, 'roman')
  h.owner.restoreDeferredResidentMounts(0)
  h.resolve(); await flushMountLoads()
  h.owner.restoreDeferredResidentMounts(3000)
  // Changes after enqueue are checked again inside the real spawn job.
  if (reason === 'scene-disposed') h.owner.disposed = true
  else h.profile.townEquipment!.roman!.actors[h.resident.spec.id]!.mount = null
  gameplayNpcSpawns.tick(++mountFrame)
  expect(spawnBatches.at(-1)?.status).toBe('complete')
  expect(h.create).not.toHaveBeenCalled(); expect(h.mounts).toHaveLength(0)
  expect(h.npc.mountVehicle).not.toHaveBeenCalled()
})

it('preserves the saved retirement mount and riding state when checkpointing before assets recover', () => {
  const next = createCareerProfile('roman')
  const mountState = { activeMountId: 'armored-horse' as const, hp: { 'armored-horse': 219 }, armorImpact: { 'armored-horse': 0 }, unavailable: [] }
  next.retirementRuntime = { mountState,
    player: { position: { x: 1, y: 0, z: 2, yaw: .3 }, hp: 90, stamina: 30, arrows: 5, shieldImpact: 3, mounted: true },
    mount: { position: { x: 11, y: 2, z: 13, yaw: 1.2 }, hp: 219, armorImpactRemaining: 0 },
  }
  const savedMount = structuredClone(next.retirementRuntime.mount)
  const mounts = Object.assign(Object.create(CareerMountController.prototype) as CareerMountController, {
    active: null, restoringMountId: 'armored-horse', hp: new Map([['armored-horse', 219]]), armorImpact: new Map([['armored-horse', 0]]), unavailable: new Set(),
  })
  interface CaptureEntry { captureRetirementResources(next: CareerProfile): void }
  const owner = Object.assign(Object.create(TownScene.prototype) as CaptureEntry, { careerMounts: mounts,
    skills: { skillState: next.skills }, player: {
      group: { position: { x: 1, y: 0, z: 2 }, rotation: { y: .3 } }, dead: false, hp: 80, staminaValue: 30, arrowCount: 5,
      shield: { shieldImpactRemaining: 3, captureDurability: () => ({}) }, currentMount: null, isFalling: false,
    },
  })
  owner.captureRetirementResources(next)
  expect(next.retirementRuntime?.mount).toEqual(savedMount)
  expect(next.retirementRuntime?.mountState).toEqual(mountState)
  expect(next.retirementRuntime?.player.mounted).toBe(true)
  expect(next.retirementRuntime?.player.hp).toBe(80)
})
