import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { createCareerProfile, cloneCareerProfile } from '../../src/career/CareerProfile'
import { parseCareerProfile } from '../../src/career/CareerProfileStore'
import { createCaptainPatrolCommandMission } from '../../src/career/CaptainMissionCatalog'
import { CaptainPatrolCommandController, resolveCaptainPatrolCommandOutcome } from '../../src/career/CaptainPatrolCommandController'
import { TownCommandSquadController, TOWN_COMMAND_RETURN_ID } from '../../src/town/TownCommandSquadController'
import { TownCavalryPatrolController } from '../../src/town/TownCavalryPatrolController'
import { TownEvent, townCommandSquadRoster, townRoster, type TownActorSpec } from '../../src/town/TownRules'
import { Faction, type NPC } from '../../src/world/NPC'
import type { Mount } from '../../src/world/Mount'
import type { Player } from '../../src/player/Player'
import type { CombatEvent } from '../../src/combat/CombatAttribution'
import { emptyPersonalContribution } from '../../src/combat/CommandMerit'
import { getTerrainHeight } from '../../src/world/Terrain'
import type { NavigationWorld } from '../../src/navigation/NavigationWorld'

/** Recording resident boundary: 0 real NPC/0 Mount/0 world. It verifies ownership and saved state, not locomotion. */
function resident(spec: TownActorSpec) {
  const group = new THREE.Group(); group.position.set(spec.x, getTerrainHeight(spec.x, spec.z), spec.z)
  const homeMount = spec.mounted ? { group: new THREE.Group(), currentHp: 61, maxHp: 100, dead: false, disposed: false,
    riderPlayer: null, riderNpc: null as NPC | null, flight: undefined, type: 'horse', takeDamage: vi.fn() } : undefined
  homeMount?.group.position.copy(group.position)
  let formation: NPC['combatFormationCheckpoint']
  const actor = { group, combatPosition: group.position, combatantId: spec.id, name: spec.id,
    dead: false, hp: 73, faction: Faction.TOWN, squadId: undefined as NPC['squadId'], combatOwnership: undefined as NPC['combatOwnership'],
    mount: homeMount ?? null, isMounted: Boolean(homeMount), isFalling: false, combatAmmo: 12,
    tacticalOrder: 'attack' as NPC['tacticalOrder'], formationCommandId: null as number | null,
    shield: { shieldImpactRemaining: 1, shieldImpactMax: 8 }, respawnEnabled: false,
    setCommandAllegiance: vi.fn((faction: Faction) => { actor.faction = faction }),
    setCommandSquad: vi.fn((squad: NPC['squadId']) => { actor.squadId = squad }),
    setTownPeaceful: vi.fn(), clearEncounter: vi.fn(), assignFollowTarget: vi.fn(),
    setTacticalOrder: vi.fn((order: NPC['tacticalOrder']) => { actor.tacticalOrder = order; actor.formationCommandId = null; formation = undefined }),
    assignFormationTarget: vi.fn((id: number, point: THREE.Vector3) => { actor.formationCommandId = id; actor.tacticalOrder = 'formation'; formation = { commandId: id, position: { x: point.x, z: point.z, yaw: 0 }, reached: false } }),
    isFormationTargetReached: vi.fn(() => false), updateTownTravel: vi.fn(),
    restoreCombatHealth: vi.fn((hp: number) => { actor.hp = hp; actor.dead = hp === 0 }), restoreCombatAmmo: vi.fn(),
    get combatFormationCheckpoint() { return formation },
  }
  // The constructor boundary intentionally supplies only actor methods used by this controller.
  const npc = actor as unknown as NPC
  if (homeMount) homeMount.riderNpc = npc
  return { spec, npc, homeMount: homeMount as unknown as Mount | undefined, actor }
}
function player() { return { dead: false, group: new THREE.Group(), combatPosition: new THREE.Vector3() } as unknown as Player }

