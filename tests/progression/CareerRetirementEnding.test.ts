import { describe, expect, it } from 'vitest'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { retirementEndingView } from '../../src/town/TownRetirementUI'
import { emptyPersonalContribution } from '../../src/combat/CommandMerit'

describe('Retirement presentation data', () => {
  it('maps the six faction and visual variants without adding a persisted outcome', () => {
    const assets = [
      ['roman', 'escaped', 100, 'roman_escaped.webp', '帶旗離城'],
      ['roman', 'fallen', 0, 'roman_fallen.webp', '光榮退役'],
      ['roman', 'escaped', 0, 'roman_legacy.webp', '旗幟不倒'],
      ['viking', 'escaped', 100, 'viking_escaped.webp', '帶旗離城'],
      ['viking', 'fallen', 0, 'viking_fallen.webp', '光榮退役'],
      ['viking', 'escaped', 0, 'viking_legacy.webp', '旗幟不倒'],
    ] as const
    for (const [faction, outcome, hp, asset, title] of assets) {
      const profile = createCareerProfile(faction)
      profile.careerRetirement = { version: 1, phase: 'completed', acceptedAt: 1, combatElapsedSeconds: 61, outcome }
      profile.retirementRuntime = { player: { hp, stamina: 0, arrows: 0, shieldImpact: 0, mounted: false, position: { x: 0, y: 0, z: 0, yaw: 0 } } }
      const view = retirementEndingView(profile)!
      expect(view.title).toBe(title)
      expect(view.imageUrl).toContain(`/retirement/${asset}`)
      expect(profile.careerRetirement.outcome).toBe(outcome)
    }
  })

  it('shows unknown legacy counters as dashes and never infers death from missing runtime', () => {
    const profile = createCareerProfile('roman')
    profile.careerRetirement = { version: 1, phase: 'completed', acceptedAt: 1, combatElapsedSeconds: 0, outcome: 'escaped' }
    const view = retirementEndingView(profile)!
    expect(view.variant).toBe('escaped')
    expect(view.stats.map(([, value]) => value)).toEqual(['—', '—', '—', '—', '—', '—', '—', '0:00'])
  })

  it('preserves real zero counters and the saved final-stand clock', () => {
    const profile = createCareerProfile('viking')
    profile.careerRetirement = { version: 1, phase: 'completed', acceptedAt: 1, combatElapsedSeconds: 65.9, outcome: 'escaped' }
    profile.careerMissionCompletionsByTier = { 5: 10 }
    profile.retirementRuntime = {
      player: { hp: 0, stamina: 0, arrows: 0, shieldImpact: 0, mounted: false, position: { x: 0, y: 0, z: 0, yaw: 0 } },
      stats: { player: { ...emptyPersonalContribution(), damageTaken: 0 }, personal: { ...emptyPersonalContribution(), damageTaken: 42.6, kills: 2 } },
    }
    expect(retirementEndingView(profile)?.stats.map(([, value]) => value)).toEqual(['10', '0', '2', '0', '0', '0', '43', '1:05'])
  })
})
