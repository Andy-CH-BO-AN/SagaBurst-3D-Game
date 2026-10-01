import { describe, expect, it, vi } from 'vitest'
import { createCareerProfile, type CareerProfile } from './CareerProfile'
import { CareerProfileStore, parseCareerProfile, CAREER_STORAGE_KEY } from './CareerProfileStore'
import { acceptCareerOutpost, claimCareerOutpost, clearCareerOutpost, isCareerOutpostUnlocked, type CareerOutpostStageId } from './CareerOutpostMission'
import { createCareerOutpostLaunch } from './CareerOutpostLaunch'
import { calculateArmyTotal } from '../battle/BattleConfig'
import { createDefenseCampaignWaveConfig, defenseCampaignCapabilities, validateDefenseCampaignLaunchConfig } from '../campaign/DefenseCampaignLaunch'
import { BattleSpawner } from '../battle/BattleSpawner'
import { completeDefenseCampaignStage, DEFENSE_CAMPAIGN_PROGRESS_STORAGE_KEY, getDefenseCampaignUnlockedStage } from '../campaign/CampaignProgress'
import { DefenseCampaignRuntime } from '../campaign/DefenseCampaignRuntime'
import { TownEquipment } from '../town/TownEquipment'
import { calculateMerit } from './MeritCalculator'

const stats = { player: { damageDealt: 250, damageTaken: 10, kills: 3, structureDamage: 500, structuresDestroyed: 1, gateBreaches: 1, survived: true }, squads: [] }
function soldier(): CareerProfile {
  return { ...createCareerProfile('roman'), totalMerit: 300, availableMerit: 300, rank: 'soldier', starterWeaponId: 'gladius_rusty', ownedWeapons: ['gladius_rusty'] }
}
function mission(stageId: CareerOutpostStageId = 1): CareerProfile {
  return acceptCareerOutpost({ ...soldier(), completedOutpostStages: stageId === 1 ? [] : stageId === 2 ? [1] : [1, 2] }, stageId, 'outpost-battle')!
}
function storage() {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } } as Storage
}

describe('Career Outpost unlocks and results', () => {
  it('requires Soldier, a previous victory, and no active mission', () => {
    expect(acceptCareerOutpost(createCareerProfile('roman'), 1, 'recruit')).toBeNull()
    expect(isCareerOutpostUnlocked(soldier(), 1)).toBe(true)
    expect(isCareerOutpostUnlocked(soldier(), 2)).toBe(false)
    expect(isCareerOutpostUnlocked(soldier(), 3)).toBe(false)
    expect(acceptCareerOutpost(mission(), 1, 'other')).toBeNull()
  })
  it('unlocks II then III only after victory and preserves replays at every higher rank', () => {
    let profile = mission()
    for (const stageId of [1, 2, 3] as const) {
      const id = profile.activeOutpostMission!.id
      profile = claimCareerOutpost(profile, id, 'victory', stats).profile
      expect(profile.completedOutpostStages).toContain(stageId)
      if (stageId < 3) {
        expect(isCareerOutpostUnlocked(profile, (stageId + 1) as CareerOutpostStageId)).toBe(true)
        profile = acceptCareerOutpost(clearCareerOutpost(profile), (stageId + 1) as CareerOutpostStageId, `outpost-${stageId + 1}`)!
      }
    }
    for (const rank of ['soldier', 'veteran', 'captain', 'commander'] as const) {
      expect(isCareerOutpostUnlocked({ ...profile, rank }, 1)).toBe(true)
      expect(isCareerOutpostUnlocked({ ...profile, rank }, 3)).toBe(true)
    }
  })
  it('awards battle-policy merit once, including after persistence and reload', () => {
    const current = mission(), store = new CareerProfileStore(storage())
    const claim = claimCareerOutpost(current, 'outpost-battle', 'victory', stats)
    const merit = calculateMerit(stats, 'victory', 'defense').total
    expect(claim.meritAwarded).toBe(merit)
    expect(claim.profile.totalMerit).toBe(current.totalMerit + merit)
    expect(claim.profile.availableMerit).toBe(current.availableMerit + merit)
    expect(claim.profile.lifetimeStats).toMatchObject({ battles: 1, victories: 1, kills: 3, damage: 250, structureDamage: 0, breaches: 0 })
    expect(store.save(claim.profile)).toBe(true)
    const reloaded = store.load()!
    expect(reloaded.outpostBattleRecords?.[0]).toMatchObject({ id: 'outpost-battle', kind: 'outpost-defense', stageId: 1, outcome: 'victory', completed: true })
    const duplicate = claimCareerOutpost(reloaded, 'outpost-battle', 'victory', stats)
    expect(duplicate.alreadyClaimed).toBe(true)
    expect(duplicate.meritAwarded).toBe(0)
    expect(duplicate.profile).toEqual(reloaded)
    expect(clearCareerOutpost(reloaded).activeOutpostMission).toBeUndefined()
  })
  it('settles defeat merit without unlocking the next stage and permits retry', () => {
    const profile = claimCareerOutpost(mission(), 'outpost-battle', 'defeat', stats).profile
    expect(profile.totalMerit).toBeGreaterThan(300)
    expect(isCareerOutpostUnlocked(profile, 2)).toBe(false)
    expect(profile.outpostBattleRecords?.[0].completed).toBe(false)
    expect(acceptCareerOutpost(clearCareerOutpost(profile), 1, 'retry')).not.toBeNull()
  })
  it('does not change formal Campaign progress in either direction', () => {
    const persistence = storage(), career = new CareerProfileStore(persistence)
    vi.stubGlobal('window', { localStorage: persistence })
    const completed = claimCareerOutpost(mission(), 'outpost-battle', 'victory', stats).profile
    career.save(completed)
    expect(persistence.getItem(DEFENSE_CAMPAIGN_PROGRESS_STORAGE_KEY)).toBeNull()
    const careerBefore = persistence.getItem(CAREER_STORAGE_KEY)
    completeDefenseCampaignStage('roman', 1, persistence)
    expect(getDefenseCampaignUnlockedStage('roman', persistence)).toBe(2)
    expect(persistence.getItem(CAREER_STORAGE_KEY)).toBe(careerBefore)
    vi.unstubAllGlobals()
  })
  it('rejects malformed persisted stage ids and copies progression and records independently', () => {
    const raw = { ...soldier(), activeOutpostMission: { id: 'bad', kind: 'outpost-defense', stageId: 9 }, completedOutpostStages: [1, 1, 9, '2'], outpostBattleRecords: [{ id: 'bad' }] }
    const parsed = parseCareerProfile(raw)!
    expect(parsed.activeOutpostMission).toBeUndefined()
    expect(parsed.completedOutpostStages).toEqual([1])
    expect(parsed.outpostBattleRecords).toEqual([])
  })
})

