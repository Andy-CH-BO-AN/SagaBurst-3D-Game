import { beforeEach, expect, it, onTestFinished, vi } from 'vitest'
import { cloneCareerProfile, createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import {
  advanceCommanderRetirementFinalStand, areAllRetirementEnemiesDefeated, atCommanderRetirementRally,
  beginCommanderRetirementFinalStand, CareerRetirementFinaleOwner,
  completeCommanderRetirement,
} from '../../src/career/CareerRetirementFinale'
import { TOWN_RETIREMENT_EXTRACTION } from '../../src/town/TownBounds'
import { hasCompleteRetirementMobilizationCheckpoint } from '../../src/career/CareerRetirementMobilization'
import { TownRetirementFinaleController } from '../../src/town/TownRetirementFinaleController'
import { emptyPersonalContribution } from '../../src/combat/CommandMerit'
import { Faction } from '../../src/combat/CombatFaction'
import type { CombatActorRef, CombatEvent, CombatTargetRef } from '../../src/combat/CombatAttribution'

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
  expect(completeCommanderRetirement(started, {
    playerDead: false, privateFightersAlive: false, allTownEnemiesDefeated: false,
  })).toBeNull()
})

it('uses an 8 m horizontal admission trigger then advances to escape with surviving private fighters after player death', () => {
  const position = { ...TOWN_RETIREMENT_EXTRACTION, y: 100 }
  expect(atCommanderRetirementRally({ ...position, x: position.x + 8 })).toBe(true)
  expect(atCommanderRetirementRally({ ...position, x: position.x + 8.01 })).toBe(false)
  const started = finaleProfile('final-stand')
  const frame = { deltaSeconds: 42.5, playerPosition: position, playerDead: false,
    privateFightersAlive: true, allTownEnemiesDefeated: false }
  let result = advanceCommanderRetirementFinalStand(started, frame)
  expect(result.profile.careerRetirement?.combatElapsedSeconds).toBe(42.5)
  expect(started.careerRetirement?.combatElapsedSeconds).toBe(0)
  const away = { ...position, x: position.x + 1000, z: position.z + 1000 }
  const deadPlayerFrame = { ...frame, playerPosition: away, playerDead: true }
  result = advanceCommanderRetirementFinalStand(result.profile, { ...deadPlayerFrame, deltaSeconds: 257 })
  expect(result.profile.careerRetirement?.combatElapsedSeconds).toBe(299.5)
  expect(result.outcome).toBeUndefined()
  const checkpoint = result.profile
  result = advanceCommanderRetirementFinalStand(checkpoint, { ...deadPlayerFrame, deltaSeconds: 0.5 })
  expect(result.profile.careerRetirement?.combatElapsedSeconds).toBe(300)
  expect(result.outcome).toBe('escaped')
  expect(completeCommanderRetirement(result.profile, deadPlayerFrame)?.careerRetirement)
    .toMatchObject({ phase: 'completed', outcome: 'escaped', combatElapsedSeconds: 300 })
})

