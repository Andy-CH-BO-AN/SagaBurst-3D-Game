import { expect, it } from 'vitest'
import { careerMissionCompletionsForTier } from '../../src/career/CareerProfile'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import { commanderRetirementEligibility } from '../../src/career/CareerRetirement'
import { createCommanderRetirementQaProfile } from '../../src/career/CareerRetirementQaProfile'
import { MemoryStorage } from '../helpers/memoryStorage'

it('builds a legal ready Commander preset whose exact ten Tier 5 wins and spendable merit survive save normalization', () => {
  const preset = createCommanderRetirementQaProfile('viking')
  const store = new CareerProfileStore(new MemoryStorage())
  expect(store.save(preset)).toBe(true)
  const profile = store.loadChecked().profile!
  expect(profile.rank).toBe('commander')
  expect(profile.faction).toBe('viking')
  expect(profile.availableMerit).toBe(100_000)
  expect(profile.totalMerit).toBeGreaterThanOrEqual(100_000)
  expect(profile.enlistmentMeritBase).toBe(0)
  expect(careerMissionCompletionsForTier(profile, 5)).toBe(10)
  expect(profile.completedCareerMissionTemplateIds).toEqual([
    'commander-sky-raid', 'commander-operation-decapitation', 'commander-outpost-last-stand',
    'commander-bridgehead-battle', 'commander-four-gate-defense',
  ])
  expect(commanderRetirementEligibility(profile).eligible).toBe(true)
  expect(profile.personalSquad?.members).toEqual([])
  expect(profile.careerRetirement).toBeUndefined()
  expect(profile.activeMission).toBeUndefined()
  expect(profile.activeOutpostMission).toBeUndefined()
  expect(profile.activeRace).toBeUndefined()
  expect(profile.townEvent).toBeUndefined()
})