describe('permanent Captain Town command roster', () => {
  it.each(['roman', 'viking'] as const)('selects fixed native T2 training residents for %s without officers or Patrol', faction => {
    const roster = townCommandSquadRoster(faction)
    expect(roster).toHaveLength(30); expect(new Set(roster.map(actor => actor.id)).size).toBe(30)
    expect(roster.every(actor => actor.duty === 'training' && actor.tier === 2)).toBe(true)
    expect(roster.filter(actor => actor.unitKind === 'sword_cavalry')).toHaveLength(5)
    expect(roster.filter(actor => actor.unitKind === 'lancer')).toHaveLength(5)
    expect(roster.filter(actor => actor.unitKind === 'horse_archer')).toHaveLength(4)
    expect(roster.filter(actor => actor.unitKind === 'archer')).toHaveLength(faction === 'roman' ? 4 : 8)
    expect(roster.filter(actor => actor.unitKind === 'ranged')).toHaveLength(faction === 'roman' ? 4 : 0)
    expect(roster.filter(actor => actor.unitKind === 'melee')).toHaveLength(4)
    expect(roster.filter(actor => actor.unitKind === 'spearman')).toHaveLength(4)
    expect(townCommandSquadRoster(faction, [...townRoster()].reverse()).map(actor => actor.id)).toEqual(roster.map(actor => actor.id))
  })
  it.each(['captain', 'commander'] as const)('persists automatic %s grant before live allegiance and retains it through Dismiss and hostility', rank => {
    const residents = townCommandSquadRoster('roman').map(resident), p = player()
    let profile = createCareerProfile('roman'); profile.rank = rank
    const commit = vi.fn((next: typeof profile) => { profile = cloneCareerProfile(next); return true })
    const controller = new TownCommandSquadController(residents, () => p, () => profile, commit)
    expect(controller.grant()).toBe(true)
    expect(controller.authorizedActorIds).toHaveLength(30)
    expect(controller.state).toBe('TRAINING')
    expect(residents.every(r => r.actor.assignFollowTarget.mock.calls.length === 0)).toBe(true)
    expect(residents.every(r => r.npc.faction === Faction.PLAYER)).toBe(true)
    expect(commit.mock.invocationCallOrder[0]).toBeLessThan(residents[0].actor.setCommandAllegiance.mock.invocationCallOrder[0])
    residents[0].npc.combatPosition.x = 140
    expect(controller.issue('dismiss')).toBe(true)
    expect(profile.townCommandSquad?.authorized).toBe(true)
    expect(profile.townCommandSquad?.members?.[residents[0].spec.id].formation?.commandId).toBe(TOWN_COMMAND_RETURN_ID)
    const saves = commit.mock.calls.length
    expect(controller.grant()).toBe(true); expect(commit.mock.calls.length).toBe(saves)
    expect(controller.state).toBe('RETURNING')
    residents[1].actor.dead = true; residents[1].actor.hp = 0
    controller.beginHostility()
    expect(controller.authorizedActorIds).toHaveLength(30); expect(residents[0].npc.faction).toBe(Faction.PLAYER)
  })
  it('keeps returning soldiers loyal but rejects new orders until their real travel owner reports arrival', () => {
    const residents = townCommandSquadRoster('roman').map(resident), p = player()
    let profile = createCareerProfile('roman'); profile.rank = 'captain'
    const controller = new TownCommandSquadController(residents, () => p, () => profile, next => { profile = next; return true })
    controller.grant(); const returning = residents[0]
    returning.npc.combatPosition.set(140, 0, 150)
    expect(controller.issue('dismiss')).toBe(true)
    const position = returning.npc.combatPosition.clone()
    expect(controller.accepts(returning.npc)).toBe(false)
    expect(controller.issue('follow')).toBe(false); expect(controller.issue('attack')).toBe(false)
    expect(returning.actor.assignFollowTarget).not.toHaveBeenCalled()
    expect(returning.npc.combatPosition.equals(position)).toBe(true)
    expect(returning.npc.hp).toBe(73); expect(returning.homeMount!.currentHp).toBe(61)
    expect(returning.npc.faction).toBe(Faction.PLAYER); expect(controller.authorizedActorIds).toHaveLength(30)
    // The recording travel boundary reports completion; locomotion is covered by its real NPC owner.
    returning.actor.isFormationTargetReached.mockReturnValue(true)
    controller.updateResident(returning, .016, new THREE.Vector3(), [], {} as NavigationWorld)
    expect(controller.accepts(returning.npc)).toBe(true)
    expect(controller.issue('follow')).toBe(true)
    expect(returning.actor.assignFollowTarget).toHaveBeenCalledOnce()
    expect(residents.slice(1).every(r => r.actor.assignFollowTarget.mock.calls.length === 0)).toBe(true)
    expect(returning.npc.hp).toBe(73); expect(returning.homeMount!.currentHp).toBe(61)
  })
  it('failed handover save leaves granted soldiers unchanged; successful handover preserves injured resident and mount', () => {
    const residents = townCommandSquadRoster('roman').map(resident), p = player()
    let profile = createCareerProfile('roman'); profile.rank = 'captain'
    const controller = new TownCommandSquadController(residents, () => p, () => profile, next => { profile = next; return true })
    controller.grant(); const borrowed = residents[0]; borrowed.npc.combatPosition.set(140, 0, 150)
    borrowed.homeMount!.group.position.copy(borrowed.npc.combatPosition)
    const staged = controller.stageMissionHandoff(profile)
    expect(borrowed.npc.faction).toBe(Faction.PLAYER)
    expect(controller.commandsEnabled).toBe(true)
    profile = staged; controller.applySavedState(staged.townCommandSquad)
    expect(borrowed.npc.faction).toBe(Faction.TOWN); expect(controller.commandsEnabled).toBe(false)
    expect(borrowed.npc.hp).toBe(73); expect(borrowed.homeMount!.currentHp).toBe(61)
    expect(borrowed.npc.combatPosition.toArray()).toEqual([140, 0, 150])
    expect(controller.isReserveAvailable(borrowed.spec.id)).toBe(false)
    expect(controller.checkpoint()?.members?.[borrowed.spec.id].mount?.hp).toBe(61)
  })
  it('excludes exactly saved loyal Actor IDs from conquest while requiring every other resident', () => {
    const event = new TownEvent([{ id: 'loyal' }, { id: 'defender' }])
    event.register('loyal', { dead: false }); event.register('defender', { dead: true }); event.complete(); event.hostile = true
    expect(event.evaluate(false)).toBeNull()
    event.excludeAuthorizedActors(['loyal', 'outsider'])
    expect(event.evaluate(false)).toBe('town_defeated')
    event.actors.get('defender')!.dead = false
    expect(event.evaluate(false)).toBeNull()
  })
})

