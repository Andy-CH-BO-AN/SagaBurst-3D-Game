import { describe, expect, it } from 'vitest'
import { DEFAULT_SAVE, restoreSavedPlayerHp, SaveManager } from '../../src/save/SaveManager'
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
})
