import * as THREE from 'three'
import { selectMissionInfantryActorIds } from '../../src/career/BanditMissionController'
import { selectTownCavalryReserve } from '../../src/town/TownCavalryReserve'
import { selectCareerDuelRoster } from '../../src/career/CareerDuelController'
import type { NPC } from '../../src/world/NPC'
import type { Mount } from '../../src/world/Mount'
import { describe, expect, it } from 'vitest'
import { townEagleRoster, resolveTownEagleGarrison, townMissionMilitaryIds } from '../../src/town/TownEagleGarrison'
import { townMilitaryEquipment, townRoster, TownEvent } from '../../src/town/TownRules'
import { resolveTownEagleTrainingGround } from '../../src/town/TownEagleTrainingGround'
import { resolveTownHRLayout } from '../../src/town/TownHRLayout'
import { isEagleApproachClear } from '../../src/world/EagleApproach'
import { isEagleLandingClear } from '../../src/world/EagleLanding'
import { isEagleLandingClearOfMounts, type EagleLandingOccupant } from '../../src/world/EagleLandingOccupants'
import { townCavalryReserveSource } from '../../src/town/TownCavalryReserve'
import { createEnemyTownAssaultMission } from '../../src/career/EnemyTownAssault'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import { MemoryStorage } from '../helpers/memoryStorage'

it.each([
  { scenario: 'west-gate horse 22.7 m away leaves the eagle pad clear', x: -117.704, flying: false, clear: true },
  { scenario: 'horse body inside the eagle wing footprint blocks the pad', x: -106.8, flying: false, clear: false },
  { scenario: 'neighboring eagle retains full wing separation', x: -117.704, flying: true, clear: false },
])('$scenario', ({ x, flying, clear }) => {
  // Collision policy only: no real mounts, NPCs, assets or TownWorld.
  const group = new THREE.Group(), geometry = new THREE.BoxGeometry(1.1, 1.65, 2.4)
  const material = new THREE.MeshBasicMaterial(), aimCollider = new THREE.Mesh(geometry, material)
  aimCollider.position.y = .825; group.add(aimCollider); group.position.set(x, 0, -75)
  const occupant: EagleLandingOccupant = { group, aimCollider, isFlyingMount: flying, dead: false, disposed: false }
  try {
    expect(isEagleLandingClearOfMounts({ x: -95, z: -75, yaw: 0 }, [], [occupant], undefined, 350, () => 0)).toBe(clear)
  } finally { geometry.dispose(); material.dispose() }
})

it('rejects a high rendered roof and unsafe parked eagle along an otherwise clear authored approach', () => {
  const pad = { x: 0, z: 0, yaw: 0 }, flat = () => 0
  const body = { box: new THREE.Box3(new THREE.Vector3(-4, 0, -55), new THREE.Vector3(4, 5, -45)), isBarricade: false }
  const roof = { box: new THREE.Box3(new THREE.Vector3(-4, 14, -55), new THREE.Vector3(4, 31, -45)), isBarricade: false }
  expect(isEagleApproachClear(pad, [body], [], 350, 20, flat)).toBe(true)
  expect(isEagleApproachClear(pad, [body, roof], [], 350, 20, flat)).toBe(false)
  expect(isEagleApproachClear(pad, [], [{ x: 0, z: -30, yaw: 0 }], 350, 20, flat)).toBe(false)
  expect(isEagleApproachClear(pad, [], [{ x: 0, z: -50, yaw: 0 }], 350, 20, flat)).toBe(true)
})

it('rejects an authored staging corridor outside the map or below the airborne terrain envelope', () => {
  expect(isEagleApproachClear({ x: 0, z: -300, yaw: 0 }, [], [], 350, 20, () => 0)).toBe(false)
  expect(isEagleApproachClear({ x: 0, z: 0, yaw: 0 }, [], [], 350, 20,
    (_x, z) => z < -40 ? 25 : 0)).toBe(false)
})

