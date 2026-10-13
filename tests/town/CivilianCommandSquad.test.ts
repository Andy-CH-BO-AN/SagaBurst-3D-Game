import * as THREE from 'three'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { CivilianCommandSquadController, CIVILIAN_COMMAND_RETURN_ID } from '../../src/town/CivilianCommandSquadController'
import { civilianCommandRoster, parseCivilianCommandSquad } from '../../src/career/CivilianCommandAuthority'
import { createCareerProfile, cloneCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import { createTownDefenseMission } from '../../src/career/CareerMissionState'
import { TownScene } from '../../src/town/TownScene'
import type { TownCombatResident } from '../../src/town/TownMissionCombat'
import { TownDefenseController } from '../../src/career/TownDefenseController'
import { townRoster, type TownActorSpec } from '../../src/town/TownRules'
import { Faction, NPC, AIType } from '../../src/world/NPC'
import type { Player } from '../../src/player/Player'
import { NavigationWorld } from '../../src/navigation/NavigationWorld'
import { getTerrainHeight } from '../../src/world/Terrain'
import { MemoryStorage } from '../helpers/memoryStorage'
import { townProfileCheckpoint } from '../helpers/townProfileCheckpoint'
import * as commandCheckpoint from '../../src/career/CareerCommandActorCheckpoint'
import { careerCommandHudRoster } from '../../src/career/CareerCommandHudRoster'

/** 0 real NPC/Mount/TownWorld. Recording boundary verifies ownership and persistence, not movement. */
function recordingResident(id = 'civilian-0', role: 'civilian' | 'merchant' = 'civilian') {
  const spec: TownActorSpec = { ...townRoster().find(spec => spec.role === role)!, id, x: 0, z: 0 }
  const group = new THREE.Group(); group.position.y = getTerrainHeight(0, 0)
  let formation: NPC['combatFormationCheckpoint']
  const actor = { group, combatPosition: group.position, combatantId: id, townCategory: 'civilian',
    dead: false, hp: 50, maxHp: 50, hostileToPlayer: false, faction: Faction.TOWN,
    combatOwnership: undefined as NPC['combatOwnership'], squadId: undefined as NPC['squadId'],
    isMounted: false, isFalling: false, mount: null, combatAmmo: 0,
    shield: { shieldImpactRemaining: 0, shieldImpactMax: 0 }, tacticalOrder: 'attack' as NPC['tacticalOrder'],
    missionMovement: false, formationCommandId: null as number | null,
    get combatFormationCheckpoint() { return formation },
    setCommandAllegiance: vi.fn((faction: Faction) => { actor.faction = faction }),
    setCommandSquad: vi.fn((id: NPC['squadId']) => { actor.squadId = id }),
    setTownPeaceful: vi.fn(), setMissionCombatTarget: vi.fn(), assignSiegeObstacle: vi.fn(), clearEncounter: vi.fn(),
    armTownCivilian: vi.fn(), disarmTownCivilian: vi.fn(), updateTownPeace: vi.fn(), updateTownTravel: vi.fn(), isFormationTargetReached: vi.fn(() => false),
    assignFollowTarget: vi.fn(() => { actor.tacticalOrder = 'follow'; formation = undefined; actor.formationCommandId = null }),
    assignFormationTarget: vi.fn((id: number, point: THREE.Vector3) => {
      actor.tacticalOrder = 'formation'; actor.formationCommandId = id
      formation = { commandId: id, position: { x: point.x, z: point.z, yaw: 0 }, reached: false }
    }),
    setTacticalOrder: vi.fn((order: NPC['tacticalOrder']) => { actor.tacticalOrder = order; formation = undefined; actor.formationCommandId = null }),
    restoreCombatAmmo: vi.fn(), restoreCombatHealth: vi.fn((hp: number) => { if (!actor.dead) { actor.hp = hp; actor.dead = hp <= 0 } }),
  }
  return { spec, npc: actor as unknown as NPC, actor }
}
const commandPlayer = () => ({ dead: false, group: new THREE.Group(), combatPosition: new THREE.Vector3(20, 0, 20) }) as unknown as Player
function fixture(residents = [recordingResident()], rank: CareerProfile['rank'] = 'commander') {
  let profile = createCareerProfile('roman'); profile.rank = rank; profile.totalMerit = 20000
  let savesAllowed = true
  const player = commandPlayer()
  const commit = vi.fn((next: CareerProfile) => { if (!savesAllowed) return false; profile = cloneCareerProfile(next); return true })
  const controller = new CivilianCommandSquadController(residents, () => player, () => profile, commit,
    { sceneKey: 'town:roman', townFaction: 'roman' })
  return { residents, controller, player, commit, get profile() { return profile }, set profile(next: CareerProfile) { profile = next },
    set savesAllowed(value: boolean) { savesAllowed = value } }
}

describe('Commander civilian resident authority', () => {
  it('selects the existing 20 civilians and one merchant without materializing or including service/military actors', () => {
    const ids = civilianCommandRoster(townRoster())
    expect(ids).toHaveLength(21)
    expect(ids).toEqual([...Array.from({ length: 20 }, (_, i) => `civilian-${i}`), 'merchant'].sort())
    expect(civilianCommandRoster([...townRoster(), ...townRoster()].reverse())).toEqual(ids)
  })
  it.each(['recruit', 'soldier', 'veteran', 'captain'] as const)('does not grant %s civilian command from 20,000 merit alone', rank => {
    const f = fixture(undefined, rank)
    expect(f.controller.restore()).toBe(true)
    expect(f.controller.commandsEnabled).toBe(false)
    expect(f.controller.issue('follow')).toBe(false)
    expect(f.residents[0].actor.assignFollowTarget).not.toHaveBeenCalled()
  })
  it('saves first, retains daily owner until command, isolates civilian target and rejects enemies/foreign owners', () => {
    const resident = recordingResident(), enemy = recordingResident('enemy'), borrowed = recordingResident('borrowed')
    enemy.actor.faction = Faction.ENEMY; borrowed.actor.combatOwnership = 'mission-official'
    const f = fixture([resident, enemy, borrowed]); f.controller.restore()
    expect(f.controller.actors).toEqual([resident.npc]); expect(f.controller.owner(resident.npc)).toBe('daily')
    expect(resident.npc.faction).toBe(Faction.TOWN)
    expect(f.controller.issue('follow', 'squad:1')).toBe(false)
    expect(f.controller.issue('follow', 'all')).toBe(true)
    expect(f.controller.owner(resident.npc)).toBe('player'); expect(resident.npc.squadId).toBe('civilians')
    expect(f.commit.mock.invocationCallOrder[f.commit.mock.invocationCallOrder.length - 1]).toBeLessThan(resident.actor.assignFollowTarget.mock.invocationCallOrder[0])
    expect(resident.actor.armTownCivilian).toHaveBeenCalledWith('gladius_rusty')
    expect(enemy.actor.assignFollowTarget).not.toHaveBeenCalled(); expect(borrowed.actor.assignFollowTarget).not.toHaveBeenCalled()
    const impostor = recordingResident(resident.spec.id)
    expect(f.controller.accepts(impostor.npc)).toBe(false)
    resident.actor.faction = Faction.ENEMY
    expect(f.controller.accepts(resident.npc)).toBe(false); expect(f.controller.hudState?.actorIds).toEqual([])
    f.profile.faction = 'viking'; expect(f.controller.commandsEnabled).toBe(false)
  })
  it('does not transfer ownership when command save fails or mutate the staged ALL claim', () => {
    const f = fixture(); f.controller.restore(); f.savesAllowed = false
    expect(f.controller.beforeIssue('defend', 'all', [f.residents[0].npc])).toBe(false)
    expect(f.controller.owner(f.residents[0].npc)).toBe('daily')
    expect(f.residents[0].actor.assignFollowTarget).not.toHaveBeenCalled()
    const staged = f.controller.stageCommand(f.profile, 'follow', 'all')!
    expect(staged.civilianCommandSquad?.owners['civilian-0']).toBe('player')
    expect(f.controller.owner(f.residents[0].npc)).toBe('daily')
  })
  it('gives evacuation back to defense, preserves its casualty census, and does not commandeer merchant evacuation', () => {
    const civilian = recordingResident(), merchant = recordingResident('merchant', 'merchant'), f = fixture([civilian, merchant])
    f.profile.activeMission = createTownDefenseMission([], ['civilian-0'], 'civilian-defense')
    f.controller.restore(); expect(f.controller.owner(civilian.npc)).toBe('evacuation')
    const defense: TownDefenseController = Object.assign(Object.create(TownDefenseController.prototype), {
      residents: [civilian, merchant], readProfile: () => f.profile, player: () => f.player,
    })
    defense.civilianCommandOwns = npc => f.controller.ownsPlayerCommand(npc) || f.controller.ownsPeacefulTravel(npc)
    f.controller.issue('follow'); defense.updateCivilianOrder(civilian.npc)
    expect(civilian.npc.tacticalOrder).toBe('follow')
    expect(defense.civilians).toEqual([civilian.npc])
    merchant.actor.dead = true; merchant.actor.hp = 0
    expect(defense.civilianDeaths).toBe(0)
    civilian.actor.dead = true; civilian.actor.hp = 0
    expect(defense.civilianDeaths).toBe(1)
    expect(f.controller.accepts(civilian.npc)).toBe(false)
  })
  it('keeps the issued runtime owner when player death disables new commands', () => {
    const f = fixture(); f.controller.restore(); f.controller.issue('follow')
    Object.assign(f.player, { dead: true })
    expect(f.controller.commandsEnabled).toBe(false); expect(f.controller.issue('charge')).toBe(false)
    expect(f.controller.ownsPlayerCommand(f.residents[0].npc)).toBe(true)
    expect(f.controller.combatActors).toEqual([f.residents[0].npc])
    expect(f.controller.updateResident(f.residents[0], .05, new THREE.Vector3(), [], new NavigationWorld())).toBe(true)
    expect(f.residents[0].npc.tacticalOrder).toBe('follow')
  })
  it('dismisses defense civilians to evacuation and merchant to physical home return; mission changes release claims', () => {
    const f = fixture([recordingResident(), recordingResident('merchant', 'merchant')]);
    f.profile.activeMission = createTownDefenseMission([], ['civilian-0'], 'defense-a')
    f.controller.restore(); f.controller.issue('defend')
    expect(f.controller.issue('dismiss')).toBe(true)
    expect(f.controller.owner(f.residents[0].npc)).toBe('evacuation')
    expect(f.controller.owner(f.residents[1].npc)).toBe('returning')
    expect(f.controller.accepts(f.residents[1].npc)).toBe(false)
    expect(f.profile.civilianCommandSquad?.members.merchant.formation?.commandId).toBe(CIVILIAN_COMMAND_RETURN_ID)
    f.controller.issue('follow'); delete f.profile.activeMission
    expect(f.controller.synchronize()).toBe(true)
    expect(f.controller.owner(f.residents[0].npc)).toBe('returning')
    expect(f.residents[0].npc.faction).toBe(Faction.TOWN)
  })
  it('restores saved Follow against the current player and preserves dead checkpoints after rank loss', () => {
    const f = fixture(); f.controller.restore(); f.controller.issue('follow')
    f.residents[0].npc.group.position.set(12, 0, 7)
    f.profile.civilianCommandSquad = f.controller.checkpoint()
    const store = new CareerProfileStore(new MemoryStorage()); store.save(f.profile)
    const restored = fixture(); restored.profile = store.load()!; restored.controller.restore()
    expect(restored.residents[0].npc.tacticalOrder).toBe('follow')
    expect(restored.residents[0].actor.assignFollowTarget).toHaveBeenCalledWith(restored.player, 0, expect.any(THREE.Vector3))
    expect(restored.residents[0].npc.group.position.x).toBe(12)
    restored.residents[0].actor.dead = true; restored.residents[0].actor.hp = 0
    restored.profile.civilianCommandSquad = restored.controller.checkpoint(); restored.profile.rank = 'captain'
    store.save(restored.profile)
    const demoted = fixture(); demoted.profile = store.load()!; demoted.controller.restore()
    expect(demoted.residents[0].npc.dead).toBe(true); expect(demoted.controller.commandsEnabled).toBe(false)
  })
  it('round-trips owner, formation, return, health and death through CareerProfileStore without revival or double claim', () => {
    const resident = recordingResident(), merchant = recordingResident('merchant', 'merchant'), f = fixture([resident, merchant])
    f.controller.restore(); f.controller.issue('follow')
    resident.actor.dead = true; resident.actor.hp = 0; merchant.actor.hp = 19
    f.controller.issue('dismiss')
    f.profile.civilianCommandSquad = f.controller.checkpoint()
    const store = new CareerProfileStore(new MemoryStorage()); expect(store.save(f.profile)).toBe(true)
    const restoredProfile = store.load()!, restoredResident = recordingResident(), restoredMerchant = recordingResident('merchant', 'merchant')
    const restored = fixture([restoredResident, restoredMerchant]); restored.profile = restoredProfile
    expect(restored.controller.restore()).toBe(true)
    expect(restored.controller.actors).toHaveLength(2)
    expect(restoredResident.npc.dead).toBe(true); expect(restoredResident.npc.hp).toBe(0)
    expect(restoredMerchant.npc.hp).toBe(19); expect(restored.controller.owner(restoredMerchant.npc)).toBe('returning')
    expect(restoredMerchant.npc.formationCommandId).toBe(CIVILIAN_COMMAND_RETURN_ID)
    expect(restored.controller.issue('follow')).toBe(false)
    expect(parseCivilianCommandSquad({ ...restoredProfile.civilianCommandSquad, actorIds: ['merchant', 'merchant'] })).toBeUndefined()
  })
  it('keeps the 20-civilian casualty census independent of commanded faction and merchant', () => {
    const residents = Array.from({ length: 20 }, (_, i) => recordingResident(`civilian-${i}`)), merchant = recordingResident('merchant', 'merchant')
    // Census/owner inputs are lightweight records: 0 real NPC constructors.
    for (const resident of residents.slice(0, 10)) { resident.actor.dead = true; resident.actor.faction = Faction.PLAYER }
    merchant.actor.dead = true
    const f = fixture([...residents, merchant]); f.profile.activeMission = createTownDefenseMission([], residents.map(r => r.spec.id), 'counts')
    const defense: TownDefenseController = Object.assign(Object.create(TownDefenseController.prototype), { residents: [...residents, merchant] })
    expect(defense.civilians).toHaveLength(20); expect(defense.civilianDeaths).toBe(10); expect(defense.civilianSurvived).toBe(10)
    expect(f.profile.activeMission.civilianActorIds).toHaveLength(20)
  })
})

describe('civilian lightweight HUD and Town checkpoint gate', () => {
  function checkpointFixture() {
    // One recording resident, zero real NPC/Mount/TownWorld. The Town commit and Store are real.
    const resident = recordingResident(), profile = createCareerProfile('roman'); profile.rank = 'commander'
    const storage = new MemoryStorage(), store = new CareerProfileStore(storage), town = townProfileCheckpoint(profile, store)
    const controller = new CivilianCommandSquadController([resident], () => town.player as Player,
      () => town.profile, next => town.commit(next), { sceneKey: 'town:roman', townFaction: 'roman' })
    Object.assign(town, { civilianCommand: controller })
    controller.restore()
    const snapshots = vi.spyOn(commandCheckpoint, 'snapshotCommandActor'), writes = vi.spyOn(store, 'save')
    onTestFinished(() => { snapshots.mockRestore(); writes.mockRestore() })
    return { resident, controller, storage, store, town, snapshots, writes }
  }

  it('shows live HUD status and orders without materializing actor or formation checkpoints', () => {
    const f = fixture(); f.controller.restore()
    const actor = f.residents[0].actor, snapshots = vi.spyOn(commandCheckpoint, 'snapshotCommandActor')
    const formations = vi.spyOn(actor, 'combatFormationCheckpoint', 'get')
    onTestFinished(() => { snapshots.mockRestore(); formations.mockRestore() })
    actor.tacticalOrder = 'defend'; actor.hp = 19
    const hud = f.controller.hudState!
    expect(hud.members['civilian-0']).toEqual({ status: 'deployed', hp: 19, order: 'defend' })
    expect(hud.actorIds).toEqual(['civilian-0'])
    actor.dead = true; actor.hp = 0
    expect(careerCommandHudRoster({ sceneKey: 'town:roman', faction: 'roman', civilians: f.controller.hudState,
      actors: [f.residents[0].npc] }).members).toEqual([{ id: 'civilian-0', squadId: 'civilians', state: 'dead', order: 'defend' }])
    expect(snapshots).not.toHaveBeenCalled(); expect(formations).not.toHaveBeenCalled()
    // A HUD read cannot rewrite the controller's saved checkpoint or a previous projection.
    expect(f.profile.civilianCommandSquad?.members['civilian-0'].hp).toBe(50)
    expect(hud.members['civilian-0'].hp).toBe(19)
  })

  it('does zero civilian snapshots on non-save frames and saves current HP and position once at five seconds', () => {
    const test = checkpointFixture()
    test.town.persistPersonalSquad(0)
    expect(test.snapshots).toHaveBeenCalledTimes(1)
    test.snapshots.mockClear(); test.writes.mockClear()
    const formations = vi.spyOn(test.resident.actor, 'combatFormationCheckpoint', 'get')
    onTestFinished(() => formations.mockRestore())
    test.resident.actor.hp = 19; test.resident.npc.group.position.set(12, 3, 7)
    for (let frame = 0; frame < 4; frame++) {
      expect(test.controller.hudState?.members['civilian-0'].hp).toBe(19)
      test.town.persistPersonalSquad(1)
    }
    expect(test.snapshots).not.toHaveBeenCalled(); expect(test.writes).not.toHaveBeenCalled()
    expect(formations).not.toHaveBeenCalled()
    test.town.persistPersonalSquad(1)
    expect(test.snapshots).toHaveBeenCalledTimes(1); expect(test.writes).toHaveBeenCalledTimes(1)
    expect(test.store.load()?.civilianCommandSquad?.members['civilian-0'])
      .toMatchObject({ status: 'deployed', hp: 19, position: { x: 12, y: 3, z: 7 } })
  })

  it.each(['death', 'order', 'formation target', 'formation arrival'] as const)(
    'saves %s immediately through Town and retries the same change after a failed write', change => {
      const test = checkpointFixture(), actor = test.resident.actor
      if (change === 'formation target') actor.assignFormationTarget(16, new THREE.Vector3(1, 0, 2))
      if (change === 'formation arrival') actor.assignFormationTarget(17, new THREE.Vector3(3, 0, 8))
      test.town.persistPersonalSquad(0); test.snapshots.mockClear(); test.writes.mockClear()
      const before = test.store.load()?.civilianCommandSquad
      if (change === 'death') { actor.dead = true; actor.hp = 0 }
      else if (change === 'order') actor.setTacticalOrder('defend')
      else if (change === 'formation target') actor.assignFormationTarget(17, new THREE.Vector3(3, 0, 8))
      else { actor.combatFormationCheckpoint!.reached = true; actor.isFormationTargetReached.mockReturnValue(true) }
      test.storage.failWrites = true; test.town.persistPersonalSquad(0)
      expect(test.writes).toHaveBeenCalledTimes(1)
      expect(test.store.load()?.civilianCommandSquad).toEqual(before)
      test.storage.failWrites = false; test.town.persistPersonalSquad(0)
      expect(test.writes).toHaveBeenCalledTimes(2); expect(test.snapshots).toHaveBeenCalledTimes(2)
      const saved = test.store.load()?.civilianCommandSquad?.members['civilian-0']
      if (change === 'death') expect(saved).toMatchObject({ status: 'dead', hp: 0 })
      else if (change === 'order') expect(saved?.order).toBe('defend')
      else expect(saved?.formation).toMatchObject({ commandId: 17, position: { x: 3, z: 8 }, reached: change === 'formation arrival' })
      test.town.persistPersonalSquad(0)
      expect(test.writes).toHaveBeenCalledTimes(2); expect(test.snapshots).toHaveBeenCalledTimes(2)
    },
  )

  it('retries a failed periodic save on the next frame without consuming the five-second interval', () => {
    const test = checkpointFixture()
    test.town.persistPersonalSquad(0); test.writes.mockClear()
    test.resident.actor.hp = 23
    test.storage.failWrites = true; test.town.persistPersonalSquad(5)
    expect(test.store.load()?.civilianCommandSquad?.members['civilian-0'].hp).toBe(50)
    test.storage.failWrites = false; test.town.persistPersonalSquad(0)
    expect(test.writes).toHaveBeenCalledTimes(2)
    expect(test.store.load()?.civilianCommandSquad?.members['civilian-0'].hp).toBe(23)
    test.town.persistPersonalSquad(4.99)
    expect(test.writes).toHaveBeenCalledTimes(2)
    test.town.persistPersonalSquad(.01)
    expect(test.writes).toHaveBeenCalledTimes(3)
  })
})

describe('civilian physical follow and return', () => {
  it('walks the same merchant away from and back to the shop, resumes daily owner, and keeps HP 50', () => {
    // One real NPC, zero Mount/TownWorld/GLB; this owns native locomotion beyond recording tests.
    const scene = new THREE.Scene(), spec = { ...townRoster().find(spec => spec.id === 'merchant')!, x: 0, z: 0 }
    const npc = new NPC(scene, 0, 0, Faction.TOWN, 'roman', AIType.MELEE, 'merchant', 2, false,
      { meleeWeaponId: null, rangedWeaponId: null, shieldId: null }, undefined, undefined, 'merchant', undefined, undefined, undefined, undefined, 'civilian')
    onTestFinished(() => npc.dispose())
    npc.setTownPeaceful()
    let profile = createCareerProfile('roman'); profile.rank = 'commander'
    const player = commandPlayer(); player.combatPosition.set(18, getTerrainHeight(18, 0), 0); player.group.position.copy(player.combatPosition)
    const resident = { spec, npc }, navigation = new NavigationWorld()
    const controller = new CivilianCommandSquadController([resident], () => player, () => profile, next => { profile = next; return true },
      { sceneKey: 'town:roman', townFaction: 'roman' })
    controller.restore(); expect(npc.maxHp).toBe(50); expect(npc.meleeWeaponId).toBeNull()
    const start = npc.combatPosition.clone(); expect(controller.issue('follow')).toBe(true)
    for (let frame = 0; frame < 80; frame++) { navigation.beginFrame(); npc.updateTownTravel(.05, 0, [], [], navigation) }
    expect(npc.combatPosition.distanceTo(start)).toBeGreaterThan(3)
    const departure = npc.combatPosition.clone(); expect(controller.issue('dismiss')).toBe(true)
    expect(npc.combatPosition.distanceTo(departure)).toBe(0)
    let frames = 0
    while (controller.owner(npc) === 'returning' && frames++ < 400) {
      navigation.beginFrame(); controller.updateResident(resident, .05, player.combatPosition, [], navigation)
    }
    expect({ owner: controller.owner(npc), frames, position: npc.combatPosition, order: npc.tacticalOrder, formation: npc.combatFormationCheckpoint }).toMatchObject({ owner: 'daily' })
    expect(Math.hypot(npc.combatPosition.x, npc.combatPosition.z)).toBeLessThan(1)
    expect(npc.faction).toBe(Faction.TOWN); expect(npc.hp).toBe(50); expect(npc.meleeWeaponId).toBeNull()
    expect(controller.actors[0]).toBe(npc)
  })
})

/** Narrow TownScene caller probe: renderer/audio/spawns are irrelevant to service and daily movement ownership. */
interface CivilianTownProbe {
  profile: CareerProfile
  player: Player
  residents: { spec: TownActorSpec; npc: NPC }[]
  target: string | null
  defense: { active?: CareerProfile['activeMission']; servicesLocked: boolean }
  event: { hostile: boolean; allActors: Map<string, { dead: boolean }> }
  interaction(): void
  serviceAvailable(id: string): boolean
  updatePeace(resident: TownCombatResident, dt: number): void
}
function townProbe(f: ReturnType<typeof fixture>): CivilianTownProbe {
  const playerPosition = f.player.combatPosition
  Object.assign(f.player, { isMounted: false, isFalling: false, facingYaw: 0, position: playerPosition, currentMount: null })
  const unavailable = ['captain', 'deployment', 'ranger', 'cat', 'hr-officer', 'eagle-trainer'].map(id => [id, { dead: true }] as const)
  return Object.assign(Object.create(TownScene.prototype), {
    profile: f.profile, player: f.player, residents: f.residents, civilianCommand: f.controller,
    world: { faction: 'roman', obstacles: [], buildings: [] }, navigation: new NavigationWorld(),
    camera: { position: new THREE.Vector3() }, elapsed: 0, nextTrainingSound: 0,
    updateEagleDuty: () => false, mission: {}, defense: { servicesLocked: false },
    event: { hostile: false, allActors: new Map<string, { dead: boolean }>([...unavailable, ...f.residents.map(r => [r.spec.id, r.npc] as const)]) },
    careerMounts: { activeMount: null }, temporaryMounts: { all: [] },
    hint: { textContent: '', style: { display: '' } }, target: null,
  }) as CivilianTownProbe
}

describe('TownScene civilian owner and merchant service wiring', () => {
  it('keeps player orders out of daily movement and updates a dismissed return exactly once per peace tick', () => {
    const f = fixture(); f.controller.restore(); f.controller.issue('follow')
    const town = townProbe(f), resident = { ...f.residents[0], cycle: 0, walkTime: 0 }
    resident.npc.group.position.set(50, 0, 50)
    town.updatePeace(resident, .05)
    expect(resident.npc.group.position.x).toBe(50)
    expect(resident.actor.updateTownPeace).not.toHaveBeenCalled()
    expect(resident.actor.updateTownTravel).not.toHaveBeenCalled()
    f.controller.issue('dismiss'); resident.npc.setTacticalOrder('attack') // Mission cleanup can release native formations.
    town.updatePeace(resident, .05)
    expect(resident.npc.formationCommandId).toBe(CIVILIAN_COMMAND_RETURN_ID)
    expect(resident.actor.updateTownTravel).toHaveBeenCalledTimes(1)
    expect(resident.actor.updateTownPeace).not.toHaveBeenCalled()
    resident.actor.isFormationTargetReached.mockReturnValue(true); town.updatePeace(resident, .05)
    expect(f.controller.owner(resident.npc)).toBe('daily')
    town.updatePeace(resident, .05)
    expect(resident.actor.updateTownPeace).toHaveBeenCalledTimes(1)
  })
  it('offers merchant E interaction at the moved actor only in peace, suspends return service, and restores the same actor', () => {
    const merchant = recordingResident('merchant', 'merchant'), f = fixture([merchant])
    f.controller.restore(); f.controller.issue('follow')
    const town = townProbe(f)
    merchant.npc.group.position.set(40, 0, 40); f.player.combatPosition.set(40, 0, 39)
    town.interaction(); expect(town.target).toBe('merchant')
    f.player.combatPosition.set(0, 0, -1); town.interaction(); expect(town.target).toBeNull()
    f.player.combatPosition.set(40, 0, 39)
    town.event.hostile = true; town.interaction(); expect(town.target).toBeNull(); town.event.hostile = false
    town.defense.active = createTownDefenseMission([], [], 'locked'); town.defense.servicesLocked = true
    town.interaction(); expect(town.target).toBeNull(); delete town.defense.active; town.defense.servicesLocked = false
    f.controller.issue('dismiss'); expect(town.serviceAvailable('merchant')).toBe(false)
    merchant.actor.isFormationTargetReached.mockReturnValue(true)
    f.savesAllowed = false
    town.updatePeace({ ...merchant, cycle: 0, walkTime: 0 }, .05)
    expect(f.controller.owner(merchant.npc)).toBe('returning')
    expect(town.serviceAvailable('merchant')).toBe(false)
    f.savesAllowed = true
    town.updatePeace({ ...merchant, cycle: 0, walkTime: 0 }, .05)
    expect(town.serviceAvailable('merchant')).toBe(true)
    town.interaction(); expect(town.target).toBe('merchant')
    expect(town.residents[0].npc).toBe(merchant.npc)
  })
})
