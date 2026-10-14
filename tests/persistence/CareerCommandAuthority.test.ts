import { careerTownSceneRoster } from '../../src/career/CareerFieldSceneContext'
import { describe, expect, it } from 'vitest'
import { parseTownCommandSquad, officialMissionSourcePolicy, parseOfficialCommandAuthority, cloneOfficialCommandAuthority, createMissionCommandAuthority, officialCommandSquads, officialActorSquadId, officialCommandAcceptsActor, officialCommandIsPlayerControlled, townCommandIsPlayerControlled } from '../../src/career/CareerCommandAuthority'
import { emptyPersonalContribution } from '../../src/combat/CommandMerit'
import { cloneCareerProfile, createCareerProfile } from '../../src/career/CareerProfile'
import { acceptCareerOutpost, acceptCareerOutpostRelief } from '../../src/career/CareerOutpostMission'
import { createActiveCareerMission } from '../../src/career/CareerMissionState'
import { snapshotPersonalMission } from '../../src/career/CareerPersonalSquadMission'
import type { OfficialCommandAuthority } from '../../src/career/CareerCommandAuthority'
import { CAREER_STORAGE_KEY, CareerProfileStore } from '../../src/career/CareerProfileStore'
import { MemoryStorage } from '../helpers/memoryStorage'
import { Faction } from '../../src/world/NPC'
import type { CombatActorRef } from '../../src/combat/CombatAttribution'

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

  it('preserves incoming damage through authority serialization and the real personal Career store', () => {
    const profile = createCareerProfile('roman')
    profile.personalSquad = { members: [{ id: 'personal:damage', type: 'soldier' }] }
    profile.activeMission = createActiveCareerMission('recruit-bandits-01', 0, 3, 0, 'damage-resume')
    profile.activeMission.personalSquad = snapshotPersonalMission(profile)!
    profile.activeMission.personalSquad.contribution = { ...emptyPersonalContribution(), damageDealt: 11, damageTaken: 19 }
    const authority: OfficialCommandAuthority = { type: 'mission-official', missionId: 'damage-resume',
      townFaction: 'roman', squadId: 1, actorIds: ['accepted'],
      contribution: { ...emptyPersonalContribution(), damageDealt: 7, damageTaken: 13 } }

    const savedAuthority = parseOfficialCommandAuthority(JSON.parse(JSON.stringify(authority)))!
    expect(savedAuthority.contribution).toEqual(authority.contribution)
    const invalid = { ...authority, contribution: { ...authority.contribution, damageTaken: Infinity } }
    expect(parseOfficialCommandAuthority(JSON.parse(JSON.stringify(invalid)))!.contribution.damageTaken).toBeUndefined()

    const store = new CareerProfileStore(new MemoryStorage())
    expect(store.save(profile)).toBe(true)
    expect(store.load()!.activeMission!.personalSquad!.contribution).toEqual(profile.activeMission.personalSquad.contribution)
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
  it('round-trips exact peaceful actor claims and native return owners without treating whole squads as commanded', () => {
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
  })

  it.each([
    ['outside claim', { commandedActorIds: ['outside'] }],
    ['duplicate claim', { commandedActorIds: ['two', 'two'] }],
    ['claim also returning', { commandedActorIds: ['two'], nativeReturnStates: { two: 'REFIT' } }],
    ['invalid return owner', { nativeReturnStates: { three: 'FLYING' } }],
    ['mission-only field', { missionId: 'not-a-town-mission' }],
    ['squad claim field', { commandedSquadIds: [1] }],
  ])('rejects malformed peaceful Commander ownership: %s', (_name, patch) => {
    const base = { type: 'town-command', townFaction: 'roman', squadId: 1, commandRank: 'commander',
      squads: [{ squadId: 1, actorIds: ['one', 'two'] }, { squadId: 2, actorIds: ['three'] }],
      actorIds: ['one', 'two', 'three'], commandedActorIds: ['two'], nativeReturnStates: { three: 'REFIT' },
      contribution: emptyPersonalContribution(), authorized: true, sceneKey: 'town-home', state: 'FOLLOWING' }
    expect(parseTownCommandSquad({ ...base, ...patch })).toBeUndefined()
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
    for (const rank of ['captain', 'commander'] as const) {
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
    }
  })

  it.each(['rank', 'mission', 'faction', 'membership'] as const)('refuses an invalid expanded %s grant without acknowledging a write', mismatch => {
    const profile = createCareerProfile('roman')
    profile.rank = 'commander'; profile.totalMerit = 20000
    profile.activeMission = createActiveCareerMission('captain-cavalry-command', 0, 1, 0, 'army-save')
    profile.activeMission.friendlyActorIds = ['north', 'south', 'pending']
    profile.activeMission.officialSquad = commanderAuthority()
    if (mismatch === 'rank') profile.rank = 'captain'
    if (mismatch === 'mission') profile.activeMission.id = 'next-mission'
    if (mismatch === 'faction') profile.activeMission.officialSquad.townFaction = 'viking'
    if (mismatch === 'membership') profile.activeMission.friendlyActorIds = ['north']
    const storage = new MemoryStorage(), store = new CareerProfileStore(storage)
    expect(store.save(profile)).toBe(false)
    expect(storage.length).toBe(0)
  })

  it.each([
    ['duplicate member', [{ squadId: 1, actorIds: ['north', 'south'] }, { squadId: 2, actorIds: ['south', 'pending'] }]],
    ['missing member', [{ squadId: 1, actorIds: ['north'] }]],
    ['duplicate squad', [{ squadId: 1, actorIds: ['north'] }, { squadId: 1, actorIds: ['south', 'pending'] }]],
    ['ninth squad', [{ squadId: 9, actorIds: ['north', 'south', 'pending'] }]],
    ['empty squad', [{ squadId: 1, actorIds: ['north', 'south', 'pending'] }, { squadId: 2, actorIds: [] }]],
  ])('rejects malformed grouping: %s', (_name, squads) => {
    expect(parseOfficialCommandAuthority({ ...commanderAuthority(), squads })).toBeUndefined()
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

  it('authorizes the accepted Roman Maki by production identity despite her Viking appearance', () => {
    const ranger = careerTownSceneRoster({ faction: 'roman' }).find(entry => entry.spec.id === 'ranger')!
    expect(ranger.characterFaction).toBe('viking')
    expect(ranger.allegiance).toBe(Faction.TOWN)
    const authority = createMissionCommandAuthority('roman-command', 'roman', 'commander', [], [
      { squadId: 2, actorIds: [ranger.spec.id] },
    ])
    const actor = { combatantId: ranger.spec.id, squadId: 2 as const, faction: ranger.allegiance,
      characterFaction: ranger.characterFaction, combatOwnership: 'mission-official' as const, dead: false }
    expect(officialCommandAcceptsActor(authority, actor)).toBe(true)
    const source: CombatActorRef = { actorId: ranger.spec.id, actorType: 'npc', squadId: 2,
      allegiance: ranger.allegiance, characterFaction: ranger.characterFaction, ownership: 'mission-official' }
    const policy = officialMissionSourcePolicy(authority)
    expect(policy(source)).toBe(true)
    expect(policy({ ...source, actorId: 'enemy-town:ranger' })).toBe(false)
    expect(policy({ ...source, allegiance: Faction.ENEMY })).toBe(false)
    expect(officialCommandAcceptsActor(authority, { ...actor, combatantId: 'enemy-town:ranger' })).toBe(false)
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
  it.each(['outpost-defense', 'outpost-relief'] as const)('round-trips %s grant, orders, resources and casualties without sharing clone state', kind => {
    const profile = acceptedOutpost(kind), authority = profile.activeOutpostMission!.officialSquad!
    const [dead, formation, exited] = authority.actorIds
    authority.members = Object.fromEntries(authority.actorIds.map(id => [id, { status: 'reserve' }]))
    authority.members[dead] = { status: 'dead', hp: 0, mount: { hp: 0, mounted: false, position: { x: 1, z: 2, yaw: 3 } } }
    authority.members[formation] = { status: 'deployed', hp: 17, ammo: 2, shieldImpact: 4, order: 'formation',
      formation: { commandId: 12, position: { x: 2, z: 3, yaw: 4 }, reached: false, arrivalOrder: 'defend' } }
    authority.members[exited] = { status: 'exited', hp: 11 }
    authority.commandedSquadIds = [1]
    authority.contribution = { ...emptyPersonalContribution(), damageDealt: 41, kills: 2 }
    authority.squads![0].contribution = { ...authority.contribution }
    const storage = new MemoryStorage(), store = new CareerProfileStore(storage)
    expect(store.save(profile)).toBe(true)
    expect(JSON.parse(storage.getItem(CAREER_STORAGE_KEY)!).activeOutpostMission.officialSquad).toEqual(authority)
    const loaded = store.load()!
    expect(loaded.activeOutpostMission!.officialSquad).toEqual(authority)
    const copy = cloneCareerProfile(loaded), copied = copy.activeOutpostMission!.officialSquad!
    copied.actorIds.push('replacement')
    copied.squads![0].actorIds.push('replacement')
    copied.squads![0].contribution!.damageDealt = 999
    copied.commandedSquadIds!.push(2)
    copied.members![formation].formation!.position.x = 999
    expect(loaded.activeOutpostMission!.officialSquad).toEqual(authority)
    expect(store.load()!.activeOutpostMission!.officialSquad).toEqual(authority)
  })

  it.each(['rank', 'mission', 'faction', 'enemy', 'missing'] as const)('refuses an invalid Outpost %s grant without replacing the last successful save', mismatch => {
    const profile = acceptedOutpost('outpost-relief')
    const storage = new MemoryStorage(), store = new CareerProfileStore(storage)
    expect(store.save(profile)).toBe(true)
    const previous = storage.getItem(CAREER_STORAGE_KEY)
    const next = cloneCareerProfile(profile), mission = next.activeOutpostMission!, authority = mission.officialSquad!
    if (mismatch === 'rank') next.rank = 'captain'
    if (mismatch === 'mission') mission.id = 'different-mission'
    if (mismatch === 'faction') authority.townFaction = 'viking'
    if (mismatch === 'enemy') {
      authority.actorIds[0] = 'outpost-store:initial:20'
      authority.squads![0].actorIds[0] = 'outpost-store:initial:20'
    }
    if (mismatch === 'missing') {
      authority.actorIds.pop()
      authority.squads!.at(-1)!.actorIds.pop()
    }
    expect(store.save(next)).toBe(false)
    expect(storage.getItem(CAREER_STORAGE_KEY)).toBe(previous)
    expect(store.load()!.activeOutpostMission!.officialSquad).toEqual(profile.activeOutpostMission!.officialSquad)
  })

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
