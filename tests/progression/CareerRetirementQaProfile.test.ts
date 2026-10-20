import { expect, it } from 'vitest'
import { careerItemAllocated, careerItemTotal } from '../../src/career/CareerInventory'
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
  expect(profile.personalSquad?.members).toHaveLength(30)
  expect(new Set(profile.personalSquad!.members.map(member => member.id)).size).toBe(30)
  for (const [index, member] of profile.personalSquad!.members.entries()) {
    expect(member.type).toBe('commander')
    expect(member.equipment).toEqual({
      melee: index < 15 ? 'axe_t5' : 'spear_t5', ranged: index < 15 ? 'bow_t5' : null,
      shield: 'paladin_shield_t4', mount: 'black-cat',
    })
  }
  for (const [id, quantity] of Object.entries({
    axe_t5: 16, spear_t5: 15, bow_t5: 15, paladin_shield_t4: 30, 'black-cat': 30,
  })) {
    expect(careerItemTotal(profile, id)).toBe(quantity)
    expect(careerItemAllocated(profile, id)).toBe(quantity)
  }
  expect(profile.skills).toEqual({
    blocking: { level: 50, xp: 0 }, oneHanded: { level: 50, xp: 0 },
    twoHanded: { level: 50, xp: 0 }, ranged: { level: 50, xp: 0 },
    mountedImpact: { level: 50, xp: 0 },
  })
  expect(profile.careerRetirement).toBeUndefined()
  expect(profile.activeMission).toBeUndefined()
  expect(profile.activeOutpostMission).toBeUndefined()
  expect(profile.activeRace).toBeUndefined()
  expect(profile.townEvent).toBeUndefined()
})
