import { describe, expect, it } from 'vitest'
import {
  getDefaultBattleConfig,
  PLAYER_MELEE_SELECTION_IDS,
  validateBattleConfig,
} from '../src/battle/BattleConfig'

describe('Viking axe player loadout options', () => {
  it('offers three axe tiers in setup while retaining old sword IDs for saved configs', () => {
    expect(PLAYER_MELEE_SELECTION_IDS.slice(0, 3)).toEqual([
      'viking_axe_t1', 'viking_axe_t2', 'viking_axe_t3',
    ])
    expect(PLAYER_MELEE_SELECTION_IDS).not.toContain('rusty_dagger')
    expect(PLAYER_MELEE_SELECTION_IDS).not.toContain('steel_sword')
    expect(PLAYER_MELEE_SELECTION_IDS).not.toContain('runic_greatsword')

    const saved = getDefaultBattleConfig()
    saved.playerLoadout!.meleeWeaponId = 'steel_sword'
    expect(validateBattleConfig(saved).valid).toBe(true)
  })

  it('accepts each selectable Viking axe in a new custom battle loadout', () => {
    for (const meleeWeaponId of PLAYER_MELEE_SELECTION_IDS.slice(0, 3)) {
      const config = getDefaultBattleConfig()
      config.playerLoadout!.meleeWeaponId = meleeWeaponId
      expect(validateBattleConfig(config).valid).toBe(true)
    }
  })
})
