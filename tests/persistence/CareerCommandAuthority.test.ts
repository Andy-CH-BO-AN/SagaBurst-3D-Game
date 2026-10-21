import { officialCommandHudLabel, resolveCommanderTownTargetLabel } from '../../src/career/CommanderTownSquadLabels'
import { commanderGateDefenseSlots } from '../../src/career/CommanderTownRoster'
import { careerCommandHudRoster } from '../../src/career/CareerCommandHudRoster'
import { TownAirCommandSquadController } from '../../src/town/TownAirCommandSquadController'
import { TOWN_AUTONOMOUS_GUARD_IDS } from '../../src/town/TownNativeGuardIdentity'
import { Vector3 } from 'three'
import type { Player } from '../../src/player/Player'
import { CivilianCommandSquadController, type CivilianCommandResident } from '../../src/town/CivilianCommandSquadController'
import { civilianCommandRoster } from '../../src/career/CivilianCommandAuthority'
import { townRoster } from '../../src/town/TownRules'
import { describe,expect,it } from 'vitest'
import type { OfficialCommandAuthority } from '../../src/career/CareerCommandAuthority'
import { cloneOfficialCommandAuthority,createMissionCommandAuthority,officialActorSquadId,officialCommandAcceptsActor,officialCommandIsPlayerControlled,officialCommandSquads,officialMissionSourcePolicy,parseOfficialCommandAuthority,parseTownCommandSquad,townCommandIsPlayerControlled } from '../../src/career/CareerCommandAuthority'
import { createActiveCareerMission } from '../../src/career/CareerMissionState'
import { acceptCareerOutpost,acceptCareerOutpostRelief } from '../../src/career/CareerOutpostMission'
import { cloneCareerProfile,createCareerProfile } from '../../src/career/CareerProfile'
import { CAREER_STORAGE_KEY,CareerProfileStore } from '../../src/career/CareerProfileStore'
import type { CombatActorRef } from '../../src/combat/CombatAttribution'
import { emptyPersonalContribution } from '../../src/combat/CommandMerit'
import { Faction } from '../../src/world/NPC'
import { MemoryStorage } from '../helpers/memoryStorage'
import { isTownCommandRevokedByRetirement, revokeRetirementTownCommandClaims } from '../../src/career/CareerRetirementCommand'
import { snapshotPersonalMission } from '../../src/career/CareerPersonalSquadMission'

describe('Saved official command membership', () => {
  it('round-trips returning town members without refilling wounds or dead mounts', () => {
    const saved = { type: 'town-command', townFaction: 'roman', squadId: 1, actorIds: ['town:training:0'],
      state: 'RETURNING', authorized: false, sceneKey: 'enemy-outskirts', contribution: emptyPersonalContribution(),
      members: { 'town:training:0': { status: 'deployed', hp: 13, ammo: 2, shieldImpact: 4, order: 'formation',
        position: { x: 10, y: 2, z: 20, yaw: 1 },
        mount: { hp: 0, mounted: false, position: { x: 9, y: 2, z: 20, yaw: 1 } },
        formation: { commandId: -20, position: { x: 0, y: 1, z: 0, yaw: 0 }, reached: false } } } }
    expect(parseTownCommandSquad(JSON.parse(JSON.stringify(saved)))).toEqual(saved)
  })

  it('fails closed on duplicate or invalid authoritative IDs rather than granting current soldiers', () => {
    const base = { type: 'mission-official', missionId: 'mission', townFaction: 'viking', squadId: 1,
      actorIds: ['accepted'], contribution: emptyPersonalContribution() }
    expect(parseOfficialCommandAuthority({ ...base, actorIds: ['accepted', 'accepted'] })).toBeUndefined()
    expect(parseOfficialCommandAuthority({ ...base, actorIds: [''] })).toBeUndefined()
    const policy = officialMissionSourcePolicy(parseOfficialCommandAuthority(base)!)
    const source: CombatActorRef = { actorId: 'accepted', actorType: 'npc', allegiance: Faction.TOWN,
      characterFaction: 'viking', squadId: 1 }
    expect(policy(source)).toBe(true)
    expect(policy({ ...source, actorId: 'new-replacement' })).toBe(false)
    expect(policy({ ...source, squadId: 'personal', ownership: 'player-personal' })).toBe(false)
    expect(policy({ ...source, actorType: 'player' })).toBe(false)
  })
})

function commanderAuthority(): OfficialCommandAuthority {
  return createMissionCommandAuthority('army-save', 'roman', 'commander', ['north'], [
    { squadId: 1, actorIds: ['north'] }, { squadId: 2, actorIds: ['south', 'pending'] },
  ])
}

