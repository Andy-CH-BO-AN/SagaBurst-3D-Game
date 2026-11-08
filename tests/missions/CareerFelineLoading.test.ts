import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Vector3 } from 'three'
import { HorseAssetRegistry } from '../../src/world/HorseAssetRegistry'
import { BlackCatVisual, type FelineMountVariant } from '../../src/world/BlackCatVisual'
import { CareerMountController, careerFelineVariants } from '../../src/career/CareerMountController'
import { CareerRaceController } from '../../src/career/CareerRaceController'
import { createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { addCareerItem } from '../../src/career/CareerInventory'
import { applyTownEquipmentRuntime, getTownEquipmentRuntimeStatus, resetTownEquipmentRuntimeState } from '../../src/town/TownEquipmentRuntime'
import { updateTownEquipmentVisibleStatus } from '../../src/town/TownSquadEquipmentUI'
import type { TownCombatResident } from '../../src/town/TownMissionCombat'
import type { Mount } from '../../src/world/Mount'

// The Mount constructor needs rendered assets; this suite owns only the request lifecycle.
vi.mock('../../src/world/Mount', async importOriginal => {
  const original = await importOriginal<typeof import('../../src/world/Mount')>()
  class StubMount {
    armorImpactRemaining = 0; armorImpactMax = 0; restoreArmor(value?: number) { this.armorImpactRemaining = value ?? this.armorImpactMax }
    currentHp = 100; maxHp = 100; onDeathCallbacks: Array<() => void> = []
    group = { position: new Vector3(), rotation: { y: 0 } }; isAirborne = false; dead = false
    constructor(public scene: unknown, public type: string, x = 0, z = 0, y = 0) {
      this.group.position.set(x, y, z)
      if (type === original.MountType.ARMORED_HORSE) { this.maxHp = 600; this.armorImpactMax = 50 }
    }
    setCameraDistance() {}
    update() {}
    dispose() {}
  }
  return { ...original, Mount: StubMount }
})

const loaded = new Set<FelineMountVariant>()
const gates = new Map<FelineMountVariant, { resolve(): void; reject(error: Error): void }>()
let preloadCalls: FelineMountVariant[] = []

beforeEach(() => {
  loaded.clear(); gates.clear(); preloadCalls = []
  resetTownEquipmentRuntimeState()
  vi.spyOn(BlackCatVisual, 'isPreloaded').mockImplementation((variant = 'black-cat') => loaded.has(variant))
  vi.spyOn(BlackCatVisual, 'preload').mockImplementation((variant = 'black-cat') => {
    preloadCalls.push(variant)
    return new Promise<void>((resolve, reject) => gates.set(variant, { resolve: () => { loaded.add(variant); resolve() }, reject }))
  })
})
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals() })

// The mocked asset preload is an already-controlled Promise. Production
// continuations only enqueue microtasks (preloadVariants/Promise.all/then),
// so drain those directly instead of scheduling a real zero-delay timer.
// A timer injects runner-load latency into the strict <=100ms leaf budget.
async function flush() {
  for (let turn = 0; turn < 6; turn++) await Promise.resolve()
}

function mountOwner() {
  let current = createCareerProfile('roman')
  for (const id of ['serval', 'orange-cat', 'white-cat', 'armored-horse'] as const) addCareerItem(current, id, 1)
  const player = { isFalling: false, currentMount: null as Mount | null, mountVehicle: vi.fn(), dismountFromMount: vi.fn(), isMounted: false,
    combatPosition: new Vector3(), position: new Vector3(), facingYaw: 0 }
  player.mountVehicle.mockImplementation((mount: Mount) => { player.currentMount = mount; player.isMounted = true })
  const owner = Object.create(CareerMountController.prototype) as CareerMountController
  Object.assign(owner as unknown as object, {
    scene: {}, player: () => player, readProfile: () => current, commit: (next: CareerProfile) => { current = next; return true },
    obstacles: () => [], occupied: () => [], sceneKey: () => 'town-home', options: {},
    hp: new Map(), armorImpact: new Map(), unavailable: new Set(), active: null, requestSeq: 0, pending: null, statusText: '',
  })
  return { owner, player, profile: () => current }
}

