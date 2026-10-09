import { describe, expect, it } from 'vitest'
import { armyCommandTargetLabel } from '../../src/ui/ArmyCommandUI'

describe('Army command target labels', () => {
  it('labels the submenu with the selected unit group', () => {
    expect(armyCommandTargetLabel('viking_spearman')).toBe('槍兵')
    expect(armyCommandTargetLabel('viking_archer')).toBe('弓兵')
    expect(armyCommandTargetLabel('viking_berserker')).toBe('維京資深戰士')
    expect(armyCommandTargetLabel('all')).toBe('全軍命令')
  })

  it('names the current official authority while retaining independent private and All targets', () => {
    expect(armyCommandTargetLabel('squad:1', 'Town Command Squad · 城防指揮隊')).toBe('Town Command Squad · 城防指揮隊')
    expect(armyCommandTargetLabel('squad:1', 'Mission Squad · 任務部隊')).toBe('Mission Squad · 任務部隊')
    expect(armyCommandTargetLabel('squad:personal', 'Mission Squad')).toBe('Personal Squad · 私人小隊')
    expect(armyCommandTargetLabel('all', 'Mission Squad')).toBe('全軍命令')
  })

  it('labels squad command targets without requiring a unit preset', () => {
    expect(armyCommandTargetLabel('squad:3')).toBe('第 3 隊')
  })
})
