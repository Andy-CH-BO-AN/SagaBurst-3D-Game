import { createTownCombatFixture } from './townCombatFixture'
import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCareerProfile, claimCareerMission, clearCareerMission, type CareerRank } from '../src/career/CareerProfile'
import { availableRecruitMissions, availableCareerMissionsForPage, getRecruitMissionTemplate } from '../src/career/CareerMissionCatalog'
import { createTownDefenseMission } from '../src/career/CareerMissionState'
import { parseCareerProfile } from '../src/career/CareerProfileStore'
import { TownDefenseController } from '../src/career/TownDefenseController'
import { townDefenseAttackGroups, townDefenseEnemyCount, townDefenseEnemyTotals, TOWN_DEFENSE_TEMPLATE_ID, SOLDIER_TOWN_DEFENSE_TEMPLATE_ID } from '../src/career/TownDefenseState'
import { CombatEventStream } from '../src/combat/CombatAttribution'
import { townRoster } from '../src/town/TownRules'
import { TownScene } from '../src/town/TownScene'

// Keep real NPC/Mount spawning while replacing only the preloaded visual asset.
vi.mock('../src/world/HorseAssetRegistry', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/world/HorseAssetRegistry')>()), HorseAssetRegistry: {
  ready: true,
  createInstance: () => {
    const root = new THREE.Group(), saddleSeat = new THREE.Object3D()
    saddleSeat.position.y = 1.7; root.add(saddleSeat)
    return { root, saddleSeat, lod: new THREE.LOD(), skeleton: null,
      setLocomotion: vi.fn(), setAppearanceVariant: vi.fn(), playOnce: vi.fn(),
      playDeath: vi.fn(), update: vi.fn(), dispose: vi.fn() }
  },
} }))

