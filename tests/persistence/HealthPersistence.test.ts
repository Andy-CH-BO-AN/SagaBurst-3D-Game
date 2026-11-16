import { describe, expect, it } from 'vitest'
import { DEFAULT_SAVE, parsePlayerSave, restoreSavedPlayerHp, SAVE_KEY, SaveManager } from '../../src/save/SaveManager'
import { MemoryStorage } from '../helpers/memoryStorage'


describe('Health persistence', () => {

  it('restores current identity and measured HP ratio without reviving a dead player', () => {
    const storage = new MemoryStorage(), store = new SaveManager(storage)
    const saved = { ...DEFAULT_SAVE, hp: 60, maxHp: 240,
      characterTier: 1 as const, characterFaction: 'roman' as const, baseMaxHpOverride: 220 }
    expect(store.save(saved)).toBe(true)
    const loaded = store.load()!
    expect(loaded).toMatchObject({ maxHp: 240, characterTier: 1, characterFaction: 'roman', baseMaxHpOverride: 220 })
    expect(restoreSavedPlayerHp(loaded, 120)).toBe(30)
    expect(restoreSavedPlayerHp({ hp: 0, maxHp: 240 }, 120)).toBe(0)
    const restored = { ...loaded, hp: restoreSavedPlayerHp(loaded, 120), maxHp: 120 }
    expect(restoreSavedPlayerHp(restored, 120)).toBe(30)
  })

  it('rejects invalid optional HP and character identity without replacing current save bytes', () => {
    const storage = new MemoryStorage(), store = new SaveManager(storage)
    const invalidFields: Record<string, unknown>[] = [
      ...['invalid', NaN, Infinity, null, 0, -1, 1.5, 10000].map(baseMaxHpOverride => ({ baseMaxHpOverride })),
      { characterFaction: 'unknown' }, { characterFaction: null },
      { characterTier: '1' }, { characterTier: 0 }, { characterTier: 4 }, { characterTier: 1.5 },
    ]
    for (const fields of invalidFields) {
      const malformed = { ...DEFAULT_SAVE, ...fields }
      expect(parsePlayerSave(malformed), JSON.stringify(fields)).toBeNull()
      const bytes = JSON.stringify(malformed)
      storage.setItem(SAVE_KEY, bytes)
      expect(store.load()).toBeNull()
      expect(store.save(DEFAULT_SAVE)).toBe(false)
      expect(storage.getItem(SAVE_KEY)).toBe(bytes)
    }
    storage.removeItem(SAVE_KEY)
    expect(store.save(DEFAULT_SAVE)).toBe(true)
    expect(store.load()).toEqual(DEFAULT_SAVE)
  })
})