describe('Commander saved command grant', () => {
  it('migrates the authored peaceful army by actor identity and releases old air claims without healing or resetting cooldowns', () => {
    const profile = createCareerProfile('roman')
    profile.rank = 'commander'; profile.totalMerit = 20000
    const squads = commanderGateDefenseSlots(undefined, 1), actorIds = squads.flatMap(squad => squad.actorIds)
    profile.townCommandSquad = { type: 'town-command', townFaction: 'roman', squadId: 1, commandRank: 'commander', squads,
      actorIds, commandedActorIds: ['captain', 'town-eagle-rider:1'], contribution: emptyPersonalContribution(),
      authorized: true, state: 'FOLLOWING', sceneKey: 'town-home', members: {
        captain: { status: 'deployed', hp: 17, order: 'follow' },
        'town-eagle-rider:1': { status: 'dead', hp: 0, ammo: 2, position: { x: -90, y: 10, z: -75, yaw: 0 },
          mount: { hp: 11, mounted: false, position: { x: -91, y: 10, z: -76, yaw: 0 } } },
      } }
    const storage = new MemoryStorage(), store = new CareerProfileStore(storage)
    storage.setItem(CAREER_STORAGE_KEY, JSON.stringify(profile))
    const loaded = store.load()!, town = loaded.townCommandSquad!
    expect(town.squads!.map(squad => squad.actorIds.length)).toEqual([26, 26, 26, 26, 25, 26, 25, 26])
    expect(town.actorIds).toHaveLength(206)
    expect(officialActorSquadId(town, 'captain')).toBe(6)
    expect(officialActorSquadId(town, 'hr-officer')).toBe(8)
    expect(town.commandedActorIds).toEqual(['captain'])
    expect(town.members!.captain).toEqual({ status: 'deployed', hp: 17, order: 'follow' })
    const native = loaded.townEagleGarrisons!.roman!
    expect(native.pairs[0]).toMatchObject({ riderId: 'town-eagle-rider:1', duty: 'casualty', hp: 0,
      commandReturn: true, replacementRemaining: 60, mount: { hp: 11 } })
    native.pairs[0].replacementRemaining = 23
    expect(store.save(loaded)).toBe(true)
    expect(store.load()!.townEagleGarrisons!.roman!.pairs[0].replacementRemaining).toBe(23)
  })

  it('isolates native sentries from official ALL, legacy air authority and HUD while mission-issued air remains commandable', () => {
    const squads = commanderGateDefenseSlots(), authority = createMissionCommandAuthority('guards', 'roman', 'commander', [], squads)
    authority.commandedSquadIds = [8]
    expect(authority.actorIds).toHaveLength(206)
    expect(officialCommandHudLabel(authority)).toBe(resolveCommanderTownTargetLabel)
    expect(officialCommandIsPlayerControlled(authority, 'hr-officer')).toBe(true)
    for (const id of TOWN_AUTONOMOUS_GUARD_IDS) {
      expect(officialCommandAcceptsActor(authority, { combatantId: id, squadId: 8, dead: false,
        faction: Faction.TOWN, combatOwnership: 'mission-official' })).toBe(false)
    }
    const legacy = createMissionCommandAuthority('legacy', 'roman', 'commander', [], commanderGateDefenseSlots(undefined, 1))
    legacy.commandedSquadIds = [8]
    expect(officialCommandIsPlayerControlled(legacy, 'town-eagle-rider:1')).toBe(false)
    const roster = careerCommandHudRoster({ sceneKey: 'town:roman', faction: 'roman', missionId: 'legacy', official: legacy,
      townAirActorIds: TOWN_AUTONOMOUS_GUARD_IDS, actors: [] })
    expect(roster.members.some(member => TOWN_AUTONOMOUS_GUARD_IDS.includes(member.id))).toBe(false)
    // Compatibility adapter cannot authorize an empty or populated air squad.
    const air = new TownAirCommandSquadController([], () => { throw new Error('No Player required') },
      () => createCareerProfile('roman'), {} as ConstructorParameters<typeof TownAirCommandSquadController>[3], 'roman')
    expect(air.commandsEnabled).toBe(false)
    expect(air.stageCommand(createCareerProfile('roman'), 'charge', 'all', [])).toBeUndefined()
    const sky = createMissionCommandAuthority('sky', 'roman', 'commander', [], [{ squadId: 1, actorIds: ['sky:ranger:1'] }])
    sky.commandedSquadIds = [1]
    expect(officialCommandIsPlayerControlled(sky, 'sky:ranger:1')).toBe(true)
  })

  it('round-trips exact peaceful claims until retirement revokes Town authority while preserving HR and resources', () => {
    const profile = createCareerProfile('roman')
    profile.rank = 'commander'; profile.totalMerit = 20000
    profile.townCommandSquad = { type: 'town-command', townFaction: 'roman', squadId: 1,
      commandRank: 'commander', squads: [{ squadId: 1, actorIds: ['one', 'two'] }, { squadId: 2, actorIds: ['three'] }],
      actorIds: ['one', 'two', 'three'], commandedActorIds: ['two'], nativeReturnStates: { three: 'REFIT' },
      contribution: emptyPersonalContribution(), authorized: true, sceneKey: 'town-home', state: 'FOLLOWING',
      members: { one: { status: 'reserve' }, two: { status: 'deployed', hp: 17, ammo: 3, shieldImpact: 4,
        order: 'formation', formation: { commandId: 8, position: { x: 3, z: 4, yaw: 1 }, reached: false } },
      three: { status: 'deployed', hp: 9, mount: { hp: 5, mounted: false, position: { x: 7, z: 8, yaw: 2 } } } } }
    const storage = new MemoryStorage(), store = new CareerProfileStore(storage)
    expect(store.save(profile)).toBe(true)
    const loaded = store.load()!.townCommandSquad!
    expect(loaded).toEqual(profile.townCommandSquad)
    expect(townCommandIsPlayerControlled(loaded, 'two')).toBe(true)
    expect(townCommandIsPlayerControlled(loaded, 'one')).toBe(false)
    expect(townCommandIsPlayerControlled(loaded, 'three')).toBe(false)
    const clone = cloneCareerProfile(store.load()!)
    clone.townCommandSquad!.commandedActorIds!.push('one')
    clone.townCommandSquad!.nativeReturnStates!.three = 'REJOIN_PATROL'
    expect(store.load()!.townCommandSquad).toEqual(profile.townCommandSquad)

    const retiring = cloneCareerProfile(profile)
    retiring.personalSquad = { members: [{ id: 'personal:retained', type: 'soldier' }] }
    retiring.personalSquadRuntime = snapshotPersonalMission(retiring)!
    retiring.personalSquadRuntime.state = 'ACTIVE'
    retiring.personalSquadRuntime.members['personal:retained'] = { status: 'deployed', hp: 15, order: 'follow' }
    retiring.civilianCommandSquad = { type: 'civilian-command', squadId: 'civilians', townFaction: 'roman',
      sceneKey: 'town:roman', actorIds: ['merchant'], owners: { merchant: 'player' },
      members: { merchant: { status: 'deployed', hp: 19, order: 'follow' } } }
    retiring.townAirCommandSquad = { type: 'town-air-command', squadId: 8, townFaction: 'roman', sceneKey: 'town:roman',
      actorIds: ['town-eagle-rider:1'], commandedActorIds: ['town-eagle-rider:1'],
      members: { 'town-eagle-rider:1': { status: 'deployed', hp: 11, ammo: 2 } } }
    retiring.careerRetirement = { version: 1, phase: 'departing', acceptedAt: 1, combatElapsedSeconds: 0 }
    const departing = cloneCareerProfile(retiring)
    revokeRetirementTownCommandClaims(retiring)
    expect(retiring).toEqual(departing)
    expect(isTownCommandRevokedByRetirement(retiring)).toBe(false)
    const hud = () => careerCommandHudRoster({ sceneKey: 'town:roman', faction: 'roman',
      careerRetirement: retiring.careerRetirement, official: retiring.townCommandSquad,
      civilians: retiring.civilianCommandSquad, personal: snapshotPersonalMission(retiring), actors: [] })
    expect(hud().members.map(member => member.id)).toEqual(['one', 'two', 'three', 'personal:retained', 'merchant'])

    retiring.careerRetirement.phase = 'mobilizing'
    // The phase gate excludes even still-stale command snapshots before reconciliation.
    expect(hud().members.map(member => member.id)).toEqual(['personal:retained'])
    revokeRetirementTownCommandClaims(retiring)
    expect(retiring.townCommandSquad).toMatchObject({ authorized: false, commandedActorIds: [], state: 'TRAINING' })
    expect(retiring.townCommandSquad!.commandedSquadIds).toBeUndefined()
    expect(parseTownCommandSquad(JSON.parse(JSON.stringify(retiring.townCommandSquad)))).toEqual(retiring.townCommandSquad)
    expect(townCommandIsPlayerControlled(retiring.townCommandSquad!, 'two')).toBe(false)
    expect(retiring.townCommandSquad!.nativeReturnStates).toBeUndefined()
    expect(retiring.townCommandSquad!.members!.two).toMatchObject({ hp: 17, ammo: 3, shieldImpact: 4, order: 'defend' })
    expect(retiring.townCommandSquad!.members!.two.formation).toBeUndefined()
    expect(retiring.townCommandSquad!.members!.three.mount).toEqual(departing.townCommandSquad!.members!.three.mount)
    expect(retiring.townAirCommandSquad!.commandedActorIds).toEqual([])
    expect(retiring.townAirCommandSquad!.members).toEqual(departing.townAirCommandSquad!.members)
    expect(retiring.civilianCommandSquad!.owners).toEqual({ merchant: 'daily' })
    expect(retiring.civilianCommandSquad!.members.merchant.hp).toBe(19)
    expect(retiring.personalSquad).toEqual(departing.personalSquad)
    expect(retiring.personalSquadRuntime).toEqual(departing.personalSquadRuntime)
    retiring.townCommandSquad!.members!.two.formation = {
      commandId: -4800, position: { x: 3, z: 4, yaw: 1 }, reached: false, arrivalOrder: 'defend',
    }
    retiring.civilianCommandSquad!.members.merchant.formation = {
      commandId: -4809, position: { x: 6, z: 7, yaw: 1 }, reached: false, arrivalOrder: 'defend',
    }
    const revoked = cloneCareerProfile(retiring)
    revokeRetirementTownCommandClaims(retiring)
    expect(retiring).toEqual(revoked)
    retiring.careerRetirement.phase = 'final-stand'
    expect(isTownCommandRevokedByRetirement(retiring)).toBe(true)
    retiring.careerRetirement.phase = 'completed'; retiring.careerRetirement.outcome = 'escaped'
    expect(isTownCommandRevokedByRetirement(retiring)).toBe(true)
  })

  it('round-trips explicit squads, ownership, casualties, formations and resource checkpoints through CareerProfileStore', () => {
    const profile = createCareerProfile('roman')
    profile.rank = 'commander'; profile.totalMerit = 20000
    profile.activeMission = createActiveCareerMission('captain-cavalry-command', 0, 1, 0, 'army-save')
    profile.activeMission.friendlyActorIds = ['north', 'south']
    profile.activeMission.reinforcementActorIds = ['pending']
    const authority = commanderAuthority()
    authority.commandedSquadIds = [2]
    authority.contribution = { ...emptyPersonalContribution(), damageDealt: 45, kills: 2 }
    authority.squads![1].contribution = { ...emptyPersonalContribution(), damageDealt: 45, kills: 2 }
    authority.members = {
      north: { status: 'dead', hp: 0, mount: { hp: 0, mounted: false, position: { x: 3, z: 4, yaw: 1 } } },
      south: { status: 'deployed', hp: 17, ammo: 3, shieldImpact: 4, order: 'formation',
        formation: { commandId: 9, position: { x: 5, z: 6, yaw: 1 }, reached: false, arrivalOrder: 'defend' } },
      pending: { status: 'reserve' },
    }
    profile.activeMission.officialSquad = authority
    const storage = new MemoryStorage(), store = new CareerProfileStore(storage)
    expect(store.save(profile)).toBe(true)
    expect(JSON.parse(storage.getItem(CAREER_STORAGE_KEY)!).activeMission.officialSquad).toEqual(authority)
    expect(store.load()!.activeMission!.officialSquad).toEqual(authority)
    const loaded = store.load()!
    const copy = cloneCareerProfile(loaded)
    copy.activeMission!.officialSquad!.squads![1].actorIds.push('not-saved')
    copy.activeMission!.officialSquad!.commandedSquadIds!.push(1)
    copy.activeMission!.officialSquad!.members!.south.formation!.position.x = 99
    copy.activeMission!.officialSquad!.squads![1].contribution!.damageDealt = 999
    expect(loaded.activeMission!.officialSquad).toEqual(authority)
    expect(store.load()!.activeMission!.officialSquad).toEqual(authority)
  })

  it('never promotes a legacy single-squad save merely because the profile has merit or a higher current rank', () => {
    const rank = 'commander'
      const profile = createCareerProfile('roman')
      profile.rank = rank; profile.totalMerit = 20000
      profile.activeMission = createActiveCareerMission('captain-cavalry-command', 0, 1, 0, 'army-save')
      profile.activeMission.friendlyActorIds = ['north', 'south']
      profile.activeMission.officialSquad = createMissionCommandAuthority('army-save', 'roman', 'captain', ['north'], [])
      const store = new CareerProfileStore(new MemoryStorage())
      expect(store.save(profile)).toBe(true)
      const saved = store.load()!.activeMission!.officialSquad!
      expect(officialCommandSquads(saved)).toEqual([{ squadId: 1, actorIds: ['north'] }])
      expect(saved.commandRank).toBeUndefined()
      expect(officialActorSquadId(saved, 'south')).toBeUndefined()
  })

  it.each(['rank', 'membership'] as const)('refuses an invalid expanded %s grant without acknowledging a write', mismatch => {
    const profile = createCareerProfile('roman')
    profile.rank = 'commander'; profile.totalMerit = 20000
    profile.activeMission = createActiveCareerMission('captain-cavalry-command', 0, 1, 0, 'army-save')
    profile.activeMission.friendlyActorIds = ['north', 'south', 'pending']
    profile.activeMission.officialSquad = commanderAuthority()
    if (mismatch === 'rank') profile.rank = 'captain'
    if (mismatch === 'membership') profile.activeMission.friendlyActorIds = ['north']
    const storage = new MemoryStorage(), store = new CareerProfileStore(storage)
    expect(store.save(profile)).toBe(false)
    expect(storage.length).toBe(0)
  })

  it('preserves explicit AI return ownership for legacy Captain and isolates a failed Commander save', () => {
    const captain = createMissionCommandAuthority('army-save', 'roman', 'captain', ['north'], [])
    expect(officialCommandIsPlayerControlled(captain, 'north')).toBe(true)
    captain.commandedSquadIds = []
    const savedCaptain = parseOfficialCommandAuthority(JSON.parse(JSON.stringify(captain)))!
    expect(officialCommandIsPlayerControlled(savedCaptain, 'north')).toBe(false)
    const profile = createCareerProfile('roman')
    profile.rank = 'commander'; profile.totalMerit = 20000
    profile.activeMission = createActiveCareerMission('captain-cavalry-command', 0, 1, 0, 'army-save')
    profile.activeMission.friendlyActorIds = ['north', 'south', 'pending']
    profile.activeMission.officialSquad = commanderAuthority()
    const storage = new MemoryStorage(), store = new CareerProfileStore(storage)
    expect(store.save(profile)).toBe(true)
    const staged = cloneCareerProfile(profile)
    staged.activeMission!.officialSquad!.commandedSquadIds = [2]
    storage.failWrites = true
    expect(store.save(staged)).toBe(false)
    expect(profile.activeMission.officialSquad.commandedSquadIds).toEqual([])
    expect(store.load()!.activeMission!.officialSquad!.commandedSquadIds).toEqual([])
    expect(officialCommandIsPlayerControlled(staged.activeMission!.officialSquad!, 'south')).toBe(true)
  })

  it('accepts eight 30-member data groups and rejects a 31st member in one group', () => {
    const squads = Array.from({ length: 8 }, (_, i) => ({ squadId: i + 1, actorIds: Array.from({ length: 30 }, (_, j) => `${i}:${j}`) }))
    const raw = { ...commanderAuthority(), squads, actorIds: squads.flatMap(squad => squad.actorIds) }
    expect(parseOfficialCommandAuthority(raw)?.actorIds).toHaveLength(240)
    squads[0].actorIds.push(squads[1].actorIds.pop()!)
    expect(parseOfficialCommandAuthority(raw)).toBeUndefined()
  })

  it('uses exact saved squad, allegiance and owner for Commander sources, including delayed shots', () => {
    const authority = commanderAuthority(), policy = officialMissionSourcePolicy(authority)
    authority.members = { south: { status: 'dead', hp: 0 } }
    const source: CombatActorRef = { actorId: 'south', actorType: 'npc', squadId: 2,
      characterFaction: 'roman', allegiance: Faction.TOWN, ownership: 'mission-official' }
    expect(policy(source)).toBe(true)
    const patches: Partial<CombatActorRef>[] = [{ actorId: 'outsider' }, { squadId: 1 }, { squadId: 'personal' as const },
      { ownership: 'player-personal' as const }, { ownership: 'town-command' as const }, { ownership: undefined },
      { allegiance: Faction.ENEMY }, { allegiance: Faction.BANDIT }]
    for (const patch of patches) {
      expect(policy({ ...source, ...patch })).toBe(false)
    }
    const actor = { combatantId: 'south', squadId: 2 as const, characterFaction: 'roman' as const,
      faction: Faction.TOWN, combatOwnership: 'mission-official' as const, dead: false }
    expect(officialCommandAcceptsActor(authority, actor)).toBe(false)
    const live = cloneOfficialCommandAuthority(authority); live.members = { south: { status: 'deployed', hp: 13 } }
    expect(officialCommandAcceptsActor(live, actor)).toBe(true)
    expect(officialCommandAcceptsActor(live, { ...actor, combatOwnership: 'town-command' })).toBe(false)
    live.members.south.status = 'exited'
    expect(officialCommandAcceptsActor(live, actor)).toBe(false)
  })

})


