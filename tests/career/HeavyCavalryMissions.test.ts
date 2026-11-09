import { describe, expect, it } from 'vitest'
import { availableCareerMissionsForPage } from '../../src/career/CareerMissionCatalog'
import { careerMissionTierForTemplateId } from '../../src/career/CareerMissionTier'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { parseCareerProfile } from '../../src/career/CareerProfileStore'
import { acceptHeavyFieldMission, createCareerHeavySpawnPlan, getHeavyFieldMissionAvailability } from '../../src/career/HeavyFieldMission'
import { Faction } from '../../src/combat/CombatFaction'
import { AIType } from '../../src/world/NPC'
import type { CombatEvent } from '../../src/combat/CombatAttribution'
import {
  CAPTAIN_STEEL_AVALANCHE_ID, COMMANDER_IRON_LEGION_ID, SOLDIER_IRON_ENCOUNTER_ID, VETERAN_IRON_TIDE_ID,
  HEAVY_FIELD_SPECS, caltropRouteExists, createHeavyFieldState, heavyActorIds, heavyEnemyActorIds, heavyFriendlyActorIds,
  heavyCommandPlan, heavyFrontlineDistance, isHeavyFormationComplete, heavyGroupsTotal, heavyNpcGroups, heavyTacticalOrder, ironLegionEnemyActorIds, IRON_LEGION_ENEMY_GROUPS,
  parseHeavyFieldState, planVeteranCaltropDefense, shouldIssueHeavyFormation, shouldTriggerHeavyCounterCharge,
  shouldTriggerHeavyEnemyCharge, validateCaltropLayout, veteranCaltropWorldRects,
} from '../../src/career/HeavyCavalryMissions'

const tiers = (groups: readonly { tier: number; count: number }[]) =>
  groups.reduce<Record<number, number>>((acc, g) => ({ ...acc, [g.tier]: (acc[g.tier] ?? 0) + g.count }), {})

function damage(targetType: 'npc' | 'mount', id: string, appliedDamage: number): CombatEvent {
  return { type: 'damage_applied', method: 'melee', requestedDamage: 10, appliedDamage,
    source: { actorId: 'p', actorType: 'player', allegiance: 0, characterFaction: 'roman' },
    target: targetType === 'npc' ? { targetId: id, targetType, name: 'x' } : { targetId: `${id}:mount`, targetType, name: 'm', ownerActorId: id } } as unknown as CombatEvent
}

describe('heavy cavalry Career rosters', () => {
  it('每關兵力、Tier 與玩家編制位置符合任務規格', () => {
    const soldier = HEAVY_FIELD_SPECS[SOLDIER_IRON_ENCOUNTER_ID]
    expect(heavyGroupsTotal(soldier.friendly)).toBe(75)
    expect(tiers(soldier.friendly)).toEqual({ 2: 65, 3: 9, 4: 1 })
    expect(tiers(soldier.enemy)).toEqual({ 3: 50, 4: 9, 5: 1 })
    expect(heavyFriendlyActorIds(SOLDIER_IRON_ENCOUNTER_ID)).toHaveLength(74)

    const veteran = HEAVY_FIELD_SPECS[VETERAN_IRON_TIDE_ID]
    expect(heavyGroupsTotal(veteran.friendly)).toBe(300)
    expect(tiers(veteran.friendly)).toEqual({ 3: 294, 4: 6 })
    expect(tiers(veteran.enemy)).toEqual({ 3: 70, 4: 25, 5: 5 })
    expect(heavyFriendlyActorIds(VETERAN_IRON_TIDE_ID)).toHaveLength(299)
    expect(heavyNpcGroups(VETERAN_IRON_TIDE_ID, 'friendly').filter(g => g.role === 'melee').reduce((n, g) => n + g.count, 0)).toBe(99)

    const captain = HEAVY_FIELD_SPECS[CAPTAIN_STEEL_AVALANCHE_ID]
    expect(heavyFriendlyActorIds(CAPTAIN_STEEL_AVALANCHE_ID)).toHaveLength(29)
    expect(heavyEnemyActorIds(CAPTAIN_STEEL_AVALANCHE_ID)).toHaveLength(200)
    expect(captain.enemy.every(g => g.role !== 'spear')).toBe(true)
    expect(tiers(captain.enemy)).toEqual({ 3: 196, 4: 4 })

    expect(tiers(IRON_LEGION_ENEMY_GROUPS)).toEqual({ 4: 210, 5: 90 })
    expect(new Set(ironLegionEnemyActorIds('m')).size).toBe(300)
    expect(new Set(heavyActorIds('m', 'enemy', IRON_LEGION_ENEMY_GROUPS))).toEqual(new Set(ironLegionEnemyActorIds('m')))
  })
})

