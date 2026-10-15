import type { NavigationWorld } from '../../src/navigation/NavigationWorld'
import { getTerrainHeight } from '../../src/world/Terrain'
import { TownEagleGarrisonController, stageTownEaglePlayerCommand } from '../../src/town/TownEagleGarrisonController'
import { parseTownEagleGarrisonState } from '../../src/town/TownEagleGarrisonState'
import * as THREE from 'three'
import { selectMissionInfantryActorIds } from '../../src/career/BanditMissionController'
import { selectTownCavalryReserve } from '../../src/town/TownCavalryReserve'
import { selectCareerDuelRoster } from '../../src/career/CareerDuelController'
import type { NPC } from '../../src/world/NPC'
import type { Mount } from '../../src/world/Mount'
import { describe, expect, it, vi } from 'vitest'
import { townEagleRoster, resolveTownEagleGarrison, townMissionMilitaryIds, townEaglePatrolRoute } from '../../src/town/TownEagleGarrison'
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

// Duty policy uses recording actor boundaries, not locomotion or rendered assets.
function patrolPolicyFixture(count = 1) {
  const rows = townEagleRoster().slice(0, count).map(spec => {
    const home = spec.eagle!.home, group = new THREE.Group(), mountGroup = new THREE.Group()
    mountGroup.position.set(home.x, getTerrainHeight(home.x, home.z), home.z); group.position.copy(mountGroup.position)
    const flight = { phase: 'grounded' as import('../../src/movement/EagleFlightController').EagleFlightSnapshot['phase'], speed: 0, pitch: 0, bank: 0, yaw: home.yaw, velocity: { x: 0, y: 0, z: 0 },
      snapshot() { return { phase: this.phase, speed: this.speed, pitch: this.pitch, bank: this.bank, yaw: this.yaw, velocity: { ...this.velocity } } },
      restore(state: import('../../src/movement/EagleFlightController').EagleFlightSnapshot) { Object.assign(this, state) },
    }
    const mountState = { group: mountGroup, dead: false, isFlyingMount: true, isAirborne: false, currentHp: 200, maxHp: 200, flight,
      restoreForTown: vi.fn(() => { mountState.dead = false; mountState.currentHp = 200 }),
      takeDamage: () => { mountState.dead = true; mountState.currentHp = 0 },
    }
    const mount = mountState as unknown as Mount
    const npcState = { group, dead: false, hp: 100, maxHp: 100, isFalling: false, deathPresentationComplete: undefined as boolean | undefined, mount: null as Mount | null, combatAmmo: 30, missionMovement: false,
      get combatPosition() { return group.position },
      setEagleCruiseAltitude: vi.fn(), setEagleFlightOrder: vi.fn(), setMissionCombatTarget: vi.fn(), setTownPeaceful: vi.fn(),
      setTacticalOrder: vi.fn(), restoreCombatAmmo: (ammo: number) => { npcState.combatAmmo = ammo },
      restoreCombatHealth: (hp: number) => { npcState.hp = hp },
      assignFormationTarget: vi.fn(), updateTownTravel: vi.fn(), updateTownPeace: vi.fn(),
      mountVehicle: (vehicle: Mount) => { npcState.mount = vehicle }, dismountFromMount: () => { npcState.mount = null },
      restoreForTown: vi.fn(() => { npcState.dead = false; npcState.hp = 100; npcState.combatAmmo = 30 }),
      takeDamage: () => { npcState.dead = true; npcState.hp = 0 },
    }
    return { spec, npc: npcState as unknown as NPC, homeMount: mount, npcState, mountState }
  })
  const runtime = new TownEagleGarrisonController(rows), camera = new THREE.Vector3(), navigation = {} as NavigationWorld
  const tick = (combat = false, index = 0) => runtime.update(rows[index].npc, 0, combat, camera, [], navigation, [], rows.map(row => row.homeMount))
  return { rows, runtime, tick }
}