describe('Career Outpost reuses Campaign spawning and capabilities', () => {
  it.each([1, 2, 3] as const)('keeps stage %i AI slots intact and player additional', stageId => {
    for (const faction of ['roman', 'viking'] as const) {
      const launch = createCareerOutpostLaunch({ ...mission(stageId), faction })
      expect(validateDefenseCampaignLaunchConfig(launch)).toEqual({ valid: true, errors: [] })
      const defenders = createDefenseCampaignWaveConfig(launch, 'defenders')
      const attackers = createDefenseCampaignWaveConfig(launch, 'attackers')
      const expectedDefenders = [80, 85, 90][stageId - 1]
      expect(calculateArmyTotal(defenders[faction])).toBe(expectedDefenders)
      expect(BattleSpawner.createSpawnPlan(defenders).npcSpecs).toHaveLength(expectedDefenders)
      expect(BattleSpawner.createSpawnPlan(defenders).playerSpawn).toBeDefined()
      expect(BattleSpawner.createSpawnPlan(attackers).npcSpecs).toHaveLength([100, 110, 120][stageId - 1])
      expect(defenseCampaignCapabilities(launch)).toEqual({ reinforcementsEnabled: false, playerCommandsEnabled: false, gateControlEnabled: false, attackerHeroesEnabled: false })
      expect(launch.playerLoadout.startMounted).toBe(false)
      expect(() => createDefenseCampaignWaveConfig(launch, 'reinforcement')).toThrow('disabled')
    }
  })
  it('retains formal Campaign reinforcement, heroes, commands and gate capabilities', () => {
    const launch = createCareerOutpostLaunch(mission())
    delete launch.capabilities
    delete launch.careerMissionId
    expect(defenseCampaignCapabilities(launch)).toEqual({ reinforcementsEnabled: true, playerCommandsEnabled: true, gateControlEnabled: true, attackerHeroesEnabled: true })
    expect(BattleSpawner.createSpawnPlan(createDefenseCampaignWaveConfig(launch, 'attackers')).npcSpecs).toHaveLength(102)
    expect(BattleSpawner.createSpawnPlan(createDefenseCampaignWaveConfig(launch, 'reinforcement')).npcSpecs).toHaveLength(50)
  })
  it.each(['gladius_rusty', 'wooden_shortbow', 'pilum_basic'])('carries only legitimate equipment for starter %s', starter => {
    const profile = { ...mission(), starterWeaponId: starter, ownedWeapons: [starter] }
    const equipment = new TownEquipment(() => profile, () => true)
    equipment.prepareForCombat()
    expect(equipment.inventoryStacks.map(stack => stack.item.id)).toEqual([starter])
    expect(equipment.shieldEnabled).toBe(false)
    expect(equipment.meleeEnabled).toBe(starter === 'gladius_rusty')
    expect(equipment.rangedEnabled).toBe(starter !== 'gladius_rusty')
    expect(createCareerOutpostLaunch(profile).playerLoadout.startMounted).toBe(false)
  })
  it('does not schedule relief and resolves victory and defeat without a relief wave', () => {
    const state = { playerDead: false, originalDefendersAlive: 80, defendersAlive: 80, attackersAlive: 100, reinforcementSpawned: false }
    const runtime = new DefenseCampaignRuntime({ reinforcementsEnabled: false })
    expect(runtime.update(60, state)).toEqual(['assault_started'])
    expect(runtime.update(180, state)).toEqual([])
    expect(runtime.getSnapshot().reinforcementTriggered).toBe(false)
    expect(runtime.update(1, { ...state, attackersAlive: 0 })).toEqual(['battle_victory'])
    expect(runtime.update(180, state)).toEqual([])
    const defeat = new DefenseCampaignRuntime({ reinforcementsEnabled: false })
    defeat.update(60, state)
    expect(defeat.update(1, { ...state, playerDead: true, originalDefendersAlive: 0, defendersAlive: 0 })).toEqual(['battle_defeat'])
    expect(defeat.update(180, state)).toEqual([])
  })
})
