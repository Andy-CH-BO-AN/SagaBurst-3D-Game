import { commanderTownCommandMembership } from '../../src/career/CommanderTownRoster'
import { snapshotCommandActor } from '../../src/career/CareerCommandActorCheckpoint'
import * as THREE from 'three'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { TownAirCommandSquadController } from '../../src/town/TownAirCommandSquadController'
import { CivilianCommandSquadController } from '../../src/town/CivilianCommandSquadController'
import { TownEagleGarrisonController } from '../../src/town/TownEagleGarrisonController'
import { townEagleRoster } from '../../src/town/TownEagleGarrison'
import { townRoster, settleTown, type TownActorSpec } from '../../src/town/TownRules'
import { createCareerProfile, cloneCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import { createTownDefenseMission } from '../../src/career/CareerMissionState'
import { emptyPersonalContribution } from '../../src/combat/CommandMerit'
import { FormationController, type FormationCommandAssignment } from '../../src/battle/FormationController'
import type { ArmyCommandTarget } from '../../src/battle/CommandTarget'
import type { ArmyHudRoster } from '../../src/battle/ArmyCommandHudRoster'
import type { TacticalOrder } from '../../src/battle/TacticalOrder'
import { EagleFlightController } from '../../src/movement/EagleFlightController'
import { Faction, NPC } from '../../src/world/NPC'
import type { Mount } from '../../src/world/Mount'
import type { Player } from '../../src/player/Player'
import { NavigationWorld } from '../../src/navigation/NavigationWorld'
import { getTerrainHeight } from '../../src/world/Terrain'
import { townProfileCheckpoint } from '../helpers/townProfileCheckpoint'
import { MemoryStorage } from '../helpers/memoryStorage'
import { createArmyCommandHarness } from '../helpers/armyCommandHarness'

// Audio is an external boundary; all command, Town, garrison and storage callers below are real.
vi.mock('../../src/audio/SoundManager', () => ({ SoundManager: class {
  playCareerMissionVoice() {} playCommanderCommand() {} cancelCareerAudio() {}
} }))

/** Recording state only, not locomotion or actor initialization: 0 real NPCs/Mounts/Worlds/GLBs. */
function recordingCrew(slot = 1, suppliedSpec?: TownActorSpec) {
  const spec = suppliedSpec ?? townEagleRoster().find(row => row.id === `town-eagle-rider:${slot}`)!
  const group = new THREE.Group(), mountGroup = new THREE.Group(), flight = new EagleFlightController()
  const home = spec.eagle?.home ?? { x: spec.x, z: spec.z, yaw: 0 }
  mountGroup.position.set(home.x, getTerrainHeight(home.x, home.z), home.z)
  group.position.copy(mountGroup.position)
  let formation: { commandId: number; position: THREE.Vector3; facing: THREE.Vector3; reached: boolean; speedLimit?: number; arrivalOrder?: TacticalOrder } | undefined
  const mountState = { group: mountGroup, flight, currentHp: 200, maxHp: 200, dead: false,
    isFlyingMount: true, reservedForTown: false, riderNpc: null as NPC | null, riderPlayer: null,
    get isAirborne() { return flight.phase !== 'grounded' },
    takeDamage: vi.fn((amount: number) => { mountState.currentHp = Math.max(0, mountState.currentHp - amount); mountState.dead = mountState.currentHp === 0 }),
  }
  const mount = mountState as unknown as Mount
  const actor = { group, combatPosition: group.position, name: spec.id, combatantId: spec.id,
    presetId: 'roman_archer' as const, dead: false, hp: 80, maxHp: 80, hostileToPlayer: false,
    faction: Faction.TOWN, combatOwnership: undefined as NPC['combatOwnership'], squadId: undefined as NPC['squadId'],
    mount: null as Mount | null, get isMounted() { return actor.mount !== null }, isFalling: false,
    combatAmmo: 30, shield: { shieldImpactRemaining: 7, shieldImpactMax: 20, reset: vi.fn() },
    missionMovement: false, tacticalOrder: 'attack' as TacticalOrder,
    get formationTarget() { return formation },
    // Use the production checkpoint getter so this double cannot conceal lost formation altitude.
    get combatFormationCheckpoint(): NPC['combatFormationCheckpoint'] {
      return Object.getOwnPropertyDescriptor(NPC.prototype, 'combatFormationCheckpoint')!.get!.call(actor)
    },
    get formationCommandId() { return formation?.commandId ?? null },
    setCommandAllegiance: vi.fn((faction: Faction) => { actor.faction = faction }),
    setCommandSquad: vi.fn((squad: NPC['squadId']) => { actor.squadId = squad }),
    setEagleCruiseAltitude: vi.fn(), setEagleFlightOrder: vi.fn<NPC['setEagleFlightOrder']>(),
    setMissionCombatTarget: vi.fn(), assignSiegeObstacle: vi.fn(),
    setTownPeaceful: vi.fn(), updateTownTravel: vi.fn(), updateTownPeace: vi.fn(), updateTownEagleBoarding: vi.fn(),
    assignFollowTarget: vi.fn<NPC['assignFollowTarget']>(() => { actor.tacticalOrder = 'follow'; formation = undefined }),
    setTacticalOrder: vi.fn((order: TacticalOrder) => { actor.tacticalOrder = order; formation = undefined }),
    assignFormationTarget: vi.fn<NPC['assignFormationTarget']>((commandId, point, forward, speedLimit, arrivalOrder, reached = false) => {
      actor.tacticalOrder = 'formation'; formation = { commandId, position: point.clone(), facing: forward.clone(), reached,
        ...(speedLimit === undefined ? {} : { speedLimit }), ...(arrivalOrder ? { arrivalOrder } : {}) }
    }),
    isFormationTargetReached: vi.fn(() => formation?.reached ?? false),
    mountVehicle: vi.fn((vehicle: Mount) => { if (!actor.dead && !vehicle.dead) { actor.mount = vehicle; vehicle.riderNpc = npc } }),
    dismountFromMount: vi.fn(() => { if (actor.mount) actor.mount.riderNpc = null; actor.mount = null }),
    restoreCombatHealth: vi.fn((hp: number) => { actor.hp = hp; actor.dead = hp <= 0 }),
    restoreCombatAmmo: vi.fn((ammo: number) => { actor.combatAmmo = ammo }),
    takeDamage: vi.fn((amount: number) => { actor.hp = Math.max(0, actor.hp - amount); actor.dead = actor.hp === 0 }),
  }
  // Single actor boundary: only methods consumed by command/checkpoint/garrison policy are supplied.
  const npc = actor as unknown as NPC
  return { spec, npc, actor, homeMount: mount, mountState }
}

interface TownCommandPort {
  commandsEnabled(): boolean
  isAuthorizedCommandActor(npc: NPC): boolean
  commandHudRoster(): ArmyHudRoster
  preparePlayerCommand(order: TacticalOrder | 'dismiss', target: ArmyCommandTarget, participants: readonly NPC[], assignments?: readonly FormationCommandAssignment[]): boolean
  issuePartyOrder(order: TacticalOrder | 'dismiss', target: ArmyCommandTarget): boolean
  onPlayerCommandIssued(order: TacticalOrder, target: ArmyCommandTarget): void
  playMissionVoice(cue: 'follow'): void
  restoreEagleCommandState(): void
  synchronizeEaglePatrolPolicy(): void
  synchronizeEagleCommandOwnership(): void
}
function fixture(options: { profile?: CareerProfile; residents?: ReturnType<typeof recordingCrew>[]; worldFaction?: CareerProfile['faction'] } = {}) {
  const profile = options.profile ?? createCareerProfile('roman')
  if (!options.profile) { profile.rank = 'commander'; profile.totalMerit = 20000 }
  const residents = options.residents ?? [recordingCrew()]
  const storage = new MemoryStorage(), store = new CareerProfileStore(storage)
  // Named prototype seam exposes actual Town callers without constructing its unrelated rendered world.
  const town = townProfileCheckpoint(profile, store) as ReturnType<typeof townProfileCheckpoint> & TownCommandPort
  const faction = options.worldFaction ?? profile.faction
  const garrison = new TownEagleGarrisonController(residents)
  const air = new TownAirCommandSquadController(residents, () => town.player as Player, () => town.profile, garrison, faction)
  Object.assign(town, { residents, commandActors: residents.map(row => row.npc), world: { faction },
    townAirCommand: air, eagleGarrison: garrison, garrisonRestored: true,
    civilianCommand: new CivilianCommandSquadController([], () => town.player as Player, () => town.profile, next => town.commit(next),
      { sceneKey: `town:${faction}`, townFaction: faction }) })
  town.playMissionVoice('follow')
  // Actual Town restore entry point owns native resources first, then saved player intent.
  town.restoreEagleCommandState(); town.synchronizeEaglePatrolPolicy()
  const formation = new FormationController(new THREE.Scene(), new THREE.PerspectiveCamera(), residents.map(row => row.npc), new THREE.Object3D(), [])
  const raycaster = (formation as unknown as { raycaster: THREE.Raycaster }).raycaster
  const ray = vi.spyOn(raycaster, 'intersectObject').mockReturnValue([
    { point: new THREE.Vector3(0, getTerrainHeight(0, 0), 0) } as THREE.Intersection,
  ])
  const h = createArmyCommandHarness(residents.map(row => row.actor), formation, () => town.commandsEnabled(), null, 'roman', 'squad', true, undefined,
    { accepts: npc => town.isAuthorizedCommandActor(npc), enabled: () => town.commandsEnabled(),
      beforeIssue: (order, target, participants, assignments) => town.preparePlayerCommand(order, target, participants, assignments),
      issue: (order, target) => town.issuePartyOrder(order, target) }, () => town.commandHudRoster(),
    (order, target) => town.onPlayerCommandIssued(order, target ?? 'all'))
  onTestFinished(() => { h.controller.close(); formation.cancelPlacement(); ray.mockRestore() })
  const issue = (order: TacticalOrder | 'dismiss', target: '8' | 'all' | '1' | '0' | '9' = '8') => {
    if (target === 'all') h.input.pressAll(); else h.input.press(target)
    h.controller.update()
    h.input.press(String(['attack', 'charge', 'defend', 'formation', 'follow', 'dismiss'].indexOf(order) + 1)); h.controller.update()
    if (order === 'formation') { h.input.pressE(); h.controller.update() }
  }
  return { residents, storage, store, town, garrison, air, h, formation, issue }
}

// New owner: peaceful air authority and Town -> real Store transactions. Existing garrison tests
// own native lifecycle/flight; this suite must not materialize an entire official army to test routing.
describe('peaceful Town air command routing and durable ownership', () => {
  it('selects only the existing five fixed pairs and exposes independent Squad 8 without claiming native duty', () => {
    // Full identity census uses five records, not five real actors or mounts.
    const expected = ['town-eagle-rider:1', 'town-eagle-rider:2', 'town-eagle-rider:3', 'town-eagle-rider:4', 'town-eagle-rider:5']
    const crews = [5, 3, 1, 4, 2].map(slot => recordingCrew(slot))
    const intruder = recordingCrew(1, { ...townRoster().find(spec => spec.id === 'merchant')! })
    const f = fixture({ residents: [...crews, intruder] })
    expect(f.air.actors.map(npc => npc.combatantId)).toEqual(expected)
    expect(f.town.commandHudRoster().members).toEqual(expected.map(id => ({ id, squadId: 8, state: 'deployed', order: 'attack' })))
    expect(f.town.profile.townAirCommandSquad).toBeUndefined()
    expect(f.town.profile.personalSquad?.members ?? []).toEqual([])
    expect(f.town.profile.civilianCommandSquad).toBeUndefined()
    expect(f.town.profile.townCommandSquad).toBeUndefined()
    for (const crew of crews) {
      expect(crew.actor.squadId).toBe(8); expect(crew.actor.faction).toBe(Faction.TOWN)
      expect(f.garrison.isPlayerCommandOwned(crew.npc)).toBe(false)
    }
    const crew = crews.find(row => row.spec.id === expected[0])!
    f.garrison.update(crew.npc, 0, false, new THREE.Vector3(), [], new NavigationWorld())
    expect(f.garrison.dutyFor(crew.npc)).toBe('mounted-waiting')
    expect(crew.actor.assignFollowTarget).not.toHaveBeenCalled()
    expect(intruder.actor.squadId).toBeUndefined()
  })

  it.each(['recruit', 'soldier', 'veteran', 'captain'] as const)('denies %s both key 8 and ALL after reloading an old Commander claim', rank => {
    const source = fixture(); source.issue('follow')
    const saved = source.store.load()!; saved.rank = rank; saved.totalMerit = 20000
    const f = fixture({ profile: saved })
    expect(f.air.commandsEnabled).toBe(false); expect(f.town.commandHudRoster().members).toEqual([])
    f.issue('follow'); f.issue('charge', 'all')
    expect(f.residents[0].actor.faction).toBe(Faction.TOWN)
    expect(f.residents[0].actor.assignFollowTarget).not.toHaveBeenCalled()
    expect(f.garrison.isPlayerCommandOwned(f.residents[0].npc)).toBe(false)
    expect(f.storage.length).toBe(0)
  })

  it('denies own IDs in an enemy scene and rejects foreign owners or substituted actors', () => {
    const source = fixture(); source.issue('follow')
    const f = fixture({ profile: source.store.load()!, worldFaction: 'viking' })
    f.issue('follow'); f.issue('charge', 'all')
    expect(f.air.commandsEnabled).toBe(false); expect(f.town.commandHudRoster().members).toEqual([])
    expect(f.residents[0].actor.assignFollowTarget).not.toHaveBeenCalled()
    const own = fixture(), original = own.residents[0]
    expect(own.air.accepts(recordingCrew().npc)).toBe(false)
    original.actor.combatOwnership = 'mission-official'
    expect(own.air.accepts(original.npc)).toBe(false)
    original.actor.combatOwnership = undefined; original.actor.faction = Faction.ENEMY
    expect(own.air.accepts(original.npc)).toBe(false)
    own.issue('charge', 'all'); expect(original.actor.setTacticalOrder).not.toHaveBeenCalled()
  })

  it.each(['attack', 'charge', 'defend', 'follow'] as const)('routes %s through key 8 and saves ownership before touching live actors', order => {
    const f = fixture(), crew = f.residents[0]
    const writes = vi.spyOn(f.store, 'save'); onTestFinished(() => writes.mockRestore())
    f.issue(order)
    expect(f.store.load()?.townAirCommandSquad).toMatchObject({ squadId: 8, actorIds: ['town-eagle-rider:1'], commandedActorIds: ['town-eagle-rider:1'], members: { 'town-eagle-rider:1': { order } } })
    expect(crew.actor.tacticalOrder).toBe(order); expect(crew.actor.faction).toBe(Faction.PLAYER)
    expect(f.garrison.isPlayerCommandOwned(crew.npc)).toBe(true)
    expect(writes.mock.invocationCallOrder[0]).toBeLessThan(crew.actor.setCommandAllegiance.mock.invocationCallOrder[0])
    expect(crew.actor.hp).toBe(80); expect(crew.mountState.currentHp).toBe(200)
  })

  it('leaves live resources, ownership and stored state unchanged when an ALL command save fails, then retries', () => {
    const f = fixture(), crew = f.residents[0]
    expect(f.store.save(f.town.profile)).toBe(true)
    const before = f.store.load(), position = crew.npc.group.position.clone()
    f.storage.failWrites = true; f.issue('charge', 'all')
    expect(f.store.load()).toEqual(before); expect(f.town.profile.townAirCommandSquad).toBeUndefined()
    expect(crew.actor.faction).toBe(Faction.TOWN); expect(crew.actor.tacticalOrder).toBe('attack')
    expect(crew.actor.setCommandAllegiance).not.toHaveBeenCalled(); expect(crew.actor.setTacticalOrder).not.toHaveBeenCalled()
    expect(f.garrison.isPlayerCommandOwned(crew.npc)).toBe(false); expect(crew.npc.group.position).toEqual(position)
    f.storage.failWrites = false; f.issue('charge', 'all')
    expect(crew.actor.tacticalOrder).toBe('charge'); expect(f.store.load()?.townAirCommandSquad?.commandedActorIds).toEqual(['town-eagle-rider:1'])
  })

  it('saves the exact airborne formation slot before assignment, retries failed placement, and restores that slot', () => {
    const f = fixture(), crew = f.residents[0]
    crew.actor.mountVehicle(crew.homeMount)
    f.storage.failWrites = true; f.issue('formation')
    expect(crew.actor.assignFormationTarget).not.toHaveBeenCalled(); expect(f.garrison.isPlayerCommandOwned(crew.npc)).toBe(false)
    expect(f.formation.isPlacementMode).toBe(true)
    f.storage.failWrites = false
    const writes = vi.spyOn(f.store, 'save'); onTestFinished(() => writes.mockRestore())
    f.h.input.pressE(); f.h.controller.update()
    const exact = { commandId: 1, position: { x: 0, y: getTerrainHeight(0, 0) + 30, z: 0, yaw: Math.PI }, reached: false }
    expect(f.store.load()?.townAirCommandSquad?.members['town-eagle-rider:1'].formation).toEqual(exact)
    expect(crew.actor.combatFormationCheckpoint).toMatchObject(exact)
    expect(writes.mock.invocationCallOrder[0]).toBeLessThan(crew.actor.assignFormationTarget.mock.invocationCallOrder[0])
    f.town.persistPersonalSquad(5)
    expect(f.store.load()?.townAirCommandSquad?.members['town-eagle-rider:1'].formation).toMatchObject(exact)
    const restored = fixture({ profile: f.store.load()! })
    expect(restored.residents[0].actor.combatFormationCheckpoint).toMatchObject(exact)
    expect(restored.garrison.isPlayerCommandOwned(restored.residents[0].npc)).toBe(true)
  })

  it('atomically saves Dismiss with native commandReturn before releasing ownership, including failure and reload', () => {
    const f = fixture(), crew = f.residents[0]
    crew.actor.mountVehicle(crew.homeMount); crew.mountState.flight.phase = 'cruise'; f.issue('follow')
    crew.actor.hp = 31; crew.actor.combatAmmo = 9; crew.mountState.currentHp = 61
    const before = f.store.load(), position = crew.npc.group.position.clone()
    f.storage.failWrites = true; f.issue('dismiss')
    expect(f.store.load()).toEqual(before); expect(f.garrison.isPlayerCommandOwned(crew.npc)).toBe(true)
    expect(crew.actor.tacticalOrder).toBe('follow')
    f.storage.failWrites = false; f.issue('dismiss')
    const saved = f.store.load()!
    expect(saved.townAirCommandSquad?.commandedActorIds).toEqual([])
    expect(saved.townEagleGarrisons?.roman?.pairs[0]).toMatchObject({ commandReturn: true, duty: 'return-queue', refitAllowed: true, hp: 31, ammo: 9, mount: { hp: 61 } })
    expect(f.garrison.isPlayerCommandOwned(crew.npc)).toBe(false); expect(crew.actor.faction).toBe(Faction.TOWN)
    expect(crew.npc.group.position).toEqual(position); expect(crew.actor.hp).toBe(31); expect(crew.mountState.currentHp).toBe(61)
    const restored = fixture({ profile: saved })
    expect(restored.garrison.isPlayerCommandOwned(restored.residents[0].npc)).toBe(false)
    expect(restored.garrison.snapshot('town:roman').pairs[0]).toMatchObject({ commandReturn: true, duty: 'return-queue', hp: 31, ammo: 9, mount: { hp: 61 } })
  })

  it('restores native patrol first and rebinds saved Follow to the current player afterward', () => {
    const source = fixture(), crew = source.residents[0]
    source.garrison.update(crew.npc, 0, false, new THREE.Vector3(), [], new NavigationWorld())
    source.garrison.update(crew.npc, 0, false, new THREE.Vector3(), [], new NavigationWorld())
    expect(source.garrison.dutyFor(crew.npc)).toBe('patrolling')
    source.issue('follow'); source.town.persistPersonalSquad(5)
    const restored = fixture({ profile: source.store.load()! }), actor = restored.residents[0].actor
    expect(actor.assignFollowTarget).toHaveBeenLastCalledWith(restored.town.player, 0, expect.any(THREE.Vector3))
    expect(actor.tacticalOrder).toBe('follow'); expect(restored.garrison.isPlayerCommandOwned(restored.residents[0].npc)).toBe(true)
    expect(actor.restoreCombatHealth.mock.invocationCallOrder[0]).toBeLessThan(actor.assignFollowTarget.mock.invocationCallOrder[0])
    expect(actor.setEagleFlightOrder).toHaveBeenLastCalledWith(null)
  })

  it('checkpoints consecutive periodic resource changes through canonical IDs and restores death and mount loss without refill', () => {
    const f = fixture({ residents: [recordingCrew(1), recordingCrew(2)] })
    f.issue('follow', 'all')
    const [dead, survivor] = f.residents
    dead.actor.takeDamage(80); survivor.mountState.takeDamage(200); survivor.actor.combatAmmo = 11; survivor.actor.shield.shieldImpactRemaining = 3
    survivor.actor.hp = 27; survivor.actor.group.position.set(12, 4, 18)
    f.town.persistPersonalSquad(5)
    survivor.actor.hp = 19; survivor.actor.combatAmmo = 4; survivor.actor.group.position.set(22, 7, 28)
    f.town.persistPersonalSquad(5)
    const saved = f.store.load()!
    expect(saved.townAirCommandSquad?.actorIds).toEqual(['town-eagle-rider:1', 'town-eagle-rider:2'])
    expect(saved.townEagleGarrisons?.roman?.pairs.map(pair => pair.riderId)).toEqual(['town-eagle-rider:1', 'town-eagle-rider:2'])
    expect(saved.townAirCommandSquad?.members['town-eagle-rider:1']).toMatchObject({ status: 'dead', hp: 0 })
    expect(saved.townAirCommandSquad?.members['town-eagle-rider:2']).toMatchObject({ hp: 19, ammo: 4, shieldImpact: 3, position: { x: 22, y: 7, z: 28 }, mount: { hp: 0 } })
    const restored = fixture({ profile: saved, residents: [recordingCrew(1), recordingCrew(2)] })
    expect(restored.residents[0].actor.dead).toBe(true)
    expect(restored.residents[1].actor).toMatchObject({ hp: 19, combatAmmo: 4, mount: null, shield: { shieldImpactRemaining: 3 } })
    expect(restored.residents[1].mountState.dead).toBe(true)
    expect(restored.town.commandHudRoster().members.map(row => [row.id, row.state])).toEqual([['town-eagle-rider:1', 'dead'], ['town-eagle-rider:2', 'deployed']])
  })

  it('releases a completely dead owned air squad through key 8 Dismiss and keeps casualties durable', () => {
    const f = fixture(); f.issue('follow'); f.residents[0].actor.takeDamage(80)
    f.issue('dismiss')
    const saved = f.store.load()!
    expect(saved.townAirCommandSquad?.commandedActorIds).toEqual([])
    expect(saved.townEagleGarrisons?.roman?.pairs[0]).toMatchObject({ hp: 0, duty: 'casualty', commandReturn: true, replacementRemaining: 60, ambientRecovery: true })
    expect(f.garrison.isPlayerCommandOwned(f.residents[0].npc)).toBe(false)
  })
})

describe('Town air isolation from formal command grants', () => {
  it('key 8 claims only the accepted formal air squad; ALL reaches other authorized squads without a peaceful grant', () => {
    const air = recordingCrew(), foot = recordingCrew(1, townRoster().find(spec => spec.id === 'melee_infantry-0')!)
    air.actor.squadId = 8; foot.actor.squadId = 1
    for (const crew of [air, foot]) crew.actor.combatOwnership = 'mission-official'
    foot.actor.tacticalOrder = 'defend'; foot.actor.hp = 17
    const profile = createCareerProfile('roman'); profile.rank = 'commander'; profile.totalMerit = 20000
    profile.activeMission = createTownDefenseMission([air.spec.id, foot.spec.id], [], 'air-routing-defense')
    profile.activeMission.phase = 'ATTACKING'
    profile.activeMission.officialSquad = { type: 'mission-official', missionId: 'air-routing-defense', townFaction: 'roman', squadId: 1,
      actorIds: [air.spec.id, foot.spec.id], commandRank: 'commander',
      squads: [{ squadId: 1, actorIds: [foot.spec.id] }, { squadId: 8, actorIds: [air.spec.id] }], commandedSquadIds: [],
      contribution: emptyPersonalContribution(), members: { [foot.spec.id]: { status: 'deployed', hp: 17, order: 'defend' } } }
    const f = fixture({ profile, residents: [air, foot] })
    expect(f.air.commandsEnabled).toBe(false)
    f.issue('follow')
    expect(air.actor.tacticalOrder).toBe('follow'); expect(f.garrison.isPlayerCommandOwned(air.npc)).toBe(true)
    expect(foot.actor.tacticalOrder).toBe('defend'); expect(foot.actor.hp).toBe(17)
    expect(foot.actor.setTacticalOrder).not.toHaveBeenCalled(); expect(foot.actor.assignFollowTarget).not.toHaveBeenCalled()
    expect(f.store.load()?.activeMission?.officialSquad?.commandedSquadIds).toEqual([8])
    expect(f.store.load()?.townAirCommandSquad).toBeUndefined()
    f.issue('charge', 'all')
    expect([air.actor.tacticalOrder, foot.actor.tacticalOrder]).toEqual(['charge', 'charge'])
    expect(f.store.load()?.activeMission?.officialSquad?.commandedSquadIds).toEqual([1, 8])
    f.issue('dismiss')
    expect(f.store.load()?.activeMission?.officialSquad?.commandedSquadIds).toEqual([1])
    expect(f.garrison.isPlayerCommandOwned(air.npc)).toBe(false)
    expect(f.store.load()?.townEagleGarrisons?.roman?.pairs[0].commandReturn).toBe(true)
    expect(foot.actor.tacticalOrder).toBe('charge')
  })

  it('dismisses a completely dead formal Squad 8 atomically after failed-save retry and releases its native lifecycle', () => {
    const crew = recordingCrew(); crew.actor.squadId = 8; crew.actor.combatOwnership = 'mission-official'
    const profile = createCareerProfile('roman'); profile.rank = 'commander'; profile.totalMerit = 20000
    profile.activeMission = createTownDefenseMission([crew.spec.id], [], 'dead-air-defense')
    profile.activeMission.phase = 'ATTACKING'
    profile.activeMission.officialSquad = { type: 'mission-official', missionId: 'dead-air-defense', townFaction: 'roman', squadId: 1,
      actorIds: [crew.spec.id], commandRank: 'commander', squads: [{ squadId: 8, actorIds: [crew.spec.id] }],
      commandedSquadIds: [], contribution: emptyPersonalContribution() }
    const f = fixture({ profile, residents: [crew] }); f.issue('follow')
    crew.actor.takeDamage(80)
    // Periodic ownership synchronization must retain a dead command until explicit Dismiss.
    f.town.persistPersonalSquad(5)
    expect(f.garrison.isPlayerCommandOwned(crew.npc)).toBe(true)
    const before = f.store.load()
    f.storage.failWrites = true; f.issue('dismiss')
    expect(f.store.load()).toEqual(before); expect(f.garrison.isPlayerCommandOwned(crew.npc)).toBe(true)
    f.storage.failWrites = false; f.issue('dismiss')
    const saved = f.store.load()!
    expect(saved.activeMission?.officialSquad?.commandedSquadIds).toEqual([])
    expect(saved.activeMission?.officialSquad?.members?.[crew.spec.id]).toMatchObject({ status: 'dead', hp: 0 })
    expect(saved.townEagleGarrisons?.roman?.pairs[0]).toMatchObject({ hp: 0, duty: 'casualty', commandReturn: true, replacementRemaining: 60 })
    expect(f.garrison.isPlayerCommandOwned(crew.npc)).toBe(false)
    const resumedCrew = recordingCrew(); resumedCrew.actor.squadId = 8; resumedCrew.actor.combatOwnership = 'mission-official'
    const restored = fixture({ profile: saved, residents: [resumedCrew] })
    expect(resumedCrew.actor.dead).toBe(true); expect(restored.garrison.isPlayerCommandOwned(resumedCrew.npc)).toBe(false)
  })

  it('keeps a hostile-transition release durable through failed-save retry, periodic checkpoints and later settlement', () => {
    const f = fixture(), crew = f.residents[0]; f.issue('follow')
    const hostile = cloneCareerProfile(f.town.profile)
    hostile.townEvent = { id: 'air-hostility', state: 'hostile' }
    const before = f.store.load()
    f.storage.failWrites = true
    expect(f.town.commit(hostile)).toBe(false)
    expect(f.store.load()).toEqual(before); expect(f.town.profile.townEvent).toBeUndefined()
    expect(f.air.ownsPlayerCommand(crew.npc)).toBe(true); expect(f.garrison.isPlayerCommandOwned(crew.npc)).toBe(true)
    f.storage.failWrites = false
    expect(f.town.commit(hostile)).toBe(true)
    expect(f.store.load()?.townAirCommandSquad?.commandedActorIds).toEqual([])
    expect(f.air.checkpoint()?.commandedActorIds).toEqual([])
    expect(f.garrison.isPlayerCommandOwned(crew.npc)).toBe(false)
    expect(crew.actor.faction).toBe(Faction.TOWN); expect(crew.actor.combatOwnership).toBeUndefined()
    f.town.persistPersonalSquad(5)
    expect(f.store.load()?.townAirCommandSquad?.commandedActorIds).toEqual([])
    const settled = cloneCareerProfile(f.town.profile)
    settled.townEvent = { id: 'air-hostility', state: 'settled' }
    expect(f.town.commit(settled)).toBe(true)
    f.town.persistPersonalSquad(5)
    expect(f.air.commandsEnabled).toBe(true)
    expect(f.air.ownsPlayerCommand(crew.npc)).toBe(false); expect(f.garrison.isPlayerCommandOwned(crew.npc)).toBe(false)
    expect(f.store.load()?.townAirCommandSquad?.commandedActorIds).toEqual([])
    const restored = fixture({ profile: f.store.load()! })
    expect(restored.garrison.isPlayerCommandOwned(restored.residents[0].npc)).toBe(false)
    expect(restored.residents[0].actor.assignFollowTarget).not.toHaveBeenCalled()
    // A fresh explicit command is still allowed after the event has settled.
    f.issue('follow'); expect(f.garrison.isPlayerCommandOwned(crew.npc)).toBe(true)
  })

  it.each(['commanded', 'dismissed'] as const)('settles faction defeat with a %s air checkpoint through Store and Town without reviving foreign authority', state => {
    const f = fixture(), crew = f.residents[0]; f.issue('follow')
    if (state === 'dismissed') f.issue('dismiss')
    const hostile = cloneCareerProfile(f.town.profile)
    hostile.townEvent = { id: 'change-faction', state: 'hostile' }
    const settled = settleTown(hostile, 'change-faction', 'town_defeated')
    const directStore = new CareerProfileStore(new MemoryStorage())
    expect(directStore.save(settled)).toBe(true)
    expect(directStore.load()).toMatchObject({ faction: 'viking', rank: 'recruit' })
    expect(directStore.load()?.townAirCommandSquad).toBeUndefined()
    const before = f.store.load(), owned = f.garrison.isPlayerCommandOwned(crew.npc), faction = crew.actor.faction
    f.storage.failWrites = true
    expect(f.town.commit(settled)).toBe(false)
    expect(f.store.load()).toEqual(before); expect(f.town.profile.faction).toBe('roman')
    expect(f.garrison.isPlayerCommandOwned(crew.npc)).toBe(owned); expect(crew.actor.faction).toBe(faction)
    f.storage.failWrites = false
    expect(f.town.commit(settled)).toBe(true)
    expect(f.air.checkpoint()).toBeUndefined(); expect(f.air.commandsEnabled).toBe(false)
    expect(f.garrison.isPlayerCommandOwned(crew.npc)).toBe(false)
    expect(f.town.commit(cloneCareerProfile(f.town.profile))).toBe(true)
    f.town.persistPersonalSquad(5)
    const saved = f.store.load()!
    expect(saved.faction).toBe('viking'); expect(saved.townAirCommandSquad).toBeUndefined()
    const restored = fixture({ profile: saved, worldFaction: 'roman' })
    restored.issue('follow', 'all')
    expect(restored.air.commandsEnabled).toBe(false); expect(restored.air.checkpoint()).toBeUndefined()
    expect(restored.garrison.isPlayerCommandOwned(restored.residents[0].npc)).toBe(false)
  })

  it.each(['follow', 'formation'] as const)('Town restore reapplies formal %s after the native saved patrol and resources', order => {
    const crew = recordingCrew(); crew.actor.squadId = 8; crew.actor.combatOwnership = 'mission-official'
    const profile = createCareerProfile('roman'); profile.rank = 'commander'; profile.totalMerit = 20000
    profile.activeMission = createTownDefenseMission([crew.spec.id], [], `restore-air-${order}`)
    profile.activeMission.phase = 'ATTACKING'
    profile.activeMission.officialSquad = { type: 'mission-official', missionId: profile.activeMission.id, townFaction: 'roman', squadId: 1,
      actorIds: [crew.spec.id], commandRank: 'commander', squads: [{ squadId: 8, actorIds: [crew.spec.id] }],
      commandedSquadIds: [], contribution: emptyPersonalContribution() }
    const source = fixture({ profile, residents: [crew] }); crew.actor.mountVehicle(crew.homeMount); source.issue(order)
    const saved = source.store.load()!, native = saved.townEagleGarrisons!.roman!.pairs[0]
    native.duty = 'patrolling'; native.patrol = { active: true, waypoint: 2, elapsed: 15 }
    native.hp = 31; native.ammo = 6
    expect(source.store.save(saved)).toBe(true)
    const resumedCrew = recordingCrew(); resumedCrew.actor.squadId = 8; resumedCrew.actor.combatOwnership = 'mission-official'
    const restored = fixture({ profile: source.store.load()!, residents: [resumedCrew] })
    expect(resumedCrew.actor.setEagleFlightOrder.mock.calls[0][0]).toMatchObject({ kind: 'patrol' })
    expect(resumedCrew.actor.setEagleFlightOrder).toHaveBeenLastCalledWith(null)
    expect(resumedCrew.actor.tacticalOrder).toBe(order); expect(resumedCrew.actor.hp).toBe(80); expect(resumedCrew.actor.combatAmmo).toBe(30)
    expect(restored.garrison.isPlayerCommandOwned(resumedCrew.npc)).toBe(true)
    if (order === 'follow') expect(resumedCrew.actor.assignFollowTarget).toHaveBeenLastCalledWith(restored.town.player, 0, expect.any(THREE.Vector3))
    else expect(resumedCrew.actor.combatFormationCheckpoint).toMatchObject({ commandId: 1,
      position: { x: 0, y: getTerrainHeight(0, 0) + 30, z: 0, yaw: Math.PI }, reached: false })
  })

  it('Town restore preserves ordinary Captain native airborne patrol without granting formal or peaceful player ownership', () => {
    const profile = createCareerProfile('roman'); profile.rank = 'captain'; profile.totalMerit = 20000
    profile.activeMission = createTownDefenseMission(['town-eagle-rider:1'], [], 'captain-native-air')
    const source = fixture({ profile }), native = source.garrison.snapshot('town:roman')
    native.pairs[0] = { ...native.pairs[0], duty: 'patrolling', mounted: true, hp: 31, ammo: 6,
      position: { x: 120, y: 42, z: 90, yaw: .4 }, patrol: { active: true, waypoint: 2, elapsed: 15 },
      mount: { hp: 61, position: { x: 120, y: 42, z: 90, yaw: .4 },
        flight: { phase: 'cruise', yaw: .4, pitch: .1, bank: .2, speed: 20, velocity: { x: 2, y: 1, z: 19 } } } }
    profile.townEagleGarrisons = { roman: native }
    expect(source.store.save(profile)).toBe(true)
    const restored = fixture({ profile: source.store.load()! }), crew = restored.residents[0]
    expect(crew.actor.hp).toBe(31); expect(crew.actor.combatAmmo).toBe(6); expect(crew.mountState.currentHp).toBe(61)
    expect(crew.actor.group.position).toEqual(new THREE.Vector3(120, 42, 90))
    expect(crew.mountState.flight.snapshot()).toEqual(native.pairs[0].mount.flight)
    expect(crew.actor.setEagleFlightOrder).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'patrol' }))
    expect(crew.actor.assignFollowTarget).not.toHaveBeenCalled()
    expect(restored.air.commandsEnabled).toBe(false); expect(restored.garrison.isPlayerCommandOwned(crew.npc)).toBe(false)
  })

  it('revokes a peaceful claim in the same saved rank transition without mutating owners on failure', () => {
    const f = fixture(); f.issue('follow')
    const next = cloneCareerProfile(f.town.profile); next.rank = 'captain'
    f.storage.failWrites = true
    expect(f.town.commit(next)).toBe(false)
    expect(f.town.profile.rank).toBe('commander'); expect(f.garrison.isPlayerCommandOwned(f.residents[0].npc)).toBe(true)
    f.storage.failWrites = false
    expect(f.town.commit(next)).toBe(true)
    const saved = f.store.load()!
    expect(saved.rank).toBe('captain'); expect(saved.townAirCommandSquad?.commandedActorIds).toEqual([])
    expect(saved.townEagleGarrisons?.roman?.pairs[0].commandReturn).toBe(true)
    expect(f.garrison.isPlayerCommandOwned(f.residents[0].npc)).toBe(false)
    expect(f.residents[0].actor.faction).toBe(Faction.TOWN)
    const restored = fixture({ profile: saved })
    restored.issue('follow', 'all'); expect(restored.garrison.isPlayerCommandOwned(restored.residents[0].npc)).toBe(false)
  })
})

