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
import { careerMountAppearanceVariant } from './CareerMountController'
import { applyCampaignBreachOrders } from '../campaign/CampaignGate'
import type { NPC } from '../world/NPC'
import { calculateMerit } from './MeritCalculator'
import { calculateRecruitMissionMerit } from './CareerMissionMeritPolicy'
import { getDefenseCampaignStage } from '../campaign/CampaignConfig'
import { MemoryStorage } from '../../tests/helpers/memoryStorage'

const stats = { player: { damageDealt: 250, damageTaken: 10, kills: 3, structureDamage: 500, structuresDestroyed: 1, gateBreaches: 1, survived: true }, squads: [] }
function soldier(): CareerProfile {
  return { ...createCareerProfile('roman'), totalMerit: 300, availableMerit: 300, rank: 'soldier', starterWeaponId: 'gladius_rusty', ownedWeapons: ['gladius_rusty'] }
}
function mission(stageId: CareerOutpostStageId = 1): CareerProfile {
  return acceptCareerOutpost({ ...soldier(), completedOutpostStages: stageId === 1 ? [] : stageId === 2 ? [1] : [1, 2] }, stageId, 'outpost-battle')!
}
describe('Career Outpost unlocks and results', () => {
  it.each([
    ['soldier', 10], ['veteran', 10], ['captain', 60], ['commander', 60],
  ] as const)('starts %s Outpost assaults after %s seconds, including reload', (rank, seconds) => {
    for (const stage of [1, 2, 3] as const) {
      const profile = parseCareerProfile(JSON.parse(JSON.stringify({ ...mission(stage), rank, totalMerit: 10000 })))!
      const launch = createCareerOutpostLaunch(profile)
      expect(launch.deploymentSeconds).toBe(seconds)
      const runtime = new DefenseCampaignRuntime({ ...launch.capabilities, deploymentSeconds: launch.deploymentSeconds })
      const state = { playerDead: false, originalDefendersAlive: 80, defendersAlive: 80, attackersAlive: 100, reinforcementSpawned: false }
      expect(runtime.getSnapshot().deploymentRemainingSeconds).toBe(seconds)
      expect(runtime.update(seconds - .5, state)).toEqual([])
      expect(runtime.getSnapshot().deploymentRemainingSeconds).toBe(.5)
      expect(runtime.update(.5, state)).toEqual(['assault_started'])
      expect(runtime.getSnapshot().activePhase).toBe('assault')
      expect(runtime.update(1, state)).toEqual([])
    }
  })

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
    const current = mission(), store = new CareerProfileStore(new MemoryStorage())
    const claim = claimCareerOutpost(current, 'outpost-battle', 'victory', stats)
    const merit = calculateMerit(stats, 'victory', 'defense', 'mission').total
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
    const persistence = new MemoryStorage(), career = new CareerProfileStore(persistence)
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
      const roster = BattleSpawner.createSpawnPlan(defenders).npcSpecs
      expect(roster).toHaveLength(expectedDefenders)
      const captains = roster.filter(spec => spec.tier === 4)
      expect(captains).toHaveLength(1)
      expect(captains[0]).toMatchObject({ characterFaction: faction, cavalry: false, visualAssetId: faction === 'roman' ? 'roman-hero-t4' : 'viking-hero-t4' })
      const captain = { ...captains[0], dead: false, setTacticalOrder: vi.fn() }
      applyCampaignBreachOrders([captain as unknown as NPC], faction === 'roman' ? 'viking' : 'roman')
      expect(captain.setTacticalOrder).toHaveBeenCalledWith('attack')
      expect(BattleSpawner.createSpawnPlan(defenders).playerSpawn).toBeDefined()
      expect(BattleSpawner.createSpawnPlan(attackers).npcSpecs).toHaveLength([100, 110, 120][stageId - 1])
      const stage = getDefenseCampaignStage(stageId)
      const cavalry = roster.filter(spec => spec.cavalry)
      expect(cavalry).toHaveLength(stage.defenderDeployment.cavalryCap!)
      expect(cavalry.every(spec => spec.presetId === `${faction}_lancer` && spec.tier === 3)).toBe(true)
      const t1 = roster.filter(spec => spec.tier === 1)
      expect(t1).toHaveLength([30, 35, 35][stageId - 1])
      expect(t1.every(spec => spec.presetId === `${faction}_archer` && spec.loadout?.rangedWeaponId === 'wooden_shortbow')).toBe(true)
      const spearmen = roster.filter(spec => spec.presetId === `${faction}_spearman`).length
      const melee = roster.length - t1.length - cavalry.length - spearmen
      expect(Math.abs(spearmen - melee)).toBeLessThanOrEqual(1)
      expect(defenseCampaignCapabilities(launch)).toEqual({ reinforcementsEnabled: true, playerCommandsEnabled: false, gateControlEnabled: false, attackerHeroesEnabled: false })
      expect(launch.playerLoadout.startMounted).toBe(false)
      const relief = BattleSpawner.createSpawnPlan(createDefenseCampaignWaveConfig(launch, 'reinforcement')).npcSpecs
      expect(relief).toHaveLength(50)
      expect(relief.every(spec => spec.characterFaction === faction && spec.cavalry && spec.tier === 1)).toBe(true)
    }
  })
  it.each([1, 2, 3] as const)('migrates a selected legacy T%i horse to the military horse through reload and launch', tier => {
    const profile: CareerProfile = { ...mission(), rank: tier === 3 ? 'veteran' : 'soldier', totalMerit: 900, availableMerit: 900, ownedHorseTiers: [tier], selectedMountId: `horse-t${tier}` }
    const store = new CareerProfileStore(new MemoryStorage())
    expect(store.save(profile)).toBe(true)
    const reloaded = store.load()!
    const launch = createCareerOutpostLaunch(reloaded)
    expect(launch.playerLoadout).toMatchObject({ startMounted: true, mountId: 'horse' })
    expect(launch.playerMountAppearanceVariant).toBe(0)
    expect(launch.playerMountAppearanceVariant).toBe(careerMountAppearanceVariant(reloaded.selectedMountId))
    expect(reloaded.ownedHorseTiers).toEqual([tier])
    expect(reloaded.selectedMountId).toBe('horse')
  })
  it('keeps mountless Career launches unmounted and the default appearance for hero mounts', () => {
    expect(createCareerOutpostLaunch(mission()).playerLoadout.startMounted).toBe(false)
    expect(careerMountAppearanceVariant('black-cat')).toBe(0)
    expect(careerMountAppearanceVariant('corgi')).toBe(0)
    expect(careerMountAppearanceVariant()).toBe(0)
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
  it('schedules Campaign reinforcements once after 120 assault seconds, including Player death', () => {
    const launch = createCareerOutpostLaunch(mission())
    const state = { playerDead: false, originalDefendersAlive: 80, defendersAlive: 80, attackersAlive: 100, reinforcementSpawned: false }
    const runtime = new DefenseCampaignRuntime({ ...launch.capabilities, deploymentSeconds: launch.deploymentSeconds })
    expect(runtime.update(10, state)).toEqual(['assault_started'])
    expect(runtime.update(119.9, { ...state, playerDead: true })).toEqual([])
    expect(runtime.update(.1, { ...state, playerDead: true })).toEqual(['reinforcement_due'])
    expect(runtime.update(1, { ...state, playerDead: true, reinforcementSpawned: true })).toEqual([])
    expect(runtime.getSnapshot().reinforcementTriggered).toBe(true)
  })

  it('still supports battles that explicitly disable reinforcements', () => {
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

describe('Outpost damage merit matches Home Defense', () => {
  it.each([0, 19, 20, 99, 100, 450, 999])('uses the same damage merit for %s damage and persists the increased award once', damageDealt => {
    const battleStats = { player: { ...stats.player, damageDealt }, squads: [] }
    const expectedDamage = calculateRecruitMissionMerit(battleStats.player, 'victory').damage
    const claim = claimCareerOutpost(mission(), 'outpost-battle', 'victory', battleStats)
    expect(claim.meritBreakdown.characterDamage).toBe(expectedDamage)
    expect(claim.meritBreakdown).toMatchObject({ victory: 80, kills: 24, survival: 20 })
    const reloaded = parseCareerProfile(JSON.parse(JSON.stringify(claim.profile)))!
    expect(reloaded.outpostBattleRecords![0].merit.characterDamage).toBe(expectedDamage)
    const duplicate = claimCareerOutpost(reloaded, 'outpost-battle', 'victory', battleStats)
    expect(duplicate.meritAwarded).toBe(0)
    expect(duplicate.profile.totalMerit).toBe(claim.profile.totalMerit)
  })
})