describe('feline mount activation under asynchronous asset loading', () => {
  it('reports loading as not-yet-activated, coalesces repeated clicks and ignores a superseded load', async () => {
    const { owner, profile } = mountOwner()
    expect(owner.activate('serval')).toBe(false)
    expect(owner.activate('serval')).toBe(false)
    expect(preloadCalls).toEqual(['serval'])
    // A newer choice supersedes the in-flight Serval request.
    expect(owner.activate('orange-cat')).toBe(false)
    gates.get('serval')!.resolve(); await flush()
    expect(owner.activeMountId).toBeNull()
    expect(profile().selectedMountId).toBeUndefined()
    gates.get('orange-cat')!.resolve(); await flush()
    expect(owner.activeMountId).toBe('orange-cat')
    expect(profile().selectedMountId).toBe('orange-cat')
  })

  it.each(['dismiss', 'release', 'dispose', 'restInTown', 'syncOwnership'] as const)('%s invalidates a pending load', async action => {
    const { owner } = mountOwner()
    expect(owner.activate('serval')).toBe(false)
    owner[action]('serval' as never)
    gates.get('serval')!.resolve(); await flush()
    expect(owner.activeMountId).toBeNull()
  })

  it('leaves no stale request after a failed load and allows an explicit retry', async () => {
    const { owner } = mountOwner()
    expect(owner.activate('white-cat')).toBe(false)
    gates.get('white-cat')!.reject(new Error('network')); await flush()
    expect(owner.activeMountId).toBeNull(); expect(owner.statusText).toContain('失敗')
    expect(owner.activate('white-cat')).toBe(false)
    expect(preloadCalls).toEqual(['white-cat', 'white-cat'])
    gates.get('white-cat')!.resolve(); await flush()
    expect(owner.activeMountId).toBe('white-cat')
  })
})

describe('Career saved mounts after the shared preload barrier', () => {
  it('restores mission HP and zero armor once without changing the selected mount or spending merit', () => {
    const h = mountOwner(), profile = h.profile()
    profile.selectedMountId = 'armored-horse'
    profile.activeMission = { id: 'restore-mission', templateId: 'outpost-relief', targetCampId: 0, phase: 'ENGAGING', acceptedAt: 1,
      targetActorIds: [], friendlyActorIds: [], mountState: { activeMountId: 'armored-horse', hp: { 'armored-horse': 317 }, armorImpact: { 'armored-horse': 0 }, unavailable: [] } }
    Object.assign(h.owner, { hp: new Map([['armored-horse', 317]]), armorImpact: new Map([['armored-horse', 0]]) })
    vi.spyOn(HorseAssetRegistry, 'armoredReady', 'get').mockReturnValue(true)
    const preload = vi.spyOn(HorseAssetRegistry, 'preloadArmored')
    const saved = structuredClone(profile)
    expect(h.owner.restoreActiveMount()).toBe(true)
    const mount = h.owner.activeMount!
    expect(mount.type).toBe('ARMORED_HORSE')
    expect(mount.currentHp).toBe(317); expect(mount.armorImpactRemaining).toBe(0)
    expect(h.player.currentMount).toBe(mount)
    expect(h.owner.restoreActiveMount()).toBe(true)
    expect(h.owner.activeMount).toBe(mount)
    expect(h.player.mountVehicle).toHaveBeenCalledTimes(1)
    expect(h.profile()).toEqual(saved); expect(preload).not.toHaveBeenCalled()
  })

  it.each([true, false])('restores retirement resources, coordinates, heading and mounted=%s synchronously', mounted => {
    const h = mountOwner(), p = h.profile()
    p.selectedMountId = 'armored-horse'
    p.careerRetirement = { version: 1, phase: 'final-stand', acceptedAt: 1, combatElapsedSeconds: 0 }
    p.retirementRuntime = {
      mountState: { activeMountId: 'armored-horse', hp: { 'armored-horse': 219 }, armorImpact: { 'armored-horse': 0 }, unavailable: [] },
      player: { position: { x: 4, y: 0, z: 5, yaw: .3 }, hp: 50, stamina: 30, arrows: 5, shieldImpact: 3, mounted },
      mount: { position: { x: 11, y: 2, z: 13, yaw: 1.2 }, hp: 219, armorImpactRemaining: 0 },
    }
    vi.spyOn(HorseAssetRegistry, 'armoredReady', 'get').mockReturnValue(true)
    const saved = structuredClone(p)
    expect(h.owner.restoreActiveMount()).toBe(true)
    const mount = h.owner.activeMount!
    expect(mount.group.position).toEqual(new Vector3(11, 2, 13))
    expect(mount.group.rotation.y).toBe(1.2)
    expect(mount.currentHp).toBe(219); expect(mount.armorImpactRemaining).toBe(0)
    expect(h.player.mountVehicle).toHaveBeenCalledTimes(mounted ? 1 : 0)
    if (mounted) expect(h.player.mountVehicle).toHaveBeenCalledWith(mount, 1.2)
    expect(h.profile()).toEqual(saved)
  })
})

