import { describe, expect, it } from 'vitest'
import { getCareerMissionTemplate } from '../../src/career/CareerMissionCatalog'
import { careerMissionCompletionsForTier, claimCareerMission, clearCareerMission, createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { parseCareerProfile } from '../../src/career/CareerProfileStore'
import { createVeteranRoster, getVeteranMissionAvailability, VETERAN_MISSION_CATALOG, acceptVeteranMission, createVeteranSpawnSpec } from '../../src/career/VeteranMission'
import { UNIT_PRESETS } from '../../src/battle/UnitPresetCatalog'
import { T4_UNIT_PROFILES } from '../../src/battle/T4HeroCatalog'
import { townRoster } from '../../src/town/TownRules'

const victoryStats = { damageDealt: 50, damageTaken: 0, kills: 2, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived: true }
const veteran = (): CareerProfile => ({ ...createCareerProfile('roman'), rank: 'veteran', totalMerit: 900, availableMerit: 900 })
const horseVeteran = (): CareerProfile => ({ ...veteran(), ownedMounts: ['horse'] })
const withVeteranProgress = (profile: CareerProfile, unlockedIndex: number): CareerProfile => ({
  ...profile, completedCareerMissionTemplateIds: VETERAN_IDS.slice(0, unlockedIndex),
})
const VETERAN_IDS = [
  'veteran-dread-outpost', 'veteran-scout-hunters', 'veteran-village-intercept',
  'veteran-outpost-assault', 'veteran-spear-line-hunt', 'veteran-tragedy-of-the-scouts',
] as const

describe('Veteran Career mission catalog and progression', () => {
  it('exposes all six templates through the generic active-mission parser lookup', () => {
    expect(VETERAN_MISSION_CATALOG.map(mission => mission.id)).toEqual(VETERAN_IDS)
    for (const id of VETERAN_IDS) expect(getCareerMissionTemplate(id)?.id).toBe(id)
  })

  it('locks the page below Veteran, opens I at Veteran, and persists sequential victory unlocks', () => {
    const recruit = createCareerProfile('roman')
    const soldier = { ...recruit, rank: 'soldier' as const, totalMerit: 300 }
    for (const id of VETERAN_IDS) {
      expect(getVeteranMissionAvailability(recruit, id).unlocked).toBe(false)
      expect(getVeteranMissionAvailability(soldier, id).unlocked).toBe(false)
    }
    let profile = veteran()
    expect(getVeteranMissionAvailability(profile, VETERAN_IDS[0]).unlocked).toBe(true)
    expect(getVeteranMissionAvailability(profile, VETERAN_IDS[1]).unlocked).toBe(false)

    for (let index = 0; index < VETERAN_IDS.length; index++) {
      const id = VETERAN_IDS[index]
      profile = { ...profile, ownedMounts: id === VETERAN_IDS[0] ? [] : ['horse'] }
      const accepted = acceptVeteranMission(profile, id, { missionId: `claim-${id}`, acceptedAt: 1 })
      expect(accepted).not.toBeNull()
      if (index === 0) profile = { ...accepted!, ownedMounts: ['horse'] }
      else profile = accepted!
      const failed = claimCareerMission(profile, profile.activeMission!.id, 'failure', victoryStats)
      expect(failed.profile.completedCareerMissionTemplateIds ?? []).not.toContain(id)
      expect(getVeteranMissionAvailability(clearCareerMission(failed.profile, profile.activeMission!.id), id).unlocked).toBe(true)

      const mission = acceptVeteranMission(clearCareerMission(profile, profile.activeMission!.id), id, { missionId: `won-${id}`, acceptedAt: 2 })!
      const claim = claimCareerMission(mission, mission.activeMission!.id, 'victory', victoryStats)
      expect(claim.alreadyClaimed).toBe(false)
      expect(claim.profile.completedCareerMissionTemplateIds).toContain(id)
      const restored = parseCareerProfile(JSON.parse(JSON.stringify(claim.profile)))!
      const duplicate = claimCareerMission(restored, restored.activeMission!.id, 'victory', victoryStats)
      expect(duplicate.alreadyClaimed).toBe(true)
      profile = clearCareerMission(duplicate.profile, duplicate.profile.activeMission!.id)
      expect(careerMissionCompletionsForTier(profile, 3)).toBe(index + 1)
      if (index + 1 < VETERAN_IDS.length) expect(getVeteranMissionAvailability(profile, VETERAN_IDS[index + 1]).unlocked).toBe(true)
    }
    expect(getVeteranMissionAvailability(profile, VETERAN_IDS[0]).unlocked).toBe(true)
  })

  it('requires a currently legal owned mount for II–VI, while Dread Outpost stays available', () => {
    const profile = withVeteranProgress(veteran(), VETERAN_IDS.length)
    expect(getVeteranMissionAvailability(profile, VETERAN_IDS[0]).unlocked).toBe(true)
    for (const id of VETERAN_IDS.slice(1)) {
      expect(getVeteranMissionAvailability(profile, id)).toMatchObject({ unlocked: false, reason: '需要坐騎' })
    }
    const withMount: CareerProfile = { ...profile, ownedMounts: ['horse'] }
    expect(getVeteranMissionAvailability(withMount, VETERAN_IDS[1]).unlocked).toBe(true)
  })

  it('creates exact army sizes, tiers, and squad counts for all six missions', () => {
    const expected = [
      [100, 50, 50, [25, 25, 25, 25]],
      [100, 40, 0, [25, 25, 25, 25]],
      [50, 100, 0, [25, 25]],
      [100, 100, 0, [25, 25, 25, 25]],
      [50, 100, 0, [25, 25]],
      [20, 100, 0, [10, 10]],
    ] as const
    VETERAN_IDS.forEach((id, index) => {
      const [friendly, enemy, reinforcements, squads] = expected[index]
      const roster = createVeteranRoster(id, 'roman', `roster-${id}`)
      expect(roster).toMatchObject({ friendlyTotal: friendly, enemyTotal: enemy, reinforcementTotal: reinforcements, squadSizes: [...squads] })
      expect(roster.friendly.length + Number(roster.playerIncluded)).toBe(friendly)
      expect(roster.enemy.length).toBe(enemy)
      expect(roster.reinforcements.length).toBe(reinforcements)
      expect(new Set([...roster.friendly, ...roster.enemy, ...roster.reinforcements].map(unit => unit.actorId)).size)
        .toBe(roster.friendly.length + roster.enemy.length + roster.reinforcements.length)
      const opposing = roster.enemy.every(unit => unit.presetId.startsWith('viking_'))
      expect(opposing).toBe(true)
      const viking = createVeteranRoster(id, 'viking', `viking-${id}`)
      expect(new Set([...viking.friendly, ...viking.enemy, ...viking.reinforcements].map(unit => unit.actorId)).size)
        .toBe(viking.friendly.length + viking.enemy.length + viking.reinforcements.length)
      expect(viking.enemy.every(unit => unit.presetId.startsWith('roman_'))).toBe(true)
      if (id === VETERAN_IDS[5]) {
        expect(roster.enemy.every(unit => unit.mounted)).toBe(true)
        expect(roster.enemy.filter(unit => unit.tier === 4).every(unit => unit.heroRole === 'captain' || unit.heroRole === 'ranger')).toBe(true)
        const enemySpecs = roster.enemy.map(unit => createVeteranSpawnSpec(unit, 'roman', 'enemy'))
        expect(enemySpecs).toHaveLength(100)
        expect(enemySpecs.every(spec => spec.cavalry && spec.characterFaction === 'viking')).toBe(true)
        expect(enemySpecs.filter(spec => spec.tier === 4).every(spec => spec.combatProfileId && spec.visualAssetId)).toBe(true)
      }
      for (let squadId = 1; squadId <= squads.length; squadId++) {
        const members = roster.friendly.filter(unit => unit.squadId === squadId).length + (squadId === 1 ? 1 : 0)
        expect(members).toBe(squads[squadId - 1])
      }
    })
  })

  it('splits the 100-enemy Village and Outpost groups into four actual 25-person squads', () => {
    for (const id of [VETERAN_IDS[2], VETERAN_IDS[3]]) {
      const roster = createVeteranRoster(id, 'roman', `enemy-squads-${id}`)
      const squadSizes = [...new Set(roster.enemy.map(unit => unit.squadId))]
        .sort((a, b) => a - b)
        .map(squadId => roster.enemy.filter(unit => unit.squadId === squadId).length)
      expect(squadSizes).toEqual([25, 25, 25, 25])
      expect(roster.enemy.filter(unit => unit.leader && unit.tier === 4)).toHaveLength(2)
      expect(roster.enemy.filter(unit => unit.presetId === 'viking_archer' && unit.tier === (id === VETERAN_IDS[2] ? 3 : 4))).toHaveLength(id === VETERAN_IDS[2] ? 49 : 2)
      if (id === VETERAN_IDS[2]) {
        expect(countPreset(roster.enemy, 'viking_berserker', 3)).toBe(49)
        expect(roster.enemy.filter(unit => unit.mounted)).toHaveLength(0)
      } else {
        expect(countPreset(roster.enemy, 'viking_horse_archer', 3)).toBe(49)
        expect(roster.enemy.filter(unit => unit.mounted)).toHaveLength(50)
      }
    }
  })

  it('uses exact ordinary T3 preset distributions and actual T4 profiles', () => {
    const two = createVeteranRoster(VETERAN_IDS[1], 'roman', 'scout')
    expect(countPreset(two.friendly, 'roman_lancer', 3)).toBe(45)
    expect(countPreset(two.friendly, 'roman_sword_cavalry', 3)).toBe(25)
    expect(countPreset(two.friendly, 'roman_horse_archer', 3)).toBe(25)
    expect(countPreset(two.enemy, 'viking_lancer', 4)).toBe(20)
    expect(countPreset(two.enemy, 'viking_archer', 4)).toBe(20)
    expect(two.enemy.every(unit => unit.tier === 4 && unit.source === 'mission')).toBe(true)
    const enemyRanger = createVeteranSpawnSpec(two.enemy.find(unit => unit.heroRole === 'ranger')!, 'roman', 'enemy')
    expect(enemyRanger).toMatchObject({ characterFaction: 'viking', tier: 4, visualAssetId: 'maki-archer-t4', combatProfileId: 'ranger', specialCombatProfile: 'maki-ranger' })

    const one = createVeteranRoster(VETERAN_IDS[0], 'roman', 'dread')
    expect(countPreset(one.friendly, 'roman_spearman', 3)).toBe(24)
    expect(countPreset(one.friendly, 'roman_heavy_infantry', 3)).toBe(24)
    expect(countPreset(one.friendly, 'roman_horse_archer', 3)).toBe(24)
    expect(countPreset(one.friendly, 'roman_lancer', 3)).toBe(23)
    expect(countPreset(one.enemy, 'viking_lancer', 4)).toBe(25)
    expect(countPreset(one.enemy, 'viking_archer', 4)).toBe(25)
    expect(one.enemy.filter(unit => unit.heroRole === 'ranger').every(unit => unit.mounted)).toBe(true)
    expect(countPreset(one.reinforcements, 'roman_lancer', 3)).toBe(48)
    expect(one.reinforcements.filter(unit => unit.tier === 4).length).toBe(2)
    expect(one.reinforcements.filter(unit => unit.tier === 4 && unit.heroRole === 'ranger').length).toBe(1)
    for (const unit of [...one.friendly, ...two.friendly, ...two.enemy]) {
      if (unit.tier === 3) expect(createVeteranSpawnSpec(unit, 'roman').loadout).toEqual(UNIT_PRESETS[unit.presetId].tierLoadouts[3])
      else expect(T4_UNIT_PROFILES[unit.presetId]).toBeDefined()
    }
  })

  it('uses nineteen T4 Captain and mounted Ranger NPCs in new VI runs while preserving legacy version-one rosters', () => {
    const vi = VETERAN_IDS[5]
    const briefing = VETERAN_MISSION_CATALOG[5].briefing
    expect(briefing).toContain('敵方城鎮的騎兵出城迎擊')
    expect(briefing).toContain('9 名 T4 隊長')
    expect(briefing).toContain('10 名 T4 弓騎斥候')
    expect(briefing).toContain('20 人')
    expect(briefing).toContain('02:00')
    const roster = createVeteranRoster(vi, 'roman', 'new-vi')
    expect(roster).toMatchObject({ friendlyTotal: 20, squadSizes: [10, 10] })
    expect(roster.friendly).toHaveLength(19)
    expect(roster.friendly.every(unit => unit.tier === 4)).toBe(true)
    expect(roster.friendly.filter(unit => unit.heroRole === 'captain')).toHaveLength(9)
    expect(roster.friendly.filter(unit => unit.heroRole === 'ranger')).toHaveLength(10)
    expect(roster.friendly.filter(unit => unit.source === 'town').map(unit => unit.actorId)).toEqual(['captain', 'ranger'])
    expect(roster.friendly.filter(unit => unit.source === 'temporary')).toHaveLength(17)
    expect(roster.friendly.filter(unit => unit.squadId === 1)).toHaveLength(9)
    expect(roster.friendly.filter(unit => unit.squadId === 2)).toHaveLength(10)
    expect(roster.friendly.filter(unit => unit.squadId === 1 && unit.leader).map(unit => unit.actorId)).toEqual(['captain'])
    expect(roster.friendly.filter(unit => unit.squadId === 2 && unit.leader).map(unit => unit.actorId)).toEqual(['ranger'])
    expect(roster.friendly.filter(unit => unit.heroRole === 'ranger').every(unit => unit.mounted)).toBe(true)

    const captain = createVeteranSpawnSpec(roster.friendly.find(unit => unit.heroRole === 'captain')!, 'roman')
    expect(captain).toMatchObject({ tier: 4, visualAssetId: T4_UNIT_PROFILES.roman_sword_cavalry.visualAssetId, combatProfileId: T4_UNIT_PROFILES.roman_sword_cavalry.combatProfileId, cavalry: true })
    expect(captain.loadout).toEqual({ ...UNIT_PRESETS.roman_sword_cavalry.tierLoadouts[3], mountId: T4_UNIT_PROFILES.roman_sword_cavalry.mountOverride })
    const ranger = createVeteranSpawnSpec(roster.friendly.find(unit => unit.heroRole === 'ranger')!, 'roman')
    expect(ranger).toMatchObject({ tier: 4, visualAssetId: 'maki-archer-t4', combatProfileId: 'ranger', specialCombatProfile: 'maki-ranger', cavalry: true, loadout: { mountId: 'black-cat' } })
    for (const unit of roster.friendly) {
      const spec = createVeteranSpawnSpec(unit, 'roman')
      const t4Profile = T4_UNIT_PROFILES[unit.presetId]
      expect(spec).toMatchObject({ tier: 4, visualAssetId: t4Profile.visualAssetId, combatProfileId: t4Profile.combatProfileId })
      const expectedTier3Loadout = { ...UNIT_PRESETS[unit.presetId].tierLoadouts[3] }
      const spawnLoadout = { ...spec.loadout! }
      delete expectedTier3Loadout.mountId
      delete spawnLoadout.mountId
      expect(spawnLoadout).toEqual(expectedTier3Loadout)
      expect(spec.loadout!.mountId).toBe(unit.heroRole === 'ranger' ? 'black-cat' : t4Profile.mountOverride)
      if (unit.heroRole === 'ranger') expect(spec).toMatchObject({ specialCombatProfile: 'maki-ranger', cavalry: true })
    }
    const vikingRoster = createVeteranRoster(vi, 'viking', 'new-vi-viking')
    for (const unit of vikingRoster.friendly) {
      const spec = createVeteranSpawnSpec(unit, 'viking')
      const t4Profile = T4_UNIT_PROFILES[unit.presetId]
      expect(spec).toMatchObject({ tier: 4, visualAssetId: t4Profile.visualAssetId, combatProfileId: t4Profile.combatProfileId })
    }

    const legacy = createVeteranRoster(vi, 'roman', 'legacy-vi', 1)
    expect(legacy.friendly).toHaveLength(19)
    expect(legacy.friendly.filter(unit => unit.source === 'town')).toHaveLength(16)
    expect(legacy.friendly.filter(unit => unit.source === 'temporary')).toHaveLength(3)
    expect(legacy.friendly.filter(unit => unit.tier === 3)).toHaveLength(17)
    const accepted = acceptVeteranMission(withVeteranProgress(horseVeteran(), 5), vi, { missionId: 'new-vi-acceptance', acceptedAt: 20 })!
    expect(accepted.activeMission).toMatchObject({ veteranRosterVersion: 2, borrowedActorIds: ['captain', 'ranger'] })
    const loadedNew = parseCareerProfile(JSON.parse(JSON.stringify(accepted)))!
    expect(loadedNew.activeMission?.veteranRosterVersion).toBe(2)
    const oldMission = { ...accepted.activeMission!, veteranRosterVersion: undefined,
      friendlyActorIds: legacy.friendly.map(unit => unit.actorId),
      borrowedActorIds: legacy.friendly.filter(unit => unit.source === 'town').map(unit => unit.actorId),
      deadFriendlyActorIds: ['lancer_cavalry-0'],
    }
    const loadedOld = parseCareerProfile(JSON.parse(JSON.stringify({ ...accepted, activeMission: oldMission })))!
    expect(loadedOld.activeMission?.veteranRosterVersion).toBeUndefined()
    expect(loadedOld.activeMission?.friendlyActorIds).toEqual(oldMission.friendlyActorIds)
    expect(loadedOld.activeMission?.borrowedActorIds).toEqual(oldMission.borrowedActorIds)
    expect(loadedOld.activeMission?.deadFriendlyActorIds).toEqual(['lancer_cavalry-0'])
  })

  it('reuses stable Town actors and persists borrowed identity through mission reload', () => {
    const expectations = [
      [VETERAN_IDS[1], ['captain', 'ranger', 'lancer_cavalry-0', 'melee_cavalry-0', 'ranged_cavalry-0']],
      [VETERAN_IDS[2], ['captain', 'ranger', 'cavalry-training:lancer_cavalry:0']],
      [VETERAN_IDS[4], ['ranger', 'cavalry-training:melee_cavalry:0']],
    ] as const
    for (const [id, required] of expectations) {
      const mission = acceptVeteranMission(withVeteranProgress(horseVeteran(), VETERAN_IDS.indexOf(id)), id, { missionId: `borrow-${id}`, acceptedAt: 10 })
      expect(mission).not.toBeNull()
      expect(mission!.activeMission!.borrowedActorIds).toEqual(expect.arrayContaining([...required]))
      const loaded = parseCareerProfile(JSON.parse(JSON.stringify(mission)))!
      expect(loaded.activeMission!.borrowedActorIds).toEqual(mission!.activeMission!.borrowedActorIds)
      expect(loaded.activeMission!.friendlyActorIds).toEqual(mission!.activeMission!.friendlyActorIds)
    }
  })

  it.each(['roman', 'viking'] as const)('reequips the required %s city cavalry before requesting support', faction => {
    const townCavalry = townRoster().filter(actor => actor.role.endsWith('_cavalry')).map(actor => actor.id)
    for (const [id, role, supports] of [
      [VETERAN_IDS[2], 'lancer', 0], [VETERAN_IDS[4], 'horse_archer', 1],
    ] as const) {
      const roster = createVeteranRoster(id, faction, `equip-${id}`)
      const ordinary = roster.friendly.filter(unit => unit.tier === 3)
      expect(ordinary).toHaveLength(47)
      expect(ordinary.filter(unit => unit.source === 'town').map(unit => unit.actorId)).toEqual(townCavalry.slice(0, 47))
      expect(roster.friendly.filter(unit => unit.source === 'temporary')).toHaveLength(supports)
      for (const unit of ordinary) {
        expect(unit.presetId).toBe(`${faction}_${role}`)
        expect(createVeteranSpawnSpec(unit, faction).loadout).toEqual(UNIT_PRESETS[unit.presetId].tierLoadouts[3])
      }
      expect(roster.squadSizes).toEqual([25, 25])
      expect(new Set(roster.friendly.map(unit => unit.actorId)).size).toBe(49)
    }
  })

  it.each([VETERAN_IDS[2], VETERAN_IDS[4]])('persists only available Town cavalry and the exact shortage for %s', id => {
    for (const available of [[], ['cavalry-training:ranged_cavalry:7', 'cavalry-training:melee_cavalry:3', 'cavalry-training:lancer_cavalry:1']] as string[][]) {
      const accepted = acceptVeteranMission(withVeteranProgress(horseVeteran(), VETERAN_IDS.indexOf(id)), id, {
        missionId: `available-${id}`, availableTownCavalryActorIds: [...available, 'civilian-0', ...available],
      })!
      expect(accepted.activeMission?.veteranRosterVersion).toBe(3)
      const loaded = parseCareerProfile(JSON.parse(JSON.stringify(accepted)))!
      const active = loaded.activeMission!
      const roster = createVeteranRoster(id, loaded.faction, active.id, active.veteranRosterVersion, active.borrowedActorIds)
      const ordinary = roster.friendly.filter(unit => unit.tier === 3)
      expect(ordinary.filter(unit => unit.source === 'town').map(unit => unit.actorId).sort()).toEqual([...available].sort())
      expect(ordinary.filter(unit => unit.source === 'temporary')).toHaveLength(47 - available.length)
      expect(roster.friendly.map(unit => unit.actorId)).toEqual(active.friendlyActorIds)
      expect(roster.friendly.filter(unit => unit.source === 'town').map(unit => unit.actorId)).toEqual(active.borrowedActorIds)
    }
  })

  it('preserves existing version-one and version-two field mission identities', () => {
    expect(createVeteranRoster(VETERAN_IDS[2], 'roman', 'old-village', 1).friendly.filter(unit => unit.source === 'town')).toHaveLength(7)
    expect(createVeteranRoster(VETERAN_IDS[4], 'roman', 'old-hunt', 2).friendly.filter(unit => unit.source === 'town')).toHaveLength(11)
  })

  it('round-trips Veteran active checkpoint state and treats pre-tier-3 saves as zero Veteran progress', () => {
    const profile = veteran()
    profile.careerMissionCompletionsByTier = { 1: 7, 2: 4, 3: 2 }
    const active = acceptVeteranMission(horseVeteran(), VETERAN_IDS[5], { missionId: 'checkpoint', acceptedAt: 25 })
    expect(active).toBeNull() // VI is still progression locked
    const first = acceptVeteranMission(horseVeteran(), VETERAN_IDS[0], { missionId: 'checkpoint', acceptedAt: 25 })!
    Object.assign(first.activeMission!, {
      survivalElapsed: 37.5,
      chargedSquadIds: [1, 2],
      reinforcementElapsed: 90,
      reinforcementSpawned: true,
      reinforcementActorIds: first.activeMission!.reinforcementActorIds,
      deadFriendlyActorIds: [first.activeMission!.reinforcementActorIds![0]],
      actorHealth: { [first.activeMission!.reinforcementActorIds![1]]: { hp: 14, mountHp: 6 } },
      playerHp: 40,
      playerStamina: 12,
    })
    const loaded = parseCareerProfile(JSON.parse(JSON.stringify(first)))!
    expect(loaded.activeMission).toMatchObject({ survivalElapsed: 37.5, chargedSquadIds: [1, 2], reinforcementElapsed: 90, reinforcementSpawned: true, deadFriendlyActorIds: [first.activeMission!.reinforcementActorIds![0]], actorHealth: { [first.activeMission!.reinforcementActorIds![1]]: { hp: 14, mountHp: 6 } }, playerHp: 40, playerStamina: 12 })
    expect(parseCareerProfile(JSON.parse(JSON.stringify(profile)))?.careerMissionCompletionsByTier).toEqual({ 1: 7, 2: 4, 3: 2 })
    const legacy = { ...profile, careerMissionCompletionsByTier: { 1: 7, 2: 4 } }
    expect(parseCareerProfile(JSON.parse(JSON.stringify(legacy)))?.careerMissionCompletionsByTier).toEqual({ 1: 7, 2: 4, 3: 0 })
  })
})

function countPreset(units: ReturnType<typeof createVeteranRoster>['friendly'], presetId: string, tier: number): number {
  return units.filter(unit => unit.presetId === presetId && unit.tier === tier).length
}
