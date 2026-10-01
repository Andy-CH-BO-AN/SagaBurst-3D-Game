import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { createCareerProfile, type CareerRank } from '../src/career/CareerProfile'
import { availableRecruitMissions, getRecruitMissionTemplate } from '../src/career/CareerMissionCatalog'
import { createTownDefenseMission } from '../src/career/CareerMissionState'
import { parseCareerProfile } from '../src/career/CareerProfileStore'
import { TownDefenseController } from '../src/career/TownDefenseController'
import { townDefenseAttackGroups, townDefenseEnemyCount, townDefenseEnemyTotals } from '../src/career/TownDefenseState'
import { CombatEventStream } from '../src/combat/CombatAttribution'

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

describe('Town Defense difficulty follows appointed rank', () => {
  it.each([
    ['recruit', 60, [18, 18, 24], { melee: 24, lancer: 18, 'horse-archer': 18 }],
    ['soldier', 70, [21, 21, 28], { melee: 28, lancer: 21, 'horse-archer': 21 }],
  ] as const)('keeps %s display, roster and three lanes consistent at %s enemies', (rank, count, lanes, totals) => {
    const profile = createCareerProfile('roman')
    profile.rank = rank; profile.totalMerit = 1000; profile.careerMissionCompletions = 5
    const template = availableRecruitMissions(profile).find(mission => mission.kind === 'town-defense')!
    expect(template).toMatchObject({ enemyCount: count, friendlyCombatants: 64, maxCivilianDeaths: 10 })
    const mission = createTownDefenseMission(['captain'], [], 'rank-defense', rank)
    expect(mission.targetActorIds).toHaveLength(count)
    expect(new Set(mission.targetActorIds).size).toBe(count)
    expect(townDefenseEnemyCount(rank)).toBe(count)
    expect(townDefenseEnemyTotals(count)).toEqual(totals)
    expect(townDefenseAttackGroups(count).map(group => Object.values(group.composition).reduce((sum, n) => sum + n, 0))).toEqual(lanes)
    expect(townDefenseAttackGroups(count).map(group => group.id)).toEqual(['south', 'west', 'east'])
    // Reading a Soldier's board must not overwrite the Recruit catalog entry.
    expect(getRecruitMissionTemplate('recruit-town-defense-01')).toMatchObject({ enemyCount: 60 })
  })

  it.each(['veteran', 'captain', 'commander'] as const)('retains the current 70-enemy baseline for %s', rank => {
    expect(townDefenseEnemyCount(rank)).toBe(70)
  })

  it.each(['roman', 'viking'] as const)('spawns only registered T2 cavalry for both %s difficulty levels', faction => {
    for (const rank of ['recruit', 'soldier'] as const) {
      const profile = createCareerProfile(faction)
      profile.rank = rank
      const mission = createTownDefenseMission(['captain'], [], `spawn-${faction}-${rank}`, rank)
      profile.activeMission = mission
      const controller = Object.assign(Object.create(TownDefenseController.prototype), {
        scene: new THREE.Scene(), readProfile: () => profile, events: new CombatEventStream(),
        enemies: [], enemyMounts: [], attackGroups: [],
      }) as any
      try {
        controller.spawnAttackers(mission)
        expect(controller.enemies).toHaveLength(townDefenseEnemyCount(rank))
        expect(controller.enemyMounts).toHaveLength(townDefenseEnemyCount(rank))
        expect(controller.enemies.map((npc: any) => npc.combatantId)).toEqual(mission.targetActorIds)
        expect(controller.enemies.every((npc: any) => npc.tier === 2 && npc.isMounted && !npc.respawnEnabled)).toBe(true)
        expect(controller.attackGroups.map((group: any) => group.members.length)).toEqual(rank === 'recruit' ? [18, 18, 24] : [21, 21, 28])
      } finally { controller.disposeEnemies() }
    }
  })

  it.each(['recruit', 'soldier'] as const)('reload retains %s roster and accepts dead-player victory after all registered attackers die', rank => {
    const profile = createCareerProfile('roman')
    profile.rank = rank
    profile.activeMission = createTownDefenseMission(['captain'], [], 'reload-rank', rank)
    profile.activeMission.phase = 'ATTACKING'; profile.activeMission.playerDead = true
    profile.activeMission.deadTargetActorIds = profile.activeMission.targetActorIds.slice(0, 2)
    const saved = parseCareerProfile(JSON.parse(JSON.stringify(profile)))!
    // Even if appointed rank changes, an active mission uses its accepted roster.
    saved.rank = (rank === 'recruit' ? 'soldier' : 'recruit') as CareerRank
    const active = saved.activeMission!
    const controller = Object.assign(Object.create(TownDefenseController.prototype), {
      readProfile: () => saved, residents: [], groups: [],
      enemies: active.targetActorIds.slice(2).map(combatantId => ({ combatantId, dead: false })),
    }) as TownDefenseController
    expect(active.targetActorIds).toHaveLength(townDefenseEnemyCount(rank))
    expect(townDefenseAttackGroups(active.targetActorIds.length).map(group => Object.values(group.composition).reduce((sum, n) => sum + n, 0))).toEqual(rank === 'recruit' ? [18, 18, 24] : [21, 21, 28])
    expect(controller.evaluate(true)).toBe('failure')
    controller.enemies.length = 0
    expect(controller.evaluate(false)).toBeNull() // Incomplete registration never wins.
    active.deadTargetActorIds = [...active.targetActorIds]
    expect(controller.evaluate(true)).toBe('victory')
    expect(active.playerDead).toBe(true)
  })
})
