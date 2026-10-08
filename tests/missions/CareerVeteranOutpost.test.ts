import { describe, expect, it } from 'vitest'
import { getCampaignOutpostPlacement, getCampaignDefenderFacingYaw } from '../../src/campaign/CampaignOutpost'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { acceptVeteranMission } from '../../src/career/VeteranMission'
import { createCareerVeteranOutpostLaunch, createCareerVeteranOutpostSpawnPlan } from '../../src/career/CareerVeteranOutpost'

function veteran(faction: 'roman' | 'viking' = 'roman') {
  return { ...createCareerProfile(faction), rank: 'veteran' as const, totalMerit: 900, availableMerit: 900 }
}

function launchFor(templateId: 'veteran-dread-outpost' | 'veteran-outpost-assault', faction: 'roman' | 'viking' = 'roman') {
  const prior = templateId === 'veteran-outpost-assault'
    ? ['veteran-dread-outpost', 'veteran-scout-hunters', 'veteran-village-intercept']
    : []
  const profile = {
    ...veteran(faction),
    ownedMounts: templateId === 'veteran-outpost-assault' ? ['horse' as const] : [],
    selectedMountId: templateId === 'veteran-outpost-assault' ? 'horse' as const : undefined,
    completedCareerMissionTemplateIds: prior,
  }
  const active = acceptVeteranMission(profile, templateId, { missionId: `test-${templateId}`, acceptedAt: 1 })
  if (!active) throw new Error(`Unable to accept ${templateId} test mission`)
  return createCareerVeteranOutpostLaunch(active)
}