it('gives each fixed pad a distinct finite town-centered circuit with a generous map turning margin', () => {
  const routes = [1, 2, 3, 4, 5].map(slot => townEaglePatrolRoute(`town-eagle-pad:${slot}`))
  expect(new Set(routes.map(route => JSON.stringify(route))).size).toBe(5)
  for (const route of routes) {
    expect(route).toHaveLength(6)
    for (const point of route) { expect(Math.abs(point.x)).toBeLessThan(230); expect(Math.abs(point.z)).toBeLessThan(230) }
  }
})

it('requires explicit ambient authority and spaces all five grounded takeoff orders by 1.5 seconds', () => {
  const { rows, runtime, tick } = patrolPolicyFixture(5)
  rows.forEach((_, index) => tick(false, index))
  expect(rows.map(row => runtime.dutyFor(row.npc))).toEqual(Array(5).fill('standby'))
  runtime.setAmbientPatrolAllowed(true)
  rows.forEach((_, index) => tick(false, index))
  rows.forEach((_, index) => tick(false, index))
  expect(rows.map(row => runtime.dutyFor(row.npc))).toEqual(['patrolling', 'mounted-waiting', 'mounted-waiting', 'mounted-waiting', 'mounted-waiting'])
  for (let index = 1; index < 5; index++) {
    runtime.beginFrame(1.49); tick(false, index)
    expect(runtime.dutyFor(rows[index].npc)).toBe('mounted-waiting')
    runtime.beginFrame(.011); tick(false, index)
    expect(runtime.dutyFor(rows[index].npc)).toBe('patrolling')
    expect(rows[index].homeMount.group.position.y).toBe(getTerrainHeight(rows[index].spec.eagle!.home.x, rows[index].spec.eagle!.home.z))
  }
})

it('changes patrol orders only at waypoints, resumes the interrupted circuit and returns after one lap', () => {
  const { rows: [row], runtime, tick } = patrolPolicyFixture()
  runtime.setAmbientPatrolAllowed(true); tick(); tick()
  const order = row.npcState.setEagleFlightOrder, initialCalls = order.mock.calls.length
  tick(); tick(); expect(order).toHaveBeenCalledTimes(initialCalls)
  row.mountState.isAirborne = true; row.mountState.flight.phase = 'cruise'; row.homeMount.group.position.y += 20
  expect(tick(true)).toBe(false); expect(runtime.dutyFor(row.npc)).toBe('sortie')
  tick(); expect(runtime.dutyFor(row.npc)).toBe('patrolling')
  expect(order).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'patrol', cruiseAltitude: 20 }))
  for (const point of townEaglePatrolRoute(row.spec.eagle!.homePadId)) {
    row.homeMount.group.position.x = point.x; row.homeMount.group.position.z = point.z
    tick()
  }
  expect(runtime.dutyFor(row.npc)).toBe('returning')
  expect(order).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'return' }))
  tick(true) // Completed patrols cannot be trapped in an endless re-intercept/return cycle.
  expect(runtime.dutyFor(row.npc)).toBe('returning')
})

it('bounds a stalled or continuously fighting ambient patrol by simulation time without aerial refit', () => {
  const { rows: [row], runtime, tick } = patrolPolicyFixture()
  runtime.setAmbientPatrolAllowed(true); tick(); tick()
  row.mountState.isAirborne = true; row.mountState.flight.phase = 'cruise'; row.homeMount.group.position.y += 20
  row.npcState.hp = 52; row.npcState.combatAmmo = 3; row.mountState.currentHp = 87
  tick(true); runtime.beginFrame(180); tick(true); tick(true)
  expect(runtime.dutyFor(row.npc)).toBe('returning')
  expect(row.npcState.hp).toBe(52); expect(row.npcState.combatAmmo).toBe(3); expect(row.mountState.currentHp).toBe(87)
  expect(row.npcState.restoreForTown).not.toHaveBeenCalled()
})