it('Town save stages selected air service recovery durably before any native mutation and leaves the other pair untouched', () => {
  const f = fixture({ residents: [recordingCrew(1), recordingCrew(2)] }), [row, other] = f.residents
  const next = cloneCareerProfile(f.town.profile), membership = commanderTownCommandMembership()
  next.townCommandSquad = { type: 'town-command', squadId: 1, townFaction: 'roman', ...membership,
    state: 'TRAINING', authorized: true, sceneKey: 'town-home', contribution: emptyPersonalContribution(),
    members: { [row.spec.id]: snapshotCommandActor(row.npc, row.homeMount) }, refittingActorIds: [row.spec.id] }
  const before = f.garrison.snapshot('town:roman')
  f.storage.setItem = () => { throw new Error('storage denied') }
  expect(f.town.commit(next)).toBe(false)
  expect(f.garrison.snapshot('town:roman')).toEqual(before)
  expect(f.garrison.serviceRefitPending(row.npc)).toBe(false)
  f.storage.setItem = MemoryStorage.prototype.setItem
  expect(f.town.commit(next)).toBe(true)
  const saved = f.store.load()!.townEagleGarrisons!.roman!
  expect(saved.pairs.find(p => p.riderId === row.spec.id)).toMatchObject({ refitAllowed: true, serviceRefit: true })
  expect(saved.pairs.find(p => p.riderId === other.spec.id)).toEqual(before.pairs.find(p => p.riderId === other.spec.id))
  expect(f.garrison.serviceRefitPending(row.npc)).toBe(false) // Saving does not perform physical recovery.
  f.garrison.requestServiceRefit(row.npc)
  expect(f.garrison.serviceRefitPending(row.npc)).toBe(true)
  expect(f.air.accepts(row.npc)).toBe(false)
  expect(f.garrison.serviceRefitPending(other.npc)).toBe(false)
})