function acceptedOutpost(kind: 'outpost-defense' | 'outpost-relief') {
  const current = { ...createCareerProfile('roman'), rank: 'commander' as const, totalMerit: 20000,
    completedOutpostStages: [1, 2, 3] as const, ownedMounts: ['horse' as const] }
  const profile = { ...current, completedOutpostStages: [...current.completedOutpostStages] }
  return (kind === 'outpost-relief' ? acceptCareerOutpostRelief(profile, 'outpost-store')
    : acceptCareerOutpost(profile, 1, 'outpost-store'))!
}

describe('Outpost Commander storage boundary', () => {

  it('keeps native Outpost AI ownership when a command checkpoint write fails', () => {
    const profile = acceptedOutpost('outpost-defense')
    const storage = new MemoryStorage(), store = new CareerProfileStore(storage)
    expect(store.save(profile)).toBe(true)
    const next = cloneCareerProfile(profile)
    next.activeOutpostMission!.officialSquad!.commandedSquadIds = [4]
    storage.failWrites = true
    expect(store.save(next)).toBe(false)
    expect(profile.activeOutpostMission!.officialSquad!.commandedSquadIds).toEqual([])
    expect(store.load()!.activeOutpostMission!.officialSquad!.commandedSquadIds).toEqual([])
  })
})

