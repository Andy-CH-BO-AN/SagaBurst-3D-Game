import { expect, it } from 'vitest'
import { createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import {
  atCommanderRetirementRally, beginCommanderRetirementFinalStand, CareerRetirementFinaleOwner,
  completeCommanderRetirement, insideCommanderRetirementFinalStandZone,
} from '../../src/career/CareerRetirementFinale'
import { TOWN_RETIREMENT_EXTRACTION } from '../../src/town/TownBounds'
import { withNativeRetirementCheckpoints } from '../helpers/RetirementMobilizationFixture'

function finaleProfile(phase: 'mobilizing' | 'final-stand', combatElapsedSeconds = 0): CareerProfile {
  const profile = createCareerProfile('roman')
  profile.rank = 'commander'; profile.totalMerit = 20000
  profile.personalSquad = { members: [] }
  profile.careerRetirement = { version: 1, phase, acceptedAt: 123, combatElapsedSeconds,
    mobilization: { version: 1, commandRevoked: true, refillCompleted: true, formationPrepared: true } }
  return withNativeRetirementCheckpoints(profile)
}

it('starts only a complete mobilization and advances the immutable survival clock only inside the horizontal zone', () => {
  const ready = finaleProfile('mobilizing')
  const original = JSON.stringify(ready)
  expect(beginCommanderRetirementFinalStand({ ...ready, rank: 'captain' })).toBeNull()
  expect(beginCommanderRetirementFinalStand({ ...ready, activeMission: {
    id: 'mission', templateId: 'recruit-bandits-01', targetCampId: 0,
    phase: 'RETURNING', targetActorIds: [], friendlyActorIds: [], acceptedAt: 123,
  } })).toBeNull()
  expect(beginCommanderRetirementFinalStand({ ...ready, retirementTowerGuards: undefined })).toBeNull()
  const started = beginCommanderRetirementFinalStand(ready)!
  expect(started.careerRetirement).toMatchObject({ phase: 'final-stand', combatElapsedSeconds: 0 })
  expect(JSON.stringify(ready)).toBe(original)
  expect(beginCommanderRetirementFinalStand(started)).toBeNull()
  const position = { ...TOWN_RETIREMENT_EXTRACTION, y: 100 }
  expect(atCommanderRetirementRally({ ...position, x: 8 })).toBe(true)
  expect(atCommanderRetirementRally({ ...position, x: 8.01 })).toBe(false)
  expect(insideCommanderRetirementFinalStandZone({ ...position, x: 45 })).toBe(true)
  expect(insideCommanderRetirementFinalStandZone({ ...position, x: 45.01 })).toBe(false)
  const owner = new CareerRetirementFinaleOwner()
  const frame = { deltaSeconds: 42.5, playerPosition: position, playerDead: false }
  expect(owner.advance(started, { ...frame, playerPosition: { ...position, x: 46 } })).toBe(started)
  let progressed = owner.advance(started, frame)
  expect(progressed.careerRetirement?.combatElapsedSeconds).toBe(42.5)
  expect(started.careerRetirement?.combatElapsedSeconds).toBe(0)
  expect(completeCommanderRetirement(progressed, false)).toBeNull()
  progressed = owner.fastForward(progressed)!
  expect(progressed.careerRetirement?.combatElapsedSeconds).toBe(295)
  progressed = owner.advance(progressed, { ...frame, deltaSeconds: 4.5 })
  expect(progressed.careerRetirement?.combatElapsedSeconds).toBe(299.5)
  expect(owner.outcome).toBeUndefined()
  expect(owner.retryCompletion(() => { throw new Error('No terminal candidate to save yet') })).toBeNull()
})

it('latches escape at 300 seconds and retries an isolated unchanged candidate after a rejected save and later death', () => {
  const current = finaleProfile('final-stand', 299.5)
  const owner = new CareerRetirementFinaleOwner()
  const frame = { deltaSeconds: 0.5, playerPosition: TOWN_RETIREMENT_EXTRACTION, playerDead: false }
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
  const frame = { deltaSeconds: 42.5, playerPosition: TOWN_RETIREMENT_EXTRACTION, playerDead: true }
  owner.advance(current, frame)
  expect(owner.outcome).toBe('fallen')
  expect(owner.retryCompletion(() => false)).toBeNull()
  owner.advance({ ...current, careerRetirement: { ...current.careerRetirement!, combatElapsedSeconds: 300 } },
    { ...frame, playerDead: false })
  const fallen = owner.retryCompletion(() => true)!
  expect(fallen.careerRetirement).toMatchObject({ phase: 'completed', outcome: 'fallen', combatElapsedSeconds: 12.5 })
})
