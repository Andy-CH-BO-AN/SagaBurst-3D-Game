/**
 * SaveManager.ts
 * Handles serialising / deserialising game state to localStorage.
 * Phase 7 & 8 addition: inventory items & equipped weapons persistence.
 */

const SAVE_KEY = 'wdyh_save_v1'

export interface SkillDetail {
  level: number
  xp: number
}

export interface PlayerSaveData {
  position: { x: number; y: number; z: number }
  hp: number
  stamina: number
  arrows: number
  skills: {
    oneHanded: SkillDetail
    archery: SkillDetail
  }
  inventory: {
    items?: { id: string; quantity: number }[]
    ownedWeaponIds?: string[]
    equippedMeleeId: string
    equippedRangedId: string
  }
  mountData?: {
    isMounted: boolean
    type: string
  }
}

export const DEFAULT_SAVE: PlayerSaveData = {
  position: { x: 0, y: 0.95, z: 0 },
  hp: 100,
  stamina: 100,
  arrows: 30,
  skills: {
    oneHanded: { level: 1, xp: 0 },
    archery: { level: 1, xp: 0 },
  },
  inventory: {
    ownedWeaponIds: ['steel_sword', 'recurve_longbow'],
    equippedMeleeId: 'steel_sword',
    equippedRangedId: 'recurve_longbow',
  },
}

export class SaveManager {
  save(data: PlayerSaveData): boolean {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(data))
      return true
    } catch {
      console.warn('[SaveManager] Failed to save:', SAVE_KEY)
      return false
    }
  }

  load(): PlayerSaveData {
    try {
      const raw = localStorage.getItem(SAVE_KEY)
      if (!raw) return { ...DEFAULT_SAVE }
      const parsed = JSON.parse(raw) as Partial<PlayerSaveData>
      return {
        ...DEFAULT_SAVE,
        ...parsed,
        position: { ...DEFAULT_SAVE.position, ...parsed.position },
        skills: {
          oneHanded: { ...DEFAULT_SAVE.skills.oneHanded, ...parsed.skills?.oneHanded },
          archery: { ...DEFAULT_SAVE.skills.archery, ...parsed.skills?.archery },
        },
        inventory: {
          ownedWeaponIds: parsed.inventory?.ownedWeaponIds ?? DEFAULT_SAVE.inventory.ownedWeaponIds,
          equippedMeleeId: parsed.inventory?.equippedMeleeId ?? DEFAULT_SAVE.inventory.equippedMeleeId,
          equippedRangedId: parsed.inventory?.equippedRangedId ?? DEFAULT_SAVE.inventory.equippedRangedId,
        },
      }
    } catch {
      console.warn('[SaveManager] Corrupt save data — using defaults.')
      return { ...DEFAULT_SAVE }
    }
  }

  hasSave(): boolean {
    return localStorage.getItem(SAVE_KEY) !== null
  }
}