describe('heavy cavalry tactical triggers', () => {
  const enemies = new Set(['e1'])

  it('敵方 Charge 只由騎士或坐騎的有效傷害觸發，且只觸發一次', () => {
    const state = createHeavyFieldState(VETERAN_IRON_TIDE_ID)
    expect(shouldTriggerHeavyEnemyCharge(VETERAN_IRON_TIDE_ID, state, damage('npc', 'e1', 0), enemies)).toBe(false)
    expect(shouldTriggerHeavyEnemyCharge(VETERAN_IRON_TIDE_ID, state, damage('npc', 'stranger', 9), enemies)).toBe(false)
    expect(shouldTriggerHeavyEnemyCharge(VETERAN_IRON_TIDE_ID, state, damage('mount', 'e1', 4), enemies)).toBe(true)
    expect(shouldTriggerHeavyEnemyCharge(VETERAN_IRON_TIDE_ID, state, damage('npc', 'e1', 4), enemies)).toBe(true)
    state.enemyChargeTriggered = true
    expect(shouldTriggerHeavyEnemyCharge(VETERAN_IRON_TIDE_ID, state, damage('npc', 'e1', 4), enemies)).toBe(false)
    // Captain's infantry only charge on the 20m rule, never on damage.
    expect(shouldTriggerHeavyEnemyCharge(CAPTAIN_STEEL_AVALANCHE_ID, createHeavyFieldState(CAPTAIN_STEEL_AVALANCHE_ID), damage('npc', 'e1', 4), enemies)).toBe(false)
  })

  it('Soldier 先行軍再列陣，20m 反衝鋒只在列陣後觸發一次並可還原', () => {
    const state = createHeavyFieldState(SOLDIER_IRON_ENCOUNTER_ID)
    expect(heavyTacticalOrder(SOLDIER_IRON_ENCOUNTER_ID, 'friendly', state)).toBe('follow')
    expect(shouldTriggerHeavyCounterCharge(state, 10)).toBe(false)
    expect(shouldIssueHeavyFormation(state, { x: 0, z: 0 }, { x: 30, z: 0 })).toBe(false)
    expect(shouldIssueHeavyFormation(state, { x: 28, z: 0 }, { x: 30, z: 0 })).toBe(true)
    state.formationIssued = true
    expect(heavyTacticalOrder(SOLDIER_IRON_ENCOUNTER_ID, 'friendly', state)).toBe('formation')
    expect(shouldTriggerHeavyCounterCharge(state, 20.01)).toBe(false)
    expect(shouldTriggerHeavyCounterCharge(state, 20)).toBe(true)
    state.counterChargeTriggered = true
    expect(shouldTriggerHeavyCounterCharge(state, 5)).toBe(false)
    const restored = parseHeavyFieldState(JSON.parse(JSON.stringify(state)), SOLDIER_IRON_ENCOUNTER_ID)
    expect(heavyTacticalOrder(SOLDIER_IRON_ENCOUNTER_ID, 'friendly', restored!)).toBe('charge')
    expect(parseHeavyFieldState({ version: 1, formationIssued: false, enemyChargeTriggered: false, counterChargeTriggered: 1 }, SOLDIER_IRON_ENCOUNTER_ID)).toBeUndefined()
  })

  it('Captain 開場雙方 Defend，我方進入 20m 後敵方全軍 Charge 且不覆蓋我方軍令', () => {
    const state = createHeavyFieldState(CAPTAIN_STEEL_AVALANCHE_ID)
    expect(heavyTacticalOrder(CAPTAIN_STEEL_AVALANCHE_ID, 'friendly', state)).toBe('defend')
    expect(heavyTacticalOrder(CAPTAIN_STEEL_AVALANCHE_ID, 'enemy', state)).toBe('defend')
    state.counterChargeTriggered = true
    expect(heavyTacticalOrder(CAPTAIN_STEEL_AVALANCHE_ID, 'enemy', state)).toBe('charge')
    expect(heavyTacticalOrder(CAPTAIN_STEEL_AVALANCHE_ID, 'friendly', state)).toBe('defend')
  })

  it('Soldier 敵軍在我方列陣完成前原地待命，完成（或逾時）後才 Attack', () => {
    const state = createHeavyFieldState(SOLDIER_IRON_ENCOUNTER_ID)
    expect(heavyCommandPlan(SOLDIER_IRON_ENCOUNTER_ID, 'enemy', state).kind).toBe('hold')
    expect(isHeavyFormationComplete([1, 2, 50, 60], 5)).toBe(false)
    expect(isHeavyFormationComplete([1, 2, 2.5, 1, 1, 1, 1, 50], 5)).toBe(true)
    expect(isHeavyFormationComplete([50, 60], 25)).toBe(true)
    state.enemyReleased = true
    expect(heavyCommandPlan(SOLDIER_IRON_ENCOUNTER_ID, 'enemy', state).kind).toBe('plain')
  })

  it('Soldier / Veteran 敵軍在受傷前為真正的 Attack（不使用會強制 Defend 的 Formation 守位）', () => {
    for (const id of [SOLDIER_IRON_ENCOUNTER_ID, VETERAN_IRON_TIDE_ID] as const) {
      const state = createHeavyFieldState(id)
      state.enemyReleased = true
      expect(heavyCommandPlan(id, 'enemy', state)).toEqual({ order: 'attack', kind: 'plain' })
      state.enemyChargeTriggered = true
      expect(heavyCommandPlan(id, 'enemy', state)).toEqual({ order: 'charge', kind: 'charge' })
    }
    expect(heavyCommandPlan(VETERAN_IRON_TIDE_ID, 'friendly', createHeavyFieldState(VETERAN_IRON_TIDE_ID)).kind).toBe('hold')
    expect(heavyCommandPlan(SOLDIER_IRON_ENCOUNTER_ID, 'friendly', createHeavyFieldState(SOLDIER_IRON_ENCOUNTER_ID)).kind).toBe('march')
    expect(heavyCommandPlan(CAPTAIN_STEEL_AVALANCHE_ID, 'enemy', createHeavyFieldState(CAPTAIN_STEEL_AVALANCHE_ID)).kind).toBe('hold')
  })

  it('前線距離取兩軍最近的單位而非中心點', () => {
    expect(heavyFrontlineDistance([{ x: 0, z: 0 }, { x: 0, z: -200 }], [{ x: 0, z: 18 }, { x: 0, z: 300 }])).toBe(18)
  })
})