describe('Town-owned five-pair eagle roster policy', () => {
  it.each(['roman', 'viking'] as const)('%s uses five real T3 archers and fixed rider/mount/home identities independent of array order', faction => {
    const guards = townRoster().filter(spec => spec.duty === 'eagle_garrison')
    expect(guards.map(spec => spec.id)).toEqual([1, 2, 3, 4, 5].map(slot => `town-eagle-rider:${slot}`))
    expect(guards.map(spec => spec.eagle!.mountId)).toEqual([1, 2, 3, 4, 5].map(slot => `town-eagle-mount:${slot}`))
    expect(guards.map(spec => spec.eagle!.homePadId)).toEqual([1, 2, 3, 4, 5].map(slot => `town-eagle-pad:${slot}`))
    expect(guards.map(spec => spec.eagle!.cruiseAltitude)).toEqual([20, 25, 30, 35, 40])
    for (const spec of [...guards].reverse()) {
      const equipment = townMilitaryEquipment(faction, spec)
      expect(equipment).toMatchObject({ presetId: `${faction}_archer`, tier: 3, level: 3, loadout: { rangedWeaponId: 'elven_runebow' } })
      expect(spec).toMatchObject({ mounted: false, training: false, tier: 3 })
      expect(townCavalryReserveSource(spec)).toBeUndefined()
    }
  })
  it('ordinary infantry, cavalry and duels never borrow the paired Town guards', () => {
    // Read-only selection facts, zero real actors. Doubles expose only consumed eligibility fields.
    const candidates = townRoster().filter(spec => spec.eagle || spec.id === 'captain' || spec.id === 'melee_infantry-0').map(spec => {
      const mount = { dead: false, disposed: false, riderNpc: null, riderPlayer: null } as unknown as Mount
      const npc = { combatantId: spec.id, dead: false, mount: null, presetId: spec.eagle ? 'roman_archer' : 'roman_heavy_infantry' } as unknown as NPC
      return { spec, npc, homeMount: spec.eagle ? mount : undefined }
    })
    const guards = candidates.filter(resident => resident.spec.eagle)
    expect(selectMissionInfantryActorIds(guards, 5)).toEqual([])
    expect(selectTownCavalryReserve(guards, [{ unitType: 'horse_archer' }, { unitType: 'horse_archer', officer: 'ranger' }])).toEqual([undefined, undefined])
    const duel = selectCareerDuelRoster(candidates, {} as Mount, 'roman_archer', 3)
    expect(duel?.opponent.spec.id).toBe('melee_infantry-0')
  })
  it('materializes three private and five separate town pads, reserving full landing envelopes without a TownWorld', () => {
    const privateLayout = resolveTownEagleTrainingGround([], [], resolveTownHRLayout('roman', [], []))
    const townLayout = resolveTownEagleGarrison(privateLayout)
    expect(privateLayout.pads).toHaveLength(3); expect(townLayout.pads).toHaveLength(5)
    const pads = [...privateLayout.pads, ...townLayout.pads]
    expect(new Set(pads.map(p => p.id)).size).toBe(8)
    pads.forEach(pad => expect(isEagleLandingClear(pad, [], pads.filter(other => other !== pad), 350)).toBe(true))
    const roster = townEagleRoster(townLayout)
    roster.forEach(spec => expect(townLayout.pads.find(p => p.id === spec.eagle!.homePadId)).toMatchObject(spec.eagle!.home))
  })
  it('requires only the five riders for conquest and never mounts, personal actors or roaming troops', () => {
    const roster = townEagleRoster(), event = new TownEvent(roster)
    roster.forEach(spec => event.register(spec.id, { dead: true }))
    for (const id of ['town-eagle-mount:1', 'personal:ranger', 'outskirts:cavalry:a:0']) event.register(id, { dead: false })
    event.complete(); event.hostile = true
    expect(event.actors.size).toBe(5); expect(event.evaluate(false)).toBe('town_defeated')
  })
  it('preserves accepted old assault IDs and casualties through real storage while new missions include all five riders', () => {
    const profile = createCareerProfile('roman'), store = new CareerProfileStore(new MemoryStorage())
    profile.activeMission = createEnemyTownAssaultMission('old-assault')
    expect(profile.activeMission.targetActorIds.filter(id => id.startsWith('town-eagle-rider:'))).toHaveLength(5)
    profile.activeMission.targetActorIds = profile.activeMission.targetActorIds.filter(id => !id.startsWith('town-eagle-rider:'))
    profile.activeMission.deadTargetActorIds = ['captain']
    profile.activeMission.phase = 'ATTACKING'; profile.activeMission.siege!.rosterCreated = true
    expect(store.save(profile)).toBe(true)
    const restored = store.load()!.activeMission!
    expect(restored.targetActorIds).toEqual(profile.activeMission.targetActorIds)
    expect(restored.deadTargetActorIds).toEqual(['captain'])
    expect(townMissionMilitaryIds(townRoster(), restored.targetActorIds).size).toBe(203)
    expect([...townMissionMilitaryIds(townRoster(), restored.targetActorIds)].some(id => id.startsWith('town-eagle-rider:'))).toBe(false)
  })
})