it.each(['rider', 'mount', 'both'] as const)('retains %s incapacity through a real save and cannot recover at 59 seconds', casualty => {
  const { rows: [row], runtime, tick } = patrolPolicyFixture()
  runtime.setAmbientPatrolAllowed(true)
  row.npcState.group.position.set(row.spec.x, getTerrainHeight(row.spec.x, row.spec.z), row.spec.z)
  if (casualty !== 'mount') row.npcState.takeDamage()
  if (casualty !== 'rider') row.mountState.takeDamage()
  tick(); runtime.beginFrame(30); tick()
  const profile = createCareerProfile('roman'), store = new CareerProfileStore(new MemoryStorage())
  profile.townEagleGarrisons = { roman: runtime.snapshot('town:roman') }
  expect(store.save(profile)).toBe(true)
  const reload = patrolPolicyFixture()
  reload.runtime.restore(store.load()!.townEagleGarrisons!.roman, 'town:roman'); reload.runtime.setAmbientPatrolAllowed(true)
  reload.runtime.beginFrame(29); reload.tick()
  expect(reload.runtime.snapshot('town:roman').pairs[0].replacementRemaining).toBe(1)
  expect(reload.rows[0].npcState.restoreForTown).not.toHaveBeenCalled()
  reload.runtime.beginFrame(1); reload.tick()
  expect(reload.rows[0].npcState.restoreForTown).toHaveBeenCalledTimes(1)
  expect(reload.rows[0].mountState.restoreForTown).toHaveBeenCalledTimes(1)
  reload.tick(); expect(reload.rows[0].npcState.restoreForTown).toHaveBeenCalledTimes(1)
})

it('pauses ambient casualty recovery during formal events and never revives in midair', () => {
  const { rows: [row], runtime, tick } = patrolPolicyFixture()
  runtime.setAmbientPatrolAllowed(true); row.npcState.takeDamage(); row.mountState.isAirborne = true
  tick(); runtime.beginFrame(60); tick(); expect(row.npcState.restoreForTown).not.toHaveBeenCalled()
  runtime.setAmbientPatrolAllowed(false); row.mountState.isAirborne = false; tick()
  expect(row.npcState.restoreForTown).not.toHaveBeenCalled()
  runtime.setAmbientPatrolAllowed(true); tick()
  expect(row.npcState.restoreForTown).toHaveBeenCalledTimes(1)
})

it('recovers a stranded living orphan at its original ground base only after 60s and complete rider presentation', () => {
  const { rows: [row], runtime, tick } = patrolPolicyFixture()
  runtime.setAmbientPatrolAllowed(true)
  row.npcState.takeDamage(); row.mountState.isAirborne = true
  row.homeMount.group.position.set(250, 30, 250)
  tick(); runtime.beginFrame(59); tick()
  expect(row.mountState.restoreForTown).not.toHaveBeenCalled()
  runtime.beginFrame(1); tick()
  expect(row.mountState.restoreForTown).not.toHaveBeenCalled()
  Object.assign(row.npcState, { deathPresentationComplete: true, isFalling: true })
  tick(); expect(row.mountState.restoreForTown).not.toHaveBeenCalled()
  row.npcState.isFalling = false; tick()
  const home = row.spec.eagle!.home
  expect(row.mountState.restoreForTown).toHaveBeenCalledExactlyOnceWith(home.x, home.z, home.yaw)
  expect(row.npcState.restoreForTown).toHaveBeenCalledExactlyOnceWith({ x: row.spec.x, z: row.spec.z, yaw: row.spec.yaw })
})

it('migrates legacy v1 conservatively and rejects corrupt patrol clocks or waypoint indices', () => {
  const { runtime } = patrolPolicyFixture(), state = runtime.snapshot('town:roman')
  delete state.nextTakeoffRemaining
  const pair = state.pairs[0]
  delete pair.patrol; delete pair.replacementRemaining; delete pair.ambientRecovery; delete pair.restRemaining
  expect(parseTownEagleGarrisonState(JSON.parse(JSON.stringify(state)))).toEqual(state)
  for (const patrol of [{ active: true, waypoint: 7, elapsed: 0 }, { active: true, waypoint: 0, elapsed: -1 }]) {
    expect(parseTownEagleGarrisonState({ ...state, pairs: [{ ...pair, patrol }] })).toBeUndefined()
  }
  expect(parseTownEagleGarrisonState({ ...state, nextTakeoffRemaining: Infinity })).toBeUndefined()
  expect(parseTownEagleGarrisonState({ ...state, pairs: [{ ...pair, replacementRemaining: 61 }] })).toBeUndefined()
  expect(parseTownEagleGarrisonState({ ...state, pairs: [{ ...pair, commandReturn: 'true' }] })).toBeUndefined()
})