/** Checkpoint/controller owners use plain resource records and narrow lifecycle boundaries. */
interface ResidentResource {
  combatantId: string; faction: Faction; townCategory: 'civilian'; hostileToPlayer: boolean
  dead: boolean; hp: number; maxHp: number; combatAmmo: number; combatAmmoCapacity: number
  tacticalOrder: 'attack' | 'defend' | 'follow'; mount: MountResource | null
  group: { position: Vector3; rotation: { y: number } }; combatPosition: Vector3
  shield: { shieldImpactRemaining: number; shieldImpactMax: number }
  restoreCombatHealth(hp: number): void; restoreCombatAmmo(ammo: number): void
  refitCombat(): void; mountVehicle(mount: MountResource): void; dismountFromMount(): void
  setTacticalOrder(order: 'attack' | 'defend' | 'follow'): void
  releaseOutpostRampartGarrison(): void; setCommandSquad(): void; setCommandAllegiance(faction: Faction): void
  disarmTownCivilian(): void; setTownPeaceful(): void
  armTownCivilian(): void; setMissionCombatTarget(): void; assignSiegeObstacle(): void; assignFollowTarget(): void
}
interface MountResource {
  dead: boolean; currentHp: number; maxHp: number; disposed: boolean; isAirborne: boolean
  riderNpc: ResidentResource | null; riderPlayer: null
  group: { position: Vector3; rotation: { y: number } }
  restoreForTown(x: number, z: number, yaw: number): void; takeDamage(): void
}
function residentRecovery(actorId: string, npcDead: boolean, mountDead: boolean,
  placement: Pick<ConstructorParameters<typeof CivilianCommandSquadController>[4], 'canPlaceMountedCivilian'> = {}) {
  const events: string[] = []
  const mount: MountResource = { dead: mountDead, currentHp: mountDead ? 0 : 17, maxHp: 200, disposed: false,
    isAirborne: false, riderNpc: null, riderPlayer: null, group: { position: new Vector3(3, 0, 4), rotation: { y: 1 } },
    restoreForTown() { events.push('restore-mount'); this.dead = false; this.currentHp = this.maxHp; this.riderNpc = null },
    takeDamage() { this.dead = true; this.currentHp = 0 },
  }
  const roster = townRoster()
  const records = civilianCommandRoster(roster).map(id => {
    const position = new Vector3(3, 0, 4)
    const npc: ResidentResource = { combatantId: id, faction: Faction.TOWN, townCategory: 'civilian', hostileToPlayer: false,
      dead: id === actorId && npcDead, hp: id === actorId && npcDead ? 0 : 13, maxHp: 40,
      combatAmmo: 0, combatAmmoCapacity: 0, tacticalOrder: 'attack', mount: null,
      group: { position, rotation: { y: 1 } }, combatPosition: position,
      shield: { shieldImpactRemaining: 0, shieldImpactMax: 0 },
      restoreCombatHealth(hp) { if (hp <= 0) { this.dead = true; this.hp = 0; this.dismountFromMount() } else if (!this.dead) this.hp = hp },
      restoreCombatAmmo(ammo) { this.combatAmmo = ammo },
      refitCombat() { events.push('refit-npc'); this.dead = false; this.hp = this.maxHp },
      mountVehicle(value) { events.push('mount'); this.mount = value; value.riderNpc = this },
      dismountFromMount() { if (this.mount) this.mount.riderNpc = null; this.mount = null },
      setTacticalOrder(order) { this.tacticalOrder = order },
      releaseOutpostRampartGarrison() {}, setCommandSquad() {}, setCommandAllegiance(faction) { this.faction = faction }, disarmTownCivilian() {}, setTownPeaceful() {},
      armTownCivilian() {}, setMissionCombatTarget() {}, assignSiegeObstacle() {}, assignFollowTarget() { this.tacticalOrder = 'follow' },
    }
    return { spec: roster.find(spec => spec.id === id)!, npc, ...(id === actorId ? { homeMount: mount } : {}) }
  })
  const actor = records.find(record => record.spec.id === actorId)!.npc
  // One adapter into the production borrowing boundary; no NPC/Mount/3D construction.
  const residents = records as unknown as CivilianCommandResident[]
  let profile: import('../../src/career/CareerProfile').CareerProfile = { ...createCareerProfile('roman'), rank: 'commander', totalMerit: 20000 }
  let permitSave = true
  const controller = () => new CivilianCommandSquadController(residents, () => ({ dead: false }) as Player,
    () => profile, next => { events.push('save'); if (!permitSave) return false; profile = next; return true },
    { sceneKey: 'town:roman', townFaction: 'roman', refitSceneKey: 'town-home', canRefit: () => true, ...placement })
  const owner = controller(); expect(owner.synchronize()).toBe(true); events.length = 0
  return { actor, mount, residents, owner, controller, events, read: () => profile,
    allowSave: (allow: boolean) => { permitSave = allow } }
}

