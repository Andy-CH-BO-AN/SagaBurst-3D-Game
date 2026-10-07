import { describe, expect, it } from 'vitest'
import { getArmyCommandShortcut, getArmyCommandShortcuts, getCommandFromSubmenuKey } from '../../src/battle/ArmyCommandController'

describe('Army command shortcut mapping', () => {
  it('maps command keys to Attack, Charge, Defend, and Formation', () => {
    expect(getCommandFromSubmenuKey('1')).toBe('attack')
    expect(getCommandFromSubmenuKey('2')).toBe('charge')
    expect(getCommandFromSubmenuKey('3')).toBe('defend')
    expect(getCommandFromSubmenuKey('4')).toBe('formation')
    expect(getCommandFromSubmenuKey('5')).toBeNull()
  })

  it('maps Viking and Roman shortcuts to preset ids and ALL', () => {
    expect(getArmyCommandShortcuts('viking').map(entry => entry.target)).toEqual([
      'viking_berserker', 'viking_spearman', 'viking_archer',
      'viking_sword_cavalry', 'viking_lancer', 'viking_horse_archer', 'all',
    ])
    expect(getArmyCommandShortcuts('roman').map(entry => entry.target)).toEqual([
      'roman_heavy_infantry', 'roman_spearman', 'roman_archer', 'roman_javelin_infantry',
      'roman_sword_cavalry', 'roman_lancer', 'roman_horse_archer', 'all',
    ])
    expect(getArmyCommandShortcut('viking', '`')).toBe('all')
    expect(getArmyCommandShortcut('roman', '`')).toBe('all')
    expect(getArmyCommandShortcut('viking', '7')).toBeNull()
    expect(getArmyCommandShortcut('roman', '8')).toBeNull()
  })
})