describe('Career Veteran Campaign outposts', () => {
  it('launches Dread Outpost with 100 defenders, 50 actual T4 attackers, and a 90-second rescue wave', () => {
    const launch = launchFor('veteran-dread-outpost')
    const config = launch.careerVeteranOutpost!
    const initial = createCareerVeteranOutpostSpawnPlan(launch, 'initial')
    const friendlies = initial.npcSpecs.filter(spec => spec.characterFaction === config.playerFaction)
    const enemies = initial.npcSpecs.filter(spec => spec.characterFaction !== config.playerFaction)
    const reinforcement = createCareerVeteranOutpostSpawnPlan(launch, 'reinforcement').npcSpecs

    expect(launch).toMatchObject({ careerMissionId: 'test-veteran-dread-outpost', careerMissionKind: 'veteran-outpost-defense' })
    expect(config).toMatchObject({ playerFaction: 'roman', outpostFaction: 'roman', reinforcementDelaySeconds: 90 })
    expect(friendlies.length + 1).toBe(100)
    expect(enemies).toHaveLength(50)
    expect(enemies.every(spec => spec.tier === 4 && spec.combatProfileId && spec.visualAssetId)).toBe(true)
    expect(enemies.filter(spec => spec.specialCombatProfile === 'maki-ranger')).toHaveLength(25)
    expect(enemies.filter(spec => spec.presetId === 'viking_lancer' && spec.tier === 4)).toHaveLength(25)
    expect(friendlies.filter(spec => spec.tier === 4)).toHaveLength(4)
    expect(reinforcement).toHaveLength(50)
    expect(reinforcement.filter(spec => spec.tier === 4)).toHaveLength(2)
    expect(reinforcement.filter(spec => spec.tier === 3)).toHaveLength(48)
    expect(new Set(reinforcement.map(spec => spec.squadId)).size).toBe(2)
    expect(launch.careerVeteranOutpost?.runtimeState).toMatchObject({
      activePhase: 'assault', assaultElapsedSeconds: 0, reinforcementTriggered: false,
      reinforcementSpawned: false, reinforcementArrived: false,
    })
  })

  it('stages Veteran I attackers at least 100m outside the Outpost front while keeping Veteran IV at 65m', () => {
    const dreadLaunch = launchFor('veteran-dread-outpost')
    const dreadData = dreadLaunch.careerVeteranOutpost!
    const dreadPlan = createCareerVeteranOutpostSpawnPlan(dreadLaunch, 'initial')
    const dreadPlacement = getCampaignOutpostPlacement(dreadData.outpostFaction)
    const dreadInward = Math.sign(dreadPlacement.backZ - dreadPlacement.frontZ)
    const dreadAttackers = dreadPlan.npcSpecs.filter(spec => spec.characterFaction !== dreadData.playerFaction)

    expect(Math.min(...dreadAttackers.map(spec => (dreadPlacement.frontZ - spec.z) * dreadInward))).toBeGreaterThanOrEqual(100)

    const assaultLaunch = launchFor('veteran-outpost-assault')
    const assaultData = assaultLaunch.careerVeteranOutpost!
    const assaultPlan = createCareerVeteranOutpostSpawnPlan(assaultLaunch, 'initial')
    const assaultPlacement = getCampaignOutpostPlacement(assaultData.outpostFaction)
    const assaultInward = Math.sign(assaultPlacement.backZ - assaultPlacement.frontZ)
    const assaultAttackers = assaultPlan.npcSpecs.filter(spec => spec.characterFaction === assaultData.playerFaction)

    expect(Math.min(...assaultAttackers.map(spec => (assaultPlacement.frontZ - spec.z) * assaultInward))).toBeCloseTo(65)
  })

  it('attacks a real enemy-owned Outpost with the full Career force outside the gate', () => {
    const launch = launchFor('veteran-outpost-assault')
    const config = launch.careerVeteranOutpost!
    const plan = createCareerVeteranOutpostSpawnPlan(launch, 'initial')
    const owner = getCampaignOutpostPlacement(config.outpostFaction)
    const inward = Math.sign(owner.backZ - owner.frontZ)
    const friendly = plan.npcSpecs.filter(spec => spec.characterFaction === config.playerFaction)
    const enemy = plan.npcSpecs.filter(spec => spec.characterFaction === config.outpostFaction)

    expect(launch).toMatchObject({ careerMissionKind: 'veteran-outpost-assault', defenderFaction: 'viking' })
    expect(config).toMatchObject({ playerFaction: 'roman', outpostFaction: 'viking', assaultChargeDistanceMeters: 50 })
    expect(friendly.length + 1).toBe(100)
    expect(enemy).toHaveLength(100)
    expect(enemy.filter(spec => spec.tier === 4)).toHaveLength(2)
    expect(enemy.filter(spec => spec.specialCombatProfile === 'maki-ranger')).toHaveLength(2)
    expect(enemy.filter(spec => spec.tier === 4 && !spec.cavalry)).toHaveLength(1)
    expect(enemy.filter(spec => spec.tier === 4 && spec.cavalry && spec.specialCombatProfile === 'maki-ranger')).toHaveLength(1)
    expect(friendly.every(spec => (spec.z - owner.frontZ) * inward < 0)).toBe(true)
    expect(enemy.every(spec => (spec.z - owner.frontZ) * inward > 0)).toBe(true)
    expect(plan.playerSpawn.z).toBeCloseTo(owner.frontZ - inward * 50)
    expect(enemy.find(spec => spec.specialCombatProfile === 'maki-ranger')?.visualAssetId).toBe('maki-archer-t4')
    expect(getCampaignDefenderFacingYaw(config.outpostFaction)).not.toBe(getCampaignDefenderFacingYaw(config.playerFaction))
  })

  it('restores a saved siege gate state and runtime after a reload', () => {
    const active = acceptVeteranMission({ ...veteran(), ownedMounts: ['horse'], completedCareerMissionTemplateIds: [
        'veteran-dread-outpost', 'veteran-scout-hunters', 'veteran-village-intercept',
      ] }, 'veteran-outpost-assault', { missionId: 'resume-v4', acceptedAt: 1 })
    if (!active?.activeMission) throw new Error('Expected a persisted Veteran assault')
    active.activeMission.outpostBattleState = {
      phase: 'assault', activePhase: 'assault', assaultElapsedSeconds: 37.5,
      deploymentRemainingSeconds: 0, reinforcementRemainingSeconds: 0,
      reinforcementTriggered: false, reinforcementSpawned: false, reinforcementArrived: false,
      reinforcementQueueIndex: 0, assaultChargeTriggered: true, gateHealth: 0, gateState: 'destroyed',
    }
    const restored = createCareerVeteranOutpostLaunch(active)
    expect(restored.careerVeteranOutpost?.runtimeState).toMatchObject({
      assaultElapsedSeconds: 37.5, assaultChargeTriggered: true, gateHealth: 0, gateState: 'destroyed',
    })
  })
})
