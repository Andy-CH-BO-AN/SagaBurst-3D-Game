import { expect, it } from 'vitest'
import { cloneCareerProfile, createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { validateOrdinaryRetirementCommit } from '../../src/career/CareerRetirement'
import {
  atCommanderRetirementRally, beginCommanderRetirementFinalStand, CareerRetirementFinaleOwner,
  completeCommanderRetirement, insideCommanderRetirementFinalStandZone,
} from '../../src/career/CareerRetirementFinale'
import { TOWN_RETIREMENT_EXTRACTION } from '../../src/town/TownBounds'
import { withNativeRetirementCheckpoints } from '../helpers/RetirementMobilizationFixture'

it('owns the validated zone survival transition and latches either terminal candidate until its unchanged save succeeds', () => {
  const profile = createCareerProfile('roman')
  profile.rank = 'commander'; profile.totalMerit = 20000
  profile.personalSquad = { members: [] }
  profile.careerRetirement = { version: 1, phase: 'mobilizing', acceptedAt: 123, combatElapsedSeconds: 0,
    mobilization: { version: 1, commandRevoked: true, refillCompleted: true, formationPrepared: true } }
  const ready = withNativeRetirementCheckpoints(profile)
  const original = JSON.stringify(ready)
  expect(beginCommanderRetirementFinalStand({ ...ready, rank: 'captain' })).toBeNull()
  expect(beginCommanderRetirementFinalStand({ ...ready, careerRetirement: { ...ready.careerRetirement!, mobilization: undefined } })).toBeNull()
  expect(beginCommanderRetirementFinalStand({ ...ready, retirementTowerGuards: undefined })).toBeNull()
  const activeWork: Partial<CareerProfile>[] = [
    { activeMission: { id: 'mission', templateId: 'recruit-bandits-01', targetCampId: 0,
      phase: 'RETURNING', targetActorIds: [], friendlyActorIds: [], acceptedAt: 123 } },
    { activeOutpostMission: { id: 'outpost', kind: 'outpost-defense', stageId: 1, acceptedAt: 123 } },
    { activeRace: { version: 1, deployed: false, id: 'race', raceId: 'race-1', phase: 'guiding',
      countdownSeconds: 0, elapsedSeconds: 0, gameSeconds: 0, phaseSeconds: 0, waypoint: 0,
      player: { actorId: 'player', mountId: 'horse', position: { x: 0, y: 0, z: 0, yaw: 0 },
        mountPosition: { x: 0, y: 0, z: 0, yaw: 0 }, hp: 100, mountHp: 100, stamina: 100, mounted: true, dead: false, checkpoint: 0 },
      opponent: { actorId: 'opponent', mountId: 'horse', position: { x: 0, y: 0, z: 0, yaw: 0 },
        mountPosition: { x: 0, y: 0, z: 0, yaw: 0 }, hp: 100, mountHp: 100, stamina: 100, mounted: true, dead: false, checkpoint: 0 } } },
  ]
  for (const work of activeWork) expect(beginCommanderRetirementFinalStand({ ...ready, ...work })).toBeNull()
  const started = beginCommanderRetirementFinalStand(ready)!
  expect(started.careerRetirement?.phase).toBe('final-stand')
  expect(started.careerRetirement?.combatElapsedSeconds).toBe(0)
  expect(JSON.stringify(ready)).toBe(original)
  expect(beginCommanderRetirementFinalStand(started)).toBeNull()
  expect(beginCommanderRetirementFinalStand({ ...ready, careerRetirement: { version: 1, phase: 'departing', acceptedAt: 123, combatElapsedSeconds: 0 } })).toBeNull()
  expect(validateOrdinaryRetirementCommit(ready, started).allowed).toBe(false)
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
  expect(owner.outcome).toBeUndefined()
  expect(started.careerRetirement?.combatElapsedSeconds).toBe(0)
  expect(completeCommanderRetirement(progressed, false)).toBeNull()
  progressed = owner.fastForward(progressed)!
  expect(progressed.careerRetirement?.combatElapsedSeconds).toBe(295)
  expect(validateOrdinaryRetirementCommit(started, progressed).allowed).toBe(false)
  progressed = owner.advance(progressed, { ...frame, deltaSeconds: 4.5 })
  expect(owner.outcome).toBeUndefined()
  let saved = progressed
  progressed = owner.advance(progressed, { ...frame, deltaSeconds: 0.5 })
  expect(progressed.careerRetirement?.combatElapsedSeconds).toBe(300)
  expect(progressed.personalSquad?.members).toEqual([])
  expect(owner.outcome).toBe('escaped')
  // A rejected transaction may mutate its argument; neither it nor later death revises the latch.
  expect(owner.retryCompletion(next => { next.careerRetirement!.outcome = 'fallen'; return false })).toBeNull()
  owner.advance(progressed, { ...frame, playerDead: true })
  expect(owner.outcome).toBe('escaped')
  expect(owner.fastForward(progressed)).toBeNull()
  expect(saved.careerRetirement?.combatElapsedSeconds).toBe(299.5)
  const escaped = owner.retryCompletion(next => { saved = next; return true })!
  expect(escaped.careerRetirement).toMatchObject({ phase: 'completed', outcome: 'escaped', combatElapsedSeconds: 300 })
  expect(escaped.availableMerit).toBe(ready.availableMerit)
  expect(escaped.careerMissionCompletionsByTier).toEqual(ready.careerMissionCompletionsByTier)
  expect(saved.careerRetirement?.outcome).toBe('escaped')
  expect(beginCommanderRetirementFinalStand(escaped)).toBeNull()

  const fallenOwner = new CareerRetirementFinaleOwner()
  const fallenAt = cloneCareerProfile(started)
  fallenAt.careerRetirement!.combatElapsedSeconds = 12.5
  fallenOwner.advance(fallenAt, { ...frame, playerDead: true })
  expect(fallenOwner.outcome).toBe('fallen')
  expect(fallenOwner.retryCompletion(() => false)).toBeNull()
  fallenOwner.advance({ ...fallenAt, careerRetirement: { ...fallenAt.careerRetirement!, combatElapsedSeconds: 300 } }, frame)
  const fallen = fallenOwner.retryCompletion(next => { saved = next; return true })!
  expect(fallen.careerRetirement).toMatchObject({ phase: 'completed', outcome: 'fallen', combatElapsedSeconds: 12.5 })
})