describe('Captain Patrol actual combat objective and handover', () => {
  it('borrows all twenty original A residents and never lets autonomous patrol overwrite their command', () => {
    const residents = townRoster().filter(spec => spec.patrolId === 'A').map(resident), patrol = new TownCavalryPatrolController(residents)
    expect(patrol.selectAvailableSquad()?.actorIds).toHaveLength(20)
    expect(patrol.selectAvailableSquad()?.actorIds[0]).toBe('town-patrol:a:captain')
    const ids = patrol.selectAvailableSquad()!.actorIds
    expect(patrol.resumeSquad(ids)).toBe(true); expect(patrol.selectAvailableSquad()).toBeNull()
    patrol.beginFrame(new Set())
    expect(residents.every(r => !patrol.owns(r.npc))).toBe(true)
    expect(residents.every(r => r.actor.assignFormationTarget.mock.calls.length === 0 && r.actor.assignFollowTarget.mock.calls.length === 0)).toBe(true)
  })
  it('counts only actual authorized kills once and retains the kill set and independent contributions after reload', () => {
    const residents = townRoster().filter(spec => spec.patrolId === 'A').map(resident), patrol = new TownCavalryPatrolController(residents), p = player()
    let profile = createCareerProfile('roman'); profile.rank = 'captain'
    profile.activeMission = createCaptainPatrolCommandMission(profile, patrol.selectAvailableSquad()!.actorIds, 'patrol')
    const runtime = new CaptainPatrolCommandController(residents, patrol, () => p, () => profile, next => { profile = next; return true },
      { isEligibleTarget: target => target.targetId.startsWith('enemy:') })
    profile.activeMission = runtime.captureForMission(profile.activeMission)!
    expect(runtime.resume(false)).toBe(true)
    const source = { actorId: 'town-patrol:a:captain', actorType: 'npc' as const, allegiance: Faction.TOWN, characterFaction: 'roman' as const, squadId: 1 as const, ownership: 'mission-official' as const }
    const kill = (id: string): CombatEvent => ({ type: 'actor_killed', source, target: { targetId: id, targetType: 'npc', name: id, allegiance: Faction.ENEMY }, method: 'projectile' })
    expect(runtime.recordEvent(kill('enemy:1'))).toBe(true); expect(runtime.recordEvent(kill('enemy:1'))).toBe(false)
    expect(runtime.recordEvent(kill('town:civilian'))).toBe(false)
    expect(runtime.killCount).toBe(1)
    expect(runtime.statsSnapshot?.player.kills).toBe(0); expect(runtime.statsSnapshot?.meritPlayer?.kills).toBe(1)
    runtime.persist(true); runtime.dispose()
    profile = parseCareerProfile(JSON.parse(JSON.stringify(profile)))!
    expect(profile.activeMission?.patrolKilledActorIds).toEqual(['enemy:1'])
    const reload = new CaptainPatrolCommandController(residents, patrol, () => p, () => profile, next => { profile = next; return true },
      { isEligibleTarget: target => target.targetId.startsWith('enemy:') })
    expect(reload.resume()).toBe(true); expect(reload.killCount).toBe(1)
    expect(reload.recordEvent(kill('enemy:1'))).toBe(false)
    expect(reload.statsSnapshot?.meritPlayer?.kills).toBe(1)
    reload.dispose()
  })
  it('wins at thirty while allies survive Player death and fails only when all deployed participants die', () => {
    expect(resolveCaptainPatrolCommandOutcome(30, true, 1, 0)).toBe('victory')
    expect(resolveCaptainPatrolCommandOutcome(29, true, 0, 1)).toBeNull()
    expect(resolveCaptainPatrolCommandOutcome(29, true, 0, 0)).toBe('failure')
  })
  it('records real enemy damage to each authorized squad without crediting Player merit and preserves it through storage', () => {
    const residents = townRoster().filter(spec => spec.patrolId === 'A').map(resident), patrol = new TownCavalryPatrolController(residents), p = player()
    let profile = createCareerProfile('roman'); profile.rank = 'captain'
    profile.activeMission = createCaptainPatrolCommandMission(profile, patrol.selectAvailableSquad()!.actorIds, 'incoming')
    profile.activeMission.personalSquad = { squadId: 'personal', memberIds: ['personal:guard'], sceneKey: 'town-home', state: 'ACTIVE',
      members: { 'personal:guard': { status: 'deployed' } }, contribution: emptyPersonalContribution() }
    const runtime = new CaptainPatrolCommandController(residents, patrol, () => p, () => profile, next => { profile = next; return true },
      { isEligibleTarget: target => target.targetId === 'enemy:actual' })
    profile.activeMission = runtime.captureForMission(profile.activeMission)!
    expect(runtime.resume(false)).toBe(true)
    const incoming = (id: string, squadId: 1 | 'personal', appliedDamage: number, sourceId = 'enemy:actual'): CombatEvent => ({
      type: 'damage_applied', source: { actorId: sourceId, actorType: 'npc', allegiance: Faction.ENEMY, characterFaction: 'viking' },
      target: { targetId: id, targetType: 'npc', name: id, allegiance: squadId === 1 ? Faction.TOWN : Faction.PLAYER, squadId },
      method: 'melee', requestedDamage: appliedDamage, appliedDamage,
    })
    expect(runtime.recordEvent(incoming(residents[0].spec.id, 1, 40))).toBe(true)
    expect(runtime.recordEvent(incoming('personal:guard', 'personal', 11))).toBe(true)
    expect(runtime.recordEvent(incoming('personal:guard', 'personal', 99, 'enemy:unregistered'))).toBe(false)
    expect(runtime.recordEvent(incoming('town:unrelated', 1, 99))).toBe(false)
    expect(runtime.statsSnapshot?.squads.find(squad => squad.squadId === 1)?.damageTaken).toBe(40)
    expect(runtime.statsSnapshot?.squads.find(squad => squad.squadId === 'personal')?.damageTaken).toBe(11)
    expect(runtime.statsSnapshot?.meritPlayer?.damageDealt).toBe(0); expect(runtime.killCount).toBe(0)
    runtime.persist(true); runtime.dispose()
    profile = parseCareerProfile(JSON.parse(JSON.stringify(profile)))!
    const reload = new CaptainPatrolCommandController(residents, patrol, () => p, () => profile, next => { profile = next; return true })
    expect(reload.resume()).toBe(true)
    expect(reload.statsSnapshot?.squads.find(squad => squad.squadId === 1)?.damageTaken).toBe(40)
    expect(reload.statsSnapshot?.squads.find(squad => squad.squadId === 'personal')?.damageTaken).toBe(11)
    reload.dispose()
  })
})
