import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Game } from '../../src/Game'
import { InventoryManager } from '../../src/rpg/InventoryManager'
import { isEquipmentDemanded, resetHighTierEquipmentForTest } from '../../src/world/HighTierEquipment'

const LANCE = 'byzantine_standard_lance_t5'
function inventory(meleeWeaponId = LANCE): InventoryManager {
  return new InventoryManager({ meleeWeaponId, rangedWeaponId: 'elven_runebow', shieldId: null })
}

beforeEach(() => {
  vi.useFakeTimers()
  resetHighTierEquipmentForTest()
  vi.stubGlobal('fetch', () => new Promise(() => {}))
})
afterEach(() => {
  resetHighTierEquipmentForTest()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('Game inventory lifecycle callers', () => {
  it('replaces inventory through the real Game owner and releases only the outgoing demand', () => {
    interface InventoryReplacement { inventoryManager: InventoryManager; _setInventoryManager(next: InventoryManager): void }
    const game = Object.assign(Object.create(Game.prototype) as InventoryReplacement, { inventoryManager: inventory() })
    const otherOwner = inventory()
    const replacement = inventory('steel_lance')
    try {
      game._setInventoryManager(replacement)
      expect(game.inventoryManager).toBe(replacement)
      expect(isEquipmentDemanded(LANCE)).toBe(true)
      otherOwner.dispose()
      expect(isEquipmentDemanded(LANCE)).toBe(false)
    } finally { game.inventoryManager.dispose(); otherOwner.dispose() }
  })

  it('releases active inventory demand during the real training exit before leaving the document', () => {
    const events: string[] = []
    const active = inventory(), release = vi.spyOn(active, 'dispose')
      .mockImplementation(() => { InventoryManager.prototype.dispose.call(active); events.push('release') })
    const location = { pathname: '/game/', search: '?nolock', set href(value: string) {
      events.push(value); expect(isEquipmentDemanded(LANCE)).toBe(false)
    } }
    vi.stubGlobal('window', { location })
    vi.stubGlobal('document', { pointerLockElement: null })
    const dispose = () => ({ dispose: vi.fn() })
    // Only exit dependencies: no Game, scene, actor or renderer is constructed.
    const game = Object.assign(Object.create(Game.prototype) as { _exitTraining(): void }, {
      trainingGround: dispose(), trainingUI: dispose(), sceneListeners: { abort: vi.fn() }, input: dispose(),
      equipmentUI: { close: vi.fn() }, _disposeCareerOutpostBattleActors: vi.fn(), player: dispose(),
      inventoryManager: active, arrows: [], _aimTargetRegistry: { clear: vi.fn() },
      damageNumbers: { clear: vi.fn() }, weaponWheelUI: dispose(), soundManager: { updateHorseGallopLoops: vi.fn() },
      hintTimer: null, notifyTimer: null, enemyHudTimer: null, deathBannerTimer: null,
      scene: { clear: vi.fn() }, renderer: { dispose: vi.fn(), forceContextLoss: vi.fn() },
    })
    try {
      game._exitTraining()
      expect(release).toHaveBeenCalledTimes(1)
      expect(events).toEqual(['release', '/game/?menu=1&nolock'])
      expect(isEquipmentDemanded(LANCE)).toBe(false)
    } finally { release.mockRestore(); active.dispose() }
  })
})