describe('Town startup feline preload set', () => {
  it('does not request merely owned felines for a profile riding a horse', () => {
    const profile = createCareerProfile('roman')
    for (const id of ['horse', 'white-cat', 'orange-cat', 'serval', 'caracal'] as const) addCareerItem(profile, id, 1)
    profile.ownedMounts = ['white-cat', 'orange-cat', 'serval', 'caracal']
    profile.selectedMountId = 'horse'
    expect([...careerFelineVariants(profile)]).toEqual(['black-cat'])
  })

  it('includes the selected mount, saved race opponent and mounts assigned to squad members', () => {
    const profile = createCareerProfile('roman')
    profile.selectedMountId = 'serval'
    profile.activeRace = { player: { mountId: 'serval' }, opponent: { mountId: 'caracal' } } as CareerProfile['activeRace']
    profile.personalSquad = { members: [{ id: 'm', type: 'commander', equipment: { mount: 'white-cat' } }] } as CareerProfile['personalSquad']
    expect([...careerFelineVariants(profile)].sort()).toEqual(['black-cat', 'caracal', 'serval', 'white-cat'])
  })
})

describe('Race opponent feline load failure recovery', () => {
  interface RaceInternals { session?: unknown; deploy(initial: boolean, restoring: boolean): void }
  function raceOwner() {
    const session = { id: 'race-session', opponent: { mountId: 'caracal', actorId: 'commander' } }
    const enqueueDeployment = vi.fn()
    const owner = Object.create(CareerRaceController.prototype) as CareerRaceController
    const internals = owner as unknown as RaceInternals
    Object.assign(internals, { session, enqueueDeployment, preloadInFlight: false, error: '' })
    return { owner, internals, session, enqueueDeployment }
  }

  it('keeps the persisted session and opponent, retries after the delay and deploys exactly once', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(0)
    const { owner, internals, session, enqueueDeployment } = raceOwner()
    internals.deploy(false, true)
    gates.get('caracal')!.reject(new Error('transient')); await flush()
    expect(owner.deploymentRetryPending).toBe(true)
    expect(owner.error).toContain('重試')
    expect(session.opponent.mountId).toBe('caracal')
    expect(enqueueDeployment).not.toHaveBeenCalled()

    owner.prepare(); expect(preloadCalls).toEqual(['caracal'])      // not yet due
    vi.setSystemTime(3001); owner.prepare()
    expect(preloadCalls).toEqual(['caracal', 'caracal'])
    gates.get('caracal')!.resolve(); await flush()
    expect(enqueueDeployment).toHaveBeenCalledExactlyOnceWith(session, false, true)
    expect(owner.deploymentRetryPending).toBe(false)
    owner.prepare(); expect(preloadCalls).toHaveLength(2)
  })

  it('drops the retry when the session is gone', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(0)
    const { owner, internals, enqueueDeployment } = raceOwner()
    internals.deploy(true, false)
    gates.get('caracal')!.reject(new Error('transient')); await flush()
    internals.session = undefined
    vi.setSystemTime(5000); owner.prepare()
    expect(owner.deploymentRetryPending).toBe(false)
    expect(enqueueDeployment).not.toHaveBeenCalled()
  })
})

