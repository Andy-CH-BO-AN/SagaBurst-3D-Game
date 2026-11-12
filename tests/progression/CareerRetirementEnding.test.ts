import { describe, expect, it } from 'vitest'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { retirementEndingView } from '../../src/town/TownRetirementUI'
import { emptyPersonalContribution } from '../../src/combat/CommandMerit'

describe('Retirement presentation data', () => {
  it('preserves real zero counters and saved final-stand clock while showing unknown legacy counters without mutating outcome', () => {
    const legacyProfile = createCareerProfile('roman')
    legacyProfile.careerRetirement = { version: 1, phase: 'completed', acceptedAt: 1, combatElapsedSeconds: 0, outcome: 'escaped' }
    const legacyView = retirementEndingView(legacyProfile)!
    expect(legacyView.variant).toBe('escaped')
    expect(legacyProfile.careerRetirement.outcome).toBe('escaped')
    expect(legacyView.stats.map(([, value]) => value)).toEqual(['—', '—', '—', '—', '—', '—', '—', '0:00'])

    const profile = createCareerProfile('viking')
    profile.careerRetirement = { version: 1, phase: 'completed', acceptedAt: 1, combatElapsedSeconds: 65.9, outcome: 'escaped' }
    profile.careerMissionCompletionsByTier = { 5: 10 }
    profile.retirementRuntime = {
      player: { hp: 0, stamina: 0, arrows: 0, shieldImpact: 0, mounted: false, position: { x: 0, y: 0, z: 0, yaw: 0 } },
      stats: { player: { ...emptyPersonalContribution(), damageTaken: 0 }, personal: { ...emptyPersonalContribution(), damageTaken: 42.6, kills: 2 } },
    }
    const view = retirementEndingView(profile)!
    expect(view.variant).toBe('legacy')
    expect(profile.careerRetirement.outcome).toBe('escaped')
    expect(view.stats.map(([, value]) => value)).toEqual(['10', '0', '2', '0', '0', '0', '43', '1:05'])
  })
})