it('stages two ready crews by simulation time and gives only one return approach ownership', async () => {
  const THREE = await import('three')
  const { TownEagleGarrisonController } = await import('../../src/town/TownEagleGarrisonController')
  const { getTerrainHeight } = await import('../../src/world/Terrain')
  const { vi } = await import('vitest')
  const layout = resolveTownEagleGarrison(resolveTownEagleTrainingGround([], [], resolveTownHRLayout('roman', [], [])))
  // Command-policy doubles, zero real NPCs/Mounts. Real locomotion/flight is owned by the runtime integration.
  const crew = townEagleRoster(layout).slice(0, 2).map(spec => {
    const home = spec.eagle!.home, mountGroup = new THREE.Group(), group = new THREE.Group()
    mountGroup.position.set(home.x, getTerrainHeight(home.x, home.z), home.z); group.position.copy(mountGroup.position)
    const mountState = { group: mountGroup, dead: false, isFlyingMount: true, isAirborne: false, currentHp: 200, maxHp: 200,
      flight: { phase: 'grounded' as const, speed: 0, yaw: home.yaw, velocity: { x: 0, y: 0, z: 0 } } }
    const mount = mountState as unknown as Mount
    const npcState = { group, dead: false, isFalling: false, mount: null as Mount | null, combatAmmo: 30, missionMovement: false,
      get combatPosition() { return group.position },
      setEagleCruiseAltitude: vi.fn(), setEagleFlightOrder: vi.fn(), setMissionCombatTarget: vi.fn(),
      setTacticalOrder: vi.fn(), restoreCombatAmmo: vi.fn(), assignFormationTarget: vi.fn(), updateTownTravel: vi.fn(), updateTownPeace: vi.fn(),
      mountVehicle: (vehicle: Mount) => { npcState.mount = vehicle }, dismountFromMount: () => { npcState.mount = null },
    }
    return { spec, npc: npcState as unknown as NPC, homeMount: mount, mountState, npcState }
  })
  const runtime = new TownEagleGarrisonController(crew)
  const navigation = {} as import('../../src/navigation/NavigationWorld').NavigationWorld
  const tick = (index: number, combat: boolean) => runtime.update(crew[index].npc, 0, combat, new THREE.Vector3(), [], navigation, [], crew.map(row => row.homeMount))
  tick(0, true); tick(1, true)
  expect(crew.map(row => runtime.dutyFor(row.npc))).toEqual(['mounted-waiting', 'mounted-waiting'])
  expect(tick(0, true)).toBe(false); expect(tick(1, true)).toBe(true)
  runtime.beginFrame(1.49); expect(tick(1, true)).toBe(true)
  runtime.beginFrame(.01); expect(tick(1, true)).toBe(false)
  crew.forEach(row => { row.mountState.isAirborne = true; row.homeMount.group.position.y += 25 })
  tick(0, false); tick(1, false)
  expect(crew.map(row => runtime.dutyFor(row.npc))).toEqual(['returning', 'return-queue'])
  expect(crew[1].npcState.setEagleFlightOrder).toHaveBeenLastCalledWith({ kind: 'hold', cruiseAltitude: 25 })
  crew[0].mountState.isAirborne = false; crew[0].homeMount.group.position.y -= 25
  tick(0, false); tick(1, false)
  expect(crew[0].npc.mount).toBeNull()
  expect(runtime.dutyFor(crew[1].npc)).toBe('returning')
  expect(crew[1].npcState.setEagleFlightOrder).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'return', landingYaw: crew[1].spec.eagle!.home.yaw }))
})
