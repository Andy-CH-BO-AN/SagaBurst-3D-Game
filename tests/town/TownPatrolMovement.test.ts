import { Vector3 } from 'three'
import { describe, expect, it, vi } from 'vitest'
import type { NavigationWorld } from '../../src/navigation/NavigationWorld'
import { TownCavalryPatrolController, type PatrolResident } from '../../src/town/TownCavalryPatrolController'
import { townRoster } from '../../src/town/TownRules'
import type { NPC } from '../../src/world/NPC'

/** Position/ownership data and recorded commands only: no locomotion or render objects. */
function patrol(count = 2) {
  const specs = townRoster().filter(spec => spec.patrolId === 'A')
  const selected = [specs.find(spec => spec.patrolLeader)!, ...specs.filter(spec => !spec.patrolLeader)].slice(0, count)
  const actors = selected.map(spec => {
    const position = new Vector3(spec.x, 0, spec.z)
    const actor = {
      combatantId: spec.id, combatPosition: position, group: { position, rotation: { y: 0 } },
      dead: false, combatOwnership: undefined as NPC['combatOwnership'],
      mount: null as { dead: boolean; riderNpc: object } | null, formationCommandId: null as number | null,
      clearEncounter: vi.fn(), setTownPeaceful: vi.fn(), setTacticalOrder: vi.fn(),
      assignFormationTarget: vi.fn(), updateTownTravel: vi.fn(),
    }
    actor.mount = { dead: false, riderNpc: actor }
    return actor
  })
  // The production interface also has rendering/combat methods this decision never reads.
  const residents: PatrolResident[] = selected.map((spec, i) => ({ spec, npc: actors[i] as unknown as NPC }))
  return { actors, residents, controller: new TownCavalryPatrolController(residents) }
}
describe('Town patrol travel and ownership decisions', () => {
  it('advances the final route waypoint to the first when its leader reaches it', () => {
    const { actors, residents, controller } = patrol(1), squad = controller.squads[0]
    squad.state = 'PATROLLING'; squad.waypoint = controller.route.length - 1
    actors[0].combatPosition.copy(controller.route[squad.waypoint])
    controller.beginFrame(new Set())
    controller.updateResident(residents[0], 0, new Vector3(), [], {} as NavigationWorld)
    expect(squad.waypoint).toBe(0)
    expect(actors[0].assignFormationTarget).toHaveBeenCalledWith(-3, controller.route[0], expect.any(Vector3), expect.any(Number))
  })
  it('elects the living mounted deputy after the active captain dies', () => {
    const { actors, controller } = patrol()
    controller.beginFrame(new Set())
    expect(controller.squads[0].activeLeaderActorId).toBe(actors[0].combatantId)
    actors[0].dead = true; controller.beginFrame(new Set())
    expect(controller.squads[0].activeLeaderActorId).toBe(actors[1].combatantId)
  })
  it('keeps a returning resident unavailable until its saved refit enters rejoin', () => {
    const { actors, controller } = patrol(1), id = actors[0].combatantId
    expect(controller.beginMissionReturn(id)).toBe(true)
    expect(controller.returnStateFor(id)).toBe('RETURN_TO_BARRACKS')
    expect(controller.canClaimTownCommand(id)).toBe(false)
    expect(controller.isReserveAvailable(id)).toBe(false)
    controller.restoreMissionReturn(id, 'REJOIN_PATROL')
    expect(controller.canClaimTownCommand(id)).toBe(true)
    expect(controller.isReserveAvailable(id)).toBe(true)
  })
  it('rejects an incomplete takeover without releasing any permanent patrol identity', () => {
    const { actors, controller } = patrol(20)
    expect(controller.relinquishSquad(actors.slice(0, 19).map(actor => actor.combatantId))).toBe(false)
    expect(actors.every(actor => controller.owns(actor as unknown as NPC))).toBe(true)
    for (const actor of actors) expect(actor.clearEncounter).not.toHaveBeenCalled()
  })
  it('releases the complete accepted roster and excludes it from autonomous ownership', () => {
    const { actors, controller } = patrol(20), ids = actors.map(actor => actor.combatantId)
    expect(controller.selectAvailableSquad()?.actorIds).toEqual(ids)
    expect(controller.relinquishSquad(ids)).toBe(true)
    expect(controller.selectAvailableSquad()).toBeNull()
    expect(actors.every(actor => !controller.owns(actor as unknown as NPC))).toBe(true)
    for (const actor of actors) expect(actor.clearEncounter).toHaveBeenCalledOnce()
  })
})