it('never grants automatic recovery to a casualty first observed under formal or hostile ownership', () => {
  const { rows: [row], runtime, tick } = patrolPolicyFixture()
  row.npcState.takeDamage(); tick(true)
  runtime.beginFrame(60); runtime.setAmbientPatrolAllowed(true); tick()
  expect(runtime.dutyFor(row.npc)).toBe('casualty')
  expect(row.npcState.restoreForTown).not.toHaveBeenCalled()
  runtime.beginRefit(row.spec.id); tick()
  expect(row.npcState.restoreForTown).toHaveBeenCalledTimes(1)
})

it('does not heal a grounded eagle away from its own base even with settlement refit authority', () => {
  const { rows: [row], runtime, tick } = patrolPolicyFixture()
  row.homeMount.group.position.x += 100; row.mountState.currentHp = 50
  runtime.beginRefit(row.spec.id); tick()
  expect(row.mountState.currentHp).toBe(50)
  expect(row.npcState.restoreForTown).not.toHaveBeenCalled()
})

it.each(['patrolling', 'sortie', 'returning', 'return-queue', 'walking-to-standby', 'resting', 'casualty'] as const)(
  'round-trips %s duty, flight, resources and progress through storage without replenishing', duty => {
    const { runtime } = patrolPolicyFixture(), state = runtime.snapshot('town:roman'), pair = state.pairs[0]
    const mounted = ['patrolling', 'sortie', 'returning', 'return-queue'].includes(duty)
    Object.assign(pair, { duty, hp: duty === 'casualty' ? 0 : 13, ammo: 4, mounted,
      patrol: { active: duty !== 'resting', waypoint: 2, elapsed: 70 }, replacementRemaining: duty === 'casualty' ? 1 : 0,
      ambientRecovery: duty === 'casualty', restRemaining: duty === 'resting' ? 8 : 0,
    })
    pair.mount.hp = 37; pair.mount.flight.phase = mounted ? 'cruise' : 'grounded'
    if (mounted) { pair.mount.position.y += 25; pair.position.y += 25 }
    state.nextTakeoffRemaining = .75
    const profile = createCareerProfile('roman'), storage = new MemoryStorage(), store = new CareerProfileStore(storage)
    profile.townEagleGarrisons = { roman: state }
    storage.failWrites = true; expect(store.save(profile)).toBe(false)
    storage.failWrites = false; expect(store.save(profile)).toBe(true)
    const reload = patrolPolicyFixture(); reload.runtime.restore(store.load()!.townEagleGarrisons!.roman, 'town:roman')
    const restored = reload.runtime.snapshot('town:roman')
    expect(restored.nextTakeoffRemaining).toBe(.75)
    expect(restored.pairs[0]).toMatchObject({
      duty: duty === 'returning' ? 'return-queue' : duty, hp: pair.hp, ammo: 4,
      patrol: pair.patrol, replacementRemaining: pair.replacementRemaining, restRemaining: pair.restRemaining,
      mount: { hp: 37, flight: pair.mount.flight },
    })
    expect(reload.rows[0].npcState.restoreForTown).not.toHaveBeenCalled()
  },
)

it.each(['rider HP', 'mount HP', 'ammunition'] as const)('returns for depleted %s without accepting a fresh intercept or refitting in flight', resource => {
  const { rows: [row], runtime, tick } = patrolPolicyFixture()
  runtime.setAmbientPatrolAllowed(true); tick(); tick()
  row.mountState.isAirborne = true; row.mountState.flight.phase = 'cruise'; row.homeMount.group.position.y += 20
  if (resource === 'rider HP') row.npcState.hp = 25
  if (resource === 'mount HP') row.mountState.currentHp = 50
  if (resource === 'ammunition') row.npcState.combatAmmo = 0
  tick(true); tick(true)
  expect(runtime.dutyFor(row.npc)).toBe('returning')
  expect(row.npcState.restoreForTown).not.toHaveBeenCalled()
})

