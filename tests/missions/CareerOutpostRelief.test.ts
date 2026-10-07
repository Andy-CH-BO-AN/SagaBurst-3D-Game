import { describe, expect, it } from 'vitest'
import { createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { acceptCareerOutpostRelief, isCareerOutpostReliefUnlocked } from '../../src/career/CareerOutpostMission'
import { createCareerOutpostLaunch } from '../../src/career/CareerOutpostLaunch'
import { createCareerReliefSpawnPlan } from '../../src/career/CareerOutpostRelief'
import { DefenseCampaignRuntime } from '../../src/campaign/DefenseCampaignRuntime'
import { getCampaignOutpostPlacement } from '../../src/campaign/CampaignOutpost'
import { AIType } from '../../src/world/NPC'
import { MAX_COMMAND_SQUAD_SIZE } from '../../src/battle/CommandTarget'

function ready(faction: 'roman' | 'viking' = 'roman'): CareerProfile {
  return { ...createCareerProfile(faction), rank: 'soldier', totalMerit: 300, availableMerit: 300,
    completedOutpostStages: [1, 2, 3], ownedHorseTiers: [1], selectedMountId: 'horse-t1' }
}

function launch(faction: 'roman' | 'viking' = 'roman') { return createCareerOutpostLaunch(acceptCareerOutpostRelief(ready(faction), 'relief')!) }

const combat = { playerDead: true, originalDefendersAlive: 0, defendersAlive: 25, attackersAlive: 60, reinforcementSpawned: false }

describe('Career relief unlock and owned mounts', () => {
  it('requires all three Career victories, legal ownership, and an idle mission slot', () => {
    for (const stage of [1, 2, 3]) expect(isCareerOutpostReliefUnlocked({ ...ready(), completedOutpostStages: ready().completedOutpostStages!.filter(id => id !== stage) })).toBe(false)
    expect(acceptCareerOutpostRelief({ ...ready(), rank: 'recruit' })).toBeNull()
    expect(acceptCareerOutpostRelief({ ...ready(), ownedHorseTiers: [], ownedMounts: [] })).toBeNull()
    const current = acceptCareerOutpostRelief(ready(), 'one')!
    expect(acceptCareerOutpostRelief(current, 'two')).toBeNull()
    expect(acceptCareerOutpostRelief({ ...ready(), townEvent: { id: 'hostile', state: 'hostile' } })).toBeNull()
  })

  it('normalizes legacy selections and falls back without granting ownership', () => {
    const profile = { ...ready(), ownedHorseTiers: [1, 2] as (1 | 2)[], selectedMountId: 'horse-t2' as const }
    const accepted = acceptCareerOutpostRelief(profile)!
    expect(accepted.selectedMountId).toBe('horse')
    expect(createCareerOutpostLaunch(accepted)).toMatchObject({ playerLoadout: { startMounted: true, mountId: 'horse' }, playerMountAppearanceVariant: 0 })
    const fallback = acceptCareerOutpostRelief({ ...profile, selectedMountId: 'corgi', ownedMounts: ['corgi'] })!
    expect(fallback.selectedMountId).toBe('horse')
    expect(fallback.ownedMounts).toEqual(['corgi'])
    expect(fallback.ownedHorseTiers).toEqual([1, 2])
    expect(profile.selectedMountId).toBe('horse-t2')
    expect(() => createCareerOutpostLaunch({ ...fallback, ownedHorseTiers: [], ownedMounts: [] })).toThrow('owned legal mount')
  })
})

describe.each(['roman', 'viking'] as const)('%s relief spawn policy', faction => {
  it('spawns 20 T2 defenders + 60 T2 enemies + 47 T2 rescue riders, two heroes and one independent Player', () => {
    const config = launch(faction), plan = createCareerReliefSpawnPlan(config)
    const rescue = plan.npcSpecs.filter(spec => spec.squadId)
    const enemy = plan.npcSpecs.filter(spec => spec.characterFaction !== faction)
    const garrison = plan.npcSpecs.filter(spec => spec.characterFaction === faction && !spec.squadId)
    expect(plan.npcSpecs).toHaveLength(129)
    expect(garrison).toHaveLength(20)
    expect(garrison.every(spec => spec.tier === 2)).toBe(true)
    expect(garrison.filter(spec => spec.aiType === AIType.MELEE)).toHaveLength(16)
    expect(garrison.filter(spec => spec.aiType === AIType.RANGED)).toHaveLength(4)
    expect(rescue).toHaveLength(49)
    const squadA = rescue.filter(spec => spec.squadId === 1), squadB = rescue.filter(spec => spec.squadId === 2)
    expect(squadA.length + 1).toBe(25); expect(squadB.length).toBe(25)
    expect(squadA.length + 1).toBeLessThanOrEqual(MAX_COMMAND_SQUAD_SIZE)
    expect(squadB.length).toBeLessThanOrEqual(MAX_COMMAND_SQUAD_SIZE)
    expect(rescue.every(spec => spec.cavalry && spec.loadout?.mountId && !spec.respawnEnabled)).toBe(true)
    expect(rescue.filter(spec => spec.tier === 4)).toHaveLength(2)
    expect(rescue.filter(spec => spec.name === 'Captain')).toHaveLength(1)
    expect(rescue.filter(spec => spec.name === 'Maki')).toHaveLength(1)
    expect(rescue.find(spec => spec.name === 'Captain')).toMatchObject({ tier: 4, visualAssetId: faction === 'roman' ? 'roman-hero-t4' : 'viking-hero-t4' })
    expect(rescue.find(spec => spec.name === 'Maki')).toMatchObject({ tier: 4, visualAssetId: 'maki-archer-t4', specialCombatProfile: 'maki-ranger' })
    expect(rescue.filter(spec => spec.tier === 2)).toHaveLength(47)
    expect(enemy).toHaveLength(60); expect(enemy.every(spec => spec.tier === 2)).toBe(true)
    const frontline = enemy.filter(spec => !spec.cavalry && spec.aiType === AIType.MELEE)
    const ranged = enemy.filter(spec => !spec.cavalry && spec.aiType === AIType.RANGED)
    expect([frontline.length, ranged.length, enemy.filter(spec => spec.presetId?.endsWith('sword_cavalry')).length,
      enemy.filter(spec => spec.presetId?.endsWith('lancer')).length, enemy.filter(spec => spec.presetId?.endsWith('horse_archer')).length]).toEqual([24, 12, 12, 6, 6])
    if (faction === 'viking') {
      expect(enemy.filter(spec => spec.presetId === 'roman_archer')).toHaveLength(6)
      expect(enemy.filter(spec => spec.presetId === 'roman_javelin_infantry')).toHaveLength(6)
    }
    const positions = [...plan.npcSpecs, plan.playerSpawn]
    for (let index = 0; index < positions.length; index++) for (let other = index + 1; other < positions.length; other++) {
      expect(Math.hypot(positions[index].x - positions[other].x, positions[index].z - positions[other].z)).toBeGreaterThan(2)
    }
    const front = getCampaignOutpostPlacement(faction).frontZ
    expect(Math.abs(plan.playerSpawn.z - front)).toBeGreaterThan(300)
  })
})

describe('Relief result policy', () => {
  it('has no deployment or waves, continues after Player death and prioritizes annihilation victory', () => {
    const runtime = new DefenseCampaignRuntime({ reinforcementsEnabled: false, eliminationObjective: true })
    expect(runtime.getSnapshot()).toMatchObject({ activePhase: 'assault', deploymentRemainingSeconds: 0 })
    expect(runtime.update(500, combat)).toEqual([])
    expect(runtime.getSnapshot()).toMatchObject({ phase: 'assault', assaultElapsedSeconds: 500, reinforcementTriggered: false })
    expect(runtime.update(1, { ...combat, attackersAlive: 0, defendersAlive: 0 })).toEqual(['battle_victory'])
    expect(runtime.update(1, combat)).toEqual([])
    const failure = new DefenseCampaignRuntime({ eliminationObjective: true })
    expect(failure.update(1, { ...combat, defendersAlive: 0, playerDead: false })).toEqual([])
    expect(failure.update(1, { ...combat, defendersAlive: 0 })).toEqual(['battle_defeat'])
    expect(failure.update(1, combat)).toEqual([])
  })
})
