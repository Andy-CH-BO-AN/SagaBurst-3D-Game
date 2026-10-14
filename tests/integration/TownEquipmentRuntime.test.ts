import * as THREE from 'three'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import { addCareerItem, normalizeCareerInventory } from '../../src/career/CareerInventory'
import { bulkCareerEquipment, changeTownEquipment, resolveTownActorEquipment, type TownEquipmentContext } from '../../src/career/CareerTownEquipment'
import { applyTownEquipmentRuntime, findTownNativeMount, registerTownNativeMount } from '../../src/town/TownEquipmentRuntime'
import type { TownCombatResident } from '../../src/town/TownMissionCombat'
import { NPC, AIType, Faction } from '../../src/world/NPC'
import { Mount, MountType } from '../../src/world/Mount'
import { HorseAssetRegistry } from '../../src/world/HorseAssetRegistry'
import { RecordingMount, RecordingNpc, recording, resetSpawnRecording } from '../helpers/npcSpawnRecording'
import { MemoryStorage } from '../helpers/memoryStorage'

const mode = vi.hoisted(() => ({ recording: false }))
vi.mock('../../src/world/HorseAssetRegistry', async original => ({
  ...(await original<typeof import('../../src/world/HorseAssetRegistry')>()),
  HorseAssetRegistry: { ready: true, createInstance: vi.fn((await import('../helpers/gameplayHorseVisual')).createGameplayHorseVisual) },
}))
// The constructor boundary is doubled only for the pure physical-token transfer case.
vi.mock('../../src/world/Mount', async original => {
  const actual = await original<typeof import('../../src/world/Mount')>()
  const { RecordingMount: Recorded } = await import('../helpers/npcSpawnRecording')
  return { ...actual, Mount: function(...args: ConstructorParameters<typeof actual.Mount>) {
    return mode.recording ? new Recorded(...args) : new actual.Mount(...args)
  } }
})

afterEach(() => { mode.recording = false; resetSpawnRecording(); vi.clearAllMocks(); vi.restoreAllMocks() })

function ownership(actorIds: string[], horseCount = 1) {
  const store = new CareerProfileStore(new MemoryStorage())
  let profile: CareerProfile = { ...createCareerProfile('roman'), rank: 'commander' }
  normalizeCareerInventory(profile); addCareerItem(profile, 'horse', horseCount)
  expect(store.save(profile)).toBe(true)
  const context: TownEquipmentContext = { townFaction: 'roman', peaceful: true, personalState: 'RESERVE', safeActorIds: new Set(actorIds) }
  const save = (next: CareerProfile) => { if (!store.save(next)) return false; profile = next; return true }
  return { read: () => profile, save, store, context }
}

