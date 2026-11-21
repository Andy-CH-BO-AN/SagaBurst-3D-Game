import { describe, expect, it, vi } from 'vitest'
import type { BattleStatsSnapshot } from '../../src/combat/BattleStatsTracker'
import { settleCareerBattleResult } from '../../src/career/CareerBattleResultSettlement'
import { acceptCareerOutpost, claimCareerOutpost } from '../../src/career/CareerOutpostMission'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { CAREER_STORAGE_KEY, CareerProfileStore } from '../../src/career/CareerProfileStore'
import { careerRankFixture } from '../helpers/careerRankFixture'
import { MemoryStorage } from '../helpers/memoryStorage'

const stats: BattleStatsSnapshot = {
  player: { damageDealt: 200, damageTaken: 10, kills: 2, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived: true }, squads: [],
}

describe('Career battle result settlement', () => {
  it('claims the result only by a durable save: every failed step leaves the stored bytes alone, the retry claims once and a second settle adds nothing', () => {
    const storage = new MemoryStorage(), store = new CareerProfileStore(storage)
    const profile = acceptCareerOutpost({ ...createCareerProfile('roman'), ...careerRankFixture('roman', 'soldier'), rank: 'soldier', totalMerit: 300, availableMerit: 300 }, 1, 'battle')!
    expect(store.save(profile)).toBe(true)
    const before = storage.getItem(CAREER_STORAGE_KEY)!
    let flushOk = true, persistOk = true, claims = 0
    const settle = () => settleCareerBattleResult({
      store, flushSkills: () => flushOk, persistBattle: () => persistOk,
      claim: fresh => { claims++; return claimCareerOutpost(fresh, 'battle', 'victory', stats) },
    })

    flushOk = false
    expect(settle()).toEqual({ status: 'save-failed' })
    flushOk = true; persistOk = false
    expect(settle()).toEqual({ status: 'save-failed' })
    persistOk = true
    storage.setItem(CAREER_STORAGE_KEY, '{not a profile')
    expect(settle()).toEqual({ status: 'save-failed' })
    expect(storage.getItem(CAREER_STORAGE_KEY)).toBe('{not a profile')
    expect(claims).toBe(0)
    storage.setItem(CAREER_STORAGE_KEY, before)
    storage.failWrites = true
    expect(settle()).toEqual({ status: 'save-failed' })
    expect(storage.getItem(CAREER_STORAGE_KEY)).toBe(before)

    storage.failWrites = false
    const writes = vi.spyOn(storage, 'setItem')
    const saved = settle()
    expect(saved.status).toBe('saved')
    expect(writes).toHaveBeenCalledOnce()
    const stored = store.load()!
    const record = stored.outpostBattleRecords!
    expect(record).toHaveLength(1)
    expect(stored.totalMerit).toBe(profile.totalMerit + record[0].merit.total)
    expect(saved).toEqual({ status: 'saved', profile: stored })

    const settledBytes = storage.getItem(CAREER_STORAGE_KEY)
    expect(settle().status).toBe('saved')
    expect(storage.getItem(CAREER_STORAGE_KEY)).toBe(settledBytes)
    expect(store.load()!.totalMerit).toBe(stored.totalMerit)
  })
})