it('latches escape at 300 seconds and retries an isolated unchanged candidate after a rejected save and later death', () => {
  const current = finaleProfile('final-stand', 299.5)
  const owner = new CareerRetirementFinaleOwner()
  const frame = { deltaSeconds: 0.5,
    playerPosition: { x: TOWN_RETIREMENT_EXTRACTION.x + 1000, z: TOWN_RETIREMENT_EXTRACTION.z }, playerDead: false,
    privateFightersAlive: false, allTownEnemiesDefeated: false }
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

it('latches total friendly defeat before mutual-wipe victory despite a rejected save and later survival', () => {
  const current = finaleProfile('final-stand', 12.5)
  const owner = new CareerRetirementFinaleOwner()
  expect(owner.fastForward(current)?.careerRetirement?.combatElapsedSeconds).toBe(295)
  const frame = { deltaSeconds: 42.5, playerPosition: TOWN_RETIREMENT_EXTRACTION, playerDead: true,
    privateFightersAlive: false, allTownEnemiesDefeated: true }
  owner.advance(current, frame)
  expect(owner.outcome).toBe('fallen')
  expect(owner.retryCompletion(() => false)).toBeNull()
  owner.advance({ ...current, careerRetirement: { ...current.careerRetirement!, combatElapsedSeconds: 300 } },
    { ...frame, playerDead: false })
  const fallen = owner.retryCompletion(() => true)!
  expect(fallen.careerRetirement).toMatchObject({ phase: 'completed', outcome: 'fallen', combatElapsedSeconds: 12.5 })
})

it('latches immediate escape when all Town enemies die and private fighters survive the player', () => {
  const current = finaleProfile('final-stand', 12.5)
  const owner = new CareerRetirementFinaleOwner()
  const frame = { deltaSeconds: 0, playerPosition: TOWN_RETIREMENT_EXTRACTION, playerDead: true,
    privateFightersAlive: true, allTownEnemiesDefeated: true }
  expect(owner.advance(finaleProfile('mobilizing'), frame).careerRetirement?.phase).toBe('mobilizing')
  expect(owner.outcome).toBeUndefined()
  expect(owner.advance(current, frame)).toBe(current)
  expect(owner.outcome).toBe('escaped')
  expect(owner.retryCompletion(next => { next.careerRetirement!.outcome = 'fallen'; return false })).toBeNull()
  owner.advance(current, { ...frame, privateFightersAlive: false })
  const escaped = owner.retryCompletion(() => true)!
  expect(escaped.careerRetirement).toMatchObject({ phase: 'completed', outcome: 'escaped', combatElapsedSeconds: 12.5 })
  expect(current.careerRetirement).toMatchObject({ phase: 'final-stand', combatElapsedSeconds: 12.5 })
})

it('requires every canonical enemy to be observed dead without counting unrelated actors', () => {
  const expectedIds = new Set(['town-guard-1', 'town-guard-2'])
  const observed = new Map([
    ['town-guard-1', { dead: true }],
    ['unrelated-actor', { dead: false }],
  ])
  expect(areAllRetirementEnemiesDefeated(new Set(), observed)).toBe(false)
  expect(areAllRetirementEnemiesDefeated(expectedIds, observed)).toBe(false)
  observed.set('town-guard-2', { dead: false })
  expect(areAllRetirementEnemiesDefeated(expectedIds, observed)).toBe(false)
  observed.get('town-guard-2')!.dead = true
  expect(areAllRetirementEnemiesDefeated(expectedIds, observed)).toBe(true)
})

it('keeps only finale-owned counters across admission, checkpoint reload and a frozen completion retry', () => {
  let profile = finaleProfile('mobilizing')
  profile.personalSquad = { members: [{ id: 'personal:owned', type: 'soldier' }] }
  profile.personalSquadRuntime = { squadId: 'personal', memberIds: ['personal:owned', 'personal:unowned'],
    sceneKey: 'town-home', state: 'ACTIVE', members: { 'personal:owned': { status: 'deployed', hp: 10 } },
    contribution: { ...emptyPersonalContribution(), kills: 99 } }
  const player: CombatActorRef = { actorId: 'player', actorType: 'player', allegiance: Faction.PLAYER, characterFaction: 'roman' }
  const personal: CombatActorRef = { ...player, actorId: 'personal:owned', actorType: 'npc', squadId: 'personal', ownership: 'player-personal' }
  const enemy: CombatActorRef = { ...player, actorId: 'native', actorType: 'npc', allegiance: Faction.TOWN }
  const target: CombatTargetRef = { targetId: 'native', targetType: 'npc', name: 'Native', allegiance: Faction.TOWN }
  const killed = (source: CombatActorRef, victim = target): CombatEvent => ({ type: 'actor_killed', source, target: victim, method: 'projectile' })
  const damage = (source: CombatActorRef, victim: CombatTargetRef, amount: number): CombatEvent => ({
    type: 'damage_applied', source, target: victim, method: 'melee', requestedDamage: amount, appliedDamage: amount,
  })
  const zero = { damageDealt: 0, damageTaken: 0, kills: 0, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0 }
  let allowSave = true, emitWhileCapturing = false
  const complete = vi.fn()
  let controller: TownRetirementFinaleController
  const controllers: TownRetirementFinaleController[] = []
  onTestFinished(() => { for (const created of controllers) created.dispose() })
  const createController = () => {
    const created = new TownRetirementFinaleController({
      read: () => profile, publish: next => { profile = next }, privateFightersAlive: () => true,
      privateSquad: () => profile.personalSquadRuntime,
      residents: [{ spec: { id: 'native' }, npc: { combatantId: 'native', dead: false, combatOwnership: undefined,
        setCommandAllegiance() {}, setCommandSquad() {}, releaseOutpostRampartGarrison() {}, beginTownHostility() {} } }],
      mobilization: { formations: [{ id: 'formation', source: 'town-ground', actorIds: ['native'] }], reconcile: () => true },
      eagles: { beginRetirementFinalStand() {} }, betray() {}, complete, failed() {},
      capture: next => {
        next.retirementRuntime = { player: { position: { x: 0, y: 0, z: 0, yaw: 0 },
          hp: 20, stamina: 10, arrows: 3, shieldImpact: 0, mounted: false } }
        if (emitWhileCapturing) controller.recordEvent(killed(player))
      },
      save: next => {
        if (!allowSave) { next.retirementRuntime!.stats!.player.kills = 999; return false }
        return true
      },
    })
    controllers.push(created)
    return created
  }
  controller = createController()
  controller.recordEvent(killed(player))
  controller.beforeCombat(0, TOWN_RETIREMENT_EXTRACTION, false)
  expect(profile.retirementRuntime?.stats).toEqual({ player: zero, personal: zero })
  controller.recordEvent(damage(player, target, 4))
  controller.recordEvent(killed(player))
  controller.recordEvent(damage(personal, target, 7))
  controller.recordEvent(killed(personal))
  controller.recordEvent(damage(enemy, { targetId: 'player', targetType: 'player', name: 'Player' }, 5))
  controller.recordEvent(damage(enemy, { targetId: personal.actorId, targetType: 'npc', squadId: 'personal', name: 'Private' }, 3))
  controller.recordEvent(killed({ ...personal, actorId: 'personal:unowned' }))
  controller.recordEvent(killed({ ...personal, ownership: 'mission-official' }))
  controller.recordEvent(killed(player, { ...target, targetId: 'unrelated' }))
  controller.recordEvent(killed(personal, { ...target, allegiance: Faction.PLAYER }))
  const expected = { player: { ...zero, damageDealt: 4, damageTaken: 5, kills: 1 },
    personal: { ...zero, damageDealt: 7, damageTaken: 3, kills: 1 } }
  const checkpoint = cloneCareerProfile(profile)
  controller.captureStats(checkpoint)
  expect(checkpoint.retirementRuntime?.stats).toEqual(expected)
  controller.dispose()
  profile = checkpoint
  controller = createController()
  expect(controller.reconcile()).toBe(true)
  expect(controller.stats).toEqual(expected)
  // Membership, not current life, attributes a private projectile already in flight.
  profile.personalSquadRuntime!.members[personal.actorId].status = 'dead'
  controller.recordEvent(killed(personal))
  allowSave = false; emitWhileCapturing = true
  controller.beforeCombat(300, TOWN_RETIREMENT_EXTRACTION, false)
  controller.recordEvent(killed(player))
  expect(controller.frozen).toBe(true)
  expect(complete).not.toHaveBeenCalled()
  allowSave = true
  controller.beforeCombat(1, TOWN_RETIREMENT_EXTRACTION, false)
  expect(profile.retirementRuntime?.stats).toEqual({ player: expected.player, personal: { ...expected.personal, kills: 2 } })
  expect(profile.careerRetirement).toMatchObject({ phase: 'completed', outcome: 'escaped' })
  expect(profile.availableMerit).toBe(checkpoint.availableMerit)
  expect(profile.careerMissionCompletionsByTier).toEqual(checkpoint.careerMissionCompletionsByTier)
  expect(complete).toHaveBeenCalledOnce()
})
