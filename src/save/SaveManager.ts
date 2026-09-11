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
    equippedShieldId?: string | null
  }
  mountData?: {
    isMounted: boolean
    type: string
    appearanceVariant?: 0 | 1 | 2
    position?: { x: number; y: number; z: number }
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
    items: [
      { id: 'steel_lance', quantity: 1 },
      { id: 'runic_greatsword', quantity: 1 },
      { id: 'elven_runebow', quantity: 1 },
      { id: 'round_shield_t3', quantity: 1 },
    ],
    ownedWeaponIds: ['steel_lance', 'runic_greatsword', 'elven_runebow', 'round_shield_t3'],
    equippedMeleeId: 'steel_lance',
    equippedRangedId: 'elven_runebow',
    equippedShieldId: 'round_shield_t3',
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

      let inventoryData: PlayerSaveData['inventory']
      if (parsed.inventory) {
        let items = parsed.inventory.items
        if (!items && parsed.inventory.ownedWeaponIds) {
          items = parsed.inventory.ownedWeaponIds.map(id => ({ id, quantity: 1 }))
        }
        inventoryData = {
          items: items ? items.map(item => ({ ...item })) : undefined,
          ownedWeaponIds: parsed.inventory.ownedWeaponIds,
          equippedMeleeId: parsed.inventory.equippedMeleeId ?? DEFAULT_SAVE.inventory.equippedMeleeId,
          equippedRangedId: parsed.inventory.equippedRangedId ?? DEFAULT_SAVE.inventory.equippedRangedId,
          equippedShieldId: parsed.inventory.equippedShieldId !== undefined ? parsed.inventory.equippedShieldId : null,
        }
      } else {
        inventoryData = {
          ...DEFAULT_SAVE.inventory,
          items: DEFAULT_SAVE.inventory.items?.map(item => ({ ...item })),
        }
      }

      const mountData = parsed.mountData ? {
        ...parsed.mountData,
        position: parsed.mountData.position ? { ...parsed.mountData.position } : undefined,
      } : undefined

      return {
        ...DEFAULT_SAVE,
        ...parsed,
        position: { ...DEFAULT_SAVE.position, ...parsed.position },
        skills: {
          oneHanded: { ...DEFAULT_SAVE.skills.oneHanded, ...parsed.skills?.oneHanded },
          archery: { ...DEFAULT_SAVE.skills.archery, ...parsed.skills?.archery },
        },
        inventory: inventoryData,
        mountData,
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