describe('Veteran caltrop defence', () => {
  it('拒馬為零散段落，缺口與弓兵列缺口皆有槍兵且騎兵有可通行路徑', () => {
    const layout = planVeteranCaltropDefense()
    expect(validateCaltropLayout(layout)).toEqual({ ok: true, problems: [] })
    expect(layout.gaps.length).toBeGreaterThan(1)
    expect(layout.caltrops.length).toBe(layout.gaps.length + 1)
    const route = caltropRouteExists(layout)
    expect(route.reachable).toBe(true)
    expect(route.minPassableWidth).toBeGreaterThanOrEqual(2)
    expect(veteranCaltropWorldRects(layout, 'roman')[0].maxZ).toBeLessThan(0)
  })

  it('完全封閉的拒馬牆會被判定為無路徑', () => {
    const layout = planVeteranCaltropDefense()
    const wall = { ...layout, caltrops: [{ minX: -80, maxX: 80, minDepth: -0.6, maxDepth: 0.6 }] }
    expect(caltropRouteExists(wall).reachable).toBe(false)
  })
})

describe('heavy cavalry field missions in Career', () => {
  const profileFor = (rank: 'soldier' | 'veteran' | 'captain' | 'commander', faction: 'roman' | 'viking' = 'roman') => {
    const profile = createCareerProfile(faction)
    profile.rank = rank
    profile.totalMerit = 20_000
    profile.availableMerit = 20_000
    profile.ownedMounts = ['black-cat']
    profile.selectedMountId = 'black-cat'
    return profile
  }

  it('Tier 與任務頁面：Soldier 不再被歸入 Recruit，新任務只出現在對應軍階頁面', () => {
    const ids = [SOLDIER_IRON_ENCOUNTER_ID, VETERAN_IRON_TIDE_ID, CAPTAIN_STEEL_AVALANCHE_ID, COMMANDER_IRON_LEGION_ID]
    expect(ids.map(careerMissionTierForTemplateId)).toEqual([2, 3, 4, 5])
    expect(availableCareerMissionsForPage(profileFor('soldier'), 'soldier').map(t => t.id)).toContain(SOLDIER_IRON_ENCOUNTER_ID)
    expect(availableCareerMissionsForPage(profileFor('soldier'), 'recruit').map(t => t.id)).not.toContain(SOLDIER_IRON_ENCOUNTER_ID)
    expect(availableCareerMissionsForPage(profileFor('veteran'), 'veteran').map(t => t.id)).toContain(VETERAN_IRON_TIDE_ID)
    expect(getHeavyFieldMissionAvailability(profileFor('soldier'), VETERAN_IRON_TIDE_ID).unlocked).toBe(false)
    expect(getHeavyFieldMissionAvailability(profileFor('captain'), SOLDIER_IRON_ENCOUNTER_ID).unlocked).toBe(true)
  })

  it.each([SOLDIER_IRON_ENCOUNTER_ID, VETERAN_IRON_TIDE_ID, CAPTAIN_STEEL_AVALANCHE_ID] as const)('%s 接受後兵力、重騎兵 Preset 與初始距離（>200m）正確', missionId => {
    const rank = missionId === SOLDIER_IRON_ENCOUNTER_ID ? 'soldier' : missionId === VETERAN_IRON_TIDE_ID ? 'veteran' : 'captain'
    const accepted = acceptHeavyFieldMission(profileFor(rank), missionId, `test:${missionId}`)!
    const plan = createCareerHeavySpawnPlan(accepted)
    const friendly = plan.npcSpecs.filter(spec => spec.faction === Faction.PLAYER), enemy = plan.npcSpecs.filter(spec => spec.faction === Faction.ENEMY)
    expect(friendly).toHaveLength(accepted.activeMission!.friendlyActorIds.length)
    expect(enemy).toHaveLength(accepted.activeMission!.targetActorIds.length)
    expect(new Set(plan.npcSpecs.map(spec => spec.actorId)).size).toBe(plan.npcSpecs.length)
    if (missionId !== CAPTAIN_STEEL_AVALANCHE_ID) expect(enemy.every(spec => spec.presetId === 'viking_heavy_cavalry' && spec.loadout?.mountId === 'snow-leopard' && spec.loadout.shieldId)).toBe(true)
    else expect(friendly.every(spec => spec.presetId === 'roman_heavy_cavalry' && spec.characterTier === 4 && spec.loadout?.mountId === 'armored-horse')).toBe(true)
    expect(friendly.every(spec => (spec.loadout?.rangedWeaponId ? spec.aiType === AIType.RANGED : spec.aiType === AIType.MELEE))).toBe(true)
    expect(heavyFrontlineDistance(friendly, enemy)).toBeGreaterThan(200)
    expect(accepted.activeMission!.commanderMission?.heavyField?.enemyChargeTriggered).toBe(false)
    const restored = parseCareerProfile(JSON.parse(JSON.stringify(accepted)))
    expect(restored?.activeMission?.templateId).toBe(missionId)
    expect(restored?.activeMission?.commanderMission?.heavyField).toEqual(accepted.activeMission!.commanderMission!.heavyField)
  })

  it('Veteran 單位不與拒馬重疊，Captain 官方軍令編制為 29 人單隊且私兵另列', () => {
    const veteran = acceptHeavyFieldMission(profileFor('veteran'), VETERAN_IRON_TIDE_ID, 'v')!
    expect([veteran.activeMission!.officialSquad, veteran.activeMission!.personalSquad]).toEqual([undefined, undefined])
    expect(acceptHeavyFieldMission(profileFor('soldier'), SOLDIER_IRON_ENCOUNTER_ID, 's')!.activeMission!.officialSquad).toBeUndefined()
    const rects = veteranCaltropWorldRects(planVeteranCaltropDefense(), 'roman')
    const friendly = createCareerHeavySpawnPlan(veteran).npcSpecs.filter(spec => spec.faction === Faction.PLAYER)
    expect(friendly.filter(spec => rects.some(r => spec.x > r.minX - 1 && spec.x < r.maxX + 1 && spec.z > r.minZ - 1 && spec.z < r.maxZ + 1))).toEqual([])
    const captainProfile = profileFor('captain')
    captainProfile.personalSquad = { members: [{ id: 'personal:hr-1', type: 'soldier' }] }
    const captain = acceptHeavyFieldMission(captainProfile, CAPTAIN_STEEL_AVALANCHE_ID, 'c')!.activeMission!
    expect(captain.officialSquad?.actorIds).toHaveLength(29)
    expect(captain.officialSquad?.actorIds.every(id => captain.friendlyActorIds.includes(id))).toBe(true)
    expect(captain.personalSquad?.memberIds).toEqual(['personal:hr-1'])
  })

  it('指揮權依玩家軍階而非任務：Captain 與 Commander 在任何一關可指揮並帶私兵，Veteran 不行', () => {
    const withSquad = (rank: 'veteran' | 'captain' | 'commander') => { const p = profileFor(rank); p.personalSquad = { members: [{ id: 'personal:hr-1', type: 'soldier' }] }; return p }
    const captain = acceptHeavyFieldMission(withSquad('captain'), SOLDIER_IRON_ENCOUNTER_ID, 'a')!.activeMission!
    expect(captain.officialSquad?.actorIds).toHaveLength(50)
    expect(captain.personalSquad?.memberIds).toEqual(['personal:hr-1'])
    const commander = acceptHeavyFieldMission(withSquad('commander'), VETERAN_IRON_TIDE_ID, 'b')!.activeMission!
    expect(commander.officialSquad?.squads?.map(squad => squad.actorIds.length)).toEqual([50, 50, 50, 50, 50, 49])
    expect(commander.officialSquad?.commandedSquadIds).toHaveLength(6)
    expect(commander.personalSquad).toBeDefined()
    const veteran = acceptHeavyFieldMission(withSquad('veteran'), SOLDIER_IRON_ENCOUNTER_ID, 'c')!.activeMission!
    expect([veteran.officialSquad, veteran.personalSquad]).toEqual([undefined, undefined])
    const restored = parseCareerProfile(JSON.parse(JSON.stringify(acceptHeavyFieldMission(withSquad('commander'), CAPTAIN_STEEL_AVALANCHE_ID, 'd'))))
    expect(restored?.activeMission?.officialSquad?.commandRank).toBe('commander')
  })
})