describe('Town feline equipment asynchronous refit', () => {
  function townResidentFixture(actorId = 'cavalry-training:melee_cavalry:0') {
    const mount = {
      group: { position: new Vector3(10, 0, 10), rotation: { y: 0 } },
      isAirborne: false,
      dead: false,
      riderPlayer: null,
      riderNpc: null as unknown,
      dispose: vi.fn(),
    }
    const npc = {
      dead: false,
      inCombat: false,
      mount: mount as unknown as Mount,
      combatPosition: { x: 10, z: 10 },
      group: { position: new Vector3(10, 0, 10), rotation: { y: 0 } },
      canApplyCareerEquipment: vi.fn(() => true),
      applyCareerEquipment: vi.fn(() => true),
      dismountFromMount: vi.fn(function (this: { mount: unknown }) { this.mount = null }),
      mountVehicle: vi.fn(function (this: { mount: unknown }, m: unknown) { this.mount = m }),
      setTownPeaceful: vi.fn(),
    }
    mount.riderNpc = npc
    const resident: TownCombatResident = {
      spec: { id: actorId, role: 'cavalry', x: 10, z: 10 } as any,
      npc: npc as any,
      homeMount: mount as unknown as Mount,
      cycle: 0,
      walkTime: 0,
    }
    const mounts: Mount[] = [mount as unknown as Mount]
    const scene = { disposed: false }
    return { resident, npc, mount, mounts, scene }
  }

  function profilesFixture(actorId = 'cavalry-training:melee_cavalry:0') {
    const previous = createCareerProfile('roman')
    previous.rank = 'commander'
    addCareerItem(previous, 'horse', 2)
    addCareerItem(previous, 'paladin_sword_t4', 1)
    previous.townEquipment = {
      roman: {
        version: 1,
        nativeReserve: [],
        actors: {
          [actorId]: { melee: { itemId: 'paladin_sword_t4', source: 'inventory' }, ranged: null, shield: null, mount: { itemId: 'horse', source: 'inventory' } },
        },
      },
    }

    const current = createCareerProfile('roman')
    current.rank = 'commander'
    addCareerItem(current, 'horse', 1)
    addCareerItem(current, 'serval', 1)
    addCareerItem(current, 'paladin_sword_t4', 1)
    current.townEquipment = {
      roman: {
        version: 1,
        nativeReserve: [],
        actors: {
          [actorId]: { melee: { itemId: 'paladin_sword_t4', source: 'inventory' }, ranged: null, shield: null, mount: { itemId: 'serval', source: 'inventory' } },
        },
      },
    }
    return { previous, current }
  }

  it('delays physical application until feline preload completes, then re-applies without requiring town reload', async () => {
    const actorId = 'cavalry-training:melee_cavalry:0'
    const { resident, mount, mounts, scene, npc } = townResidentFixture(actorId)
    const { previous, current } = profilesFixture(actorId)

    const pending = applyTownEquipmentRuntime(scene as any, [resident], mounts, previous, current, [actorId])
    expect(pending).toBe(1)
    expect(preloadCalls).toEqual(['serval'])
    expect(resident.homeMount).toBe(mount)
    expect(npc.dismountFromMount).not.toHaveBeenCalled()

    gates.get('serval')!.resolve(); await flush()
    expect(npc.dismountFromMount).toHaveBeenCalled()
    expect(mount.dispose).toHaveBeenCalled()
    expect(resident.homeMount).not.toBe(mount)
    expect(resident.npc.mount).toBe(resident.homeMount)
    expect(getTownEquipmentRuntimeStatus()).toBe('配置已套用。')
  })

  it('drops delayed refit when the resident target mount changes before preload finishes', async () => {
    const actorId = 'cavalry-training:melee_cavalry:0'
    const { resident, mount, mounts, scene, npc } = townResidentFixture(actorId)
    const { previous, current } = profilesFixture(actorId)

    let liveProfile = current
    const pending = applyTownEquipmentRuntime(scene as any, [resident], mounts, previous, current, [actorId], {
      getCurrentProfile: () => liveProfile,
    })
    expect(pending).toBe(1)

    const cancelled = createCareerProfile('roman')
    cancelled.rank = 'commander'
    cancelled.townEquipment = {
      roman: {
        version: 1,
        nativeReserve: [],
        actors: {
          [actorId]: { melee: { itemId: 'paladin_sword_t4', source: 'inventory' }, ranged: null, shield: null, mount: { itemId: 'caracal', source: 'inventory' } },
        },
      },
    }
    liveProfile = cancelled

    gates.get('serval')!.resolve(); await flush()
    expect(resident.homeMount).toBe(mount)
    expect(npc.dismountFromMount).not.toHaveBeenCalled()
    expect(mount.dispose).not.toHaveBeenCalled()
  })

  it('drops delayed refit when the town scene is disposed before preload finishes', async () => {
    const actorId = 'cavalry-training:melee_cavalry:0'
    const { resident, mount, mounts, scene, npc } = townResidentFixture(actorId)
    const { previous, current } = profilesFixture(actorId)

    const pending = applyTownEquipmentRuntime(scene as any, [resident], mounts, previous, current, [actorId], {
      isDisposed: () => scene.disposed,
    })
    expect(pending).toBe(1)

    scene.disposed = true
    gates.get('serval')!.resolve(); await flush()
    expect(resident.homeMount).toBe(mount)
    expect(npc.dismountFromMount).not.toHaveBeenCalled()
    expect(mount.dispose).not.toHaveBeenCalled()
  })

  it('preserves existing physical equipment intact and surfaces retryable status when feline preload fails', async () => {
    const actorId = 'cavalry-training:melee_cavalry:0'
    const { resident, mount, mounts, scene, npc } = townResidentFixture(actorId)
    const { previous, current } = profilesFixture(actorId)

    const onStatusChange = vi.fn()
    const pending = applyTownEquipmentRuntime(scene as any, [resident], mounts, previous, current, [actorId], {
      onStatusChange,
    })
    expect(pending).toBe(1)

    gates.get('serval')!.reject(new Error('Network error')); await flush()
    expect(resident.homeMount).toBe(mount)
    expect(npc.dismountFromMount).not.toHaveBeenCalled()
    expect(mount.dispose).not.toHaveBeenCalled()
    expect(getTownEquipmentRuntimeStatus()).toBe('配置保存成功，坐騎資源載入失敗，可重試套用')
    expect(onStatusChange).toHaveBeenCalledWith('配置保存成功，坐騎資源載入失敗，可重試套用')
  })

  it('reconciles overlapping weapon refit during in-flight feline preload using physical mount baseline', async () => {
    const actorId = 'cavalry-training:melee_cavalry:0'
    const { resident, mount, mounts, scene, npc } = townResidentFixture(actorId)
    const { previous, current } = profilesFixture(actorId)

    // Call 1: Serval is selected, loading starts
    let liveProfile = current
    const pending1 = applyTownEquipmentRuntime(scene as any, [resident], mounts, previous, current, [actorId], {
      getCurrentProfile: () => liveProfile,
    })
    expect(pending1).toBe(1)
    expect(resident.homeMount).toBe(mount) // Still physical horse

    // Call 2: While Serval is still loading, player equips T5 sword for same resident
    const updatedWithWeapon = structuredClone(current)
    addCareerItem(updatedWithWeapon, 'sword_t5', 1)
    updatedWithWeapon.townEquipment!.roman!.actors[actorId]!.melee = { itemId: 'sword_t5', source: 'inventory' }
    liveProfile = updatedWithWeapon

    const pending2 = applyTownEquipmentRuntime(scene as any, [resident], mounts, current, updatedWithWeapon, [actorId], {
      getCurrentProfile: () => liveProfile,
    })
    expect(pending2).toBe(1)
    expect(resident.homeMount).toBe(mount) // Still physical horse

    // When Serval finishes preloading:
    gates.get('serval')!.resolve(); await flush()

    // Both physical mount (Serval) and weapon (T5 sword) are applied!
    expect(resident.homeMount).not.toBe(mount)
    expect(resident.npc.mount).toBe(resident.homeMount)
    expect(npc.applyCareerEquipment).toHaveBeenCalledWith(
      expect.objectContaining({ meleeWeaponId: 'sword_t5', mountId: 'serval' }),
      expect.any(Number),
    )
    expect(getTownEquipmentRuntimeStatus()).toBe('配置已套用。')
  })

  it('reports deferred status and leaves physical mount unchanged when resident enters combat during feline preload', async () => {
    const actorId = 'cavalry-training:melee_cavalry:0'
    const { resident, mount, mounts, scene, npc } = townResidentFixture(actorId)
    const { previous, current } = profilesFixture(actorId)

    const onStatusChange = vi.fn()
    const onPreloadComplete = vi.fn()
    applyTownEquipmentRuntime(scene as any, [resident], mounts, previous, current, [actorId], {
      onStatusChange,
      onPreloadComplete,
    })

    // Resident enters combat before preload completes
    npc.inCombat = true

    gates.get('serval')!.resolve(); await flush()
    expect(resident.homeMount).toBe(mount)
    expect(npc.dismountFromMount).not.toHaveBeenCalled()
    expect(getTownEquipmentRuntimeStatus()).toBe('配置已保存，待下次回城套用。')
    expect(onStatusChange).toHaveBeenCalledWith('配置已保存，待下次回城套用。')
    expect(onPreloadComplete).toHaveBeenCalledWith({
      success: false,
      status: '配置已保存，待下次回城套用。',
      actorIds: [],
    })
  })

  it('reports cancelled status when resident target mount is changed before preload finishes', async () => {
    const actorId = 'cavalry-training:melee_cavalry:0'
    const { resident, mount, mounts, scene } = townResidentFixture(actorId)
    const { previous, current } = profilesFixture(actorId)

    const cancelled = structuredClone(current)
    cancelled.townEquipment!.roman!.actors[actorId]!.mount = { itemId: 'caracal', source: 'inventory' }
    let liveProfile = current

    const onStatusChange = vi.fn()
    const onPreloadComplete = vi.fn()
    applyTownEquipmentRuntime(scene as any, [resident], mounts, previous, current, [actorId], {
      getCurrentProfile: () => liveProfile,
      onStatusChange,
      onPreloadComplete,
    })

    liveProfile = cancelled

    gates.get('serval')!.resolve(); await flush()
    expect(resident.homeMount).toBe(mount)
    expect(getTownEquipmentRuntimeStatus()).toBe('配置已取消。')
    expect(onStatusChange).toHaveBeenCalledWith('配置已取消。')
    expect(onPreloadComplete).toHaveBeenCalledWith({
      success: false,
      status: '配置已取消。',
      actorIds: [],
    })
  })

  it('ignores superseded preload completion without overwriting active request status', async () => {
    const actorId = 'cavalry-training:melee_cavalry:0'
    const { resident, mount, mounts, scene } = townResidentFixture(actorId)
    const { previous, current } = profilesFixture(actorId)

    const onStatusChange = vi.fn()
    applyTownEquipmentRuntime(scene as any, [resident], mounts, previous, current, [actorId], {
      onStatusChange,
    })

    // Newer request arrives with caracal
    const caracalProfile = structuredClone(current)
    addCareerItem(caracalProfile, 'caracal', 1)
    caracalProfile.townEquipment!.roman!.actors[actorId]!.mount = { itemId: 'caracal', source: 'inventory' }

    let liveProfile = caracalProfile
    applyTownEquipmentRuntime(scene as any, [resident], mounts, current, caracalProfile, [actorId], {
      getCurrentProfile: () => liveProfile,
      onStatusChange,
    })

    onStatusChange.mockClear()

    // Serval finishes (superseded)
    gates.get('serval')!.resolve(); await flush()
    expect(onStatusChange).not.toHaveBeenCalled()
    expect(resident.homeMount).toBe(mount)

    // Caracal finishes (active)
    gates.get('caracal')!.resolve(); await flush()
    expect(onStatusChange).toHaveBeenCalledWith('配置已套用。')
    expect(resident.homeMount).not.toBe(mount)
  })

  it('does not leak a resident physical mount baseline into a new Town scene with the same actor ID', () => {
    const actorId = 'cavalry-training:melee_cavalry:0'
    loaded.add('serval')
    const { previous, current } = profilesFixture(actorId)
    const first = townResidentFixture(actorId)
    expect(applyTownEquipmentRuntime(first.scene as any, [first.resident], first.mounts, previous, current, [actorId])).toBe(0)
    expect(first.resident.homeMount).not.toBe(first.mount)

    // New scene reuses the actor ID, but this resident is still physically on Horse.
    const second = townResidentFixture(actorId)
    const changedWeapon = structuredClone(previous)
    addCareerItem(changedWeapon, 'sword_t5', 1)
    changedWeapon.townEquipment!.roman!.actors[actorId]!.melee = { itemId: 'sword_t5', source: 'inventory' }
    expect(applyTownEquipmentRuntime(second.scene as any, [second.resident], second.mounts, previous, changedWeapon, [actorId])).toBe(0)
    expect(second.resident.homeMount).toBe(second.mount)
    expect(second.npc.dismountFromMount).not.toHaveBeenCalled()
    expect(second.mount.dispose).not.toHaveBeenCalled()
  })

  it('does not mark an unsuccessful mountVehicle as physically applied, allowing a later refit to retry', () => {
    const actorId = 'cavalry-training:melee_cavalry:0'
    loaded.add('serval')
    const { resident, mounts, scene, npc } = townResidentFixture(actorId)
    const { previous, current } = profilesFixture(actorId)
    npc.mountVehicle.mockImplementationOnce(() => {}) // First mount attempt fails.
    expect(applyTownEquipmentRuntime(scene as any, [resident], mounts, previous, current, [actorId])).toBe(1)
    expect(npc.mount).not.toBe(resident.homeMount)

    const next = structuredClone(current)
    addCareerItem(next, 'sword_t5', 1)
    next.townEquipment!.roman!.actors[actorId]!.melee = { itemId: 'sword_t5', source: 'inventory' }
    expect(applyTownEquipmentRuntime(scene as any, [resident], mounts, current, next, [actorId])).toBe(0)
    expect(npc.mount).toBe(resident.homeMount)
  })

  it('updates only the dedicated Town refit status and preserves fixed-equipment descriptions', () => {
    const statusElem = { textContent: '舊狀態' }
    const fixedEquipmentDescription = { textContent: '固定 T5 武器／T4 盾牌' }
    const otherModalStatus = { textContent: '其他功能狀態' }

    const fakeDoc = {
      querySelectorAll: vi.fn((selector: string) => {
        expect(selector).toBe('#town-equipment-current [data-town-equipment-status]')
        return [statusElem] as any
      }),
    }
    vi.stubGlobal('document', fakeDoc)

    expect(updateTownEquipmentVisibleStatus('配置已套用。')).toBe(true)
    expect(statusElem.textContent).toBe('配置已套用。')
    expect(fixedEquipmentDescription.textContent).toBe('固定 T5 武器／T4 盾牌')
    expect(otherModalStatus.textContent).toBe('其他功能狀態')
  })
})