describe('Independent Recruit and Soldier Town Defense missions', () => {
  it.each([
    ['recruit', 50, [15, 15, 20], { melee: 20, lancer: 15, 'horse-archer': 15 }],
    ['soldier', 55, [17, 16, 22], { melee: 22, lancer: 17, 'horse-archer': 16 }],
  ] as const)('keeps %s display, roster and three lanes consistent at %s enemies', (rank, count, lanes, totals) => {
    const profile = createCareerProfile('roman')
    profile.rank = rank; profile.totalMerit = 1000; profile.careerMissionCompletionsByTier = { 1: 5, 2: 5 }
    const templateId = rank === 'recruit' ? TOWN_DEFENSE_TEMPLATE_ID : SOLDIER_TOWN_DEFENSE_TEMPLATE_ID
    const template = availableRecruitMissions(profile).find(mission => mission.id === templateId)!
    expect(template).toMatchObject({ enemyCount: count, friendlyCombatants: 64, maxCivilianDeaths: 10 })
    const mission = createTownDefenseMission(['captain'], [], 'tier-defense', templateId)
    expect(mission.targetActorIds).toHaveLength(count)
    expect(new Set(mission.targetActorIds).size).toBe(count)
    expect(townDefenseEnemyCount(templateId)).toBe(count)
    expect(townDefenseEnemyTotals(count)).toEqual(totals)
    expect(townDefenseAttackGroups(count).map(group => Object.values(group.composition).reduce((sum, n) => sum + n, 0))).toEqual(lanes)
    expect(townDefenseAttackGroups(count).map(group => group.id)).toEqual(['south', 'west', 'east'])
    // Reading a Soldier's board must not overwrite the Recruit catalog entry.
    expect(getRecruitMissionTemplate('recruit-town-defense-01')).toMatchObject({ enemyCount: 50 })
  })

  it.each([['soldier', 55], ['veteran', 61], ['captain', 67], ['commander', 73]] as const)('scales %s defense by 1.1 per rank while keeping Recruit fixed', (rank, count) => {
    const profile = createCareerProfile('roman')
    profile.rank = rank; profile.totalMerit = 1000; profile.careerMissionCompletionsByTier = { 1: 5, 2: 5 }
    expect(availableRecruitMissions(profile).filter(mission => mission.kind === 'town-defense').map(mission => [mission.id, mission.enemyCount]))
      .toEqual([[TOWN_DEFENSE_TEMPLATE_ID, 50], [SOLDIER_TOWN_DEFENSE_TEMPLATE_ID, count]])
    const mission = createTownDefenseMission(['captain'], [], 'rank-defense', SOLDIER_TOWN_DEFENSE_TEMPLATE_ID, rank)
    expect(mission.targetActorIds).toHaveLength(count)
    expect(Object.values(townDefenseEnemyTotals(count)).reduce((sum, value) => sum + value, 0)).toBe(count)
  })

  it.each(['roman', 'viking'] as const)('spawns only registered T2 cavalry for both %s difficulty levels', faction => {
    for (const rank of ['recruit', 'soldier', 'veteran', 'captain', 'commander'] as const) {
      const profile = createCareerProfile(faction)
      profile.rank = rank
      const templateId = rank === 'recruit' ? TOWN_DEFENSE_TEMPLATE_ID : SOLDIER_TOWN_DEFENSE_TEMPLATE_ID
      const mission = createTownDefenseMission(['captain'], [], `spawn-${faction}-${rank}`, templateId, rank)
      profile.activeMission = mission
      const controller = Object.assign(withMissionCheckpoint(Object.create(TownDefenseController.prototype)), {
        scene: new THREE.Scene(), readProfile: () => profile, events: new CombatEventStream(),
        enemies: [], enemyMounts: [], attackGroups: [],
      }) as any
      try {
        controller.spawnAttackers(mission)
        expect(controller.enemies).toHaveLength(townDefenseEnemyCount(templateId, rank))
        expect(controller.enemyMounts).toHaveLength(townDefenseEnemyCount(templateId, rank))
        expect(controller.enemies.map((npc: any) => npc.combatantId)).toEqual(mission.targetActorIds)
        expect(controller.enemies.every((npc: any) => npc.tier === 2 && npc.isMounted && !npc.respawnEnabled)).toBe(true)
        expect(controller.attackGroups.map((group: any) => group.members.length)).toEqual(townDefenseAttackGroups(mission.targetActorIds.length).map(group => Object.values(group.composition).reduce((sum, value) => sum + value, 0)))
      } finally { controller.disposeEnemies() }
    }
  })

  it.each(['recruit', 'soldier'] as const)('reload retains %s roster and accepts dead-player victory after all registered attackers die', rank => {
    const profile = createCareerProfile('roman')
    profile.rank = rank
    const templateId = rank === 'recruit' ? TOWN_DEFENSE_TEMPLATE_ID : SOLDIER_TOWN_DEFENSE_TEMPLATE_ID
    profile.activeMission = createTownDefenseMission(['captain'], [], 'reload-tier', templateId)
    profile.activeMission.phase = 'ATTACKING'; profile.activeMission.playerDead = true
    profile.activeMission.deadTargetActorIds = profile.activeMission.targetActorIds.slice(0, 2)
    const saved = parseCareerProfile(JSON.parse(JSON.stringify(profile)))!
    // Even if appointed rank changes, an active mission uses its accepted roster.
    saved.rank = (rank === 'recruit' ? 'soldier' : 'recruit') as CareerRank
    const active = saved.activeMission!
    const controller = Object.assign(withMissionCheckpoint(Object.create(TownDefenseController.prototype)), {
      readProfile: () => saved, residents: [], groups: [],
      enemies: active.targetActorIds.slice(2).map(combatantId => ({ combatantId, dead: false })),
    }) as TownDefenseController
    expect(active.targetActorIds).toHaveLength(townDefenseEnemyCount(templateId))
    expect(townDefenseAttackGroups(active.targetActorIds.length).map(group => Object.values(group.composition).reduce((sum, n) => sum + n, 0))).toEqual(rank === 'recruit' ? [15, 15, 20] : [17, 16, 22])
    expect(controller.evaluate(true)).toBe('failure')
    controller.enemies.length = 0
    expect(controller.evaluate(false)).toBeNull() // Incomplete registration never wins.
    active.deadTargetActorIds = [...active.targetActorIds]
    expect(controller.evaluate(true)).toBe('victory')
    expect(active.playerDead).toBe(true)
    expect(active.templateId).toBe(templateId)
  })
})

class PanelElement {
  children: PanelElement[] = []
  textContent = ''; className = ''; disabled = false
  style = {}; attributes: Record<string, string> = {}
  onclick?: () => void
  constructor(readonly tagName: string) {}
  append(...elements: PanelElement[]) { this.children.push(...elements) }
  setAttribute(name: string, value: string) { this.attributes[name] = value }
}
function flatten(element: PanelElement): PanelElement[] {
  return [element, ...element.children.flatMap(flatten)]
}
function board(rank: CareerRank = 'soldier') {
  vi.stubGlobal('document', { createElement: (tag: string) => new PanelElement(tag) })
  const town = createTownCombatFixture() as any
  town.profile = createCareerProfile('roman')
  Object.assign(town.profile, { rank, totalMerit: 1000, careerMissionCompletionsByTier: { 1: 5, 2: 5 }, completedOutpostRelief: true })
  town.player = { arrowCount: 30, dead: false }
  town.openPanel = vi.fn(() => { town.panel = new PanelElement('section'); return town.panel })
  town.store = { load: () => town.profile }
  town.event = { hostile: false }; town.mission = { fieldNpcs: [] }
  town.residents = townRoster().map(spec => ({ spec }))
  town.commit = vi.fn(next => { town.profile = next; return true })
  town.defense = { startActiveMission: vi.fn(() => true) }
  town.inventory = { prepareForCombat: vi.fn() }
  town.playTownDefenseAlert = vi.fn(); town.closePanel = vi.fn()
  const open = () => town.openDeploymentPanel('任務', { townFaction: 'roman', npcRole: 'deployment', playerRank: rank, firstMeet: false }, false)
  return { town, open, rows: () => flatten(town.panel).filter(element => element.tagName === 'strong').map(element => element.textContent) }
}
afterEach(() => vi.unstubAllGlobals())

