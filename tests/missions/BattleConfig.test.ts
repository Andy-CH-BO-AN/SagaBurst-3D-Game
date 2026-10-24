import { describe, expect, it } from 'vitest'
import { createEmptyArmyConfig, validateBattleConfig, validateBattleSquadAssignments, type BattleConfig } from '../../src/battle/BattleConfig'
function config(count: number): BattleConfig {
  return { playerFaction: 'viking',
    viking: { ...createEmptyArmyConfig(), infantry: { 1: count, 2: 0, 3: 0 } },
    roman: { ...createEmptyArmyConfig(), infantry: { 1: 1, 2: 0, 3: 0 } },
    rules: { respawnEnabled: false, includeCamps: false } }
}
describe('Custom battle input boundaries', () => {
  it('accepts the maximum army and rejects one soldier above it', () => {
    const current = config(200)
    current.playerLoadout = { meleeWeaponId: 'sword_t5', rangedWeaponId: 'bow_t5', shieldId: 'commander_shield_t5', startMounted: false }
    expect(validateBattleConfig(current)).toEqual({ valid: true, errors: [] })
    expect(validateBattleConfig({ ...current, viking: config(201).viking }).valid).toBe(false)
  })
  it('rejects a command squad over its capacity before deployment', () => {
    const current = config(31)
    current.squadAssignments = [{ presetId: 'viking_berserker', tier: 1, squadId: 1, count: 31 }]
    const result = validateBattleConfig(current)
    expect(result.valid).toBe(false)
    expect(result.errors.some(error => error.includes('Squad 1 exceeds 30 units'))).toBe(true)
  })
  it('rejects an incomplete player squad allocation', () => {
    const current = config(4)
    current.commandGrouping = 'squad'
    current.squadAssignments = [{ presetId: 'viking_berserker', tier: 1, squadId: 1, count: 3 }]
    expect(validateBattleSquadAssignments(current).valid).toBe(false)
  })
})
