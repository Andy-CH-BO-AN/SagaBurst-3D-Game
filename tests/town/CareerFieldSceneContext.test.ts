import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCareerProfile, cloneCareerProfile } from '../../src/career/CareerProfile'
import { VETERAN_MISSION_IDS, acceptVeteranMission } from '../../src/career/VeteranMission'
import { townRoster } from '../../src/town/TownRules'
import { createEnemyTownAssaultMission } from '../../src/career/EnemyTownAssault'
import type { ActiveCareerMission } from '../../src/career/CareerMissionState'
import { parseCareerProfile } from '../../src/career/CareerProfileStore'
import { resolveCareerTownSceneContext, isCareerEnemyTerritoryFieldMission, careerTownSceneRoster, careerEnemyTownGarrisonActorIds } from '../../src/career/CareerFieldSceneContext'
import { Faction } from '../../src/combat/CombatFaction'
import { TownWorld } from '../../src/town/TownWorld'
import { TownMissionSettlement } from '../../src/town/TownMissionSettlement'

function tragedyMission(phase: ActiveCareerMission['phase'] = 'RESULT'): ActiveCareerMission {
  return {
    id: 'tragedy-test', templateId: 'veteran-tragedy-of-the-scouts', kind: 'veteran-field',
    targetCampId: 0, phase, targetActorIds: ['enemy-0'], friendlyActorIds: ['captain', 'maki', 'scout-0'],
    borrowedActorIds: ['captain', 'maki', 'scout-0'], acceptedAt: 1,
    result: { outcome: 'victory', claimed: true, stats: { damageDealt: 0, damageTaken: 0, kills: 0, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived: false }, merit: { damage: 0, kills: 0, contribution: 0, total: 0 } },
  }
}

function returnFixture(commitSucceeds = true) {
  const events: string[] = []
  let profile = createCareerProfile('roman')
  profile.rank = 'veteran'
  profile.activeMission = tragedyMission()
  const borrowedNpc = {
    combatantId: 'captain', group: new THREE.Group(), dismountFromMount: vi.fn(() => events.push('dismount')),
    restoreForTown: vi.fn(() => events.push('restore-npc')), mountVehicle: vi.fn(),
  }
  const bystander = { combatantId: 'merchant', group: new THREE.Group(), dismountFromMount: vi.fn(), restoreForTown: vi.fn(), mountVehicle: vi.fn() }
  const homeMount = { restoreForTown: vi.fn(() => events.push('restore-mount')) }
  const field = { friendlies: [borrowedNpc], snapshot: () => ({ player: { damageDealt: 0, damageTaken: 0, kills: 0, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived: false }, squads: [] }), cleanupMission: vi.fn(() => events.push('cleanup-field')) }
  const duel = { actors: [], snapshot: vi.fn(), cleanupMission: vi.fn() }
  const defense = { active: undefined, snapshot: vi.fn(), cleanupMission: vi.fn(), civilianSurvived: 20, civilianDeaths: 0 }
  const town = {
    residents: [
      { npc: borrowedNpc, homeMount, spec: { role: 'captain', x: 4, z: 8, yaw: .4 }, cycle: 2, walkTime: 1 },
      { npc: bystander, spec: { role: 'merchant', x: 0, z: 0 }, cycle: 2, walkTime: 1 },
    ],
    player: { group: new THREE.Group() }, releaseExternalThreat: vi.fn(), cat: { restoreForTown: vi.fn() },
    world: { obstacles: [], restoreTownDamage: vi.fn() }, navigation: { sync: vi.fn() },
    inventory: { sheathAll: vi.fn(() => events.push('sheath')) }, clearCombatShots: vi.fn(() => events.push('clear-shots')),
    restPlayer: vi.fn(), restart: vi.fn(() => events.push('restart')),
  }
  const settlement = new TownMissionSettlement({
    read: () => profile,
    commit: next => { events.push('commit'); if (!commitSucceeds) return false; profile = next; return true },
  }, { field, duel, defense } as any, town as any)
  return { settlement, profile: () => profile, field, town, borrowedNpc, bystander, homeMount, events }
}

afterEach(() => vi.unstubAllGlobals())