describe('Civilian and merchant borrowed mount checkpoints', () => {
  it('refits a dead civilian onto its surviving original horse after saving the complete checkpoint', () => {
    const h = residentRecovery('civilian-0', true, false)
    expect(h.owner.checkpoint()!.members['civilian-0'].mount).toMatchObject({ hp: 17, mounted: false })
    expect(h.owner.refit()).toBe(true)
    expect(h.events[0]).toBe('save')
    expect(h.events).not.toContain('restore-mount')
    expect(h.actor).toMatchObject({ dead: false, hp: 40 })
    expect(h.actor.mount).toBe(h.mount); expect(h.mount.riderNpc).toBe(h.actor)
    const home = h.residents.find(r => r.spec.id === 'civilian-0')!.spec
    expect(h.mount.group.position.x).toBe(home.x); expect(h.mount.group.position.z).toBe(home.z)
    expect(h.mount.currentHp).toBe(200)
    expect(h.read().civilianCommandSquad!.members['civilian-0'].mount).toMatchObject({ hp: 200, mounted: true })
  })

  it('refits an existing mounted Follow civilian on a road without checking home placement or moving it', () => {
    let placementChecks = 0
    const h = residentRecovery('civilian-0', false, false, { canPlaceMountedCivilian: () => { placementChecks++; return false } })
    h.actor.combatPosition.set(18, 0, -30); h.mount.group.position.copy(h.actor.combatPosition)
    h.actor.mountVehicle(h.mount)
    expect(h.owner.issue('follow')).toBe(true)
    const position = h.actor.combatPosition.clone()
    expect(h.owner.refit()).toBe(true)
    expect(h.actor.combatPosition).toEqual(position); expect(h.mount.group.position).toEqual(position)
    expect(h.actor).toMatchObject({ hp: 40, tacticalOrder: 'follow' })
    expect(h.actor.mount).toBe(h.mount); expect(h.mount.currentHp).toBe(200)
    expect(h.read().civilianCommandSquad!.owners['civilian-0']).toBe('player')
    expect(placementChecks).toBe(0)
  })

  it('revives an allocated dead horse at the validated living civilian position rather than its old corpse position', () => {
    const h = residentRecovery('civilian-0', false, true, { canPlaceMountedCivilian: point => point.x === 18 && point.z === -30 })
    h.actor.combatPosition.set(18, 0, -30)
    expect(h.owner.refit()).toBe(true)
    expect(h.events[0]).toBe('save')
    expect(h.actor.mount).toBe(h.mount); expect(h.mount.riderNpc).toBe(h.actor)
    expect(h.actor.combatPosition).toMatchObject({ x: 18, z: -30 })
    expect(h.mount.group.position).toMatchObject({ x: 18, z: -30 })
    expect(h.read().civilianCommandSquad!.members['civilian-0'].mount).toMatchObject({ hp: 200, mounted: true, position: { x: 18, z: -30 } })
  })

  it('restores the same dead merchant and horse through the existing mount recovery boundary', () => {
    const h = residentRecovery('merchant', true, true)
    expect(h.owner.refit()).toBe(true)
    expect(h.events.filter(event => event === 'restore-mount')).toHaveLength(1)
    expect(h.events.indexOf('restore-mount')).toBeGreaterThan(h.events.indexOf('save'))
    expect(h.actor.mount).toBe(h.mount); expect(h.mount.riderNpc).toBe(h.actor)
    expect(h.mount).toMatchObject({ dead: false, currentHp: 200 })
    expect(h.residents.find(resident => resident.spec.id === 'merchant')!.homeMount).toBe(h.mount)
  })

  it('keeps dead resources, ownership and riding unchanged when the refit checkpoint cannot be saved', () => {
    const h = residentRecovery('civilian-0', true, true), before = cloneCareerProfile(h.read())
    h.allowSave(false)
    expect(h.owner.refit()).toBe(false)
    expect(h.events).toEqual(['save'])
    expect(h.actor).toMatchObject({ dead: true, hp: 0, mount: null })
    expect(h.mount).toMatchObject({ dead: true, currentHp: 0, riderNpc: null })
    expect(h.read()).toEqual(before)
  })

  it('preserves deliberate dismount on ordinary restore without healing the saved NPC or horse', () => {
    const h = residentRecovery('civilian-0', false, false)
    expect(h.owner.checkpoint()!.members['civilian-0'].mount?.mounted).toBe(false)
    const restored = h.controller()
    expect(restored.restore()).toBe(true)
    expect(h.actor).toMatchObject({ dead: false, hp: 13, mount: null })
    expect(h.mount).toMatchObject({ dead: false, currentHp: 17, riderNpc: null })
    expect(h.events).not.toContain('refit-npc'); expect(h.events).not.toContain('mount')
  })

  it('rebinds a saved mounted merchant to its existing allocated horse during scene restore', () => {
    const h = residentRecovery('merchant', false, false)
    h.read().civilianCommandSquad!.members.merchant.mount!.mounted = true
    expect(h.controller().restore()).toBe(true)
    expect(h.actor.mount).toBe(h.mount); expect(h.mount.riderNpc).toBe(h.actor)
    expect(h.mount.currentHp).toBe(17)
    expect(h.events).not.toContain('restore-mount'); expect(h.events).not.toContain('refit-npc')
  })

  it('restores saved civilian and mount deaths onto freshly materialized resource records without refitting them', () => {
    const h = residentRecovery('civilian-0', true, true)
    // New scene resources start alive; only the saved checkpoint decides their status.
    h.actor.dead = false; h.actor.hp = 40
    h.mount.dead = false; h.mount.currentHp = 200
    h.actor.mount = h.mount; h.mount.riderNpc = h.actor
    expect(h.controller().restore()).toBe(true)
    expect(h.actor).toMatchObject({ dead: true, hp: 0, mount: null })
    expect(h.mount).toMatchObject({ dead: true, currentHp: 0, riderNpc: null })
    expect(h.events).not.toContain('refit-npc'); expect(h.events).not.toContain('restore-mount')
  })

  it('rejects a refit before saving when another resident already rides the allocated horse', () => {
    const h = residentRecovery('civilian-0', true, false)
    const foreign = { ...h.actor, combatantId: 'foreign' }
    h.mount.riderNpc = foreign
    expect(h.owner.refit()).toBe(false)
    expect(h.events).toEqual([])
    expect(h.mount.riderNpc).toBe(foreign)
    expect(h.actor.dead).toBe(true)
  })
})
