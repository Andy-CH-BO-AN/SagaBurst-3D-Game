import { describe, expect, it } from 'vitest'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { CAREER_STORAGE_KEY, CareerProfileStore } from '../../src/career/CareerProfileStore'
import { DEFAULT_SAVE, restoreSavedPlayerHp, SaveManager } from '../../src/save/SaveManager'
import { createCommanderFourGateDefenseState } from '../../src/career/CommanderFourGateDefenseState'
import { createCommanderFourGateDefenseRoster } from '../../src/career/CommanderFourGateDefenseRoster'
import { createTownDefenseMission } from '../../src/career/CareerMissionState'
import { siegeRoster } from '../../src/career/TownSiege'
import { createCavalrySweepMission } from '../../src/career/CavalrySweep'
import { migrateCareerHealth } from '../../src/career/CareerHealthMigration'
import { acceptVeteranMission, createVeteranRoster, restoreVeteranTownCavalryReserveRoster, VETERAN_MISSION_IDS } from '../../src/career/VeteranMission'
import { MemoryStorage } from '../helpers/memoryStorage'

function legacyCareer() {
  const profile = createCareerProfile('viking')
  delete profile.healthRulesVersion
  profile.playerAerialState = { sceneKey: 'town-home', position: { x: 0, y: 2, z: 0, yaw: 0 }, hp: 100.5, dead: false }
  profile.townPatrols = { viking: { squads: [{ id: 'A', generation: 0, members: {
    'town-patrol:a:0': { status: 'deployed', hp: 100, mount: { hp: 80, mounted: true, position: { x: 0, z: 0, yaw: 0 } } },
    'town-patrol:a:1': { status: 'dead', hp: 0 },
    'town-patrol:a:captain': { status: 'deployed', hp: 250 },
  } }] } }
  return profile
}

