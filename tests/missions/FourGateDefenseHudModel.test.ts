import { describe, expect, it } from 'vitest'
import { buildFourGateHudView, fourGateHudGateStatus, fourGateHudRampStatus, type FourGateHudSource } from '../../src/career/FourGateDefenseHudModel'

const gate = (id: 'north' | 'east' | 'south' | 'west', over: Partial<FourGateHudSource['gates'][number]> = {}): FourGateHudSource['gates'][number] =>
  ({ id, defendersAlive: 40, defendersTotal: 46, gateState: 'closed', gateHpRatio: 1, ramps: [undefined, undefined], ...over })
const source = (over: Partial<FourGateHudSource> = {}): FourGateHudSource => ({
  phase: 'ATTACKING', preparationRemaining: 0, survivalRemaining: 61, spectating: false, friendlyAlive: 300, enemyAlive: 100,
  // Deliberately out of display order: the HUD must not follow input order.
  gates: [gate('west'), gate('south'), gate('north'), gate('east')], ...over,
})

describe('four-gate defense HUD view', () => {
  it('separates a normally opened gate from a breached one and grades durability without exposing numbers', () => {
    expect(fourGateHudGateStatus('open', 0.9)).toBe('open')
    expect(fourGateHudGateStatus('destroyed', 0)).toBe('breached')
    expect(fourGateHudGateStatus('closed', 1)).toBe('intact')
    expect(fourGateHudGateStatus('closed', 0.5)).toBe('damaged')
    expect(fourGateHudGateStatus('closed', 0.25)).toBe('damaged')
    expect(fourGateHudGateStatus('closed', 0.2499)).toBe('critical')
  })

  it('maps real siege ramp states; a ramp that has not arrived stays absent instead of destroyed', () => {
    expect([undefined, 'DEPLOYING', 'PUSHING', 'DOCKING', 'DOCKED', 'ABANDONED', 'DESTROYED'].map(s => fourGateHudRampStatus(s as never)))
      .toEqual(['absent', 'staged', 'staged', 'staged', 'docked', 'abandoned', 'destroyed'])
  })

  it('keeps fixed gate order, counts unspawned enemies as alive, and shows the surviving-time clock per phase', () => {
    const view = buildFourGateHudView(source())
    expect(view.gates.map(g => g.id)).toEqual(['north', 'east', 'south', 'west'])
    expect(view.gates[0]).toMatchObject({ count: '40/46', percent: 87 })
    expect(view).toMatchObject({ clock: '01:01', label: '距守城勝利', friendly: 300, enemy: 100, friendlyPercent: 75 })
    expect(buildFourGateHudView(source({ phase: 'PREPARING', preparationRemaining: 150.2 }))).toMatchObject({ clock: '02:31', label: '備戰', hint: 'H 跳過準備' })
    expect(buildFourGateHudView(source({ phase: 'SPAWNING', enemyAlive: 440 }))).toMatchObject({ label: '敵軍抵達中', enemy: 440 })
    expect(buildFourGateHudView(source({ phase: 'DEPLOYING' })).label).toBe('部署中')
    expect(buildFourGateHudView(source({ spectating: true })).label).toContain('觀戰中')
  })
})
