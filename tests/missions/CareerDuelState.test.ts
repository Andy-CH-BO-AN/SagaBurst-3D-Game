import { describe, expect, it } from 'vitest'
import { ROMAN_PRESET_IDS, VIKING_PRESET_IDS, type UnitPresetId, type UnitTier } from '../../src/battle/UnitPresetCatalog'
import { Faction } from '../../src/world/NPC'
import type { CombatEvent } from '../../src/combat/CombatAttribution'
import {
  CAREER_DUEL_TEMPLATE_ID, careerDuelPresets, createCareerDuelMission,
  isCareerDuelUnlocked, resolveCareerDuelOutcome,
} from '../../src/career/CareerDuelState'
import { acceptsCareerMissionStat } from '../../src/career/CareerMissionState'
import { claimCareerMission, clearCareerMission, cloneCareerProfile, createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { CAREER_STORAGE_KEY, CareerProfileStore, parseCareerProfile } from '../../src/career/CareerProfileStore'

const stats = { damageDealt: 160, damageTaken: 20, kills: 1, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived: true }

function duel(profile: CareerProfile, presetId: UnitPresetId, tier: UnitTier, id = `${presetId}-${tier}`): CareerProfile {
  const activeMission = createCareerDuelMission(profile, presetId, tier, 'soldier-1', 'captain', id)
  expect(activeMission).not.toBeNull()
  return { ...profile, activeMission: activeMission! }
}

function win(profile: CareerProfile, presetId: UnitPresetId, tier: UnitTier, id?: string): CareerProfile {
  const current = duel(profile, presetId, tier, id)
  const claim = claimCareerMission(current, current.activeMission!.id, 'victory', stats)
  return clearCareerMission(claim.profile, current.activeMission!.id)
}

describe('Career Duel progression per unit preset', () => {
  it.each(['roman', 'viking'] as const)('offers every %s preset with only T1 initially unlocked', faction => {
    const profile = createCareerProfile(faction)
    expect(careerDuelPresets(faction).map(preset => preset.id)).toEqual(faction === 'roman' ? ROMAN_PRESET_IDS : VIKING_PRESET_IDS)
    for (const preset of careerDuelPresets(faction)) {
      expect(isCareerDuelUnlocked(profile, preset.id, 1)).toBe(true)
      for (const tier of [2, 3, 4] as const) expect(isCareerDuelUnlocked(profile, preset.id, tier)).toBe(false)
    }
  })

  it('unlocks Archer tiers in order and never unlocks other units', () => {
    let profile = createCareerProfile('roman')
    for (const tier of [1, 2, 3] as const) {
      profile = win(profile, 'roman_archer', tier)
      expect(profile.duelHighestDefeatedTierByPreset).toEqual({ roman_archer: tier })
      expect(isCareerDuelUnlocked(profile, 'roman_archer', (tier + 1) as UnitTier)).toBe(true)
      if (tier < 3) expect(isCareerDuelUnlocked(profile, 'roman_archer', (tier + 2) as UnitTier)).toBe(false)
      for (const other of ['roman_spearman', 'roman_heavy_infantry', 'roman_sword_cavalry', 'roman_lancer', 'roman_horse_archer', 'roman_javelin_infantry'] as const) {
        expect(isCareerDuelUnlocked(profile, other, 1)).toBe(true)
        expect(isCareerDuelUnlocked(profile, other, 2)).toBe(false)
      }
    }
    profile = win(profile, 'roman_archer', 4)
    for (const tier of [1, 2, 3, 4] as const) expect(isCareerDuelUnlocked(profile, 'roman_archer', tier)).toBe(true)
  })

  it('keeps concurrent Archer, Spearman and Cavalry progress independent, including through reload', () => {
    let profile = win(createCareerProfile('roman'), 'roman_archer', 1)
    profile = win(profile, 'roman_archer', 2)
    profile = win(profile, 'roman_archer', 3)
    profile = win(profile, 'roman_spearman', 1)
    const loaded = parseCareerProfile(JSON.parse(JSON.stringify(profile)))!
    expect(loaded.duelHighestDefeatedTierByPreset).toEqual({ roman_archer: 3, roman_spearman: 1 })
    expect(isCareerDuelUnlocked(loaded, 'roman_archer', 4)).toBe(true)
    expect(isCareerDuelUnlocked(loaded, 'roman_spearman', 2)).toBe(true)
    expect(isCareerDuelUnlocked(loaded, 'roman_spearman', 3)).toBe(false)
    expect(isCareerDuelUnlocked(loaded, 'roman_sword_cavalry', 2)).toBe(false)
  })

  it('does not unlock on failure or reduce progress when replaying a lower tier', () => {
    let profile = win(createCareerProfile('viking'), 'viking_archer', 1)
    profile = win(profile, 'viking_archer', 2)
    profile = win(profile, 'viking_archer', 3)
    const failed = duel(profile, 'viking_spearman', 1, 'failed-spear')
    profile = clearCareerMission(claimCareerMission(failed, 'failed-spear', 'failure', { ...stats, survived: false }).profile, 'failed-spear')
    expect(isCareerDuelUnlocked(profile, 'viking_spearman', 2)).toBe(false)
    profile = win(profile, 'viking_archer', 1, 'repeat-archer')
    expect(profile.duelHighestDefeatedTierByPreset).toEqual({ viking_archer: 3 })
  })

  it('revalidates locked tier, faction and existing missions at acceptance independently of board count or rank', () => {
    const profile = createCareerProfile('roman')
    profile.rank = 'commander'; profile.careerMissionCompletions = 999; profile.careerMissionCompletionsByTier = { 1: 999, 2: 999 }
    expect(createCareerDuelMission(profile, 'roman_archer', 2, 'soldier', 'captain')).toBeNull()
    expect(createCareerDuelMission(profile, 'viking_archer', 1, 'soldier', 'captain')).toBeNull()
    const current = duel(profile, 'roman_archer', 1)
    expect(createCareerDuelMission(current, 'roman_spearman', 1, 'soldier', 'captain')).toBeNull()
    expect(createCareerDuelMission({ ...profile, activeOutpostMission: { id: 'outpost', kind: 'outpost-defense', stageId: 1, acceptedAt: 0 } }, 'roman_archer', 1, 'soldier', 'captain')).toBeNull()
    expect(createCareerDuelMission(profile, 'roman_archer', 1, '', 'captain')).toBeNull()
    expect(createCareerDuelMission(profile, 'roman_archer', 0 as UnitTier, 'soldier', 'captain')).toBeNull()
  })
})

describe('Career Duel settlement and safe storage', () => {
  it('awards normal mission merit and lifetime stats once while preserving both mission board counters', () => {
    let profile = createCareerProfile('roman')
    profile.careerMissionCompletions = 12; profile.careerMissionCompletionsByTier = { 1: 7, 2: 5 }
    profile = duel(profile, 'roman_archer', 1, 'claim-duel')
    profile.activeMission!.phase = 'ENGAGING'
    const claimed = claimCareerMission(profile, 'claim-duel', 'victory', stats)
    expect(claimed.meritAwarded).toBe(26)
    expect(claimed.profile.totalMerit).toBe(26)
    expect(claimed.profile.availableMerit).toBe(26)
    expect(claimed.profile.lifetimeStats).toMatchObject({ battles: 1, victories: 1, damage: 160, kills: 1, deaths: 0 })
    expect(claimed.profile.careerMissionCompletions).toBe(12)
    expect(claimed.profile.careerMissionCompletionsByTier).toEqual({ 1: 7, 2: 5 })
    expect(claimed.profile.activeMission?.result).toMatchObject({ outcome: 'victory', claimed: true, stats, merit: { damage: 8, kills: 6, contribution: 12, total: 26 } })
    const loaded = parseCareerProfile(JSON.parse(JSON.stringify(claimed.profile)))!
    const duplicate = claimCareerMission(loaded, 'claim-duel', 'victory', { ...stats, damageDealt: 999 })
    expect(duplicate.alreadyClaimed).toBe(true)
    expect(duplicate.meritAwarded).toBe(0)
    expect(duplicate.profile.totalMerit).toBe(26)
    expect(duplicate.profile.lifetimeStats.battles).toBe(1)
    expect(duplicate.profile.duelHighestDefeatedTierByPreset).toEqual({ roman_archer: 1 })
  })

  it('does not create board counts for a new profile, and records failure stats without unlocking', () => {
    const current = duel(createCareerProfile('roman'), 'roman_archer', 1, 'first-duel')
    const claimed = claimCareerMission(current, 'first-duel', 'failure', { ...stats, survived: false })
    expect(claimed.profile.careerMissionCompletions).toBeUndefined()
    expect(claimed.profile.careerMissionCompletionsByTier).toBeUndefined()
    expect(claimed.profile.duelHighestDefeatedTierByPreset).toBeUndefined()
    expect(claimed.profile.lifetimeStats).toMatchObject({ battles: 1, victories: 0, deaths: 1, damage: 160, kills: 1 })
  })

  it('round-trips actor identity, countdown, combat time, health, deaths, stats and existing voice marker without refreshing them', () => {
    const profile = duel(createCareerProfile('roman'), 'roman_archer', 1, 'resume-duel')
    Object.assign(profile.activeMission!, { phase: 'ENGAGING', duelCountdownElapsed: 5, duelCombatElapsed: 24.6, duelOpponentHp: 11,
      duelOpponentMountHp: 8, duelOpponentDead: false, playerStats: { ...stats }, playerDead: true, followVoicePlayed: true })
    const values = new Map<string, string>()
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) } as Storage
    const store = new CareerProfileStore(storage)
    expect(store.save(profile)).toBe(true)
    expect(values.has(CAREER_STORAGE_KEY)).toBe(true)
    const loaded = store.load()!
    expect(loaded.activeMission).toMatchObject({ id: 'resume-duel', templateId: CAREER_DUEL_TEMPLATE_ID, kind: 'duel', targetCampId: -1,
      duelTier: 1, duelPresetId: 'roman_archer', duelOpponentActorId: 'soldier-1', duelCaptainActorId: 'captain', duelRefereeActorId: 'captain',
      phase: 'ENGAGING', duelCountdownElapsed: 5, duelCombatElapsed: 24.6, duelOpponentHp: 11, duelOpponentMountHp: 8,
      playerDead: true, followVoicePlayed: true, playerStats: { damageDealt: 160, kills: 1 } })
    profile.activeMission!.phase = 'PREPARING'; profile.activeMission!.duelCountdownElapsed = 3.9
    expect(store.save(profile)).toBe(true)
    expect(store.load()?.activeMission?.duelCountdownElapsed).toBe(3.9)
  })

  it('persists T4 Captain opponent with Maki referee separately', () => {
    const profile = createCareerProfile('roman'); profile.duelHighestDefeatedTierByPreset = { roman_heavy_infantry: 3 }
    profile.activeMission = createCareerDuelMission(profile, 'roman_heavy_infantry', 4, 'captain', 'captain', 'captain-duel', 'ranger')!
    const loaded = parseCareerProfile(profile)!
    expect(loaded.activeMission).toMatchObject({ duelOpponentActorId: 'captain', duelCaptainActorId: 'captain', duelRefereeActorId: 'ranger', targetActorIds: ['captain'], friendlyActorIds: ['ranger'] })
  })

  it('filters malformed progression without deriving it from legacy global progression, and clones without sharing references', () => {
    const profile = createCareerProfile('roman')
    const loaded = parseCareerProfile({ ...profile, duelHighestDefeatedTier: 4, duelHighestDefeatedTierByPreset: {
      roman_archer: 3, roman_spearman: 1, roman_lancer: 5, roman_horse_archer: 2.5, roman_heavy_infantry: -1,
      nonexistent_preset: 4, viking_archer: 2,
    } })!
    expect(loaded.duelHighestDefeatedTierByPreset).toEqual({ roman_archer: 3, roman_spearman: 1, viking_archer: 2 })
    expect(isCareerDuelUnlocked(loaded, 'roman_lancer', 2)).toBe(false)
    const copy = cloneCareerProfile(loaded)
    copy.duelHighestDefeatedTierByPreset!.roman_archer = 4
    expect(loaded.duelHighestDefeatedTierByPreset!.roman_archer).toBe(3)
  })

  it('rejects invalid Duel payloads and clamps excess elapsed time without adding time', () => {
    const profile = duel(createCareerProfile('roman'), 'roman_archer', 1)
    for (const invalid of [{ duelTier: 5 }, { duelPresetId: 'missing' }, { duelPresetId: 'viking_archer' },
      { duelOpponentActorId: '' }, { duelCaptainActorId: '' }, { targetCampId: 0 }, { templateId: 'missing' }]) {
      expect(parseCareerProfile({ ...profile, activeMission: { ...profile.activeMission, ...invalid } })!.activeMission).toBeUndefined()
    }
    const loaded = parseCareerProfile({ ...profile, activeMission: { ...profile.activeMission,
      duelCountdownElapsed: 100, duelCombatElapsed: 100, deadTargetActorIds: ['soldier-1', 'civilian'],
      targetActorIds: ['soldier-1', 'civilian'], friendlyActorIds: ['captain', 'civilian'], duelOpponentHp: -1 } })!
    expect(loaded.activeMission).toMatchObject({ duelCountdownElapsed: 5, duelCombatElapsed: 30, duelOpponentDead: true,
      deadTargetActorIds: ['soldier-1'], targetActorIds: ['soldier-1'], friendlyActorIds: ['captain'] })
    expect(loaded.activeMission?.duelOpponentHp).toBeUndefined()
  })
})