describe('Health persistence', () => {
  it('durably migrates ordinary Career wounds once without changing heroes, mounts or deaths', () => {
    const storage = new MemoryStorage()
    storage.setItem(CAREER_STORAGE_KEY, JSON.stringify(legacyCareer()))
    const store = new CareerProfileStore(storage)
    const migrated = store.loadChecked().profile!
    expect(migrated.playerAerialState?.hp).toBe(45.5)
    expect(migrated.townPatrols?.viking?.squads[0].members).toMatchObject({
      'town-patrol:a:0': { hp: 67.5, mount: { hp: 80 } },
      'town-patrol:a:1': { hp: 0, status: 'dead' },
      'town-patrol:a:captain': { hp: 250 },
    })
    expect(JSON.parse(storage.getItem(CAREER_STORAGE_KEY)!).healthRulesVersion).toBe(1)
    expect(store.loadChecked().profile).toEqual(migrated)
  })

  it('keeps borrowed field residents at their formal tier while newly spawned mission soldiers use the roster tier', () => {
    const profile = createCareerProfile('viking')
    profile.rank = 'veteran'
    profile.ownedMounts = ['horse']
    profile.completedCareerMissionTemplateIds = [...VETERAN_MISSION_IDS]
    const accepted = acceptVeteranMission(profile, 'veteran-village-intercept', {
      missionId: 'borrowed-health', townCavalryReserveActorIds: [undefined, undefined, 'cavalry-training:lancer_cavalry:0'],
    })!
    delete accepted.healthRulesVersion
    const mission = accepted.activeMission!
    const roster = createVeteranRoster('veteran-village-intercept', 'viking', mission.id, mission.veteranRosterVersion, mission.borrowedActorIds)
    restoreVeteranTownCavalryReserveRoster(roster, mission)
    const borrowed = roster.friendly.find(unit => unit.source === 'town' && unit.tier === 3)!
    const temporary = roster.friendly.find(unit => unit.source === 'temporary' && unit.tier === 3 && unit.actorId.includes(':reserve-'))!
    expect(borrowed.actorId).toBe('cavalry-training:lancer_cavalry:0')
    mission.actorHealth = { [borrowed.actorId]: { hp: 100 }, [temporary.actorId]: { hp: 100 } }
    migrateCareerHealth(accepted)
    expect(mission.actorHealth[borrowed.actorId].hp).toBe(67.5)
    expect(mission.actorHealth[temporary.actorId].hp).toBe(90)
    migrateCareerHealth(accepted)
    expect(mission.actorHealth[borrowed.actorId].hp).toBe(67.5)
  })

  it('migrates independent eagle rider wounds by their own faction without scaling mounts', () => {
    const profile = legacyCareer()
    const position = { x: 0, y: 0, z: 0, yaw: 0 }
    profile.enemyEaglePatrols = { roman: { version: 1, pairs: [{
      id: 1, generation: 0, state: 'PATROLLING', waypoint: 0, elapsed: 0, restRemaining: 0,
      respawnRemaining: 0, home: position,
      member: { status: 'deployed', hp: 100, mount: { hp: 80, mounted: true, position } },
    }] } }
    profile.townEagleGarrisons = { viking: { version: 1, sceneKey: 'town-home', pairs: [{
      riderId: 'town-eagle-rider:0', mountId: 'eagle:0', homePadId: 'pad:0', duty: 'patrolling',
      hp: 180, ammo: 10, position, mounted: true, refitAllowed: false,
      mount: { hp: 80, position, flight: { phase: 'cruise', yaw: 0, pitch: 0, bank: 0, speed: 10,
        velocity: { x: 0, y: 0, z: 10 } } },
    }] } }
    migrateCareerHealth(profile)
    expect(profile.enemyEaglePatrols.roman!.pairs[0].member).toMatchObject({ hp: 90, mount: { hp: 80 } })
    expect(profile.townEagleGarrisons.viking!.pairs[0]).toMatchObject({ hp: 162, mount: { hp: 80 } })
    migrateCareerHealth(profile)
    expect(profile.townEagleGarrisons.viking!.pairs[0].hp).toBe(162)
  })

  it('migrates temporary sweep recruits without downgrading borrowed resident health', () => {
    const profile = legacyCareer()
    const mission = createCavalrySweepMission('health-sweep', [undefined, 'cavalry-training:lancer_cavalry:0'])
    profile.activeMission = mission
    const resident = mission.friendlyActorIds[1], recruit = mission.friendlyActorIds[2]
    mission.actorHealth = { [resident]: { hp: 100 }, [recruit]: { hp: 100 } }
    migrateCareerHealth(profile)
    expect(mission.actorHealth[resident].hp).toBe(67.5)
    expect(mission.actorHealth[recruit].hp).toBe(45)
  })

  it('resolves Captain aerial and Frontline wave identities before migrating their saved wounds', () => {
    const aerial = legacyCareer()
    aerial.rank = 'captain'
    aerial.activeMission = { id: 'air', templateId: 'captain-eagle-battle', kind: 'captain-eagle-battle',
      targetCampId: -1, phase: 'ENGAGING', acceptedAt: 0,
      friendlyActorIds: ['air:eagle:friendly:0'], targetActorIds: ['air:eagle:enemy:0'],
      actorHealth: { 'air:eagle:friendly:0': { hp: 100 }, 'air:eagle:enemy:0': { hp: 100 } } }
    migrateCareerHealth(aerial)
    expect(aerial.activeMission.actorHealth).toEqual({
      'air:eagle:friendly:0': { hp: 90 }, 'air:eagle:enemy:0': { hp: 100 },
    })
    const frontline = legacyCareer()
    frontline.rank = 'captain'
    frontline.activeMission = { id: 'front', templateId: 'captain-frontline-command', kind: 'captain-outpost-defense',
      targetCampId: -1, phase: 'ENGAGING', acceptedAt: 0, friendlyActorIds: [], targetActorIds: [],
      actorHealth: { 'front:initial:0': { hp: 100 }, 'front:reinforcement:0': { hp: 100 },
        'front:attackers:0': { hp: 100 } } }
    migrateCareerHealth(frontline)
    expect(frontline.activeMission.actorHealth).toEqual({
      'front:initial:0': { hp: 90 }, 'front:reinforcement:0': { hp: 90 }, 'front:attackers:0': { hp: 100 },
    })
  })

  it('keeps duel equipment tier independent from the resident and native Town health', () => {
    const profile = legacyCareer(), id = 'cavalry-training:lancer_cavalry:0'
    profile.activeMission = { id: 'duel-health', templateId: 'duel', kind: 'duel', targetCampId: -1,
      phase: 'ENGAGING', acceptedAt: 0, friendlyActorIds: [], targetActorIds: [id],
      duelTier: 3, duelOpponentActorId: id, duelOpponentHp: 100 }
    profile.townCommandSquad = { type: 'town-command', townFaction: 'viking', squadId: 1,
      actorIds: [id], contribution: { damageDealt: 0, kills: 0, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0 }, state: 'FOLLOWING', authorized: true,
      sceneKey: 'town-home', members: { [id]: { status: 'deployed', hp: 100 } } }
    migrateCareerHealth(profile)
    expect(profile.activeMission.duelOpponentHp).toBe(67.5)
    expect(profile.townCommandSquad!.members![id].hp).toBe(67.5)
  })

  it('migrates borrowed siege cavalry as T2 while temporary army soldiers stay T3', () => {
    const profile = createCareerProfile('roman')
    delete profile.healthRulesVersion
    const mission = profile.activeMission = createTownDefenseMission([], [], 'health-siege')
    const roster = siegeRoster('viking', false, 2)
    const slot = roster.findIndex(({ spec }) => spec.tier === 3 && spec.presetId?.endsWith('_lancer'))
    expect(slot).toBeGreaterThanOrEqual(0)
    const borrowed = 'outskirts:cavalry:a:0:wave:2', temporary = `health-siege:siege:${slot + 1}`
    mission.siege!.attackerIds = roster.map((_, index) => index === slot ? borrowed : `health-siege:siege:${index}`)
    mission.siege!.rosterCreated = true
    mission.actorHealth = { [borrowed]: { hp: 100 }, [temporary]: { hp: 100 } }
    migrateCareerHealth(profile)
    expect(mission.actorHealth[borrowed].hp).toBe(67.5)
    expect(mission.actorHealth[temporary].hp).toBe(90)
  })

  it('migrates both Four Gate actor snapshots so nested siege restore cannot overwrite new HP', () => {
    const profile = createCareerProfile('roman')
    delete profile.healthRulesVersion
    const mission = profile.activeMission = createTownDefenseMission([], [], 'four-health')
    const state = mission.fourGateDefense = createCommanderFourGateDefenseState()
    const attacker = createCommanderFourGateDefenseRoster(mission.id, 'viking').all.find(spec => spec.tier === 3)!.actorId!
    const defender = 'cavalry-training:lancer_cavalry:0'
    state.actors = { [attacker]: { status: 'deployed', hp: 100 } }
    state.siege = { version: 1, faction: 'viking', gates: [], ramps: [], playerCommandedActorIds: [], actors: {
      [attacker]: { status: 'deployed', hp: 100, entranceId: null, breachCompleted: false },
      [defender]: { status: 'deployed', hp: 100, entranceId: null, breachCompleted: false },
    } }
    migrateCareerHealth(profile)
    expect(state.actors[attacker].hp).toBe(90)
    expect(state.siege.actors[attacker].hp).toBe(90)
    expect(state.siege.actors[defender].hp).toBe(75)
  })

  it('does not expose a half-migrated Career profile when the durable write fails', () => {
    const storage = new MemoryStorage()
    const original = JSON.stringify(legacyCareer())
    storage.setItem(CAREER_STORAGE_KEY, original)
    storage.failWrites = true
    const result = new CareerProfileStore(storage).loadChecked()
    expect(result.profile).toBeNull()
    expect(result.error).toBeDefined()
    expect(storage.getItem(CAREER_STORAGE_KEY)).toBe(original)
  })

  it('restores regular-save identity and measured HP ratio, conservatively clamping unknown legacy maxima', () => {
    const storage = new MemoryStorage(), store = new SaveManager(storage)
    const saved = { ...DEFAULT_SAVE, hp: 60, maxHp: 240, healthRulesVersion: 1 as const,
      characterTier: 1 as const, characterFaction: 'roman' as const, baseMaxHpOverride: 220 }
    expect(store.save(saved)).toBe(true)
    const loaded = store.load()
    expect(loaded).toMatchObject({ maxHp: 240, characterTier: 1, characterFaction: 'roman', baseMaxHpOverride: 220 })
    expect(restoreSavedPlayerHp(loaded, 120)).toBe(30)
    expect(restoreSavedPlayerHp({ hp: 60 }, 90)).toBe(60)
    expect(restoreSavedPlayerHp({ hp: 150 }, 90)).toBe(90)
    expect(restoreSavedPlayerHp({ hp: 0, maxHp: 240 }, 120)).toBe(0)
    const restored = { ...loaded, hp: restoreSavedPlayerHp(loaded, 120), maxHp: 120 }
    expect(restoreSavedPlayerHp(restored, 120)).toBe(30)
  })
})
