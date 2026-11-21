import { personalSquadFixture } from '../helpers/personalSquadFixture'
import { careerRankFixture } from '../helpers/careerRankFixture'
import { MountArmor } from '../../src/combat/MountArmor'
import { CareerMountController } from '../../src/career/CareerMountController'
import { CareerRaceController } from '../../src/career/CareerRaceController'
import { acceptVeteranMission } from '../../src/career/VeteranMission'
import { careerCheckpointPlayer } from '../helpers/careerCheckpointPlayer'
import { createDefaultSkillState } from '../../src/rpg/SkillManager'
import type { TownActorSpec } from '../../src/town/TownRules'
import { commitTownProfile, type TownProfileCommitRuntime, type TownProfileChange } from '../../src/town/TownProfileCommit'
import { COMMANDER_FOUR_GATE_DEFENSE_SURVIVAL_SECONDS as survivalSeconds } from '../../src/career/CommanderFourGateDefenseState'
import { Vector3 } from 'three'
import { describe, expect, it, vi } from 'vitest'
import { createCaptainPatrolCommandMission } from '../../src/career/CaptainMissionCatalog'
import { createActiveCareerMission, type ActiveCareerMission } from '../../src/career/CareerMissionState'
import { snapshotPersonalMission, type PersonalSquadMission } from '../../src/career/CareerPersonalSquadMission'
import { claimCareerMission, clearCareerMission, cloneCareerProfile, createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { createArenaTrialMission } from '../../src/career/CareerArenaTrials'
import { CAREER_STORAGE_KEY, CareerProfileStore } from '../../src/career/CareerProfileStore'
import { TownMissionSettlement } from '../../src/town/TownMissionSettlement'
import { NPC } from '../../src/world/NPC'
import { createCareerDuelMission } from '../../src/career/CareerDuelState'
import { townStationSpec } from '../../src/town/TownGarrison'
import { getTerrainHeight } from '../../src/world/Terrain'
import { standingPlayerY } from '../../src/player/PlayerFootBody'
import { MemoryStorage } from '../helpers/memoryStorage'
import { townRoster, townRosterIdentity } from '../../src/town/TownRules'
import { emptyPersonalContribution } from '../../src/combat/CommandMerit'
import { resolveTownActorEquipment } from '../../src/career/CareerTownEquipmentState'
import { addCareerItem } from '../../src/career/CareerInventory'
import { createFourGateDefenseProfile } from '../helpers/commanderFourGateDefenseFixture'
import { COMMANDER_FOUR_GATE_DEFENSE_ID } from '../../src/career/CommanderFourGateDefenseRoster'
import { TOWN_COMMANDER_ID, townCommanderSpec } from '../../src/town/TownCommanderIdentity'

import { acceptCommanderMission, COMMANDER_FELINE_CAVALRY_ID, FELINE_ENEMY_TOTAL, FELINE_FRIENDLY_TOTAL } from '../../src/career/CommanderMissionCatalog'



/** Casualty input for settlement; no controller, combat, or result transition is simulated. */
function fourGateCasualties(mission: ActiveCareerMission, ids: readonly string[]): void {
  mission.deadTargetActorIds = [...ids]
  if (ids.length === mission.targetActorIds.length) mission.fourGateDefense!.victoryReason = 'elimination'
  for (const id of ids) {
    const actor = mission.fourGateDefense!.actors[id]
    actor.status = 'dead'; actor.hp = 0
    if (actor.mount) actor.mount.mounted = false
    const ground = mission.fourGateDefense!.siege!.actors[id]
    if (ground) { ground.status = 'dead'; ground.hp = 0; if (ground.mount) ground.mount.mounted = false }
  }
}

/** Save/controller boundaries only. Position and yaw are data, never an Object3D or scene tree. */
function fixture(kind: 'bandit' | 'captain-patrol-command' | 'commander-four-gate-defense' | 'veteran-field' | 'duel' = 'bandit', completed = false) {
  const events: string[] = []
  let profile = kind === 'commander-four-gate-defense' ? createFourGateDefenseProfile('ATTACKING') : createCareerProfile('roman')
  if (kind === 'captain-patrol-command') Object.assign(profile, { rank: 'captain' as const, t4Specialization: 'paladin' as const, unlockedT4Classes: ['paladin' as const], totalMerit: 5000, availableMerit: 5000 })
  if (kind !== 'commander-four-gate-defense') profile.activeMission = kind === 'captain-patrol-command'
    ? createCaptainPatrolCommandMission(profile, ['patrol:captain'], 'settlement')
    : kind === 'duel' ? createCareerDuelMission(profile, 'roman_archer', 1, 'resident', 'captain', 'settlement')!
    : { ...createActiveCareerMission('recruit-bandits-01', 0, 1, 0, 'settlement'), kind }
  const stats = { damageDealt: 200, damageTaken: 100, kills: 2, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived: false }
  if (completed) {
    if (kind === 'commander-four-gate-defense') fourGateCasualties(profile.activeMission!, profile.activeMission!.targetActorIds)
    profile = claimCareerMission(profile, profile.activeMission!.id, 'victory', stats).profile
    profile.activeMission!.phase = 'RETURNING'
  }
  const storage = new MemoryStorage(), store = new CareerProfileStore(storage)
  // The large formal input is already supplied by the persistence fixture. Seed
  // bytes directly; settlement's actual save/retry and final reload own validation.
  if (kind === 'commander-four-gate-defense') storage.setItem(CAREER_STORAGE_KEY, JSON.stringify(profile))
  else expect(store.save(profile)).toBe(true)
  const residentState = { dead: true, group: { position: new Vector3(9, 0, 9), rotation: { y: 0 } },
    dismountFromMount: vi.fn(), restoreCombatLoadout: vi.fn(),
    restoreForTown: vi.fn((_destination?: Parameters<NPC['restoreForTown']>[0]) => { residentState.dead = false; events.push('restore') }), mountVehicle: vi.fn() }
  const resident: { spec: TownActorSpec; npc: NPC; cycle: number; walkTime: number } = { spec: { id: 'resident', role: 'melee_infantry' as const, duty: 'training' as const, mounted: false, training: true, assaultObjective: false, tier: 3 as const, index: 0, x: 2, z: 3, yaw: .5 },
    npc: residentState as unknown as NPC, cycle: 3, walkTime: 2 }
  const field = { friendlies: [resident.npc], snapshot: vi.fn(() => ({ player: stats, squads: [] })), cleanupMission: vi.fn(() => events.push('cleanup')) }
  const duel = { actors: kind === 'duel' ? [resident.npc] : [], snapshot: vi.fn(() => ({ player: stats, squads: [] })), cleanupMission: vi.fn() }
  const defense = { active: kind === 'commander-four-gate-defense' ? profile.activeMission : undefined,
    snapshot: vi.fn(() => ({ player: stats, squads: [] })), snapshotActiveMission: vi.fn((): ActiveCareerMission | undefined => undefined),
    civilianSurvived: 2, civilianDeaths: 1, cleanupMission: vi.fn(() => events.push('defense-cleanup')), ceaseAssaultAirSupport: vi.fn() }
  const patrol = { actors: [resident.npc], statsSnapshot: { player: stats, squads: [] }, release: vi.fn(() => events.push('release')) }
  const player = { ...careerCheckpointPlayer(), maxHp: 437,
    fallSnapshot: undefined as { active: boolean; highestFeetY: number; velocity: { x: number; y: number; z: number } } | undefined,
    setHp: vi.fn((hp: number) => { player.hp = hp }), group: { position: new Vector3(50, 80, 70), rotation: { y: 0 } },
    standOn: vi.fn((x: number, floorY: number, z: number) => { player.group.position.set(x, standingPlayerY(floorY), z) }), resetForScene: vi.fn((x: number, y: number, z: number) => {
    expect(store.load()!.playerAerialState).toBeUndefined()
    player.group.position.set(x, y, z); player.hp = player.maxHp; player.dead = false; player.isFalling = false; events.push('reset')
  }) }
  const town = { residents: [resident], player, cat: { restoreForTown: vi.fn(), catVisual: null },
    world: { obstacles: [], restoreTownDamage: vi.fn(() => events.push('repair')) }, navigation: { sync: vi.fn(() => { events.push('navigation'); return true }) },
    preservesResident: vi.fn(() => false), inventory: { sheathAll: vi.fn() }, releaseExternalThreat: vi.fn(), beginPatrolMissionReturn: vi.fn(() => events.push('native-return')),
    clearCombatShots: vi.fn(), restPlayer: vi.fn(), restart: vi.fn(), returnPersonalSquad: vi.fn() }
  const runtime: TownProfileCommitRuntime = {
    get profile() { return profile }, set profile(next) { profile = next },
    store: { save(next) { events.push('save'); return store.save(next) } },
    player: player as unknown as NonNullable<TownProfileCommitRuntime['player']>,
    get skills() { return { skillState: profile.skills ?? createDefaultSkillState() } },
    residents: [resident], world: { faction: profile.faction }, sceneContext: { missionOnlyResidents: false },
    garrisonRestored: false, restoringAerialState: false, residentReturnPending: false,
    townRefitOnReturn: false, careerSaveFailures: 0, careerSkillsDirty: false, notice: '',
    clearCareerSkillSaveTimer() {}, unavailableTownCavalryActorIds: () => new Set(),
    captureRetirementResources() {}, applyRetirementDeparture() {},
    synchronizeEaglePatrolPolicy() {}, synchronizeCommandActors() {}, cancelCareerAudio() {},
  }
  const commit = vi.fn((next: CareerProfile, change?: TownProfileChange) => commitTownProfile(runtime, next, change))
  // The concrete controller requires the full render-facing Player.group type; only position/yaw is consumed here.
  const settlement = new TownMissionSettlement({ read: () => profile, commit }, { field, duel, defense, patrol },
    town as unknown as ConstructorParameters<typeof TownMissionSettlement>[2])
  return { settlement, field, defense, patrol, town, player, resident, residentState, storage, store, events, commit, stats, runtime,
    read: () => profile, reload: () => { profile = store.load()! }, publish: (next: CareerProfile) => { profile = next } }
}

function raceHealth(hp: number): NonNullable<CareerProfile['racePlayerState']> {
  return { actorId: 'player', mountId: 'horse', hp, dead: false, stamina: 31, mountHp: 43, mounted: false,
    checkpoint: 0, position: { x: 4, y: 1, z: 5, yaw: .3 }, mountPosition: { x: 6, y: 0, z: 7, yaw: .4 } }
}

describe('Town mission settlement transactions', () => {
  it('accepts Commander VI through the real town save with thirty private HR soldiers joining the mission', () => {
    const h = fixture()
    Object.assign(h.player.shield, { reset: vi.fn() })
    const peaceful = cloneCareerProfile(h.read())
    delete peaceful.activeMission
    Object.assign(peaceful, careerRankFixture(peaceful.faction, 'commander'));
    peaceful.totalMerit = 20_000
    peaceful.availableMerit = 20_000
    peaceful.personalSquad = personalSquadFixture(peaceful, Array.from({ length: 30 }, (_, index) => ({
      id: `personal:hr-${index + 1}`, type: 'soldier' as const,
    })))
    expect(h.store.save(peaceful)).toBe(true)
    h.publish(peaceful)

    const next = acceptCommanderMission(peaceful, COMMANDER_FELINE_CAVALRY_ID, 'test:town-feline')!
    expect(next.activeMission?.personalSquad?.memberIds).toHaveLength(30)
    expect(h.commit(next)).toBe(true)

    const stored = h.store.loadChecked().profile!
    expect(stored.activeMission?.templateId).toBe(COMMANDER_FELINE_CAVALRY_ID)
    expect(stored.activeMission?.friendlyActorIds).toHaveLength(FELINE_FRIENDLY_TOTAL)
    expect(stored.activeMission?.targetActorIds).toHaveLength(FELINE_ENEMY_TOTAL)
    expect(stored.activeMission?.personalSquad?.memberIds).toEqual(peaceful.personalSquad.members.map(member => member.id))
    expect(stored.activeMission?.personalSquad?.sceneKey).toBe('town-home')
    expect(stored.personalSquad?.members.map(member => member.id)).toEqual(peaceful.personalSquad.members.map(member => member.id))
    expect(stored.personalSquad?.members).toHaveLength(30)
  })

  it('keeps the private squad snapshot untouched through an arena trial accept, settlement and return', () => {
    const h = fixture()
    Object.assign(h.player.shield, { reset: vi.fn() })
    const peaceful = cloneCareerProfile(h.read())
    delete peaceful.activeMission
    peaceful.personalSquad = personalSquadFixture(peaceful, [{ id: 'personal:dead', type: 'soldier' }, { id: 'personal:hurt', type: 'soldier' }])
    const squad = snapshotPersonalMission(peaceful)!
    squad.members['personal:dead'] = { status: 'dead', hp: 0 }
    squad.members['personal:hurt'] = { status: 'deployed', hp: 17 }
    peaceful.personalSquadRuntime = squad
    expect(h.store.save(peaceful)).toBe(true)
    h.publish(peaceful)

    const trial = cloneCareerProfile(peaceful)
    trial.activeMission = createArenaTrialMission(peaceful, 1, 'roman-colosseum', 'trial-squad')!
    expect(h.commit(trial)).toBe(true)
    const stored = h.store.loadChecked().profile!
    expect(stored.activeMission?.personalSquad).toBeUndefined()
    expect(stored.personalSquadRuntime?.members).toEqual(squad.members)

    const claimed = claimCareerMission(stored, 'trial-squad', 'victory', h.stats).profile
    const returned = clearCareerMission(claimed, 'trial-squad')
    expect(returned.personalSquadRuntime?.members).toEqual(squad.members)
    expect(returned.personalSquad?.members.map(member => member.id)).toEqual(['personal:dead', 'personal:hurt'])
  })

  it('lets an arena trial capture the Town command checkpoint without the formal-mission troop handoff', () => {
    const h = fixture()
    Object.assign(h.player.shield, { reset: vi.fn() })
    const peaceful = cloneCareerProfile(h.read())
    delete peaceful.activeMission
    expect(h.store.save(peaceful)).toBe(true)
    h.publish(peaceful)
    const commanded = { type: 'town-command', squadId: 1, townFaction: 'roman', actorIds: ['patrol:1'], commandedActorIds: ['patrol:1'], contribution: emptyPersonalContribution(),
      sceneKey: 'town-home', state: 'TRAINING', authorized: true, members: { 'patrol:1': { status: 'deployed', order: 'defend' } } } as unknown as NonNullable<CareerProfile['townCommandSquad']>
    const stageMissionHandoff = vi.fn((p: CareerProfile) => ({ ...p, townCommandSquad: { ...commanded, authorized: false, state: 'RETURNING' as const } }))
    h.runtime.townCommand = { checkpoint: vi.fn(() => commanded), stageRefit: vi.fn(p => p), stageMissionHandoff,
      applySavedState: vi.fn(), grant: vi.fn() } as unknown as TownProfileCommitRuntime['townCommand']

    const trial = cloneCareerProfile(peaceful)
    trial.activeMission = createArenaTrialMission(peaceful, 1, 'roman-colosseum', 'trial-command')!
    expect(h.commit(trial)).toBe(true)
    expect(stageMissionHandoff).not.toHaveBeenCalled()
    expect(h.read().townCommandSquad).toMatchObject({ authorized: true, state: 'TRAINING', commandedActorIds: ['patrol:1'], members: { 'patrol:1': { order: 'defend' } } })

    // Control: any other formal mission still hands its troops over.
    const bandit = cloneCareerProfile(peaceful)
    bandit.activeMission = { ...createActiveCareerMission('recruit-bandits-01', 0, 1, 0, 'control'), kind: 'bandit' }
    h.publish(peaceful)
    expect(h.commit(bandit)).toBe(true)
    expect(stageMissionHandoff).toHaveBeenCalledTimes(1)
  })

  it('saves the accepted native body before a field transition and publishes nothing on a rejected write', () => {
    const h = fixture()
    const peaceful = cloneCareerProfile(h.read()); delete peaceful.activeMission
    expect(h.store.save(peaceful)).toBe(true); h.publish(peaceful)
    Object.assign(h.player.shield, { reset: vi.fn() })
    Object.assign(h.residentState, { dead: false, hp: 37, characterIdentity: { characterFaction: 'roman', characterTier: 2 } })
    const next = { ...peaceful, activeMission: { ...createActiveCareerMission('recruit-bandits-01', 0, 1, 0, 'accept-native'),
      friendlyActorIds: ['resident'] } }
    vi.spyOn(h.runtime.store, 'save').mockReturnValueOnce(false)
    expect(h.commit(next)).toBe(false)
    expect(h.read().activeMission).toBeUndefined()
    expect(next.activeMission).not.toHaveProperty('borrowedActorIdentities')
    expect(h.commit(next)).toBe(true)
    expect(h.store.load()!.activeMission!.borrowedActorIdentities).toEqual({ resident: { characterFaction: 'roman', characterTier: 2 } })
  })

  it('isolates the Commander defense roster staged by the real Town commit when saving fails', () => {
    const h = fixture()
    const peaceful = cloneCareerProfile(h.read()); delete peaceful.activeMission
    Object.assign(peaceful, careerRankFixture(peaceful.faction, 'commander'), { totalMerit: 20000, availableMerit: 20000 })
    expect(h.store.save(peaceful)).toBe(true); h.publish(peaceful)
    h.resident.spec = townCommanderSpec({ x: 2, z: 3, yaw: .5 })
    Object.assign(h.residentState, { dead: false, hp: 71, combatPosition: new Vector3(2, 0, 3), combatAmmo: 3,
      shield: { shieldImpactRemaining: 2, reset: vi.fn() } })
    Object.assign(h.player.shield, { reset: vi.fn() })
    h.runtime.careerMounts = { checkpoint: () => ({ hp: {}, unavailable: [] }) }
    const next = acceptCommanderMission(peaceful, COMMANDER_FOUR_GATE_DEFENSE_ID, 'accept-defense')!
    // The live service resident is opted in by TownProfileCommit before persistence.
    next.activeMission!.friendlyActorIds = next.activeMission!.friendlyActorIds.filter(id => id !== TOWN_COMMANDER_ID)
    const before = structuredClone(next), bytes = h.storage.getItem(CAREER_STORAGE_KEY)
    const write = vi.spyOn(h.runtime.store, 'save').mockReturnValueOnce(false)

    expect(h.commit(next)).toBe(false)
    expect(write).toHaveBeenCalledOnce()
    expect(write).toHaveBeenCalledWith(expect.objectContaining({
      activeMission: expect.objectContaining({ friendlyActorIds: expect.arrayContaining([TOWN_COMMANDER_ID]) }) }))
    expect(next).toEqual(before)
    expect(h.read()).toBe(peaceful)
    expect(h.storage.getItem(CAREER_STORAGE_KEY)).toBe(bytes)
  })

  it('saves and applies full player HP before reentrant completed-arrival handoffs without losing flight or other resources', () => {
    const h = fixture('bandit', true), player = h.player
    player.hp = 37; player.isFalling = true
    player.fallSnapshot = { active: true, highestFeetY: 100, velocity: { x: 1, y: -3, z: 2 } }
    h.read().racePlayerState = raceHealth(37)
    h.runtime.race = { session: undefined, capturePlayerState: () => ({ ...raceHealth(player.hp), dead: player.dead }) }
    const reenter = vi.fn().mockImplementationOnce(() => {
      expect(player.hp).toBe(437)
      expect(h.store.load()!.playerAerialState?.hp).toBe(437)
      expect(h.commit(h.read())).toBe(true)
    })
    h.runtime.synchronizeEaglePatrolPolicy = reenter
    h.storage.writable = false
    expect(h.settlement.returnToTown('arrived').status).toBe('save-failed')
    expect(player.hp).toBe(37)
    expect(player.setHp).not.toHaveBeenCalled()
    h.storage.writable = true
    expect(h.settlement.returnToTown('arrived').status).toBe('returned')
    const saved = h.store.load()!
    expect(saved.playerAerialState).toMatchObject({ hp: 437, dead: false, fall: player.fallSnapshot })
    expect(saved.racePlayerState).toEqual({ ...raceHealth(37), hp: 437 })
    expect(player.hp).toBe(437)
    expect(reenter).toHaveBeenCalledTimes(2)
    expect(h.player.resetForScene).not.toHaveBeenCalled()
  })

  it('saves a completed direct Veteran return without an old fall before resetting the live player', () => {
    const h = fixture('veteran-field', true), player = h.player
    player.hp = 0; player.dead = true; player.isFalling = true
    player.fallSnapshot = { active: true, highestFeetY: 100, velocity: { x: 1, y: -3, z: 2 } }
    h.read().activeMission!.result!.outcome = 'failure'
    h.read().racePlayerState = raceHealth(0)
    h.read().racePlayerState!.dead = true
    h.runtime.race = { session: undefined, capturePlayerState: () => ({ ...raceHealth(player.hp), dead: player.dead }) }
    const reenter = vi.fn().mockImplementationOnce(() => {
      expect(player.dead).toBe(false); expect(player.isFalling).toBe(false)
      expect(h.commit(h.read())).toBe(true)
    })
    h.runtime.synchronizeEaglePatrolPolicy = reenter
    expect(h.settlement.returnToTown('direct').status).toBe('returned')
    expect(h.store.load()!.playerAerialState).toBeUndefined()
    expect(h.store.load()!.racePlayerState).toMatchObject({ hp: 437, dead: false, mountHp: 43, stamina: 31 })
    expect(h.player.resetForScene).toHaveBeenCalledOnce()
    expect(h.events.indexOf('save')).toBeLessThan(h.events.indexOf('reset'))
  })

  it('keeps the owned horse available after Scout defeat without replaying its death from the previous race', () => {
    const h = fixture('veteran-field')
    const home = cloneCareerProfile(h.read())
    delete home.activeMission
    Object.assign(home, careerRankFixture(home.faction, 'veteran'));
    home.totalMerit = 900
    addCareerItem(home, 'horse', 1)
    home.racePlayerState = raceHealth(80)
    const accepted = acceptVeteranMission(home, 'veteran-tragedy-of-the-scouts', { missionId: 'scout-return' })!
    accepted.activeMission!.phase = 'ENGAGING'
    accepted.activeMission!.mountState = { activeMountId: 'horse', hp: { horse: 0 }, unavailable: ['horse'] }
    h.publish(accepted)
    Object.assign(h.runtime, { world: { faction: 'viking' }, sceneContext: { missionOnlyResidents: true } })
    Object.assign(h.player, { hp: 0, dead: true, facingYaw: 0, setStamina: vi.fn() })
    // Use the race controller's real capture and replay with data-only adapters.
    const restoreRaceMount = vi.fn()
    const battleMount = { currentHp: 0, armorImpactRemaining: 0,
      group: { position: new Vector3(301, 0, 307), rotation: { y: 0 } } }
    const mounts = { activeMountId: 'horse', activeMount: battleMount as typeof battleMount | null, restoreRaceMount }
    const race = new CareerRaceController(
      null!, null!, [], [], () => h.runtime.player!, null!,
      mounts as unknown as CareerMountController, h.read, h.commit,
    )
    h.runtime.race = race

    expect(h.settlement.finish('failure').status).toBe('saved')
    expect(h.store.load()!.racePlayerState).toMatchObject({ mountId: 'horse', mountHp: 0 })
    expect(h.settlement.returnToTown('direct').status).toBe('restarted')
    h.reload()
    mounts.activeMount = null
    race.restorePlayer({ preservePlacement: true })

    expect(restoreRaceMount).not.toHaveBeenCalled()
    expect(h.read().racePlayerState).toBeUndefined()
    const homeMounts = new CareerMountController(null!, () => h.runtime.player!, h.read, h.commit, () => [], () => [])
    expect(homeMounts.list()).toContainEqual(expect.objectContaining({ id: 'horse', allocated: true, available: true }))
  })

  it('preserves completed return recovery through rejected writes and a reentrant handoff save', () => {
    const h = fixture('bandit', true)
    h.resident.spec.id = 'merchant'; h.resident.spec.role = 'merchant'; h.resident.spec.duty = 'service'
    Object.assign(h.residentState, { hp: 9, maxHp: 100, combatPosition: h.residentState.group.position,
      combatAmmo: 1, combatAmmoCapacity: 20, shield: { shieldImpactRemaining: 3, shieldImpactMax: 40 },
      tacticalOrder: 'defend', setCommandAllegiance: vi.fn(), setCommandSquad: vi.fn(),
      setMissionCombatTarget: vi.fn(), assignSiegeObstacle: vi.fn(), clearEncounter: vi.fn(),
      releaseOutpostRampartGarrison: vi.fn(), disarmTownCivilian: vi.fn() })
    const stale = { type: 'civilian-command' as const, squadId: 'civilians' as const, townFaction: 'roman' as const,
      sceneKey: 'town:roman', actorIds: ['merchant'], owners: { merchant: 'player' as const },
      members: { merchant: { status: 'dead' as const, hp: 0 } } }
    h.read().civilianCommandSquad = structuredClone(stale)
    const apply = vi.fn().mockImplementationOnce(() => {
      expect(h.store.load()!.civilianCommandSquad!.members.merchant.hp).toBe(100)
      expect(h.commit(h.read())).toBe(true)
    })
    h.runtime.civilianCommand = { checkpoint: vi.fn(() => structuredClone(stale)), applySavedState: apply, synchronize: vi.fn() }
    const before = structuredClone(h.read())
    h.storage.writable = false
    expect(h.settlement.returnToTown('arrived').status).toBe('save-failed')
    expect(h.read()).toEqual(before); expect(apply).not.toHaveBeenCalled()
    expect(h.residentState.restoreForTown).not.toHaveBeenCalled()
    h.storage.writable = true
    expect(h.settlement.returnToTown('arrived').status).toBe('returned')
    expect(h.store.load()!.civilianCommandSquad).toMatchObject({ owners: { merchant: 'daily' },
      members: { merchant: { status: 'deployed', hp: 100, ammo: 20, shieldImpact: 40 } } })
    expect(h.runtime.civilianCommand.checkpoint).not.toHaveBeenCalled()
    expect(apply).toHaveBeenCalledTimes(2)
  })

  it('captures ordinary live casualties without applying completed-return recovery', () => {
    const h = fixture(), player = h.player
    player.hp = 37; player.isFalling = true
    player.fallSnapshot = { active: true, highestFeetY: 100, velocity: { x: 1, y: -3, z: 2 } }
    h.read().racePlayerState = raceHealth(37)
    const saved = { type: 'civilian-command' as const, squadId: 'civilians' as const, townFaction: 'roman' as const,
      sceneKey: 'town:roman', actorIds: ['merchant'], owners: { merchant: 'player' as const },
      members: { merchant: { status: 'deployed' as const, hp: 50 } } }
    h.read().civilianCommandSquad = saved
    const live = { ...saved, members: { merchant: { status: 'dead' as const, hp: 0 } } }
    h.runtime.civilianCommand = { checkpoint: () => live, applySavedState: vi.fn(), synchronize: vi.fn() }
    expect(h.commit(h.read())).toBe(true)
    expect(h.store.load()!.civilianCommandSquad).toMatchObject({ owners: { merchant: 'player' },
      members: { merchant: { status: 'dead', hp: 0 } } })
    expect(h.read().activeMission?.id).toBe('settlement')
    expect(player.hp).toBe(37)
    expect(player.setHp).not.toHaveBeenCalled()
    expect(h.store.load()!.playerAerialState?.hp).toBe(37)
    expect(h.store.load()!.racePlayerState?.hp).toBe(37)
    expect(h.runtime.residentReturnPending).toBe(false)
    expect(h.residentState.restoreForTown).not.toHaveBeenCalled()
  })

  it('restores a borrowed rampart training archer at its authored height and reactivates home duty after Duel return', () => {
    const h = fixture('duel', true)
    const spec = townStationSpec(townRoster().find(a => a.duty === 'training' && a.garrison?.kind === 'rampart')!, false, true)
    Object.assign(h.resident.spec, spec)
    h.read().activeMission!.duelOpponentActorId = spec.id
    // Plain reset ports only: execute the actual restoreForTown/respawn methods,
    // without constructing an NPC, rig, Object3D, material or scene.
    const body = Object.assign(h.residentState, {
      dead: false, isMounted: false, combatantId: spec.id, combatPosition: h.residentState.group.position,
      rangedWeaponId: undefined as string | undefined, hasActiveRangedWeapon: true,
      shield: { reset: vi.fn() }, weaponSweep: { reset: vi.fn() }, deathFade: { reset: vi.fn() },
      pendingFall: { clear: vi.fn() }, maxHp: 100, rig: {}, onRespawnCallbacks: [],
      swordPivot: { visible: false }, bowPivot: { visible: false }, alertSprite: { visible: false },
      _clearObstacleDetour: vi.fn(), _clearSiegeFallback: vi.fn(), _alignExternalVisualToMount: vi.fn(),
      _refreshActiveShield: vi.fn(), _cancelEquipmentCombatState: vi.fn(), animator: { cancel: vi.fn() },
      setTacticalOrder: vi.fn(), setTownPeaceful: vi.fn(), respawn: NPC.prototype.respawn,
      activateTownRampartGarrison: vi.fn(), restoreOrdinaryTier: vi.fn(),
    })
    Object.assign(body.group.rotation, { set(_x: number, y: number, _z: number) { body.group.rotation.y = y } })
    body.restoreCombatLoadout.mockImplementation(() => { body.rangedWeaponId = 'wooden_shortbow' })
    body.restoreForTown.mockImplementation(destination => NPC.prototype.restoreForTown.call(h.resident.npc, destination))
    expect(h.settlement.returnToTown('arrived')).toEqual({ status: 'returned', kind: 'party' })
    expect(body.combatPosition.toArray()).toEqual([spec.x, spec.y, spec.z])
    expect(body.combatPosition.y).toBeGreaterThan(getTerrainHeight(spec.x, spec.z) + 5)
    expect(body.activateTownRampartGarrison).toHaveBeenCalledOnce()
    expect(body.restoreOrdinaryTier).toHaveBeenCalledOnce()
    expect(h.resident.spec).toMatchObject({ id: spec.id, duty: 'training', garrison: spec.garrison })
    expect(h.read().activeMission).toBeUndefined()
  })

  function duelStandby(): PersonalSquadMission {
    return { squadId: 'personal', sceneKey: 'town-home', state: 'RESERVE', memberIds: ['personal:wounded', 'personal:dead'],
      contribution: emptyPersonalContribution(), members: {
        'personal:wounded': { status: 'deployed', hp: 12, ammo: 3, order: 'defend', position: { x: -75, y: 2.1, z: 20, yaw: 0 },
          mount: { hp: 40, mounted: true, position: { x: -75, y: 2.1, z: 20, yaw: 0 } } },
        'personal:dead': { status: 'dead', hp: 0 } } }
  }

  it('keeps the unengaged private HR standby through Duel acceptance and restores its wounds, casualty and mount unchanged in place', () => {
    const h = fixture()
    Object.assign(h.player.shield, { reset: vi.fn() })
    const peaceful = cloneCareerProfile(h.read())
    delete peaceful.activeMission
    peaceful.personalSquad = personalSquadFixture(peaceful, [{ id: 'personal:wounded', type: 'soldier' }, { id: 'personal:dead', type: 'soldier' }])
    expect(h.store.save(peaceful)).toBe(true)
    h.publish(peaceful)
    const live = duelStandby()
    const squad = { sceneKey: 'town-home', checkpoint: vi.fn(() => structuredClone(live)), cleanup: vi.fn(),
      beginMission: vi.fn(), captureForNewMission: vi.fn(), regroupAfterMission: vi.fn() }
    h.runtime.personalSquad = squad
    const accepted = cloneCareerProfile(peaceful)
    accepted.activeMission = createCareerDuelMission(accepted, 'roman_archer', 1, 'resident', 'captain', 'test:duel')!
    expect(h.commit(accepted)).toBe(true)
    let stored = h.store.loadChecked().profile!
    // The squad is not taken into the duel, but its Town checkpoint survives acceptance.
    expect(stored.activeMission?.personalSquad).toBeUndefined()
    expect(stored.personalSquadRuntime).toEqual(live)
    expect(squad.cleanup).toHaveBeenCalledOnce()
    expect(squad.captureForNewMission).not.toHaveBeenCalled()
    expect(squad.beginMission).not.toHaveBeenCalled()
    const finished = claimCareerMission(h.read(), h.read().activeMission!.id, 'victory', h.stats).profile
    finished.activeMission!.phase = 'RETURNING'
    h.publish(finished)
    const restorePersonalSquad = vi.fn()
    Object.assign(h.town, { restorePersonalSquad })
    expect(h.settlement.returnToTown('arrived')).toEqual({ status: 'returned', kind: 'party' })
    stored = h.store.loadChecked().profile!
    expect(stored.activeMission).toBeUndefined()
    expect(stored.personalSquadRuntime).toEqual(live)
    expect(h.town.returnPersonalSquad).toHaveBeenCalledExactlyOnceWith(false)
    expect(restorePersonalSquad).toHaveBeenCalledExactlyOnceWith(live)
  })

  it('keeps the private HR standby checkpoint for the rebuilt Town after a direct Duel return', () => {
    const h = fixture('duel', true)
    const live = duelStandby()
    h.read().personalSquad = personalSquadFixture(h.read(), [{ id: 'personal:wounded', type: 'soldier' }, { id: 'personal:dead', type: 'soldier' }])
    h.read().personalSquadRuntime = structuredClone(live)
    const restorePersonalSquad = vi.fn()
    Object.assign(h.town, { restorePersonalSquad })
    expect(h.settlement.returnToTown('direct')).toEqual({ status: 'restarted' })
    expect(h.store.loadChecked().profile!.personalSquadRuntime).toEqual(live)
    expect(h.town.restart).toHaveBeenCalledWith(expect.objectContaining({ personalSquadRuntime: live }))
    expect(restorePersonalSquad).not.toHaveBeenCalled()
  })

  function commanderVHomeReturnFixture() {
    const h = fixture('commander-four-gate-defense', true), profile = h.read()
    Object.assign(profile, careerRankFixture(profile.faction, 'commander')); profile.totalMerit = 20000
    profile.racePlayerState = raceHealth(23)
    profile.personalSquad = personalSquadFixture(profile, [{ id: 'personal:dead', type: 'soldier' }])
    profile.activeMission!.personalSquad = snapshotPersonalMission(profile)!
    profile.activeMission!.personalSquad!.members['personal:dead'] = { status: 'dead', hp: 0 }
    const civilians = townRosterIdentity().filter(spec => spec.role === 'civilian' || spec.role === 'merchant').map(spec => spec.id)
    profile.civilianCommandSquad = { type: 'civilian-command', squadId: 'civilians', townFaction: 'roman', sceneKey: 'town:roman',
      missionId: profile.activeMission!.id, actorIds: civilians,
      owners: Object.fromEntries(civilians.map(id => [id, 'player' as const])),
      members: Object.fromEntries(civilians.map(id => [id, { status: 'dead' as const, hp: 0 }])) }
    const services = ['commander', 'hr-officer', 'eagle-trainer', 'captain', 'horse-vendor']
    profile.townCommandSquad = { type: 'town-command', townFaction: 'roman', sceneKey: 'town-home', squadId: 1,
      commandRank: 'commander', actorIds: ['resident', ...services], squads: [{ squadId: 1, actorIds: ['resident', ...services] }],
      commandedActorIds: [...services], nativeReturnStates: { resident: 'REFIT' }, state: 'FOLLOWING', authorized: true,
      contribution: emptyPersonalContribution(), members: Object.fromEntries(['resident', ...services].map(id => [id,
        { status: 'dead' as const, hp: 0, position: { x: 500, z: 500, yaw: 1 } }])) }
    profile.townEagleGarrisons = { roman: { version: 1, sceneKey: 'town:roman', pairs: [] } }
    profile.mountArmor = { 'armored-horse': 0, 'snow-leopard': 0 }
    h.town.preservesResident.mockReturnValue(true)
    h.storage.setItem(CAREER_STORAGE_KEY, JSON.stringify(profile))
    return h
  }

  it('leaves Commander V storage and runtime untouched when the home return save fails', () => {
    const h = commanderVHomeReturnFixture()
    const beforeReturn = h.storage.getItem(CAREER_STORAGE_KEY)
    // The real mount controller is rested only through Town rest; a failed save must not reach it.
    // No scene or Player is created: restInTown only reads the profile and commits through these ports.
    type MountPorts = ConstructorParameters<typeof CareerMountController>
    const mounts = new CareerMountController({} as MountPorts[0], () => h.player as unknown as ReturnType<MountPorts[1]>,
      () => h.read(), next => h.commit(next), () => [], () => [])
    h.town.restPlayer = vi.fn((options?: { persistMount?: boolean }) => mounts.restInTown({ persist: options?.persistMount ?? false }))
    h.storage.writable = false
    expect(h.settlement.returnToTown('direct')).toEqual({ status: 'save-failed', destination: 'restart' })
    expect(h.events).toEqual(['save'])
    expect(h.town.restart).not.toHaveBeenCalled()
    expect(h.town.restPlayer).not.toHaveBeenCalled()
    expect(h.read().mountArmor).toEqual({ 'armored-horse': 0, 'snow-leopard': 0 })
    expect(mounts.checkpoint()?.armorImpact).toEqual({ 'armored-horse': 0, 'snow-leopard': 0 })
    expect(h.storage.getItem(CAREER_STORAGE_KEY)).toBe(beforeReturn)
  })

  it('atomically rebuilds Commander V at home without replaying four-gate checkpoints or rewards', () => {
    const h = commanderVHomeReturnFixture()
    expect(h.settlement.returnToTown('direct').status).toBe('restarted')
    expect(h.events).toEqual(['save', 'defense-cleanup'])
    expect(h.town.restart).toHaveBeenCalledExactlyOnceWith(h.read())
    expect(h.town.restPlayer).toHaveBeenCalledOnce()
    h.reload()
    const saved = h.read()
    expect(saved.activeMission).toBeUndefined()
    expect(saved.mountArmor).toBeUndefined()
    const warhorse = new MountArmor('ARMORED_HORSE')
    warhorse.restore(saved.mountArmor?.['armored-horse'])
    expect(warhorse.remaining).toBe(50)
    expect(saved.racePlayerState).toBeUndefined()
    expect(saved.civilianCommandSquad?.actorIds).toHaveLength(21)
    expect(new Set(Object.values(saved.civilianCommandSquad!.owners))).toEqual(new Set(['daily']))
    expect(saved.civilianCommandSquad?.members.merchant).toEqual({ status: 'deployed', order: 'attack' })
    expect(saved.townCommandSquad?.members?.resident).toEqual({ status: 'reserve' })
    for (const id of ['commander', 'hr-officer', 'eagle-trainer', 'captain'])
      expect(saved.townCommandSquad?.members?.[id]).toEqual({ status: 'reserve', order: 'attack' })
    expect(saved.townCommandSquad?.nativeReturnStates).toBeUndefined()
    expect(saved.townCommandSquad?.commandedActorIds).toEqual([])
    expect(saved.townCommandSquad?.state).toBe('TRAINING')
    expect(saved.townEagleGarrisons?.roman).toBeUndefined()
    expect(saved.personalSquadRuntime?.members['personal:dead']).toEqual({ status: 'reserve' })
    expect(h.residentState.restoreForTown).not.toHaveBeenCalled()
    const merit = saved.totalMerit
    const savedBytes = h.storage.getItem(CAREER_STORAGE_KEY)
    expect(h.settlement.returnToTown('direct').status).toBe('ignored')
    expect(h.read().totalMerit).toBe(merit)
    expect(h.storage.getItem(CAREER_STORAGE_KEY)).toBe(savedBytes)
    expect(h.town.beginPatrolMissionReturn).not.toHaveBeenCalled()
  })

  it('preserves merchant native equipment and its purchased horse through completed return staging', () => {
    const h = fixture('commander-four-gate-defense', true), profile = h.read()
    Object.assign(profile, careerRankFixture(profile.faction, 'commander')); profile.totalMerit = 20000
    addCareerItem(profile, 'horse', 1)
    const refs = resolveTownActorEquipment(profile, 'roman', 'merchant').refs
    profile.townEquipment = { roman: { version: 2, nativeReserve: [],
      actors: { merchant: { ...refs, mount: { itemId: 'horse', source: 'inventory' } } } } }
    const equipment = structuredClone(profile.townEquipment)
    // Settlement owns preserving staged data. Inventory/parser transactions are
    // covered by CareerTownEquipment; keep only the commit boundary here.
    h.commit.mockImplementation(next => { h.publish(next); return true })
    expect(h.settlement.returnToTown('direct').status).toBe('restarted')
    expect(h.read().townEquipment).toEqual(equipment)
    expect(h.read().inventory?.quantities.horse).toBe(1)
    expect(h.town.restart).toHaveBeenCalledExactlyOnceWith(h.read())
    expect(profile.townEquipment).toEqual(equipment)
  })

  it('freezes the first personal result across a failed-save retry instead of appending later contribution', () => {
    const h = fixture()
    h.read().personalSquad = personalSquadFixture(h.read(), [{ id: 'personal:credited', type: 'soldier' }])
    h.read().activeMission!.personalSquad = snapshotPersonalMission(h.read())!
    const initial = { player: { ...h.stats }, squads: [], meritPlayer: { ...h.stats, damageDealt: 500, kills: 5 } }
    h.field.snapshot.mockReturnValue(initial)
    h.storage.writable = false
    expect(h.settlement.finish('victory').status).toBe('save-failed')
    initial.meritPlayer.damageDealt = 99999
    h.storage.writable = true
    expect(h.settlement.finish('failure').status).toBe('saved')
    expect(h.field.snapshot).toHaveBeenCalledOnce()
    expect(h.read().activeMission!.result).toMatchObject({ outcome: 'victory', stats: { damageDealt: 200 }, meritStats: { damageDealt: 500, kills: 5 } })
  })

  it('atomically captures Commander V final casualties and grants defense merit and Tier 5 completion once after retry', () => {
    const h = fixture('commander-four-gate-defense'), before = h.read(), active = before.activeMission!
    const missionId = active.id, templateId = active.templateId, lastTargetId = active.targetActorIds.find(id => id.endsWith(':lancer:t4:leader'))!
    expect(active.targetActorIds).toHaveLength(280)
    // The durable frame has 279 deaths. Only the controller boundary knows the final contact.
    fourGateCasualties(active, active.targetActorIds.filter(id => id !== lastTargetId))
    h.storage.setItem(CAREER_STORAGE_KEY, JSON.stringify(before))
    const savedBefore = h.storage.getItem(CAREER_STORAGE_KEY), latest = structuredClone(active)
    fourGateCasualties(latest, latest.targetActorIds)
    latest.deadCivilianActorIds = [...latest.civilianActorIds!]
    for (const id of latest.deadCivilianActorIds) Object.assign(latest.fourGateDefense!.actors[id], { status: 'dead', hp: 0 })
    h.defense.civilianDeaths = 20; h.defense.civilianSurvived = 0
    latest.fourGateDefense!.actors[lastTargetId].mount!.hp = 22
    latest.fourGateDefense!.player!.hp = 57
    latest.playerHp = 57
    latest.fourGateDefense!.siege!.gates[0].hp = 400
    h.defense.snapshotActiveMission.mockReturnValue(latest)
    Object.assign(h.stats, { structureDamage: 900, structuresDestroyed: 1, gateBreaches: 1, survived: true })
    const beforeMerit = before.totalMerit, beforeAvailable = before.availableMerit
    const beforeTier5 = before.careerMissionCompletionsByTier?.[5] ?? 0
    // Inject the transaction-port rejection here; storage transport failure has
    // its own owner coverage. The successful retry still writes the complete final
    // checkpoint through the real store (whose save parses it); the survival case
    // below owns reloading a four-gate RESULT, so this one reads the durable bytes.
    h.commit.mockImplementationOnce(() => false)
    expect(h.settlement.finish('victory')).toEqual({ status: 'save-failed' })
    expect(h.read()).toBe(before)
    expect(h.read().activeMission!.result).toBeUndefined()
    expect(h.read().activeMission!.deadTargetActorIds).toHaveLength(279)
    expect(h.read().activeMission!.fourGateDefense!.phase).toBe('ATTACKING')
    expect(h.read().claimedBattleIds).not.toContain(missionId)
    expect(h.storage.getItem(CAREER_STORAGE_KEY)).toBe(savedBefore)
    expect(latest.fourGateDefense!.phase).toBe('ATTACKING')
    expect(h.defense.cleanupMission).not.toHaveBeenCalled()
    expect(h.settlement.finish('victory').status).toBe('saved')
    const savedBytes = h.storage.getItem(CAREER_STORAGE_KEY)!
    const saved = JSON.parse(savedBytes) as CareerProfile, result = saved.activeMission!.result!
    expect(saved.activeMission!.deadTargetActorIds).toHaveLength(280)
    expect(saved.activeMission!.deadTargetActorIds).toContain(lastTargetId)
    expect(saved.activeMission).toMatchObject({ phase: 'RESULT',
      fourGateDefense: { phase: 'RESULT', attackStarted: true, actors: { [lastTargetId]: { status: 'dead', hp: 0, mount: { hp: 22, mounted: false } } },
        player: { hp: 57 } } })
    expect(saved.activeMission!.fourGateDefense!.siege!.gates[0].hp).toBe(400)
    // Defense: 200 / 20 damage + 2 * 8 kills + 80 victory + 20 survival, no structure/breach bonus.
    expect(result).toMatchObject({ outcome: 'victory', merit: { damage: 10, kills: 16, contribution: 100, total: 126 },
      defense: { civilianSurvived: 0, civilianDeaths: 20 }, stats: { structureDamage: 900, gateBreaches: 1 } })
    expect(saved.totalMerit).toBe(beforeMerit + 126)
    expect(saved.availableMerit).toBe(beforeAvailable + 126)
    expect(saved.careerMissionCompletionsByTier?.[5]).toBe(beforeTier5 + 1)
    expect(saved.completedCareerMissionTemplateIds?.filter(id => id === templateId)).toEqual([templateId])
    expect(saved.claimedBattleIds.filter(id => id === missionId)).toEqual([missionId])
    expect(saved.lifetimeStats).toMatchObject({ battles: 1, victories: 1, deaths: 0 })
    const published = h.read()
    expect(published.claimedBattleIds.filter(id => id === missionId)).toEqual([missionId])
    expect(h.settlement.finish('victory')).toEqual({ status: 'ignored' })
    expect(h.read()).toBe(published)
    expect(h.storage.getItem(CAREER_STORAGE_KEY)).toBe(savedBytes)
    expect(h.defense.snapshotActiveMission).toHaveBeenCalledTimes(2)
    expect(h.commit).toHaveBeenCalledTimes(2)
  })

  it('persists a survival victory at the configured deadline with live enemy air and actual merit once after a rejected commit', () => {
    const h = fixture('commander-four-gate-defense'), before = h.read(), latest = structuredClone(before.activeMission!)
    latest.fourGateDefense!.combatElapsedSeconds = survivalSeconds
    latest.fourGateDefense!.victoryReason = 'survival'
    h.defense.snapshotActiveMission.mockReturnValue(latest)
    Object.assign(h.stats, { damageDealt: 0, kills: 0, survived: true })
    h.commit.mockImplementationOnce(() => false)
    expect(h.settlement.finish('victory')).toEqual({ status: 'save-failed' })
    expect(h.read()).toBe(before)
    expect(h.read().claimedBattleIds).not.toContain(latest.id)
    expect(h.defense.cleanupMission).not.toHaveBeenCalled()
    expect(h.settlement.finish('victory').status).toBe('saved')
    h.reload()
    const saved = h.read(), active = saved.activeMission!
    expect(active.fourGateDefense).toMatchObject({ phase: 'RESULT', combatElapsedSeconds: survivalSeconds, victoryReason: 'survival' })
    expect(active.deadTargetActorIds ?? []).toHaveLength(0)
    expect(active.fourGateDefense!.actors[active.targetActorIds[229]]).toMatchObject({ status: 'deployed' })
    expect(active.result).toMatchObject({ outcome: 'victory', stats: { kills: 0 },
      merit: { damage: 0, kills: 0, contribution: 100, total: 100 } })
    expect(saved.claimedBattleIds.filter(id => id === latest.id)).toEqual([latest.id])
    expect(h.settlement.finish('victory')).toEqual({ status: 'ignored' })
  })

  it('keeps borrowed ownership and live state untouched when saving the return fails', () => {
    const h = fixture('captain-patrol-command', true)
    h.storage.writable = false
    expect(h.settlement.returnToTown('direct')).toEqual({ status: 'save-failed', destination: 'party' })
    expect(h.read().activeMission).toBeDefined()
    expect(h.patrol.release).not.toHaveBeenCalled()
    expect(h.town.returnPersonalSquad).not.toHaveBeenCalled()
    expect(h.player.resetForScene).not.toHaveBeenCalled()
    expect(h.town.restPlayer).not.toHaveBeenCalled()
  })

  it('preserves dismissed HR wounds on Captain I arrival and places the player at the Sergeant without awarding merit', () => {
    const h = fixture('captain-patrol-command', true), profile = h.read()
    profile.personalSquad = personalSquadFixture(profile, [{ id: 'personal:wounded', type: 'soldier' }, { id: 'personal:dead', type: 'soldier' }])
    const standby = duelStandby()
    profile.activeMission!.personalSquad = structuredClone(standby)
    const merit = profile.totalMerit
    const returnPoint = { x: 60, y: 12, z: 34, yaw: Math.PI }
    Object.assign(h.town, { resolveSergeantReturnPoint: () => returnPoint })
    expect(h.settlement.returnToTown('arrived')).toEqual({ status: 'returned', kind: 'party' })
    const stored = h.store.loadChecked().profile!
    expect(stored.activeMission).toBeUndefined()
    expect(stored.personalSquadRuntime).toEqual(standby)
    expect(stored.personalSquadRuntime?.returnToHR).toBeUndefined()
    expect(stored.totalMerit).toBe(merit)
    expect(stored.personalSquad?.members.map(({ id }) => id)).toEqual(['personal:wounded', 'personal:dead'])
    expect(h.player.standOn).toHaveBeenCalledExactlyOnceWith(60, 12, 34)
    expect(h.player.group.position).toEqual(new Vector3(60, standingPlayerY(12), 34))
    expect(h.player.group.rotation.y).toBe(Math.PI)
    expect(h.patrol.release).toHaveBeenCalledOnce()
    expect(h.player.resetForScene).not.toHaveBeenCalled()
    expect(h.town.returnPersonalSquad).toHaveBeenCalledExactlyOnceWith(false)
    expect(h.town.restart).not.toHaveBeenCalled()
    expect(h.settlement.returnToTown('arrived')).toEqual({ status: 'ignored' })
    expect(h.commit).toHaveBeenCalledOnce()
    expect(h.read().totalMerit).toBe(merit)
  })

  it('keeps private wounds on a direct same-scene Veteran return: in place, not travel, decides the refit', () => {
    const h = fixture('veteran-field', true), profile = h.read()
    profile.personalSquad = personalSquadFixture(profile, [{ id: 'personal:wounded', type: 'soldier' }, { id: 'personal:dead', type: 'soldier' }])
    profile.activeMission!.personalSquad = snapshotPersonalMission(profile)!
    profile.activeMission!.personalSquad!.state = 'ACTIVE'
    profile.activeMission!.personalSquad!.members['personal:wounded'] = { status: 'deployed', hp: 9, ammo: 0 }
    profile.activeMission!.personalSquad!.members['personal:dead'] = { status: 'dead', hp: 0 }
    expect(h.settlement.returnToTown('direct')).toMatchObject({ status: 'returned' })
    expect(h.store.loadChecked().profile!.personalSquadRuntime?.members).toMatchObject({
      'personal:wounded': { status: 'deployed', hp: 9, ammo: 0 }, 'personal:dead': { status: 'dead', hp: 0 } })
    expect(h.town.returnPersonalSquad).toHaveBeenCalledExactlyOnceWith(false)
    expect(h.town.restart).not.toHaveBeenCalled()
  })

  it('commits a grounded Captain return before resetting the airborne player and releasing the patrol once', () => {
    const h = fixture('captain-patrol-command', true)
    h.read().playerAerialState = { sceneKey: 'town-home', hp: 100, dead: false, position: { x: 50, y: 80, z: 70, yaw: 0 },
      fall: { active: true, highestFeetY: 100, velocity: { x: 0, y: -10, z: 0 } } }
    expect(h.settlement.returnToTown('direct')).toEqual({ status: 'returned', kind: 'party' })
    expect(h.events).toEqual(['save', 'reset', 'release'])
    expect(h.read().playerAerialState).toBeUndefined()
    expect(h.read().activeMission).toBeUndefined()
    expect(h.residentState.restoreForTown).not.toHaveBeenCalled()
    expect(h.settlement.returnToTown('direct')).toEqual({ status: 'ignored' })
    expect(h.patrol.release).toHaveBeenCalledOnce()
  })

  it('rebuilds Commander defense only after saving instead of partially repairing the outgoing scene', () => {
    const h = fixture('commander-four-gate-defense', true)
    expect(h.settlement.returnToTown('direct')).toEqual({ status: 'restarted' })
    expect(h.events).toEqual(['save', 'defense-cleanup'])
    expect(h.read().activeMission).toBeUndefined()
    expect(h.town.restart).toHaveBeenCalledExactlyOnceWith(h.read())
    expect(h.town.navigation.sync).not.toHaveBeenCalled()
  })

  it('cannot abandon an unfinished Veteran battle through direct return', () => {
    const h = fixture('veteran-field')
    h.read().mountArmor = { 'armored-horse': 0 }
    h.player.hp = 37
    expect(h.settlement.returnToTown('direct')).toEqual({ status: 'ignored' })
    expect(h.player.hp).toBe(37)
    expect(h.player.setHp).not.toHaveBeenCalled()
    expect(h.player.resetForScene).not.toHaveBeenCalled()
    expect(h.town.restPlayer).not.toHaveBeenCalled()
    expect(h.read().activeMission).toBeDefined()
    expect(h.read().mountArmor).toEqual({ 'armored-horse': 0 })
    expect(h.commit).not.toHaveBeenCalled()
    expect(h.field.cleanupMission).not.toHaveBeenCalled()
  })

  it('hands a borrowed patrol member to its native return owner only after clearing the saved mission', () => {
    const h = fixture('veteran-field', true)
    Object.assign(h.resident.spec, { duty: 'patrol' })
    expect(h.settlement.returnToTown('arrived')).toEqual({ status: 'returned', kind: 'party' })
    expect(h.events).toEqual(['save', 'cleanup', 'native-return'])
    expect(h.town.beginPatrolMissionReturn).toHaveBeenCalledExactlyOnceWith('resident')
    expect(h.residentState.restoreForTown).not.toHaveBeenCalled()
  })

  it('makes completed return the single durable authority for mount armor', () => {
    const h = fixture('commander-four-gate-defense', true)
    h.read().mountArmor = { 'armored-horse': 0 }
    h.read().playerAerialState = {
      sceneKey: 'town-home', hp: 77, dead: false, position: { x: 50, y: 80, z: 70, yaw: 0 },
    }
    h.runtime.townCommand = {
      checkpoint: vi.fn(() => ({ commandedActorIds: ['stale-actor-id'], squads: [] })) as unknown as NonNullable<TownProfileCommitRuntime['townCommand']>['checkpoint'],
      stageRefit: vi.fn(p => p),
      stageMissionHandoff: vi.fn(p => p),
      applySavedState: vi.fn(),
      grant: vi.fn(),
    }
    h.runtime.player = {
      ...h.player,
      hp: 77,
      staminaValue: 10,
      dead: false,
    } as unknown as NonNullable<TownProfileCommitRuntime['player']>

    const careerMounts = new CareerMountController(
      {} as any,
      () => h.player as unknown as any,
      () => h.read(),
      next => h.commit(next),
      () => [],
      () => [],
    )
    expect(careerMounts.checkpoint()?.armorImpact).toEqual({ 'armored-horse': 0 })

    h.town.restPlayer = vi.fn((options?: { persistMount?: boolean }) => {
      careerMounts.restInTown({ persist: options?.persistMount ?? false })
    })

    expect(h.settlement.returnToTown('direct')).toEqual({ status: 'restarted' })
    expect(h.commit).toHaveBeenCalledTimes(1)
    expect(h.town.restPlayer).toHaveBeenCalledOnce()
    expect(h.town.restart).toHaveBeenCalledOnce()

    const saved = h.store.load()!
    expect(saved.mountArmor).toBeUndefined()
    expect(saved.activeMission).toBeUndefined()
    expect(saved.playerAerialState).toBeUndefined()
    expect(saved.townCommandSquad?.commandedActorIds ?? []).not.toContain('stale-actor-id')
    expect(careerMounts.checkpoint()?.armorImpact).toBeUndefined()
    // Save failure on the same Commander V return is owned by the home-return failure case above.
  })

  it('places a completed Captain I walk-back on the Sergeant’s floor only after saving', () => {
    const h = fixture('captain-patrol-command', true)
    const entry = { x: 60, y: 4, z: 1.5, yaw: Math.PI }
    Object.assign(h.town, { resolveSergeantReturnPoint: vi.fn(() => entry) })
    expect(h.read().activeMission!.phase).toBe('RETURNING')
    h.storage.writable = false
    expect(h.settlement.returnToTown('arrived').status).toBe('save-failed')
    expect(h.player.group.position.x).toBe(50)
    h.storage.writable = true
    expect(h.settlement.returnToTown('arrived').status).toBe('returned')
    expect(h.player.group.position.x).toBe(entry.x)
    expect(h.player.group.position.z).toBe(entry.z)
    expect(h.player.standOn).toHaveBeenCalledWith(entry.x, entry.y, entry.z)
    expect(h.player.group.rotation.y).toBe(entry.yaw)
  })

  it('keeps the player on the current legal spot when no Sergeant or backup point is legal', () => {
    const settled = fixture('captain-patrol-command', true)
    Object.assign(settled.town, { resolveSergeantReturnPoint: vi.fn(() => null) })
    expect(settled.settlement.returnToTown('arrived').status).toBe('returned')
    expect(settled.player.group.position.toArray()).toEqual([50, 80, 70])

    const grounded = fixture('veteran-field', true)
    grounded.player.hp = 0; grounded.player.dead = true
    grounded.runtime.resolveSergeantReturnPoint = vi.fn(() => null)
    Object.assign(grounded.town, { resolveSergeantReturnPoint: grounded.runtime.resolveSergeantReturnPoint })
    expect(grounded.settlement.returnToTown('direct').status).toBe('returned')
    expect(grounded.player.resetForScene).toHaveBeenCalledWith(50, 80, 70)
    expect(grounded.player.group.position.toArray()).toEqual([50, 80, 70])
  })
})
