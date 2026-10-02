import { describe, expect, it } from 'vitest'
import { getDefenseCampaignDefeatMessage, getDefenseCampaignHeading, getDefenseCampaignPhaseLabel } from './DefenseCampaignHUD'

describe('DefenseCampaignHUD career outpost wording', () => {
  it('labels defender assault phases as defense and attacker phases as siege assault', () => {
    const assault = { phase: 'assault' as const, activePhase: 'assault' as const }

    expect(getDefenseCampaignPhaseLabel(assault)).toBe('防禦戰 · DEFENSE')
    expect(getDefenseCampaignPhaseLabel(assault, { playerIsAttacker: false })).toBe('防禦戰 · DEFENSE')
    expect(getDefenseCampaignPhaseLabel(assault, { playerIsAttacker: true })).toBe('攻城戰 · ASSAULT')
  })

  it('keeps the Outpost Relief label and marks the locked phase using the player role', () => {
    const reliefAssault = { phase: 'assault' as const, activePhase: 'assault' as const }
    const lockedAssault = { phase: 'defeat' as const, activePhase: 'assault' as const }

    expect(getDefenseCampaignPhaseLabel(reliefAssault, { relief: true })).toBe('騎兵救援 · 殲滅剩餘敵軍')
    expect(getDefenseCampaignPhaseLabel(lockedAssault, { playerIsAttacker: true })).toBe('DEFEAT LOCKED · ASSAULT')
    expect(getDefenseCampaignPhaseLabel(lockedAssault, { playerIsAttacker: false })).toBe('DEFEAT LOCKED · DEFENSE')
  })

  it('uses attacker wording for Veteran outpost assault defeat results', () => {
    expect(getDefenseCampaignDefeatMessage({ veteranMission: true, playerIsAttacker: true }, false))
      .toBe('我軍已全滅，攻勢失敗。')
    expect(getDefenseCampaignDefeatMessage({ veteranMission: true }, false))
      .toBe('守方已全數陣亡，戰役結束。')
  })

  it('omits the Campaign stage prefix from Veteran chapter mission titles', () => {
    expect(getDefenseCampaignHeading(4, { veteranMission: true, missionTitle: 'Outpost Assault · 強攻前哨' }))
      .toBe('Outpost Assault · 強攻前哨')
    expect(getDefenseCampaignHeading(2, { relief: true })).toBe('Outpost Relief · 騎兵救援')
    expect(getDefenseCampaignHeading(4)).toBe('STAGE 4')
  })
})
