import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { RECRUIT_MISSION_CATALOG, availableRecruitMissions } from '../src/career/CareerMissionCatalog'
import { calculateRecruitMissionMerit } from '../src/career/CareerMissionMeritPolicy'
import { acceptsCareerMissionStat, createActiveCareerMission, resolveCareerMissionOutcome } from '../src/career/CareerMissionState'
import { claimCareerMission, createCareerProfile } from '../src/career/CareerProfile'
import { canUseCareerMount, findSafeCareerMountPosition, ownedCareerMountIds } from '../src/career/CareerMountController'
import { preserveHpRatio, resolveCareerCombatProfile, resolveCareerHeroAsset } from '../src/career/CareerPlayerProfile'
import { missionGuideArrowAngle } from '../src/career/MissionGuide'
import { Faction } from '../src/combat/CombatFaction'

const playerStats = (damageDealt: number, kills: number, survived = true) => ({
  damageDealt, kills, survived, damageTaken: 0, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0,
})

describe('Recruit mission catalog and merit', () => {
  it('defines a compact repeatable board plus a late one-time Town Defense milestone', () => {
    expect(RECRUIT_MISSION_CATALOG).toHaveLength(7)
    const bandits = RECRUIT_MISSION_CATALOG.filter(mission => mission.kind === 'bandit')
    const patrols = RECRUIT_MISSION_CATALOG.filter(mission => mission.kind === 'patrol')
    const defense = RECRUIT_MISSION_CATALOG.find(mission => mission.kind === 'town-defense')!
    expect(bandits.map(m => [m.friendlyCombatants, m.banditCount])).toEqual([[5, 3], [20, 12], [6, 10], [10, 20]])
    expect(patrols.map(m => [m.routeId, m.friendlyCombatants, m.encounterBanditCount])).toEqual([
      ['south-road', 6, 4],
      ['forest-line', 8, 7],
    ])
    for (const mission of bandits) expect(mission.friendlyCombatants).toBe(mission.friendlySoldiers + 2)
    expect(defense.storyOnce).toBe(true)
    expect(defense.requiresCompletions).toBe(5)
    expect([defense.friendlySoldiers, defense.enemyCount, defense.civilianCount, defense.maxCivilianDeaths]).toEqual([60, 50, 20, 10])
    const profile = createCareerProfile('roman')
    expect(availableRecruitMissions(profile)).toHaveLength(3)
    profile.totalMerit = 60
    expect(availableRecruitMissions(profile)).toHaveLength(4)
    profile.totalMerit = 90
    expect(availableRecruitMissions(profile)).toHaveLength(5)
    profile.totalMerit = 120; profile.careerMissionCompletions = 5
    expect(availableRecruitMissions(profile)).toHaveLength(7)
    profile.completedCareerMissionTemplateIds = [defense.id]
    expect(availableRecruitMissions(profile)).toHaveLength(6)
  })

  it('gives spectators zero and scales low, normal and high personal contribution', () => {
    expect(calculateRecruitMissionMerit(playerStats(0, 0), 'victory').total).toBe(0)
    expect(calculateRecruitMissionMerit(playerStats(20, 0), 'victory').total).toBe(3)
    expect(calculateRecruitMissionMerit(playerStats(180, 0), 'victory').total).toBe(21)
    expect(calculateRecruitMissionMerit(playerStats(250, 1), 'victory').total).toBe(30)
    expect(calculateRecruitMissionMerit(playerStats(500, 3), 'victory').total).toBe(55)
  })

  it('paces roughly nine ordinary contributions plus one normal Town Defense contribution to Soldier eligibility', () => {
    const ordinaryRewards = Array.from({ length: 9 }, (_, index) => calculateRecruitMissionMerit(playerStats(150 + index * 20, 1), 'victory').total)
    const defenseReward = calculateRecruitMissionMerit(playerStats(300, 2), 'victory').total
    expect(ordinaryRewards.slice(0, 5).reduce((sum, value) => sum + value, 0)).toBeLessThan(300)
    expect(ordinaryRewards.reduce((sum, value) => sum + value, 0) + defenseReward).toBe(300)
  })
})