it('preserves an airborne patrol waypoint and budget while a formal owner temporarily borrows it', () => {
  const { rows: [row], runtime, tick } = patrolPolicyFixture()
  runtime.setAmbientPatrolAllowed(true); tick(); tick()
  row.mountState.isAirborne = true; row.mountState.flight.phase = 'cruise'; row.homeMount.group.position.y += 20
  runtime.beginFrame(20); tick(true)
  const before = runtime.snapshot('town:roman').pairs[0].patrol
  runtime.setAmbientPatrolAllowed(false); runtime.beginFrame(300); tick(true)
  expect(runtime.dutyFor(row.npc)).toBe('sortie')
  expect(runtime.snapshot('town:roman').pairs[0].patrol).toEqual(before)
  runtime.setAmbientPatrolAllowed(true); tick()
  expect(runtime.dutyFor(row.npc)).toBe('patrolling')
  expect(runtime.snapshot('town:roman').pairs[0].patrol).toEqual(before)
})


it('stages a dismissal without changing the live owner, persists return intent, and reloads without teleporting or claiming authority', () => {
  const { rows: [row], runtime, tick } = patrolPolicyFixture()
  runtime.setAmbientPatrolAllowed(true); tick(); tick()
  row.mountState.isAirborne = true; row.mountState.flight.phase = 'cruise'; row.homeMount.group.position.y += 20
  runtime.claimPlayerCommand(row.npc)
  const current = runtime.snapshot('town:roman')
  const released = stageTownEaglePlayerCommand(current, [row.spec.id, 'enemy-town:town-eagle-rider:2', 'personal:1'], false)
  expect(released.pairs[0]).toMatchObject({ commandReturn: true, duty: 'return-queue', refitAllowed: true })
  expect(current.pairs[0].commandReturn).toBeUndefined()
  const profile = createCareerProfile('roman'), storage = new MemoryStorage(), store = new CareerProfileStore(storage)
  profile.townEagleGarrisons = { roman: released }
  storage.failWrites = true
  expect(store.save(profile)).toBe(false); expect(runtime.isPlayerCommandOwned(row.npc)).toBe(true)
  storage.failWrites = false; expect(store.save(profile)).toBe(true)
  const reload = patrolPolicyFixture()
  reload.runtime.restore(store.load()!.townEagleGarrisons!.roman, 'town:roman')
  expect(reload.runtime.isPlayerCommandOwned(reload.rows[0].npc)).toBe(false)
  expect(reload.rows[0].homeMount.group.position).toEqual(row.homeMount.group.position)
  reload.tick(true) // Even combat cannot interrupt a saved, unfinished dismissal return.
  expect(reload.runtime.dutyFor(reload.rows[0].npc)).toBe('returning')
  expect(reload.rows[0].npcState.restoreForTown).not.toHaveBeenCalled()
})

it.each(['rider', 'mount', 'both'] as const)('does not replace a player-owned %s casualty and starts the full 60 second native recovery on dismissal', casualty => {
  const { rows: [row], runtime, tick } = patrolPolicyFixture()
  runtime.setAmbientPatrolAllowed(true)
  row.npc.group.position.set(row.spec.x, getTerrainHeight(row.spec.x, row.spec.z), row.spec.z)
  expect(runtime.claimPlayerCommand(row.npc)).toBe(true)
  if (casualty !== 'mount') row.npcState.takeDamage()
  if (casualty !== 'rider') row.mountState.takeDamage()
  runtime.beginFrame(120); tick()
  expect(row.npcState.restoreForTown).not.toHaveBeenCalled()
  expect(runtime.releasePlayerCommand(row.npc)).toBe(true)
  runtime.beginFrame(59); tick()
  expect(runtime.snapshot('town:roman').pairs[0].replacementRemaining).toBe(1)
  expect(row.npcState.restoreForTown).not.toHaveBeenCalled()
  runtime.beginFrame(1); tick()
  expect(row.npcState.restoreForTown).toHaveBeenCalledTimes(1)
  expect(row.mountState.restoreForTown).toHaveBeenCalledTimes(1)
})

