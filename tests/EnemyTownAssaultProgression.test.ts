import { createTownCombatFixture } from './townCombatFixture'
import { describe, expect, it, vi } from 'vitest'
import { TownScene } from '../src/town/TownScene'
import { CAREER_RANKS, claimCareerMission, clearCareerMission, createCareerProfile } from '../src/career/CareerProfile'
import { CareerProfileStore, parseCareerProfile } from '../src/career/CareerProfileStore'
import { acceptCareerOutpostRelief, claimCareerOutpost, clearCareerOutpost } from '../src/career/CareerOutpostMission'
import { availableRecruitMissions, isEnemyTownAssaultUnlocked } from '../src/career/CareerMissionCatalog'
import { acceptEnemyTownAssault, ENEMY_TOWN_ASSAULT_ID } from '../src/career/EnemyTownAssault'

const stats = { player: { damageDealt: 200, damageTaken: 10, kills: 2, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived: false }, squads: [] }
function readyForRelief(faction: 'roman' | 'viking' = 'roman') {
  return { ...createCareerProfile(faction), rank: 'soldier' as const, totalMerit: 300, availableMerit: 300,
    completedOutpostStages: [1, 2, 3] as (1 | 2 | 3)[], ownedMounts: ['horse' as const], ownedHorseTiers: [1] as (1 | 2 | 3)[], selectedMountId: 'horse-t1' as const }
}
function settleRelief(outcome: 'victory' | 'defeat', faction: 'roman' | 'viking' = 'roman') {
  const active = acceptCareerOutpostRelief(readyForRelief(faction), 'relief')!
  expect(active).not.toBeNull()
  return clearCareerOutpost(claimCareerOutpost(active, 'relief', outcome, stats).profile)
}
function listed(profile: ReturnType<typeof createCareerProfile>) {
  return availableRecruitMissions(profile).some(template => template.id === ENEMY_TOWN_ASSAULT_ID)
}

describe('Enemy Town Assault canonical Relief prerequisite', () => {
  for (const faction of ['roman', 'viking'] as const) {
    for (const rank of CAREER_RANKS) {
      it(`${faction} ${rank}: rank, Merit and generic completions cannot unlock assault`, () => {
        const profile = { ...createCareerProfile(faction), rank, totalMerit: 100000, careerMissionCompletions: 100 }
        expect(listed(profile)).toBe(false)
        expect(acceptEnemyTownAssault(profile, 'assault')).toBeNull()
      })
    }
    it(`${faction}: Outpost I–III completion and Relief defeat remain locked`, () => {
      expect(listed(readyForRelief(faction))).toBe(false)
      const defeated = settleRelief('defeat', faction)
      expect(isEnemyTownAssaultUnlocked(defeated)).toBe(false)
      expect(listed(defeated)).toBe(false)
      expect(acceptEnemyTownAssault(defeated, 'assault')).toBeNull()
    })
    it(`${faction}: Relief Victory unlocks even when the player did not survive`, () => {
      const won = settleRelief('victory', faction)
      expect(won.completedOutpostRelief).toBe(true)
      expect(listed(won)).toBe(true)
      const accepted = acceptEnemyTownAssault(won, 'assault')!
      expect(accepted.activeMission).toMatchObject({ id: 'assault', kind: 'enemy-town-assault' })
      expect(won.activeMission).toBeUndefined()
      expect(acceptEnemyTownAssault(accepted, 'duplicate')).toBeNull()
      const finished = clearCareerMission(claimCareerMission(accepted, 'assault', 'victory', stats.player).profile, 'assault')
      expect(acceptEnemyTownAssault(finished, 'replay')!.activeMission!.id).toBe('replay')
    })
  }
  it('preserves the unlock through save/load and subsequent Relief defeat', () => {
    const values = new Map<string, string>()
    const store = new CareerProfileStore({ getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) } } as Storage)
    expect(store.save(settleRelief('victory'))).toBe(true)
    const loaded = store.load()!
    expect(listed(loaded)).toBe(true)
    expect(acceptEnemyTownAssault(loaded, 'after-reload')).not.toBeNull()
    const retry = acceptCareerOutpostRelief(loaded, 'relief-retry')!
    expect(clearCareerOutpost(claimCareerOutpost(retry, 'relief-retry', 'defeat', stats).profile).completedOutpostRelief).toBe(true)
  })
  it('claims Relief victory once and does not infer unlock from truthy malformed save data', () => {
    const active = acceptCareerOutpostRelief(readyForRelief(), 'relief')!
    const won = claimCareerOutpost(active, 'relief', 'victory', stats).profile
    const duplicate = claimCareerOutpost(won, 'relief', 'victory', stats)
    expect(duplicate.alreadyClaimed).toBe(true)
    expect(duplicate.profile.careerMissionCompletions).toBe(1)
    for (const value of [undefined, false, 'true', 1]) {
      expect(isEnemyTownAssaultUnlocked(parseCareerProfile({ ...readyForRelief(), completedOutpostRelief: value })!)).toBe(false)
    }
  })
  it('blocks direct acceptance during another outpost mission or town hostility', () => {
    const won = settleRelief('victory')
    expect(acceptEnemyTownAssault(acceptCareerOutpostRelief(won, 'retry')!, 'assault')).toBeNull()
    expect(acceptEnemyTownAssault({ ...won, townEvent: { id: 'hostile-town', state: 'hostile' } }, 'assault')).toBeNull()
  })
  it.each(['soldier', 'veteran', 'captain'] as const)('deploys the best owned gear allowed for %s without changing the source profile', rank => {
    const profile = settleRelief('victory')
    profile.rank = rank
    profile.ownedArmors = ['scutum_t1', 'scutum_t2', 'scutum_t3']
    profile.equipment = { shield: null, melee: 'gladius_rusty' }
    profile.ownedHorseTiers = [1, 2, 3]; profile.ownedMounts = ['horse', 'corgi']
    const original = JSON.stringify(profile)
    const next = acceptEnemyTownAssault(profile, 'equipped-assault')!
    expect(next.activeMission!.phase).toBe('ATTACKING')
    expect(next.equipment).toEqual({ melee: 'gladius_rusty', shield: rank === 'soldier' ? 'scutum_t2' : 'scutum_t3' })
    expect(next.selectedMountId).toBe('horse')
    expect(JSON.stringify(profile)).toBe(original)
    expect(parseCareerProfile(JSON.parse(JSON.stringify(next)))!.selectedMountId).toBe(next.selectedMountId)
  })
  it('rechecks the persisted prerequisite when accepting from a stale deployment UI', () => {
    const commit = vi.fn(), restart = vi.fn(), openPanel = vi.fn()
    const scene = Object.assign(createTownCombatFixture(), {
      profile: settleRelief('victory'), store: { load: () => readyForRelief() },
      commit, onRestart: restart, openPanel,
    })
    scene.acceptMission(ENEMY_TOWN_ASSAULT_ID)
    expect(openPanel).toHaveBeenCalled()
    expect(commit).not.toHaveBeenCalled()
    expect(restart).not.toHaveBeenCalled()
  })
})