describe('Career Duel outcome and combat attribution', () => {
  it('fails immediately on player death or timeout, and wins on opponent death', () => {
    expect(resolveCareerDuelOutcome(true, false, 0)).toBe('failure')
    expect(resolveCareerDuelOutcome(true, true, 0)).toBe('failure')
    expect(resolveCareerDuelOutcome(false, false, 29.9)).toBeNull()
    expect(resolveCareerDuelOutcome(false, false, 30)).toBe('failure')
    expect(resolveCareerDuelOutcome(false, true, 29.9)).toBe('victory')
  })

  it('accepts combat stats only during ENGAGING and only between the player and opponent', () => {
    const mission = duel(createCareerProfile('roman'), 'roman_archer', 1).activeMission!
    const event: CombatEvent = { type: 'damage_applied', source: { actorId: 'player', actorType: 'player', allegiance: Faction.PLAYER, characterFaction: 'roman' },
      target: { targetId: 'soldier-1', targetType: 'npc', name: 'Duel opponent' }, method: 'projectile', requestedDamage: 100, appliedDamage: 100 }
    for (const phase of ['ASSEMBLING', 'MARCHING', 'PREPARING', 'RESULT', 'RETURNING'] as const) {
      mission.phase = phase; expect(acceptsCareerMissionStat(mission, event)).toBe(false)
    }
    mission.phase = 'ENGAGING'
    expect(acceptsCareerMissionStat(mission, event)).toBe(true)
    expect(acceptsCareerMissionStat(mission, { ...event, target: { ...event.target, targetId: 'captain' } })).toBe(false)
    expect(acceptsCareerMissionStat(mission, { ...event, target: { targetId: 'mount', targetType: 'mount', name: 'Horse', ownerActorId: 'soldier-1' } })).toBe(true)
    expect(acceptsCareerMissionStat(mission, { ...event, target: { targetId: 'mount', targetType: 'mount', name: 'Horse', ownerActorId: 'captain' } })).toBe(false)
    const incoming = { ...event, source: { ...event.source, actorId: 'soldier-1', actorType: 'npc' as const }, target: { targetId: 'player', targetType: 'player' as const, name: 'Player' } }
    expect(acceptsCareerMissionStat(mission, incoming)).toBe(true)
    expect(acceptsCareerMissionStat(mission, { ...incoming, source: { ...incoming.source, actorId: 'captain' } })).toBe(false)
  })
})