it('retains formal-event casualty protection after dismissal until settlement authorizes refit', () => {
  const { rows: [row], runtime, tick } = patrolPolicyFixture()
  runtime.claimPlayerCommand(row.npc); row.npcState.takeDamage(); row.mountState.takeDamage()
  runtime.releasePlayerCommand(row.npc); runtime.beginFrame(60); tick(true); tick(false)
  runtime.setAmbientPatrolAllowed(true); tick(false) // An event ending alone is not settlement authority.
  expect(row.npcState.restoreForTown).not.toHaveBeenCalled()
  runtime.beginRefit(row.spec.id); tick(false)
  expect(row.npcState.restoreForTown).toHaveBeenCalledTimes(1)
})

it('does not let a stored dismissal marker or a foreign actor identity grant player ownership', () => {
  const { rows: [row], runtime } = patrolPolicyFixture()
  const snapshot = runtime.snapshot('town:roman'); snapshot.pairs[0].commandReturn = true
  runtime.restore(snapshot, 'town:roman')
  expect(runtime.isPlayerCommandOwned(row.npc)).toBe(false)
  row.spec.id = 'enemy-town:town-eagle-rider:1'
  expect(runtime.claimPlayerCommand(row.npc)).toBe(false)
  expect(stageTownEaglePlayerCommand(snapshot, [row.spec.id], false)).toEqual(snapshot)
})


it('keeps repeated saved claims idempotent and freezes native patrol clocks while player orders own the airborne pair', () => {
  const { rows: [row], runtime, tick } = patrolPolicyFixture()
  runtime.setAmbientPatrolAllowed(true); tick(); tick()
  row.mountState.isAirborne = true; row.mountState.flight.phase = 'cruise'; row.homeMount.group.position.y += 20
  runtime.beginFrame(20)
  const patrol = runtime.snapshot('town:roman').pairs[0].patrol
  runtime.claimPlayerCommand(row.npc)
  row.npcState.setEagleFlightOrder.mockClear(); row.npcState.setMissionCombatTarget.mockClear()
  runtime.claimPlayerCommand(row.npc); runtime.beginFrame(300)
  expect(tick(false)).toBe(false); expect(tick(true)).toBe(false)
  expect(row.npcState.setEagleFlightOrder).not.toHaveBeenCalled()
  expect(row.npcState.setMissionCombatTarget).not.toHaveBeenCalled()
  expect(runtime.snapshot('town:roman').pairs[0].patrol).toEqual(patrol)
})


it.each([false, true])('persists a newly dismissed casualty with explicit ambient recovery authorization %s', ambientRecoveryAllowed => {
  const { rows: [row], runtime } = patrolPolicyFixture()
  runtime.claimPlayerCommand(row.npc); row.mountState.takeDamage()
  const staged = stageTownEaglePlayerCommand(runtime.snapshot('town:roman'), [row.spec.id], false, ambientRecoveryAllowed)
  const profile = createCareerProfile('roman'), store = new CareerProfileStore(new MemoryStorage())
  profile.townEagleGarrisons = { roman: staged }
  expect(store.save(profile)).toBe(true)
  expect(store.load()!.townEagleGarrisons!.roman!.pairs[0]).toMatchObject({
    duty: 'casualty', commandReturn: true, replacementRemaining: 60, ambientRecovery: ambientRecoveryAllowed, mount: { hp: 0 },
  })
})

it('retains a partially elapsed native casualty replacement clock across player claim and dismissal', () => {
  const { rows: [row], runtime, tick } = patrolPolicyFixture()
  runtime.setAmbientPatrolAllowed(true); row.npcState.takeDamage(); tick(); runtime.beginFrame(23)
  runtime.claimPlayerCommand(row.npc); runtime.beginFrame(200); tick()
  expect(runtime.snapshot('town:roman').pairs[0].replacementRemaining).toBe(37)
  runtime.releasePlayerCommand(row.npc)
  expect(runtime.snapshot('town:roman').pairs[0]).toMatchObject({ replacementRemaining: 37, ambientRecovery: true, hp: 0 })
  expect(row.npcState.restoreForTown).not.toHaveBeenCalled()
})

