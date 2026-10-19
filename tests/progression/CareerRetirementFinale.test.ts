import { beforeEach, expect, it, onTestFinished, vi } from 'vitest'
import { Vector3 } from 'three'
import { cloneCareerProfile, createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import {
  advanceCommanderRetirementFinalStand, areAllRetirementEnemiesDefeated, atCommanderRetirementRally,
  beginCommanderRetirementFinalStand, CareerRetirementFinaleOwner,
  completeCommanderRetirement,
} from '../../src/career/CareerRetirementFinale'
import { TOWN_RETIREMENT_EXTRACTION } from '../../src/town/TownBounds'
import { hasCompleteRetirementMobilizationCheckpoint, retirementAssaultFormations, retirementGroundStaging, retirementMobilizationNeedsPreparation } from '../../src/career/CareerRetirementMobilization'
import { TownRetirementFinaleController } from '../../src/town/TownRetirementFinaleController'
import { TownRetirementMobilizationController } from '../../src/town/TownRetirementMobilizationController'
import { emptyPersonalContribution } from '../../src/combat/CommandMerit'
import { Faction } from '../../src/combat/CombatFaction'
import type { CombatActorRef, CombatEvent, CombatTargetRef } from '../../src/combat/CombatAttribution'
import type { PersonalActorCheckpoint } from '../../src/career/CareerPersonalSquadMission'
import type { TacticalOrder } from '../../src/battle/TacticalOrder'
import type { NPC } from '../../src/world/NPC'
import type { TownActorSpec } from '../../src/town/TownRules'

// This suite owns phase/clock/latch decisions; native schema/store validation has
// real coverage in CaptainMissionPolicy. Keep that dependency explicit and isolated.
vi.mock('../../src/career/CareerRetirementMobilization', () => ({
  hasCompleteRetirementMobilizationCheckpoint: vi.fn(),
  retirementAssaultFormations: vi.fn(), retirementGroundStaging: vi.fn(), retirementMobilizationNeedsPreparation: vi.fn(),
}))
beforeEach(() => {
  vi.mocked(hasCompleteRetirementMobilizationCheckpoint).mockReset().mockReturnValue(true)
  vi.mocked(retirementAssaultFormations).mockReset()
  vi.mocked(retirementGroundStaging).mockReset()
  vi.mocked(retirementMobilizationNeedsPreparation).mockReset().mockReturnValue(false)
})

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

type MobilizationDependencies = ConstructorParameters<typeof TownRetirementMobilizationController>[0]

/** Coordinates and method ports only; native actor construction/physics belong to their own owners. */
function mobilizationResident(id: string, checkpoint: PersonalActorCheckpoint) {
  const position = new Vector3(checkpoint.position!.x, checkpoint.position!.y, checkpoint.position!.z)
  let formation: PersonalActorCheckpoint['formation']
  const actor = {
    combatantId: id, dead: checkpoint.status === 'dead', hp: checkpoint.hp!, combatAmmo: checkpoint.ammo!,
    mount: null, isMounted: false, characterFaction: 'roman' as const,
    group: { position, rotation: { y: 0 } }, combatPosition: position,
    shield: { shieldImpactRemaining: checkpoint.shieldImpact!, shieldImpactMax: 100 },
    tacticalOrder: 'defend' as TacticalOrder,
    get formationCommandId() { return formation?.commandId ?? null },
    releaseOutpostRampartGarrison: vi.fn(),
    restoreCombatHealth: vi.fn((hp: number) => { actor.hp = hp; actor.dead = hp <= 0 }),
    restoreCombatAmmo: vi.fn((ammo: number) => { actor.combatAmmo = ammo }),
    setTownPeaceful: vi.fn(), setMissionCombatTarget: vi.fn(), updateTownPeace: vi.fn(), updateTownTravel: vi.fn(),
    setTacticalOrder: vi.fn((order: TacticalOrder) => { actor.tacticalOrder = order; formation = undefined }),
    assignFormationTarget: vi.fn((commandId: number, destination: Vector3, facing: Vector3,
      speedLimit?: number, arrivalOrder?: TacticalOrder, reached = false) => {
      formation = { commandId, position: { x: destination.x, y: destination.y, z: destination.z,
        yaw: Math.atan2(facing.x, facing.z) }, reached, speedLimit, arrivalOrder }
      actor.tacticalOrder = arrivalOrder ?? 'formation'
    }),
  }
  const spec: TownActorSpec = { id, role: 'archer_infantry', duty: 'watchtower_guard', mounted: false,
    training: false, assaultObjective: true, tier: 3, index: 0, x: position.x, y: position.y, z: position.z }
  return { actor, resident: { spec, npc: actor as unknown as NPC } }
}

function mobilizationFixture(phase: 'mobilizing' | 'final-stand', checkpoints: Record<string, PersonalActorCheckpoint>) {
  let profile = finaleProfile(phase), allowSave = true
  profile.retirementTowerGuards = checkpoints
  profile.townCommandSquad = { type: 'town-command', squadId: 1, commandRank: 'commander', townFaction: 'roman',
    sceneKey: 'town-home', state: 'TRAINING', authorized: false, actorIds: [], commandedActorIds: [],
    contribution: emptyPersonalContribution(), members: {} }
  profile.townEagleGarrisons = { roman: { version: 1, sceneKey: 'town:roman', pairs: [] } }
  const actors = Object.entries(checkpoints).map(([id, checkpoint]) => mobilizationResident(id, checkpoint))
  vi.mocked(retirementAssaultFormations).mockReturnValue([{ id: 'guards', source: 'native-guard', actorIds: Object.keys(checkpoints) }])
  vi.mocked(retirementGroundStaging).mockReturnValue(new Map(Object.keys(checkpoints).map((id, index) =>
    [id, { x: 10 + index * 3, y: 0, z: -30, yaw: 0 }])))
  const save = vi.fn((next: CareerProfile) => { if (!allowSave) return false; profile = next; return true })
  const patrol = { recallForSiege: vi.fn(), reconcileRetirementMobilization: vi.fn(() => true) }
  const eagles = { setAmbientPatrolAllowed: vi.fn(), setRecoveryAllowed: vi.fn(),
    stageRetirementRefill: vi.fn(), reconcileRetirementMobilization: vi.fn(() => true) }
  const dependencies = {
    residents: actors.map(item => item.resident), read: () => profile, save, revoke: vi.fn(), patrol, eagles,
    navigation: { townNav: { isElevated: () => false, rampAt: () => undefined,
      watchtower: { surfaceAt: (p: Vector3) => p.y > 0 ? 1 : -1 } } },
    obstacles: [], nearby: () => [],
  }
  return { actors, save, patrol, eagles, read: () => profile, allowSave: (allowed: boolean) => { allowSave = allowed },
    create: () => new TownRetirementMobilizationController(dependencies as unknown as MobilizationDependencies) }
}

it('saves a legacy ground-order migration before restoring actors and preserves resources through retry and reached-marker reload', () => {
  const guard: PersonalActorCheckpoint = { status: 'deployed', hp: 17, ammo: 3, shieldImpact: 8,
    position: { x: -29, y: 33.5, z: -41, yaw: 1 }, order: 'defend', townRampartGarrison: true }
  const casualty: PersonalActorCheckpoint = { ...guard, status: 'dead', hp: 0 }
  const fixture = mobilizationFixture('mobilizing', { tower: guard, casualty })
  const original = cloneCareerProfile(fixture.read()), controller = fixture.create()
  fixture.allowSave(false)
  expect(controller.reconcile()).toBe(false)
  expect(fixture.read()).toEqual(original)
  expect(fixture.patrol.reconcileRetirementMobilization).not.toHaveBeenCalled()
  expect(fixture.actors[0].actor.restoreCombatHealth).not.toHaveBeenCalled()
  expect(fixture.actors[0].actor.assignFormationTarget).not.toHaveBeenCalled()
  fixture.allowSave(true)
  expect(controller.reconcile()).toBe(true)
  expect(fixture.read().retirementTowerGuards!.tower).toEqual({ ...guard, order: 'formation', townRampartGarrison: undefined,
    formation: { commandId: -4900, position: { x: 10, y: 0, z: -30, yaw: 0 }, reached: false } })
  expect(fixture.read().retirementTowerGuards!.casualty).toEqual(casualty)
  expect(fixture.actors[0].actor.combatPosition).toEqual(new Vector3(-29, 33.5, -41))
  expect(fixture.actors[0].actor.hp).toBe(17)
  expect(fixture.actors[0].actor.combatAmmo).toBe(3)
  expect(fixture.eagles.stageRetirementRefill).not.toHaveBeenCalled()
  fixture.read().retirementTowerGuards!.tower.formation!.reached = true
  expect(fixture.create().reconcile()).toBe(true)
  expect(fixture.save).toHaveBeenCalledTimes(2)
  expect(fixture.read().retirementTowerGuards!.tower.formation!.reached).toBe(true)
})

it('finishes elevated final-stand travel before issuing one charge and leaves grounded actors to native combat', () => {
  const guard: PersonalActorCheckpoint = { status: 'deployed', hp: 17, ammo: 3, shieldImpact: 8,
    position: { x: -29, y: 33.5, z: -41, yaw: 1 }, order: 'charge' }
  const fixture = mobilizationFixture('final-stand', { tower: guard, ground: { ...guard,
    position: { x: 15, y: 0, z: -30, yaw: 0 } } })
  const controller = fixture.create(), [tower, ground] = fixture.actors, camera = new Vector3()
  expect(controller.reconcile()).toBe(true)
  tower.actor.setTacticalOrder.mockClear(); ground.actor.setTacticalOrder.mockClear()
  expect(controller.updateResident(ground.resident, .1, camera)).toBe(false)
  expect(ground.actor.assignFormationTarget).not.toHaveBeenCalled()
  expect(controller.updateResident(tower.resident, .1, camera)).toBe(true)
  expect(tower.actor.assignFormationTarget).toHaveBeenCalledOnce()
  expect(tower.actor.updateTownTravel).toHaveBeenCalledOnce()
  expect(tower.actor.setTacticalOrder).not.toHaveBeenCalled()
  tower.actor.updateTownTravel.mockImplementationOnce(() => { tower.actor.combatPosition.y = 0 })
  expect(controller.updateResident(tower.resident, .1, camera)).toBe(true)
  expect(tower.actor.assignFormationTarget).toHaveBeenCalledOnce()
  expect(tower.actor.setTacticalOrder).toHaveBeenCalledExactlyOnceWith('charge')
  expect(controller.updateResident(tower.resident, .1, camera)).toBe(false)
  expect(tower.actor.setTacticalOrder).toHaveBeenCalledOnce()
  expect(tower.actor.updateTownTravel).toHaveBeenCalledTimes(2)
  expect(fixture.save).not.toHaveBeenCalled()
  expect(fixture.eagles.stageRetirementRefill).not.toHaveBeenCalled()
})
