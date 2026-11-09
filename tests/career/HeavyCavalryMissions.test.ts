import { describe, expect, it } from 'vitest'
import type { CombatEvent } from '../../src/combat/CombatAttribution'
import {
  CAPTAIN_STEEL_AVALANCHE_ID, SOLDIER_IRON_ENCOUNTER_ID, VETERAN_IRON_TIDE_ID,
  HEAVY_FIELD_SPECS, caltropRouteExists, createHeavyFieldState, heavyActorIds, heavyEnemyActorIds, heavyFriendlyActorIds,
  heavyFrontlineDistance, heavyGroupsTotal, heavyNpcGroups, heavyTacticalOrder, ironLegionEnemyActorIds, IRON_LEGION_ENEMY_GROUPS,
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
