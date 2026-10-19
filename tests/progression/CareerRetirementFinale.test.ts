import { beforeEach, expect, it, vi } from 'vitest'
import { createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import {
  advanceCommanderRetirementFinalStand, atCommanderRetirementRally, beginCommanderRetirementFinalStand, CareerRetirementFinaleOwner,
  completeCommanderRetirement,
} from '../../src/career/CareerRetirementFinale'
import { TOWN_RETIREMENT_EXTRACTION } from '../../src/town/TownBounds'
import { hasCompleteRetirementMobilizationCheckpoint } from '../../src/career/CareerRetirementMobilization'

// This suite owns phase/clock/latch decisions; native schema/store validation has
// real coverage in CaptainMissionPolicy. Keep that dependency explicit and isolated.
vi.mock('../../src/career/CareerRetirementMobilization', () => ({
  hasCompleteRetirementMobilizationCheckpoint: vi.fn(),
}))
beforeEach(() => { vi.mocked(hasCompleteRetirementMobilizationCheckpoint).mockReset().mockReturnValue(true) })

function finaleProfile(phase: 'mobilizing' | 'final-stand', combatElapsedSeconds = 0): CareerProfile {
  const profile = createCareerProfile('roman')
  profile.rank = 'commander'; profile.totalMerit = 20000
  profile.personalSquad = { members: [] }
  profile.careerRetirement = { version: 1, phase, acceptedAt: 123, combatElapsedSeconds,
    mobilization: { version: 1, commandRevoked: true, refillCompleted: true, formationPrepared: true } }
  return profile
}

it('starts only a complete mobilization without changing the admitted checkpoint', () => {
  const ready = finaleProfile('mobilizing')
  const original = JSON.stringify(ready)
  expect(beginCommanderRetirementFinalStand({ ...ready, rank: 'captain' })).toBeNull()
  expect(beginCommanderRetirementFinalStand({ ...ready, activeMission: {
    id: 'mission', templateId: 'recruit-bandits-01', targetCampId: 0,
    phase: 'RETURNING', targetActorIds: [], friendlyActorIds: [], acceptedAt: 123,
  } })).toBeNull()
  expect(hasCompleteRetirementMobilizationCheckpoint).not.toHaveBeenCalled()
  vi.mocked(hasCompleteRetirementMobilizationCheckpoint).mockReturnValueOnce(false)
  expect(beginCommanderRetirementFinalStand(ready)).toBeNull()
  expect(hasCompleteRetirementMobilizationCheckpoint).toHaveBeenLastCalledWith(ready)
  const started = beginCommanderRetirementFinalStand(ready)!
  expect(hasCompleteRetirementMobilizationCheckpoint).toHaveBeenLastCalledWith(ready)
  expect(started.careerRetirement).toMatchObject({ phase: 'final-stand', combatElapsedSeconds: 0 })
  expect(JSON.stringify(ready)).toBe(original)
  expect(beginCommanderRetirementFinalStand(started)).toBeNull()
  expect(completeCommanderRetirement(started, false)).toBeNull()
})

it('uses an 8 m horizontal admission trigger then advances continuously away from the rally', () => {
  const position = { ...TOWN_RETIREMENT_EXTRACTION, y: 100 }
  expect(atCommanderRetirementRally({ ...position, x: position.x + 8 })).toBe(true)
  expect(atCommanderRetirementRally({ ...position, x: position.x + 8.01 })).toBe(false)
  const started = finaleProfile('final-stand')
  const frame = { deltaSeconds: 42.5, playerPosition: position, playerDead: false }
  let result = advanceCommanderRetirementFinalStand(started, frame)
  expect(result.profile.careerRetirement?.combatElapsedSeconds).toBe(42.5)
  expect(started.careerRetirement?.combatElapsedSeconds).toBe(0)
  const away = { ...position, x: position.x + 1000, z: position.z + 1000 }
  result = advanceCommanderRetirementFinalStand(result.profile, { ...frame, playerPosition: away, deltaSeconds: 257 })
  expect(result.profile.careerRetirement?.combatElapsedSeconds).toBe(299.5)
  expect(result.outcome).toBeUndefined()
  const checkpoint = result.profile
  expect(advanceCommanderRetirementFinalStand(checkpoint, { ...frame, playerPosition: away, playerDead: true }))
    .toEqual({ profile: checkpoint, outcome: 'fallen' })
  result = advanceCommanderRetirementFinalStand(checkpoint, { ...frame, playerPosition: away, deltaSeconds: 0.5 })
  expect(result.profile.careerRetirement?.combatElapsedSeconds).toBe(300)
  expect(result.outcome).toBe('escaped')
})

it('latches escape at 300 seconds and retries an isolated unchanged candidate after a rejected save and later death', () => {
  const current = finaleProfile('final-stand', 299.5)
  const owner = new CareerRetirementFinaleOwner()
  const frame = { deltaSeconds: 0.5,
    playerPosition: { x: TOWN_RETIREMENT_EXTRACTION.x + 1000, z: TOWN_RETIREMENT_EXTRACTION.z }, playerDead: false }
  expect(owner.fastForward(current)?.careerRetirement?.combatElapsedSeconds).toBe(299.5)
  expect(owner.retryCompletion(() => { throw new Error('No terminal candidate to save yet') })).toBeNull()
  const progressed = owner.advance(current, frame)
  expect(progressed.careerRetirement?.combatElapsedSeconds).toBe(300)
  expect(progressed.personalSquad?.members).toEqual([])
  expect(owner.outcome).toBe('escaped')
  // A rejected transaction may mutate its argument; neither it nor later death revises the latch.
  expect(owner.retryCompletion(next => { next.careerRetirement!.outcome = 'fallen'; return false })).toBeNull()
  owner.advance(progressed, { ...frame, playerDead: true })
  expect(owner.outcome).toBe('escaped')
  expect(owner.fastForward(progressed)).toBeNull()
  expect(current.careerRetirement?.combatElapsedSeconds).toBe(299.5)
  let saved: CareerProfile | undefined
  const escaped = owner.retryCompletion(next => { saved = next; return true })!
  expect(escaped.careerRetirement).toMatchObject({ phase: 'completed', outcome: 'escaped', combatElapsedSeconds: 300 })
  expect(escaped.availableMerit).toBe(current.availableMerit)
  expect(escaped.careerMissionCompletionsByTier).toEqual(current.careerMissionCompletionsByTier)
  expect(saved?.careerRetirement?.outcome).toBe('escaped')
  expect(beginCommanderRetirementFinalStand(escaped)).toBeNull()
})

it('latches an early death at its original elapsed time despite a rejected save and later survival', () => {
  const current = finaleProfile('final-stand', 12.5)
  const owner = new CareerRetirementFinaleOwner()
  expect(owner.fastForward(current)?.careerRetirement?.combatElapsedSeconds).toBe(295)
  const frame = { deltaSeconds: 42.5, playerPosition: TOWN_RETIREMENT_EXTRACTION, playerDead: true }
  owner.advance(current, frame)
  expect(owner.outcome).toBe('fallen')
  expect(owner.retryCompletion(() => false)).toBeNull()
  owner.advance({ ...current, careerRetirement: { ...current.careerRetirement!, combatElapsedSeconds: 300 } },
    { ...frame, playerDead: false })
  const fallen = owner.retryCompletion(() => true)!
  expect(fallen.careerRetirement).toMatchObject({ phase: 'completed', outcome: 'fallen', combatElapsedSeconds: 12.5 })
})
