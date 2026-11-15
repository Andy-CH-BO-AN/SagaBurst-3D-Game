/**
 * SaveManager.ts
 * Handles serialising / deserialising game state to localStorage.
 * Phase 7 & 8 addition: inventory items & equipped weapons persistence.
 */

import { COMBAT_BALANCE } from '../combat/CombatBalance'
import { parseFallingRiderSnapshot, type FallingRiderSnapshot } from '../movement/FallingRider'
import { parseEagleFlightSnapshot, type EagleFlightSnapshot } from '../movement/EagleFlightController'

export const SAVE_KEY = 'sagaburst_game_v2'

/** Current saves record their measured HP pool. */
export function restoreSavedPlayerHp(data: Pick<PlayerSaveData, 'hp' | 'maxHp'>, newMaxHp: number): number {
  return Number.isFinite(newMaxHp) && newMaxHp > 0 ? Math.min(newMaxHp, Math.max(0, data.hp / data.maxHp * newMaxHp)) : 0
}

export interface SkillDetail {
  level: number
  xp: number
}

export interface PlayerSaveData {
  version: 2
  /** Captured identity is independent of currently equipped weapons. */
  maxHp: number
  characterTier?: 1 | 2 | 3
  characterFaction?: 'roman' | 'viking'
  /** Present only for an explicitly selected custom HP override. */
  baseMaxHpOverride?: number
  falling?: FallingRiderSnapshot
  position: { x: number; y: number; z: number }
  hp: number
  stamina: number
  arrows: number
  skills: {
    unarmed: SkillDetail
    oneHanded: SkillDetail
    twoHanded: SkillDetail
    ranged: SkillDetail
    mountedImpact: SkillDetail
    blocking: SkillDetail
  }
  inventory: {
    items: { id: string; quantity: number }[]
    equippedMeleeId: string
    equippedRangedId: string
    rangedEnabled?: boolean
    equippedShieldId?: string | null
  }
  mountData?: {
    isMounted: boolean
    type: string
    appearanceVariant?: 0 | 1 | 2
    hp: number
    armorImpactRemaining?: number
    flight?: EagleFlightSnapshot
    position: { x: number; y: number; z: number }
  }
}

export const DEFAULT_SAVE: PlayerSaveData = {
  version: 2,
  maxHp: COMBAT_BALANCE.hp.playerDefault,
  position: { x: 0, y: 0.95, z: 0 },
  hp: COMBAT_BALANCE.hp.playerDefault,
  stamina: 100,
  arrows: 30,
  skills: {
    unarmed: { level: 1, xp: 0 },
    oneHanded: { level: 1, xp: 0 },
    twoHanded: { level: 1, xp: 0 },
    ranged: { level: 1, xp: 0 },
    mountedImpact: { level: 1, xp: 0 },
    blocking: { level: 1, xp: 0 },
  },
  inventory: {
    items: [
      { id: 'steel_lance', quantity: 1 },
      { id: 'runic_greatsword', quantity: 1 },
      { id: 'elven_runebow', quantity: 1 },
      { id: 'round_shield_t3', quantity: 1 },
    ],
    equippedMeleeId: 'steel_lance',
    equippedRangedId: 'elven_runebow',
    equippedShieldId: 'round_shield_t3',
  },
}

export class SaveManager {
  constructor(private readonly storage: Storage = localStorage) {}

  save(data: PlayerSaveData): boolean {
    try {
      const existing = this.storage.getItem(SAVE_KEY)
      if (existing !== null && !parsePlayerSave(JSON.parse(existing))) return false
      const parsed = parsePlayerSave(data)
      if (!parsed) return false
      this.storage.setItem(SAVE_KEY, JSON.stringify(parsed))
      return true
    } catch {
      console.warn('[SaveManager] Failed to save:', SAVE_KEY)
      return false
    }
  }

  load(): PlayerSaveData | null {
    try {
      const raw = this.storage.getItem(SAVE_KEY)
      return raw === null ? null : parsePlayerSave(JSON.parse(raw))
    } catch {
      console.warn('[SaveManager] 無法讀取存檔；原資料已保留。')
      return null
    }
  }

  hasSave(): boolean {
    return this.storage.getItem(SAVE_KEY) !== null
  }
}

/** Reject unsupported or damaged records without converting them or writing storage. */
export function parsePlayerSave(value: unknown): PlayerSaveData | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as PlayerSaveData
  const resource = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0
  const position = (p: PlayerSaveData['position'] | undefined) => p && [p.x, p.y, p.z].every(Number.isFinite)
  if (raw.version !== 2 || !position(raw.position) || !resource(raw.hp) || !resource(raw.maxHp) || raw.maxHp <= 0
    || !resource(raw.stamina) || !resource(raw.arrows) || !raw.skills || !raw.inventory
    || !['unarmed', 'oneHanded', 'twoHanded', 'ranged', 'mountedImpact', 'blocking'].every(id => {
      const skill = raw.skills[id as keyof PlayerSaveData['skills']]
      return skill && Number.isInteger(skill.level) && skill.level >= 1 && skill.level <= 50 && resource(skill.xp)
    }) || !Array.isArray(raw.inventory.items)
    || raw.inventory.items.some(item => !item || typeof item.id !== 'string' || !Number.isSafeInteger(item.quantity) || item.quantity <= 0)
    || typeof raw.inventory.equippedMeleeId !== 'string' || typeof raw.inventory.equippedRangedId !== 'string') return null
  if (raw.mountData && (!position(raw.mountData.position) || typeof raw.mountData.isMounted !== 'boolean'
    || !['HORSE', 'ARMORED_HORSE', 'BLACK_CAT', 'WHITE_CAT', 'ORANGE_CAT', 'SERVAL', 'CARACAL', 'CORGI', 'SNOW_LEOPARD', 'xongkoro'].includes(raw.mountData.type)
    || !resource(raw.mountData.hp))) return null
  if (raw.falling !== undefined && !parseFallingRiderSnapshot(raw.falling)
    || raw.mountData?.flight !== undefined && !parseEagleFlightSnapshot(raw.mountData.flight)) return null
  return JSON.parse(JSON.stringify(raw)) as PlayerSaveData
}