describe('Veteran VI enemy-territory Town context', () => {
  it.each(['roman', 'viking'] as const)('uses opposing scenery but own residents for a %s scout party', faction => {
    const profile = createCareerProfile(faction)
    profile.activeMission = tragedyMission('ENGAGING')
    expect(isCareerEnemyTerritoryFieldMission(profile.activeMission)).toBe(true)
    expect(resolveCareerTownSceneContext(profile)).toEqual({
      worldFaction: faction === 'roman' ? 'viking' : 'roman',
      residentFaction: faction,
      missionOnlyResidents: true,
      worldOwnerAllegiance: Faction.ENEMY,
    })
  })

  it.each(['roman', 'viking'] as const)('plans borrowed allies and the deterministic enemy Town garrison for %s VI', faction => {
    const base = createCareerProfile(faction)
    base.rank = 'veteran'
    base.totalMerit = 900
    base.ownedMounts = ['horse']
    base.completedCareerMissionTemplateIds = VETERAN_MISSION_IDS.slice(0, 5)
    const accepted = acceptVeteranMission(base, VETERAN_MISSION_IDS[5], { missionId: 'enemy-town-roster', acceptedAt: 12 })!
    const entries = careerTownSceneRoster(accepted)
    const borrowed = entries.filter(entry => entry.borrowed)
    const enemyTown = entries.filter(entry => entry.spec.id.startsWith('enemy-town:'))
    const expectedNative = townRoster().filter(spec => spec.role !== 'cat')
    const opposing = faction === 'roman' ? 'viking' : 'roman'

    expect(borrowed.map(entry => entry.spec.id)).toEqual(['captain', 'ranger'])
    expect(borrowed.every(entry => entry.allegiance === Faction.TOWN && entry.borrowed)).toBe(true)
    expect(borrowed.find(entry => entry.spec.id === 'captain')?.characterFaction).toBe(faction)
    expect(borrowed.find(entry => entry.spec.id === 'ranger')?.characterFaction).toBe('viking')
    expect(enemyTown.map(entry => entry.spec.id)).toEqual(expectedNative.map(spec => `enemy-town:${spec.id}`))
    expect(enemyTown.every(entry => entry.characterFaction === opposing && entry.allegiance === Faction.ENEMY && !entry.borrowed)).toBe(true)
    expect(entries).toHaveLength(2 + expectedNative.length)
    expect(new Set(entries.map(entry => entry.spec.id)).size).toBe(entries.length)
    expect(careerEnemyTownGarrisonActorIds()).toEqual(expectedNative.map(spec => `enemy-town:${spec.id}`))
  })

  it.each(['missing', 'empty'] as const)('recovers VI borrowed Town IDs from friendly actors when borrowedActorIds is %s', state => {
    const profile = createCareerProfile('roman')
    const mission = tragedyMission('ENGAGING')
    mission.borrowedActorIds = state === 'missing' ? undefined : []
    mission.friendlyActorIds = ['captain', 'ranger', 'lancer_cavalry-0', 'temporary:captain:0', 'enemy-town:captain']
    profile.activeMission = mission

    const borrowed = careerTownSceneRoster(profile).filter(entry => entry.borrowed)
    expect(borrowed.map(entry => entry.spec.id)).toEqual(['captain', 'ranger', 'lancer_cavalry-0'])
    expect(borrowed.every(entry => entry.allegiance === Faction.TOWN)).toBe(true)
    expect(borrowed.some(entry => entry.spec.id.includes('temporary'))).toBe(false)
  })

  it('preserves the ordinary Town and Enemy Town Assault resident roster mapping', () => {
    const town = createCareerProfile('roman')
    const regular = careerTownSceneRoster(town)
    expect(regular).toHaveLength(townRoster().filter(spec => spec.role !== 'cat').length)
    expect(regular.find(entry => entry.spec.id === 'captain')).toMatchObject({ characterFaction: 'roman', allegiance: Faction.TOWN, borrowed: false })
    expect(regular.find(entry => entry.spec.id === 'ranger')).toMatchObject({ characterFaction: 'viking', allegiance: Faction.TOWN, borrowed: false })
    expect(regular.find(entry => entry.spec.id === 'civilian-0')).toMatchObject({ characterFaction: 'roman', allegiance: Faction.TOWN, borrowed: false })

    const assault = { ...town, activeMission: createEnemyTownAssaultMission('assault-roster') }
    const attackers = careerTownSceneRoster(assault)
    expect(attackers).toHaveLength(regular.length)
    expect(attackers.find(entry => entry.spec.id === 'captain')).toMatchObject({ characterFaction: 'viking', allegiance: Faction.ENEMY, borrowed: false })
    expect(attackers.find(entry => entry.spec.id === 'civilian-0')).toMatchObject({ characterFaction: 'roman', allegiance: Faction.ENEMY, borrowed: false })
  })

  it('keeps normal Town and existing Enemy Town Assault contexts unchanged', () => {
    const town = createCareerProfile('roman')
    expect(resolveCareerTownSceneContext(town)).toEqual({ worldFaction: 'roman', residentFaction: 'roman', missionOnlyResidents: false, worldOwnerAllegiance: Faction.TOWN })
    const assault = { ...town, activeMission: createEnemyTownAssaultMission('assault-context') }
    expect(resolveCareerTownSceneContext(assault)).toEqual({ worldFaction: 'viking', residentFaction: 'viking', missionOnlyResidents: false, worldOwnerAllegiance: Faction.TOWN })
    expect(isCareerEnemyTerritoryFieldMission(assault.activeMission)).toBe(false)
  })

  it('assigns enemy building ownership only when requested and keeps camp ownership bandit', () => {
    const canvasContext = new Proxy({ measureText: () => ({ width: 100 }) }, { get: (target, key) => (target as any)[key] ?? (() => {}) })
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => canvasContext }) })
    vi.stubGlobal('ImageData', class { constructor(public data: unknown, public width: number, public height: number) {} })
    const defaultScene = new THREE.Scene()
    const defaultWorld = new TownWorld('roman', defaultScene)
    expect(defaultWorld.buildings.filter(building => !building.id.startsWith('camp-')).every(building => building.ownerFaction === Faction.TOWN)).toBe(true)
    defaultWorld.dispose()

    const enemyScene = new THREE.Scene()
    const enemyWorld = new TownWorld('viking', enemyScene, Faction.ENEMY)
    expect(enemyWorld.buildings.filter(building => !building.id.startsWith('camp-')).every(building => building.ownerFaction === Faction.ENEMY)).toBe(true)
    expect(enemyWorld.buildings.filter(building => building.id.startsWith('camp-')).every(building => building.ownerFaction === Faction.BANDIT)).toBe(true)
    enemyWorld.dispose()
  })

  it('clears field mission, restores only borrowed Town actors, and restarts after save succeeds', () => {
    const f = returnFixture()
    expect(f.settlement.returnToTown('direct')).toEqual({ status: 'restarted' })
    expect(f.profile().activeMission).toBeUndefined()
    expect(f.events).toEqual(['commit', 'cleanup-field', 'clear-shots', 'dismount', 'restore-npc', 'restore-mount', 'sheath', 'restart'])
    expect(f.field.cleanupMission).toHaveBeenCalledExactlyOnceWith(0)
    expect(f.borrowedNpc.restoreForTown).toHaveBeenCalledOnce()
    expect(f.homeMount.restoreForTown).toHaveBeenCalledExactlyOnceWith(4, 8, .4)
    expect(f.bystander.restoreForTown).not.toHaveBeenCalled()
    expect(f.town.restPlayer).not.toHaveBeenCalled()
  })

  it('does not clean up or restart if clearing the mission cannot be saved', () => {
    const f = returnFixture(false)
    expect(f.settlement.returnToTown('direct')).toEqual({ status: 'save-failed', destination: 'restart' })
    expect(f.profile().activeMission).toBeDefined()
    expect(f.events).toEqual(['commit'])
    expect(f.field.cleanupMission).not.toHaveBeenCalled()
    expect(f.borrowedNpc.restoreForTown).not.toHaveBeenCalled()
    expect(f.town.restart).not.toHaveBeenCalled()
  })

  it('persists finite known actor positions and activated enemy squads through saves and clones', () => {
    const profile = createCareerProfile('roman')
    const mission = tragedyMission('ENGAGING')
    mission.actorPositions = {
      captain: { x: 12, z: 23, yaw: 1.2 },
      'enemy-0': { x: -3, z: 9, yaw: -0.8 },
      outsider: { x: 4, z: 5, yaw: 0 },
      maki: { x: Number.NaN, z: 1, yaw: 0 },
    }
    mission.engagedEnemySquadIds = [2, 1, 2, 0, -1, 1.5, 9]
    profile.activeMission = mission

    const loaded = parseCareerProfile(JSON.parse(JSON.stringify(profile)))!
    expect(loaded.activeMission?.actorPositions).toEqual({ captain: { x: 12, z: 23, yaw: 1.2 }, 'enemy-0': { x: -3, z: 9, yaw: -0.8 } })
    expect(loaded.activeMission?.engagedEnemySquadIds).toEqual([2, 1])
    const clone = cloneCareerProfile(loaded)
    expect(clone.activeMission?.actorPositions).not.toBe(loaded.activeMission?.actorPositions)
    expect(clone.activeMission?.actorPositions?.captain).not.toBe(loaded.activeMission?.actorPositions?.captain)
    expect(clone.activeMission?.engagedEnemySquadIds).not.toBe(loaded.activeMission?.engagedEnemySquadIds)
    clone.activeMission!.actorPositions!.captain.x = 99
    clone.activeMission!.engagedEnemySquadIds!.push(3)
    expect(loaded.activeMission?.actorPositions?.captain.x).toBe(12)
    expect(loaded.activeMission?.engagedEnemySquadIds).toEqual([2, 1])
  })
})