it('Sergeant service resumes native return after storage, waits for death presentation and never repairs in live flight', () => {
  // One recording pair, zero real actors/world; native flight physics have their own integration owner.
  const { rows: [row], runtime, tick } = patrolPolicyFixture()
  row.npcState.dead = true; row.npcState.hp = 0; row.npcState.deathPresentationComplete = false
  row.mountState.dead = true; row.mountState.currentHp = 0
  expect(runtime.canServiceRefit(row.npc)).toBe(true)
  runtime.requestServiceRefit(row.npc); runtime.requestServiceRefit(row.npc)
  tick()
  expect(runtime.serviceRefitPending(row.npc)).toBe(true)
  expect(row.npcState.restoreForTown).not.toHaveBeenCalled()
  const saved = parseTownEagleGarrisonState(JSON.parse(JSON.stringify(runtime.snapshot('town:roman'))))!
  const reloaded = patrolPolicyFixture()
  reloaded.runtime.restore(saved, 'town:roman')
  reloaded.rows[0].npcState.deathPresentationComplete = false
  reloaded.tick(); expect(reloaded.rows[0].npcState.restoreForTown).not.toHaveBeenCalled()
  reloaded.rows[0].npcState.deathPresentationComplete = true
  reloaded.rows[0].mountState.isAirborne = true
  reloaded.tick(); expect(reloaded.rows[0].npcState.restoreForTown).not.toHaveBeenCalled()
  reloaded.rows[0].mountState.isAirborne = false
  reloaded.tick()
  expect(reloaded.rows[0].npcState.restoreForTown).toHaveBeenCalledTimes(1)
  expect(reloaded.rows[0].mountState.restoreForTown).toHaveBeenCalledTimes(1)
  expect(reloaded.runtime.serviceRefitPending(reloaded.rows[0].npc)).toBe(false)
})


it.each(['rider', 'mount', 'both'] as const)('lets Sergeant service authorize a dismissed %s casualty without waiting for an impossible physical return', casualty => {
  // One recording pair, zero real actors/world; native service policy owns this state transition.
  const { rows: [row], runtime, tick } = patrolPolicyFixture()
  row.npcState.group.position.set(row.spec.x, getTerrainHeight(row.spec.x, row.spec.z), row.spec.z)
  runtime.claimPlayerCommand(row.npc)
  if (casualty !== 'mount') row.npcState.takeDamage()
  if (casualty !== 'rider') row.mountState.takeDamage()
  runtime.releasePlayerCommand(row.npc, false)
  expect(runtime.snapshot('town:roman').pairs[0]).toMatchObject({ duty: 'casualty', commandReturn: true, refitAllowed: false })
  expect(runtime.canServiceRefit(row.npc)).toBe(true)
  runtime.requestServiceRefit(row.npc)
  expect(runtime.canServiceRefit(row.npc)).toBe(false)
  expect(runtime.serviceRefitPending(row.npc)).toBe(true)
  row.npcState.deathPresentationComplete = true
  row.mountState.isAirborne = false
  tick()
  expect(row.npcState.restoreForTown).toHaveBeenCalledOnce()
  expect(row.mountState.restoreForTown).toHaveBeenCalledOnce()
  expect(runtime.snapshot('town:roman').pairs[0].commandReturn).toBeUndefined()
  expect(runtime.serviceRefitPending(row.npc)).toBe(false)
})

it('keeps living dismissed eagle returns unavailable, but allows service if that return later becomes a casualty', () => {
  const { rows: [row], runtime } = patrolPolicyFixture()
  runtime.claimPlayerCommand(row.npc); runtime.releasePlayerCommand(row.npc, false)
  expect(runtime.canServiceRefit(row.npc)).toBe(false)
  row.npcState.takeDamage()
  expect(runtime.canServiceRefit(row.npc)).toBe(true)
})
