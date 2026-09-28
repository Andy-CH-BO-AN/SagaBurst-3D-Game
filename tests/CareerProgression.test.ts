import { describe, expect, it } from 'vitest'
import type { BattleStatsSnapshot } from '../src/combat/BattleStatsTracker'
import {
  CAREER_RANK_THRESHOLDS,
  claimCareerBattle,
  createCareerProfile,
  resolveCareerRank,
  unlockCareerContent,
} from '../src/career/CareerProfile'
import {
  CAREER_STORAGE_KEY,
  CareerProfileStore,
  parseCareerProfile,
} from '../src/career/CareerProfileStore'
import {
  MERIT_RULES,
  calculateMerit,
} from '../src/career/MeritCalculator'

function stats(overrides: Partial<BattleStatsSnapshot['player']> = {}): BattleStatsSnapshot {
  return {
    player: {
      damageDealt: 0,
      damageTaken: 0,
      kills: 0,
      structureDamage: 0,
      structuresDestroyed: 0,
      gateBreaches: 0,
      survived: true,
      ...overrides,
    },
    squads: [],
  }
}

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()

  get length(): number { return this.values.size }

  clear(): void {
    this.values.clear()
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

describe('Career merit calculation', () => {
  it('awards victory, kills, actual damage and survival merit', () => {
    const result = calculateMerit(
      stats({ damageDealt: 2280, kills: 2, survived: true }),
      'victory',
      'defense',
    )

    expect(result).toEqual({
      victory: 80,
      kills: 16,
      characterDamage: 44,
      survival: 20,
      structureDamage: 0,
      gateBreaches: 0,
      total: 160,
    })
  })

  it('only awards structure and breach merit to offense battles', () => {
    const battleStats = stats({
      damageDealt: 450,
      kills: 1,
      structureDamage: 380,
      gateBreaches: 2,
      survived: false,
    })

    const defense = calculateMerit(battleStats, 'defeat', 'defense')
    expect(defense.structureDamage).toBe(0)
    expect(defense.gateBreaches).toBe(0)
    expect(defense.total).toBe(16)

    const offense = calculateMerit(battleStats, 'defeat', 'offense')
    expect(offense.structureDamage).toBe(3)
    expect(offense.gateBreaches).toBe(50)
    expect(offense.total).toBe(69)
  })

  it('keeps the first-pass merit tuning centralized', () => {
    expect(MERIT_RULES).toEqual({
      victory: 80,
      kill: 8,
      characterDamagePer100: 2,
      survival: 20,
      structureDamagePer100: 1,
      gateBreach: 25,
    })
  })
})

describe('Career profile progression', () => {
  it('resolves data-driven rank thresholds', () => {
    expect(CAREER_RANK_THRESHOLDS).toEqual({
      recruit: 0,
      soldier: 300,
      veteran: 900,
      captain: 2000,
      commander: 4000,
    })

    expect(resolveCareerRank(0)).toBe('recruit')
    expect(resolveCareerRank(299)).toBe('recruit')
    expect(resolveCareerRank(300)).toBe('soldier')
    expect(resolveCareerRank(899)).toBe('soldier')
    expect(resolveCareerRank(900)).toBe('veteran')
    expect(resolveCareerRank(1999)).toBe('veteran')
    expect(resolveCareerRank(2000)).toBe('captain')
    expect(resolveCareerRank(3999)).toBe('captain')
    expect(resolveCareerRank(4000)).toBe('commander')
  })

  it('claims a battle once, updates lifetime stats and promotes by total merit', () => {
    const profile = createCareerProfile('roman')
    profile.merit = 290
    profile.rank = resolveCareerRank(profile.merit)

    const first = claimCareerBattle(profile, {
      battleId: 'career-battle-001',
      outcome: 'victory',
      role: 'defense',
      stats: stats({
        damageDealt: 500,
        kills: 2,
        structureDamage: 900,
        gateBreaches: 1,
        survived: true,
      }),
    })

    expect(first.alreadyClaimed).toBe(false)
    expect(first.meritAwarded).toBe(126)
    expect(first.previousRank).toBe('recruit')
    expect(first.newRank).toBe('soldier')
    expect(first.profile.faction).toBe('roman')
    expect(first.profile.merit).toBe(416)
    expect(first.profile.lifetimeStats).toEqual({
      battles: 1,
      victories: 1,
      deaths: 0,
      kills: 2,
      damage: 500,
      structureDamage: 0,
      breaches: 0,
    })

    const duplicate = claimCareerBattle(first.profile, {
      battleId: 'career-battle-001',
      outcome: 'victory',
      role: 'offense',
      stats: stats({
        damageDealt: 9999,
        kills: 99,
        structureDamage: 9999,
        gateBreaches: 9,
        survived: false,
      }),
    })

    expect(duplicate.alreadyClaimed).toBe(true)
    expect(duplicate.meritAwarded).toBe(0)
    expect(duplicate.profile).toEqual(first.profile)
  })

  it('records defeat progress but gives no victory or death survival bonus', () => {
    const profile = createCareerProfile('viking')
    const claim = claimCareerBattle(profile, {
      battleId: 'career-battle-loss',
      outcome: 'defeat',
      role: 'defense',
      stats: stats({
        damageDealt: 950,
        kills: 3,
        survived: false,
      }),
    })

    expect(claim.meritBreakdown.victory).toBe(0)
    expect(claim.meritBreakdown.survival).toBe(0)
    expect(claim.meritAwarded).toBe(42)
    expect(claim.profile.lifetimeStats).toMatchObject({
      battles: 1,
      victories: 0,
      deaths: 1,
      kills: 3,
      damage: 950,
    })
  })

  it('unlocks each content id at most once', () => {
    const profile = createCareerProfile('viking')

    expect(unlockCareerContent(profile, 'weapon', 'viking_axe_t1')).toBe(true)
    expect(unlockCareerContent(profile, 'weapon', 'viking_axe_t1')).toBe(false)
    expect(unlockCareerContent(profile, 'shield', 'round_shield_t1')).toBe(true)
    expect(unlockCareerContent(profile, 'mount', 'horse')).toBe(true)
    expect(unlockCareerContent(profile, 'hero', 'viking-hero-t4')).toBe(true)

    expect(profile.unlockedWeapons).toEqual(['viking_axe_t1'])
    expect(profile.unlockedShields).toEqual(['round_shield_t1'])
    expect(profile.unlockedMounts).toEqual(['horse'])
    expect(profile.unlockedHeroes).toEqual(['viking-hero-t4'])
  })

  it('rejects an empty battle id before mutating career progress', () => {
    const profile = createCareerProfile('roman')
    expect(() => claimCareerBattle(profile, {
      battleId: '   ',
      outcome: 'victory',
      role: 'defense',
      stats: stats(),
    })).toThrow('Career battleId must not be empty')
    expect(profile.merit).toBe(0)
    expect(profile.claimedBattleIds).toEqual([])
  })
})

describe('Career profile persistence', () => {
  it('round-trips a career profile in its own storage key', () => {
    const storage = new MemoryStorage()
    const store = new CareerProfileStore(storage)
    const profile = createCareerProfile('viking')
    profile.merit = 2123
    profile.rank = resolveCareerRank(profile.merit)
    profile.unlockedWeapons.push('viking_axe_t1')
    profile.unlockedShields.push('round_shield_t1')
    profile.unlockedMounts.push('horse')
    profile.unlockedHeroes.push('viking-hero-t4')
    profile.claimedBattleIds.push('battle-a')
    profile.lifetimeStats = {
      battles: 7,
      victories: 5,
      deaths: 2,
      kills: 44,
      damage: 12345.5,
      structureDamage: 500,
      breaches: 1,
    }

    expect(store.save(profile)).toBe(true)
    expect(storage.getItem(CAREER_STORAGE_KEY)).not.toBeNull()

    const loaded = store.load()
    expect(loaded).toEqual(profile)
    expect(loaded?.faction).toBe('viking')
    expect(loaded?.rank).toBe('captain')
  })

  it('returns null for corrupt or unsupported saves instead of changing faction', () => {
    const storage = new MemoryStorage()
    const store = new CareerProfileStore(storage)

    storage.setItem(CAREER_STORAGE_KEY, '{broken json')
    expect(store.load()).toBeNull()

    storage.setItem(CAREER_STORAGE_KEY, JSON.stringify({
      version: 1,
      faction: 'gaul',
      merit: 9999,
    }))
    expect(store.load()).toBeNull()

    storage.setItem(CAREER_STORAGE_KEY, JSON.stringify({
      version: 2,
      faction: 'roman',
      merit: 9999,
    }))
    expect(store.load()).toBeNull()
  })

  it('sanitizes arrays and derives rank from merit instead of trusting saved rank', () => {
    const parsed = parseCareerProfile({
      version: 1,
      faction: 'roman',
      merit: 950,
      rank: 'commander',
      unlockedWeapons: ['gladius_rusty', 'gladius_rusty', 'missing-weapon'],
      unlockedShields: ['scutum_t1', 'missing-shield'],
      unlockedMounts: ['horse', 'dragon'],
      unlockedHeroes: ['roman-hero-t4', 'unknown-hero'],
      claimedBattleIds: ['battle-1', 'battle-1', '', 'battle-2'],
      lifetimeStats: {
        battles: 2.9,
        victories: -1,
        deaths: 1,
        kills: 4.8,
        damage: 123.5,
        structureDamage: -10,
        breaches: 1.9,
      },
    })

    expect(parsed).not.toBeNull()
    expect(parsed?.faction).toBe('roman')
    expect(parsed?.rank).toBe('veteran')
    expect(parsed?.unlockedWeapons).toEqual(['gladius_rusty'])
    expect(parsed?.unlockedShields).toEqual(['scutum_t1'])
    expect(parsed?.unlockedMounts).toEqual(['horse'])
    expect(parsed?.unlockedHeroes).toEqual(['roman-hero-t4'])
    expect(parsed?.claimedBattleIds).toEqual(['battle-1', 'battle-2'])
    expect(parsed?.lifetimeStats).toEqual({
      battles: 2,
      victories: 0,
      deaths: 1,
      kills: 4,
      damage: 123.5,
      structureDamage: 0,
      breaches: 1,
    })
  })
})
