import { describe, expect, it, vi } from 'vitest'
import { createCavalrySweepMission } from '../src/career/CavalrySweep'
import { createEnemyTownAssaultMission } from '../src/career/EnemyTownAssault'
import { createActiveCareerMission, createTownDefenseMission } from '../src/career/CareerMissionState'
import { claimCareerMission, createCareerProfile, type CareerProfile } from '../src/career/CareerProfile'
import { parseCareerProfile } from '../src/career/CareerProfileStore'
import { TownScene } from '../src/town/TownScene'

const deadPlayerStats = { damageDealt: 200, damageTaken: 100, kills: 2, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived: false }

describe('Town mission victory settlement after player death', () => {
  it.each(['bandit', 'patrol', 'town-defense', 'cavalry-sweep', 'enemy-town-assault'] as const)('persists %s victory rewards once and presents the saved dead-player result', kind => {
    const profile = createCareerProfile('roman')
    profile.activeMission = kind === 'town-defense' ? createTownDefenseMission(['captain'], ['civilian'], 'settlement')
      : kind === 'cavalry-sweep' ? createCavalrySweepMission('settlement')
      : kind === 'enemy-town-assault' ? createEnemyTownAssaultMission('settlement')
      : createActiveCareerMission(kind === 'patrol' ? 'recruit-patrol-01' : 'recruit-bandits-01', 0, 3, 0, 'settlement', kind)
    profile.activeMission.playerDead = true
    const town = Object.assign(Object.create(TownScene.prototype), {
      profile,
      defense: { active: kind === 'town-defense' || kind === 'enemy-town-assault', snapshot: () => ({ player: deadPlayerStats }), civilianSurvived: 19, civilianDeaths: 1 },
      mission: { snapshot: () => ({ player: deadPlayerStats }) },
      openMissionResult: vi.fn(),
    }) as any
    town.commit = vi.fn((next: CareerProfile) => {
      town.profile = parseCareerProfile(JSON.parse(JSON.stringify(next)))!
      return true
    })

    town.finishMission('victory')
    const offense = kind === 'cavalry-sweep' || kind === 'enemy-town-assault'
    expect(town.profile.activeMission.result).toMatchObject({ outcome: 'victory', stats: { survived: false }, merit: offense
      ? { damage: 10, kills: 16, contribution: 80, total: 106 }
      : { damage: 10, kills: 12, contribution: 12, total: 34 } })
    expect(town.profile.lifetimeStats).toMatchObject({ battles: 1, victories: 1, deaths: 1 })
    expect(town.profile.careerMissionCompletions).toBe(1)
    expect(town.openMissionResult).toHaveBeenCalledExactlyOnceWith(town.profile.activeMission.result, false)
    if (kind === 'town-defense') expect(town.profile.activeMission.result.defense).toEqual({ civilianSurvived: 19, civilianDeaths: 1 })

    town.finishMission('victory')
    expect(town.commit).toHaveBeenCalledOnce()
    expect(claimCareerMission(town.profile, 'settlement', 'victory', deadPlayerStats).meritAwarded).toBe(0)
  })

  it('retries an unsaved dead-player victory without losing or awarding merit twice', () => {
    const profile = createCareerProfile('roman')
    profile.activeMission = createActiveCareerMission('recruit-bandits-01', 0, 3, 0, 'retry-settlement')
    profile.activeMission.playerDead = true
    const town = Object.assign(Object.create(TownScene.prototype), {
      profile, defense: { active: false }, mission: { snapshot: () => ({ player: deadPlayerStats }) },
      openMissionResult: vi.fn(), openPanel: vi.fn(() => ({})), button: vi.fn(),
    }) as any
    town.commit = vi.fn().mockReturnValueOnce(false).mockImplementation((next: CareerProfile) => { town.profile = next; return true })
    town.finishMission('victory')
    expect(town.profile.totalMerit).toBe(0)
    expect(town.profile.activeMission.result).toBeUndefined()
    expect(town.openMissionResult).not.toHaveBeenCalled()
    town.button.mock.calls[0][2]()
    expect(town.profile.totalMerit).toBe(34)
    expect(town.profile.activeMission.result.stats.survived).toBe(false)
    town.finishMission('victory')
    expect(town.commit).toHaveBeenCalledTimes(2)
    expect(town.openMissionResult).toHaveBeenCalledOnce()
  })
})