describe('Committed Town equipment runtime mount ownership', () => {
  it('binds one real civilian and one purchased horse, preserves health on repeated bulk no-op, and disposes the released physical mount', () => {
    // 1 real NPC and 1 real Horse. Rendering uses the shared lightweight horse visual boundary; no Player/TownWorld.
    const f = ownership(['civilian-0']), scene = new THREE.Scene(), base = resolveTownActorEquipment(f.read(), 'roman', 'civilian-0')
    const npc = new NPC(scene, 0, 0, Faction.PLAYER, 'roman', AIType.MELEE, 'Civilian', 2, false,
      base.loadout, undefined, 'civilians', 'civilian-0', undefined, undefined, undefined, undefined, 'civilian', 'roman')
    onTestFinished(() => npc.dispose())
    const resident: TownCombatResident = { spec: base.spec, npc, cycle: 0, walkTime: 0 }, mounts: Mount[] = []
    onTestFinished(() => mounts.forEach(mount => mount.dispose()))
    npc.takeDamage(13)
    const before = f.read(), assignment = changeTownEquipment(f.read, f.context, 'civilian-0', 'mount', 'horse', f.save)
    expect(assignment.changed).toBe(true)
    expect(resolveTownActorEquipment(f.store.load()!, 'roman', 'civilian-0').loadout.mountId).toBe('horse')
    expect(applyTownEquipmentRuntime(scene, [resident], mounts, before, f.read(), assignment.changedActorIds)).toBe(0)
    const mount = mounts[0]
    onTestFinished(() => mount.dispose())
    expect(mounts).toHaveLength(1)
    expect(resident.homeMount).toBe(mount); expect(npc.mount).toBe(mount); expect(mount.riderNpc).toBe(npc)
    expect(mount.reservedForTown).toBe(true); expect(npc.maxHp).toBe(50); expect(npc.hp).toBe(37)
    mount.currentHp = 23
    const repeated = bulkCareerEquipment(f.read, f.context, 'civilian', 'mount', f.save)
    expect(repeated.changed).toBe(false); expect(repeated.reason).toBe('no-op')
    expect(applyTownEquipmentRuntime(scene, [resident], mounts, f.read(), f.read(), repeated.changedActorIds)).toBe(0)
    expect(mounts).toEqual([mount]); expect(mount.currentHp).toBe(23); expect(npc.hp).toBe(37)
    expect(HorseAssetRegistry.createInstance).toHaveBeenCalledTimes(1)
    const committed = f.read(), removal = changeTownEquipment(f.read, f.context, 'civilian-0', 'mount', null, f.save)
    expect(removal.changed).toBe(true)
    expect(applyTownEquipmentRuntime(scene, [resident], mounts, committed, f.read(), removal.changedActorIds)).toBe(0)
    expect(mounts).toEqual([]); expect(npc.mount).toBeNull(); expect(resident.homeMount).toBeUndefined(); expect(mount.disposed).toBe(true)
    expect(f.store.load()!.inventory!.quantities.horse).toBe(1)
  })

  it('keeps all old physical mounts and weapons when one actor becomes unavailable after the new configuration was saved', () => {
    // 2 recording NPCs and 2 existing recording Mounts. A late readiness failure is the external runtime boundary.
    mode.recording = true
    const a = 'cavalry-training:melee_cavalry:0', b = 'cavalry-training:melee_cavalry:4'
    const f = ownership([a, b], 2), scene = new THREE.Scene(), before = f.read()
    const initialA = resolveTownActorEquipment(before, 'roman', a), initialB = resolveTownActorEquipment(before, 'roman', b)
    const npcA = new RecordingNpc(scene, 0, 0, Faction.PLAYER, 'roman', AIType.MELEE, 'A', 2, true, initialA.loadout, undefined, 2, a)
    const npcB = new RecordingNpc(scene, 5, 0, Faction.PLAYER, 'roman', AIType.MELEE, 'B', 2, true, initialB.loadout, undefined, 2, b)
    const horseA = new RecordingMount(scene, MountType.HORSE, 0, 0), horseB = new RecordingMount(scene, MountType.HORSE, 5, 0)
    horseA.currentHp = 27; horseB.currentHp = 19; npcA.mountVehicle(horseA); npcB.mountVehicle(horseB)
    const residents = [
      { spec: initialA.spec, npc: npcA, homeMount: horseA, cycle: 0, walkTime: 0 },
      { spec: initialB.spec, npc: npcB, homeMount: horseB, cycle: 0, walkTime: 0 },
    ], mounts = [horseA, horseB]
    onTestFinished(() => { npcA.dispose(); npcB.dispose(); mounts.forEach(mount => mount.dispose()) })
    const plan = bulkCareerEquipment(f.read, f.context, 2, 'mount', f.save)
    expect(plan.changed).toBe(true); expect(plan.changedActorIds).toEqual([a, b])
    npcB.canApplyCareerEquipment.mockReturnValue(false)
    // Construction protocol doubles only; real readiness and actor behavior have their own owners.
    expect(applyTownEquipmentRuntime(scene, residents as unknown as TownCombatResident[], mounts as unknown as Mount[], before, f.read(), plan.changedActorIds)).toBe(2)
    expect(resolveTownActorEquipment(f.store.load()!, 'roman', a).refs.mount).toEqual({ itemId: 'horse', source: 'inventory' })
    expect(resolveTownActorEquipment(f.store.load()!, 'roman', b).refs.mount).toEqual({ itemId: 'horse', source: 'inventory' })
    expect(residents[0].homeMount).toBe(horseA); expect(npcA.mount).toBe(horseA); expect(horseA.riderNpc).toBe(npcA)
    expect(residents[1].homeMount).toBe(horseB); expect(npcB.mount).toBe(horseB); expect(horseB.riderNpc).toBe(npcB)
    expect(npcA.dismountFromMount).not.toHaveBeenCalled(); expect(npcB.dismountFromMount).not.toHaveBeenCalled()
    expect(npcA.applyCareerEquipment).not.toHaveBeenCalled(); expect(npcB.applyCareerEquipment).not.toHaveBeenCalled()
    expect(horseA.dispose).not.toHaveBeenCalled(); expect(horseB.dispose).not.toHaveBeenCalled()
    expect(horseA.currentHp).toBe(27); expect(horseB.currentHp).toBe(19); expect(mounts).toEqual([horseA, horseB])
    expect(recording.mounts).toHaveLength(2)
  })

  it('retains the shared Ranger cat as a native reserve and reuses its physical identity and HP in a later squad transaction', () => {
    // 2 recording NPCs and 2 recording Mounts (one existing service Cat + one purchased Horse); 0 real actors.
    mode.recording = true
    const rangerId = 'ranger', peerId = 'cavalry-training:melee_cavalry:1', otherSquadId = 'cavalry-training:melee_cavalry:0'
    const f = ownership([rangerId, peerId, otherSquadId]), scene = new THREE.Scene()
    expect(changeTownEquipment(f.read, f.context, peerId, 'mount', null, f.save).changed).toBe(true)
    const before = f.read(), rangerEquipment = resolveTownActorEquipment(before, 'roman', rangerId), peerEquipment = resolveTownActorEquipment(before, 'roman', peerId)
    const ranger = new RecordingNpc(scene, 0, 0, Faction.PLAYER, 'roman', AIType.RANGED, 'Ranger', 4, true, rangerEquipment.loadout, undefined, 4, rangerId)
    const peer = new RecordingNpc(scene, 5, 0, Faction.PLAYER, 'roman', AIType.MELEE, 'Peer', 2, false, peerEquipment.loadout, undefined, 4, peerId)
    const cat = new RecordingMount(scene, MountType.BLACK_CAT, 0, 0)
    cat.currentHp = 29; ranger.mountVehicle(cat)
    registerTownNativeMount(cat as unknown as Mount, 'roman/ranger/mount')
    const residents = [
      { spec: rangerEquipment.spec, npc: ranger, homeMount: cat as RecordingMount | undefined, cycle: 0, walkTime: 0 },
      { spec: peerEquipment.spec, npc: peer, homeMount: undefined as RecordingMount | undefined, cycle: 0, walkTime: 0 },
    ], mounts = [cat]
    onTestFinished(() => { ranger.dispose(); peer.dispose(); mounts.forEach(mount => mount.dispose()) })
    const assignment = changeTownEquipment(f.read, f.context, rangerId, 'mount', 'horse', f.save)
    expect(assignment.changed).toBe(true)
    expect(applyTownEquipmentRuntime(scene, residents as unknown as TownCombatResident[], mounts as unknown as Mount[], before, f.read(), assignment.changedActorIds)).toBe(0)
    const horse = ranger.mount
    expect(horse?.type).toBe(MountType.HORSE); expect(horse).not.toBe(cat); expect(cat.riderNpc).toBeNull()
    expect(cat.dispose).not.toHaveBeenCalled(); expect(cat.currentHp).toBe(29); expect(mounts).toContain(cat)
    expect(f.store.load()!.townEquipment!.roman!.nativeReserve).toContain('roman/ranger/mount')
    expect(findTownNativeMount(mounts as unknown as Mount[], rangerEquipment.refs.mount)).toBe(cat)
    const parked = f.read(), foreign = bulkCareerEquipment(f.read, f.context, 2, 'mount', f.save)
    expect(foreign.changed).toBe(false); expect(foreign.reason).toBe('no-op'); expect(f.read()).toBe(parked)
    expect(resolveTownActorEquipment(f.store.load()!, 'roman', otherSquadId).refs.mount).toEqual({ itemId: 'horse', source: 'native', nativeId: `roman/${otherSquadId}/mount` })
    const redistribution = bulkCareerEquipment(f.read, f.context, 4, 'mount', f.save)
    expect(redistribution.changed).toBe(true); expect(redistribution.changedActorIds).toEqual([peerId])
    expect(resolveTownActorEquipment(f.store.load()!, 'roman', peerId).refs.mount).toEqual({ itemId: 'black-cat', source: 'native', nativeId: 'roman/ranger/mount' })
    expect(applyTownEquipmentRuntime(scene, residents as unknown as TownCombatResident[], mounts as unknown as Mount[], parked, f.read(), redistribution.changedActorIds)).toBe(0)
    expect(residents[1].homeMount).toBe(cat); expect(peer.mount).toBe(cat); expect(cat.riderNpc).toBe(peer); expect(cat.currentHp).toBe(29)
    expect(ranger.mount).toBe(horse); expect(mounts).toHaveLength(2); expect(cat.dispose).not.toHaveBeenCalled()
    expect(recording.mounts.filter(mount => mount.type === MountType.BLACK_CAT)).toHaveLength(1); expect(recording.mounts).toHaveLength(2)
    expect(f.store.load()!.inventory!.quantities['black-cat']).toBeUndefined(); expect(f.store.load()!.inventory!.quantities.horse).toBe(1)
  })

  it('moves a native horse to a squad peer using the same physical instance and HP while leaving another resident mount untouched', () => {
    // 2 recording NPCs, 3 recording Mount constructions (2 existing + 1 purchased); 0 real actors.
    mode.recording = true
    const a = 'cavalry-training:melee_cavalry:0', b = 'cavalry-training:melee_cavalry:4'
    const f = ownership([a, b]), scene = new THREE.Scene()
    expect(changeTownEquipment(f.read, f.context, b, 'mount', null, f.save).changed).toBe(true)
    const old = f.read(), resolvedA = resolveTownActorEquipment(old, 'roman', a), resolvedB = resolveTownActorEquipment(old, 'roman', b)
    const npcA = new RecordingNpc(scene, 0, 0, Faction.PLAYER, 'roman', AIType.MELEE, 'A', 2, true, resolvedA.loadout, undefined, 2, a)
    const npcB = new RecordingNpc(scene, 5, 0, Faction.PLAYER, 'roman', AIType.MELEE, 'B', 2, false, resolvedB.loadout, undefined, 2, b)
    const native = new RecordingMount(scene, MountType.HORSE, 0, 0), unrelated = new RecordingMount(scene, MountType.HORSE, 50, 0)
    native.currentHp = 31; unrelated.currentHp = 17; npcA.mountVehicle(native)
    const residentA = { spec: resolvedA.spec, npc: npcA, homeMount: native, cycle: 0, walkTime: 0 }
    const residentB = { spec: resolvedB.spec, npc: npcB, homeMount: undefined as RecordingMount | undefined, cycle: 0, walkTime: 0 }
    const outside = { spec: { id: 'outside-squad' }, npc: { mount: unrelated }, homeMount: unrelated }
    const residents = [residentA, residentB, outside], mounts = [native, unrelated]
    onTestFinished(() => { npcA.dispose(); npcB.dispose(); mounts.forEach(mount => mount.dispose()) })
    const plan = bulkCareerEquipment(f.read, f.context, 2, 'mount', f.save)
    expect(plan.changed).toBe(true); expect(plan.summary.upgraded).toBe(2)
    expect(resolveTownActorEquipment(f.store.load()!, 'roman', b).refs.mount).toEqual({ itemId: 'horse', source: 'native', nativeId: `roman/${a}/mount` })
    // The cast is confined to the external construction protocol; no NPC or mount simulation is claimed here.
    expect(applyTownEquipmentRuntime(scene, residents as unknown as TownCombatResident[], mounts as unknown as Mount[], old, f.read(), plan.changedActorIds)).toBe(0)
    expect(residentB.homeMount).toBe(native); expect(npcB.mount).toBe(native); expect(native.riderNpc).toBe(npcB); expect(native.currentHp).toBe(31)
    expect(npcA.mount).not.toBe(native); expect(mounts).toHaveLength(3); expect(new Set(mounts).size).toBe(3)
    expect(outside.homeMount).toBe(unrelated); expect(outside.npc.mount).toBe(unrelated); expect(unrelated.currentHp).toBe(17)
    expect(unrelated.dispose).not.toHaveBeenCalled(); expect(recording.npcs).toHaveLength(2); expect(recording.mounts).toHaveLength(3)
  })
})
