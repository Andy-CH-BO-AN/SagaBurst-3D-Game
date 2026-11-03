import { COMMANDER_FOUR_GATE_DEFENSE_SURVIVAL_SECONDS as survivalSeconds } from '../../src/career/CommanderFourGateDefenseState'
import { describe, expect, it } from 'vitest'
import { CommanderFourGateDefenseController } from '../../src/career/CommanderFourGateDefenseController'
import { createFourGateDefenseProfile } from '../helpers/commanderFourGateDefenseFixture'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { createEnemyTownAssaultMission } from '../../src/career/EnemyTownAssault'
import { townAssaultRuntime } from '../helpers/townAssaultRuntime'
import { townRoster } from '../../src/town/TownRules'
import { eagleTrainerSpec } from '../../src/town/TownEagleTrainingGround'

describe('Town defense target accounting', () => {
  it('requires ordinary elevated archers and ground service fighters while original air riders remain optional after losing their mounts', () => {
    const profile = createCareerProfile('roman'), active = createEnemyTownAssaultMission('ground-objectives')
    profile.activeMission = active; active.phase = 'ATTACKING'; active.siege!.rosterCreated = true
    active.siege!.attackerIds = [...active.friendlyActorIds]
    const specs = townRoster().filter(spec => spec.eagle || spec.duty === 'watchtower_guard' || spec.role === 'ranger' || spec.role === 'eagle-trainer')
    specs.push(eagleTrainerSpec({ site: { x: 0, z: 0, yaw: 0 }, trainer: { x: 0, z: 0, yaw: 0 }, pads: [] }))
    active.targetActorIds = specs.map(spec => spec.id)
    const { owner, residents, enemies } = townAssaultRuntime(() => profile, specs)
    const ground = residents.filter(resident => !resident.spec.eagle), air = residents.filter(resident => resident.spec.eagle)
    expect(ground.some(resident => resident.spec.duty === 'watchtower_guard')).toBe(true)
    expect(ground.some(resident => resident.spec.role === 'ranger')).toBe(true)
    expect(ground.some(resident => resident.spec.role === 'eagle-trainer')).toBe(true)
    air[0].npc.mount = air[0].homeMount
    air[1].homeMount!.dead = true; air[1].homeMount!.currentHp = 0
    expect(owner.remainingAssaultGroundDefenders).toBe(ground.length)
    expect(owner.evaluate(true)).toBeNull() // A living assault army preserves spectating.
    for (const npc of enemies) npc.dead = true
    expect(owner.evaluate(true)).toBe('failure')
    for (const resident of ground.slice(1)) resident.npc.dead = true
    expect(owner.remainingAssaultGroundDefenders).toBe(1)
    expect(owner.evaluate(false)).toBeNull()
    ground[0].npc.dead = true
    expect(owner.remainingAssaultGroundDefenders).toBe(0)
    expect(owner.evaluate(true)).toBe('victory') // Ground elimination retains the existing same-frame priority.
    expect(air.every(resident => !resident.npc.dead && resident.npc.hp === 42)).toBe(true)
  })

  it('holds a zero-ground view until deployment and every accepted identity are registered, including unresolved saved actors', () => {
    const profile = createCareerProfile('roman'), active = createEnemyTownAssaultMission('pending-objectives')
    profile.activeMission = active; active.phase = 'ATTACKING'; active.siege!.rosterCreated = true
    active.siege!.attackerIds = [...active.friendlyActorIds]
    const specs = townRoster().filter(spec => spec.eagle)
    active.targetActorIds = specs.map(spec => spec.id)
    const { owner, residents, enemies } = townAssaultRuntime(() => profile, specs)
    active.siege!.rosterCreated = false
    expect(owner.evaluate(false)).toBeNull()
    active.siege!.rosterCreated = true
    owner.startedMissionId = 'not-started'
    expect(owner.evaluate(false)).toBeNull()
    owner.startedMissionId = active.id
    owner.rosterCommitPending = true
    expect(owner.evaluate(false)).toBeNull()
    owner.rosterCommitPending = false
    owner.spawnBatch = { pending: 1, status: 'pending', ready: false }
    expect(owner.evaluate(false)).toBeNull()
    owner.spawnBatch.pending = 0; owner.spawnBatch.ready = true
    const lastFriendly = enemies.pop()!
    expect(owner.evaluate(false)).toBeNull()
    enemies.push(lastFriendly)
    const lastResident = residents.pop()!
    expect(owner.evaluate(false)).toBeNull()
    residents.push(lastResident)
    active.targetActorIds.push('unresolved-saved-defender')
    expect(owner.remainingAssaultGroundDefenders).toBe(1)
    expect(owner.evaluate(false)).toBeNull()
  })

  it('waits for the last registered rider, including after its mount dies, before awarding victory', () => {
    const profile = createFourGateDefenseProfile('ATTACKING'), mission = profile.activeMission!, state = mission.fourGateDefense!
    const lastId = mission.targetActorIds.find(id => id.endsWith(':air:ranger:30'))!
    expect(lastId).toBeDefined()
    mission.deadTargetActorIds = mission.targetActorIds.filter(id => id !== lastId)
    state.registeredTargetActorIds = [...mission.deadTargetActorIds]
    const rider = { combatantId: lastId, dead: false, mount: { dead: false } }
    const enemies: typeof rider[] = []
    // Only spawn/readiness and actor state are dependencies. Evaluate, remaining count and
    // the official deployment/target accounting decisions execute on the real controller.
    const merchant = { spec: { id: 'merchant', role: 'merchant' }, npc: { combatantId: 'merchant', dead: false } }
    const residents = [...mission.civilianActorIds!.map(id => ({ spec: { id, role: 'civilian' }, npc: { combatantId: id, dead: true } })), merchant]
    const owner = Object.assign(Object.create(CommanderFourGateDefenseController.prototype) as Pick<CommanderFourGateDefenseController, 'remainingEnemies' | 'evaluate'>, {
      readProfile: () => profile, state, enemies, residents, actorsById: new Map(),
      startedMissionId: mission.id, fourGateSiege: { ready: true }, spawnBatch: { pending: 0, ready: true },
    })
    expect(owner.remainingEnemies).toBe(1)
    expect(owner.evaluate(false)).toBeNull()
    state.registeredTargetActorIds.push(lastId)
    expect(owner.evaluate(false)).toBeNull() // Registration alone cannot account for an absent living actor.
    enemies.push(rider)
    rider.mount.dead = true
    expect(owner.remainingEnemies).toBe(1)
    expect(owner.evaluate(true, 0)).toBeNull() // The final civilian/service survivor still keeps the Town alive.
    state.combatElapsedSeconds = survivalSeconds / 2
    expect(owner.evaluate(true, 0)).toBeNull()
    state.combatElapsedSeconds = survivalSeconds - .1
    expect(owner.evaluate(true, 0)).toBeNull()
    state.combatElapsedSeconds = survivalSeconds
    expect(owner.evaluate(true, 0)).toBe('victory') // A service resident is a valid deadline survivor.
    merchant.npc.dead = true
    expect(owner.evaluate(true, 1)).toBe('victory') // A live HR ally can win while the player spectates.
    expect(owner.evaluate(false, 0)).toBe('victory') // The player alone also qualifies.
    expect(owner.evaluate(true, 0)).toBe('failure')
    rider.dead = true
    expect(owner.remainingEnemies).toBe(0)
    expect(owner.evaluate(true, 0)).toBe('victory') // All20 civilian losses and mutual annihilation do not revoke victory.
    // The casualty ledger independently accounts for an intentionally absent corpse after reload.
    mission.deadTargetActorIds.push(lastId)
    enemies.length = 0
    expect(owner.evaluate(true, 1)).toBe('victory')
  })
})