describe('Mission identity, attribution and claim', () => {
  it('points the guide toward screen-space forward, right and left targets', () => {
    expect(missionGuideArrowAngle(0, -10, 0)).toBeCloseTo(-Math.PI / 2)
    expect(missionGuideArrowAngle(10, 0, 0)).toBeCloseTo(0)
    expect(Math.abs(missionGuideArrowAngle(-10, 0, 0))).toBeCloseTo(Math.PI)
    expect(missionGuideArrowAngle(-10, 0, Math.PI / 2)).toBeCloseTo(-Math.PI / 2)
  })

  it('creates stable roster identities and never counts Ambient or other-camp targets', () => {
    const mission = createActiveCareerMission('recruit-bandits-01', 2, 3, 3, 'mission-stable')
    expect(mission.targetActorIds).toEqual(['mission-stable:bandit:0', 'mission-stable:bandit:1', 'mission-stable:bandit:2'])
    const source = { actorId: 'player', actorType: 'player' as const, allegiance: Faction.PLAYER, characterFaction: 'roman' as const }
    const event = (targetId: string) => ({ type: 'damage_applied' as const, source, target: { targetId, targetType: 'npc' as const, name: 'Bandit' }, method: 'projectile' as const, requestedDamage: 20, appliedDamage: 20 })
    expect(acceptsCareerMissionStat(mission, event(mission.targetActorIds[0]))).toBe(true)
    expect(acceptsCareerMissionStat(mission, event('ambient:2:0'))).toBe(false)
  })

  it('can bind the exact existing Town captain as Mission Leader instead of cloning one', () => {
    const mission = createActiveCareerMission('recruit-patrol-01', 1, 4, 4, 'patrol-captain', 'patrol', 'captain')
    expect(mission.kind).toBe('patrol')
    expect(mission.friendlyActorIds[0]).toBe('captain')
    expect(mission.friendlyActorIds.slice(1)).toHaveLength(4)
  })

  it('prioritizes player death in the final-target frame and waits for roster registration', () => {
    expect(resolveCareerMissionOutcome(true, true, 0)).toBe('failure')
    expect(resolveCareerMissionOutcome(false, false, 0)).toBeNull()
    expect(resolveCareerMissionOutcome(false, true, 0)).toBe('victory')
  })

  it('claims the mission once while spectator victory remains zero', () => {
    const profile = createCareerProfile('viking')
    profile.activeMission = createActiveCareerMission('recruit-bandits-01', 0, 3, 3, 'mission-once')
    const first = claimCareerMission(profile, 'mission-once', 'victory', playerStats(0, 0))
    expect(first.meritAwarded).toBe(0)
    expect(first.profile.activeMission?.result?.claimed).toBe(true)
    const duplicate = claimCareerMission(first.profile, 'mission-once', 'victory', playerStats(999, 9))
    expect(duplicate.alreadyClaimed).toBe(true)
    expect(duplicate.profile.totalMerit).toBe(0)
  })
})

describe('Career mounts and appointed T4 identity', () => {
  it('keeps legacy horse ownership as T1 and distinguishes every purchased tier', () => {
    const profile = createCareerProfile('roman'); profile.ownedMounts = ['horse']; profile.rank = 'recruit'
    expect(ownedCareerMountIds(profile)).toEqual(['horse-t1'])
    profile.ownedHorseTiers = [1, 2, 3]
    expect(ownedCareerMountIds(profile)).toEqual(['horse-t1', 'horse-t2', 'horse-t3'])
    expect(canUseCareerMount(profile, 'horse-t2')).toBe(false)
    profile.rank = 'soldier'
    expect(canUseCareerMount(profile, 'horse-t2')).toBe(true)
  })

  it('fails safe-position search without changing state when every candidate is blocked', () => {
    const box = new THREE.Box3(new THREE.Vector3(-20, -20, -20), new THREE.Vector3(20, 20, 20))
    expect(findSafeCareerMountPosition(new THREE.Vector3(), [{ box, isBarricade: false }], [])).toBeNull()
  })

  it('uses appointed rank, preserves HP ratio and maps faction heroes to existing combat profiles', () => {
    const profile = createCareerProfile('roman'); profile.totalMerit = 6000
    expect(resolveCareerHeroAsset(profile)).toBeNull()
    profile.rank = 'captain'
    expect(resolveCareerHeroAsset(profile)).toBe('roman-hero-t4')
    expect(resolveCareerCombatProfile(profile)).toBe('praetorian')
    profile.faction = 'viking'; profile.rank = 'commander'
    expect(resolveCareerHeroAsset(profile)).toBe('viking-hero-t4')
    expect(resolveCareerCombatProfile(profile)).toBe('varangian')
    expect(preserveHpRatio(100, 200, 500)).toBe(250)
    expect(preserveHpRatio(0, 200, 500)).toBe(0)
  })
})
