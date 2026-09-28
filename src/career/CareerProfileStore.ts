import { PLAYER_MOUNT_IDS, type PlayerMountId } from '../battle/BattleConfig'
import { ARMORS } from '../rpg/ArmorDatabase'
import { WEAPONS } from '../rpg/WeaponDatabase'
import { isHeroAssetId, type HeroAssetId } from '../world/HeroAssetCatalog'
import {
  cloneCareerProfile,
  resolveCareerRank,
  type CareerLifetimeStats,
  type CareerProfile,
} from './CareerProfile'

export const CAREER_STORAGE_KEY = 'sagaburst_career_v1'

function nonNegativeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

function nonNegativeInteger(value: unknown): number {
  return Math.floor(nonNegativeNumber(value))
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((entry): entry is string => (
    typeof entry === 'string' && entry.trim().length > 0
  )).map(entry => entry.trim()))]
}

function parseLifetimeStats(value: unknown): CareerLifetimeStats {
  const input = value && typeof value === 'object'
    ? value as Partial<CareerLifetimeStats>
    : {}

  return {
    battles: nonNegativeInteger(input.battles),
    victories: nonNegativeInteger(input.victories),
    deaths: nonNegativeInteger(input.deaths),
    kills: nonNegativeInteger(input.kills),
    damage: nonNegativeNumber(input.damage),
    structureDamage: nonNegativeNumber(input.structureDamage),
    breaches: nonNegativeInteger(input.breaches),
  }
}

export function parseCareerProfile(value: unknown): CareerProfile | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>

  if (raw.version !== 1) return null
  if (raw.faction !== 'roman' && raw.faction !== 'viking') return null

  // Temporary compatibility with the pre-merge #140 field names.
  const totalMerit = nonNegativeInteger(raw.totalMerit ?? raw.merit)
  const availableMerit = Math.min(
    totalMerit,
    nonNegativeInteger(raw.availableMerit ?? totalMerit),
  )

  const ownedWeapons = uniqueStrings(raw.ownedWeapons ?? raw.unlockedWeapons)
    .filter(id => Boolean(WEAPONS[id]))
  const ownedArmors = uniqueStrings(raw.ownedArmors ?? raw.unlockedShields)
    .filter(id => Boolean(ARMORS[id]))
  const ownedMounts = uniqueStrings(raw.ownedMounts ?? raw.unlockedMounts)
    .filter((id): id is PlayerMountId => (
      (PLAYER_MOUNT_IDS as readonly string[]).includes(id)
    ))
  const ownedHeroes = uniqueStrings(raw.ownedHeroes ?? raw.unlockedHeroes)
    .filter((id): id is HeroAssetId => isHeroAssetId(id))

  return {
    version: 1,
    faction: raw.faction,
    totalMerit,
    availableMerit,
    rank: resolveCareerRank(totalMerit),
    ownedWeapons,
    ownedArmors,
    ownedMounts,
    ownedHeroes,
    lifetimeStats: parseLifetimeStats(raw.lifetimeStats),
    claimedBattleIds: uniqueStrings(raw.claimedBattleIds),
  }
}

export class CareerProfileStore {
  constructor(private readonly storage: Storage = localStorage) {}

  load(): CareerProfile | null {
    try {
      const raw = this.storage.getItem(CAREER_STORAGE_KEY)
      if (!raw) return null
      const parsed = parseCareerProfile(JSON.parse(raw))
      if (!parsed) {
        console.warn('[CareerProfileStore] Invalid career save — ignoring it.')
        return null
      }
      return parsed
    } catch {
      console.warn('[CareerProfileStore] Corrupt career save — ignoring it.')
      return null
    }
  }

  save(profile: CareerProfile): boolean {
    try {
      const parsed = parseCareerProfile(profile)
      if (!parsed) return false
      this.storage.setItem(
        CAREER_STORAGE_KEY,
        JSON.stringify(cloneCareerProfile(parsed)),
      )
      return true
    } catch {
      console.warn('[CareerProfileStore] Failed to save:', CAREER_STORAGE_KEY)
      return false
    }
  }

  hasProfile(): boolean {
    return this.storage.getItem(CAREER_STORAGE_KEY) !== null
  }
}