describe('Career mission pages and independent completion', () => {
  it('shows Soldier missions separately and lets Soldier switch back to Recruit missions', () => {
    const { town, open, rows } = board()
    open()
    expect(rows()).toContain('守衛家園 · 士兵守城')
    expect(rows()).toContain('Outpost I')
    expect(rows()).not.toContain('家門口的戰爭 · 菜兵守城')
    flatten(town.panel).find(element => element.textContent === '菜兵任務')!.onclick!()
    expect(rows()).toContain('家門口的戰爭 · 菜兵守城')
    expect(rows()).toContain('南路巡邏')
    expect(rows()).not.toContain('守衛家園 · 士兵守城')
    expect(rows()).not.toContain('Outpost I')
    expect(rows()).not.toContain('Enemy Town Assault · 進攻敵方家園')
    open()
    expect(rows()).toContain('家門口的戰爭 · 菜兵守城')
    flatten(town.panel).find(element => element.textContent === '士兵任務')!.onclick!()
    expect(rows()).toContain('守衛家園 · 士兵守城')
    expect(rows()).toContain('Enemy Town Assault · 進攻敵方家園')
  })

  it('keeps Recruit on the Recruit page and locks the Soldier page', () => {
    const { town, open, rows } = board('recruit')
    open()
    expect(rows()).toContain('家門口的戰爭 · 菜兵守城')
    expect(rows()).not.toContain('守衛家園 · 士兵守城')
    expect(flatten(town.panel).find(element => element.textContent === '士兵任務 · 升階解鎖')!.disabled).toBe(true)
    expect(availableCareerMissionsForPage(town.profile, 'soldier').some(template => template.id === SOLDIER_TOWN_DEFENSE_TEMPLATE_ID)).toBe(false)
  })

  it.each([[TOWN_DEFENSE_TEMPLATE_ID, 50], [SOLDIER_TOWN_DEFENSE_TEMPLATE_ID, 55]] as const)('accepts %s with its own roster even when the player is Soldier', (templateId, count) => {
    const { town } = board()
    town.acceptMission(templateId)
    expect(town.profile.activeMission.templateId).toBe(templateId)
    expect(town.profile.activeMission.targetActorIds).toHaveLength(count)
    expect(town.defense.startActiveMission).toHaveBeenCalledOnce()
  })

  it.each([TOWN_DEFENSE_TEMPLATE_ID, SOLDIER_TOWN_DEFENSE_TEMPLATE_ID])('completing %s does not complete the other defense or award merit twice', templateId => {
    let profile = createCareerProfile('roman')
    Object.assign(profile, { rank: 'soldier', totalMerit: 1000, careerMissionCompletionsByTier: { 1: 5, 2: 5 } })
    const mission = createTownDefenseMission(['captain'], [], undefined, templateId)
    profile.activeMission = mission
    const stats = { damageDealt: 25, kills: 1, survived: false, damageTaken: 100, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0 }
    const claim = claimCareerMission(profile, mission.id, 'victory', stats)
    expect(claim.profile.completedCareerMissionTemplateIds).toEqual([templateId])
    expect(claim.profile.activeMission!.result!.stats.survived).toBe(false)
    profile = parseCareerProfile(JSON.parse(JSON.stringify(claim.profile)))!
    const duplicate = claimCareerMission(profile, mission.id, 'victory', stats)
    expect(duplicate.alreadyClaimed).toBe(true)
    expect(duplicate.meritAwarded).toBe(0)
    expect(duplicate.profile.totalMerit).toBe(claim.profile.totalMerit)
    const remaining = availableRecruitMissions(clearCareerMission(profile, mission.id)).filter(template => template.kind === 'town-defense')
    expect(remaining.map(template => template.id)).toEqual([templateId === TOWN_DEFENSE_TEMPLATE_ID ? SOLDIER_TOWN_DEFENSE_TEMPLATE_ID : TOWN_DEFENSE_TEMPLATE_ID])
  })
})
import { withMissionCheckpoint } from './helpers/missionCheckpoint'
