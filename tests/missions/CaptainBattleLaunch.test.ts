import { describe, expect, it } from 'vitest'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { acceptCaptainEagle, acceptCaptainFrontline, createCaptainEagleLaunch, createCaptainEagleSpawnPlan, createCaptainFrontlineLaunch, createCaptainFrontlineSpawnPlan } from '../../src/career/CaptainBattleLaunch'
import { validateDefenseCampaignLaunchConfig, createDefenseCampaignWaveConfig } from '../../src/campaign/DefenseCampaignLaunch'
import { BattleSpawner } from '../../src/battle/BattleSpawner'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import { MemoryStorage } from '../helpers/memoryStorage'
import { purchaseTownMount } from '../../src/town/TownRules'

function captain(faction: 'roman' | 'viking') {
  return { ...createCareerProfile(faction), rank: 'captain' as const, totalMerit: 40000, availableMerit: 30000 }
}

describe('Captain cross-scene battle plans', () => {
  it.each(['roman', 'viking'] as const)('%s Frontline reuses Stage IX and commands exactly 20 existing melee defenders', faction => {
    // Plans are data: no NPC, Mount or TownWorld construction.
    const profile = acceptCaptainFrontline(captain(faction), 'captain-stage-nine')!
    const launch = createCaptainFrontlineLaunch(profile)
    const plan = createCaptainFrontlineSpawnPlan(launch)
    expect(validateDefenseCampaignLaunchConfig(launch).valid).toBe(true)
    expect(launch).toMatchObject({ type: 'defense', stageId: 9, careerMissionKind: 'captain-outpost-defense' })
    expect(plan.npcSpecs).toHaveLength(90)
    expect(plan.npcSpecs.every(spec => spec.characterFaction === faction && spec.tier === 3)).toBe(true)
    expect(plan.npcSpecs.filter(spec => spec.squadId === 1)).toHaveLength(20)
    expect(plan.npcSpecs.filter(spec => spec.squadId === 1).every(spec => !spec.cavalry && spec.presetId === (faction === 'roman' ? 'roman_heavy_infantry' : 'viking_berserker'))).toBe(true)
    expect(profile.activeMission?.officialSquad?.actorIds).toEqual(plan.npcSpecs.filter(spec => spec.squadId === 1).map(spec => spec.actorId))
    expect(new Set(plan.npcSpecs.map(spec => spec.actorId)).size).toBe(90)
    const attackers = BattleSpawner.createSpawnPlan(createDefenseCampaignWaveConfig(launch, 'attackers')).npcSpecs
    const reinforcements = BattleSpawner.createSpawnPlan(createDefenseCampaignWaveConfig(launch, 'reinforcement')).npcSpecs
    expect(attackers).toHaveLength(202)
    expect(profile.activeMission?.targetActorIds).toHaveLength(202)
    expect(attackers.filter(spec => spec.tier === 3)).toHaveLength(200)
    expect(attackers.filter(spec => spec.tier === 4)).toHaveLength(2)
    expect(reinforcements).toHaveLength(50)
    expect(attackers.every(spec => spec.characterFaction !== faction)).toBe(true)
    expect(reinforcements.every(spec => spec.tier === 3 && spec.characterFaction === faction)).toBe(true)
    const store = new CareerProfileStore(new MemoryStorage())
    expect(store.save(profile)).toBe(true)
    expect(createCaptainFrontlineSpawnPlan(createCaptainFrontlineLaunch(store.load()!)).npcSpecs.map(spec => spec.actorId)).toEqual(plan.npcSpecs.map(spec => spec.actorId))
  })

  it.each(['roman', 'viking'] as const)('%s Eagle uses 29 commanded allies and 30 enemy eagles with purchased Player ownership', faction => {
    const profile = purchaseTownMount(captain(faction), 'xongkoro').profile
    const active = acceptCaptainEagle(profile, 'captain-eagles')!
    const launch = createCaptainEagleLaunch(active)
    const plan = createCaptainEagleSpawnPlan(active)
    expect(launch.battle).toMatchObject({ careerEagleMissionId: 'captain-eagles', playerFaction: faction,
      playerLoadout: { startMounted: true, mountId: 'xongkoro' }, rules: { respawnEnabled: false, includeCamps: false } })
    expect(plan.npcSpecs).toHaveLength(59)
    expect(plan.npcSpecs.filter(spec => spec.characterFaction === faction)).toHaveLength(29)
    expect(plan.npcSpecs.filter(spec => spec.characterFaction !== faction)).toHaveLength(30)
    expect(plan.npcSpecs.every(spec => spec.cavalry && spec.loadout?.mountId === 'xongkoro')).toBe(true)
    expect(new Set(plan.npcSpecs.map(spec => spec.actorId)).size).toBe(59)
    expect(active.inventory).toEqual(profile.inventory)
    expect(active.activeMission?.officialSquad?.actorIds).toEqual(plan.npcSpecs.filter(spec => spec.squadId === 1).map(spec => spec.actorId))
  })

  it('requires ownership and an available Player allocation without borrowing a private member eagle', () => {
    expect(acceptCaptainEagle(captain('roman'))).toBeNull()
    const owned = purchaseTownMount(captain('roman'), 'xongkoro').profile
    delete owned.selectedMountId
    owned.personalSquad = { members: [{ id: 'personal:eagle-owner', type: 'ranger', equipment: { melee: null, ranged: null, shield: null, mount: 'xongkoro' } }] }
    expect(acceptCaptainEagle(owned)).toBeNull()
    expect(owned.personalSquad.members[0].equipment?.mount).toBe('xongkoro')
  })
})
