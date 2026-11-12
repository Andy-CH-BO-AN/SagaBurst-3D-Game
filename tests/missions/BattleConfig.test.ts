import { needsPlayerHpConfirmation, resolveOrdinaryPlayerBaseHp } from '../../src/combat/OrdinarySoldierProfile'
import { describe, expect, it } from 'vitest'
import { PRESET_10V10, PRESET_25V25, PRESET_50V50, PRESET_100V100, PRESET_200V200, getDefaultBattleConfig, createEmptyArmyConfig, validateBattleConfig, validateBattleSquadAssignments, type BattleConfig } from '../../src/battle/BattleConfig'
function config(count: number): BattleConfig {
  return { playerFaction: 'viking',
    viking: { ...createEmptyArmyConfig(), infantry: { 1: count, 2: 0, 3: 0 } },
    roman: { ...createEmptyArmyConfig(), infantry: { 1: 1, 2: 0, 3: 0 } },
    rules: { respawnEnabled: false, includeCamps: false } }
}
describe('Custom battle input boundaries', () => {
  it('rejects a command squad over its capacity before deployment', () => {
    const current = config(51)
    current.squadAssignments = [{ presetId: 'viking_berserker', tier: 1, squadId: 1, count: 51 }]
    const result = validateBattleConfig(current)
    expect(result.valid).toBe(false)
    expect(result.errors.some(error => error.includes('Squad 1 exceeds 50 units'))).toBe(true)
  })
  it('rejects an incomplete player squad allocation', () => {
    const current = config(4)
    current.commandGrouping = 'squad'
    current.squadAssignments = [{ presetId: 'viking_berserker', tier: 1, squadId: 1, count: 3 }]
    expect(validateBattleSquadAssignments(current).valid).toBe(false)
  })
})

it('keeps automatic health tied to character identity and requires a choice for ambiguous legacy setup', () => {
  const defaults = getDefaultBattleConfig()
  expect(needsPlayerHpConfirmation(defaults)).toBe(false)
  expect(resolveOrdinaryPlayerBaseHp('viking', 2, defaults)).toBe(135)
  for (const preset of [PRESET_10V10, PRESET_25V25, PRESET_50V50, PRESET_100V100, PRESET_200V200]) {
    expect(needsPlayerHpConfirmation(preset)).toBe(false)
  }
  const legacy = { ...defaults, playerHpSource: undefined, playerHp: 200 }
  expect(needsPlayerHpConfirmation(legacy)).toBe(true)
  const confirmed = { ...legacy, playerHpSource: 'custom' as const }
  expect(needsPlayerHpConfirmation(confirmed)).toBe(false)
  expect(resolveOrdinaryPlayerBaseHp('viking', 2, confirmed)).toBe(200)
  expect(validateBattleConfig({ ...confirmed, playerHpSource: 'unknown' }).valid).toBe(false)
})
