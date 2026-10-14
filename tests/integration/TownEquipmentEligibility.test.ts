import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { TownScene } from '../../src/town/TownScene'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { emptyPersonalContribution } from '../../src/combat/CommandMerit'
import { AIState, Faction, type NPC } from '../../src/world/NPC'
import { TownCavalryPatrolController } from '../../src/town/TownCavalryPatrolController'
import type { TownActorSpec } from '../../src/town/TownRules'
import type { TownEagleGarrisonController } from '../../src/town/TownEagleGarrisonController'
import type { TownEagleDuty } from '../../src/town/TownEagleGarrisonState'
import type { Mount } from '../../src/world/Mount'
import type { CombatOwnership } from '../../src/combat/CombatFaction'
import { changeTownEquipment, type TownEquipmentContext } from '../../src/career/CareerTownEquipment'
import { TOWN_COMMAND_RETURN_ID } from '../../src/town/TownCommandSquadController'

/** Status-only caller seam: zero NPC/Mount/TownWorld. The existing refit suite owns combat-contact timing. */
function fixture(id = 'cavalry-training:melee_cavalry:0') {
  const profile = { ...createCareerProfile('roman'), rank: 'commander' as const, totalMerit: 60000,
    townCommandSquad: { type: 'town-command' as const, townFaction: 'roman' as const, squadId: 1 as const,
      actorIds: [id], contribution: emptyPersonalContribution(), authorized: true,
      state: 'TRAINING' as 'TRAINING' | 'RETURNING', sceneKey: 'town-home', members: {} },
  }
  const npc = { combatantId: id, currentState: AIState.IDLE, dead: false, isFalling: false, inCombat: false,
    mount: null as Pick<Mount, 'isAirborne'> | null,
    faction: Faction.PLAYER, hostileToPlayer: false, tacticalOrder: 'defend', combatOwnership: 'town-command' as CombatOwnership | undefined }
  const patrol: Pick<TownCavalryPatrolController, 'isRefitting' | 'combatEnabled'> = { isRefitting: () => false, combatEnabled: () => false }
  const eagleGarrison: Pick<TownEagleGarrisonController, 'dutyFor' | 'isPlayerCommandOwned'> = {
    dutyFor: () => undefined, isPlayerCommandOwned: () => false,
  }
  const state = { profile, residents: [{ spec: { id }, npc }], event: { hostile: false, allActors: new Map([[id, npc]]) },
    player: { dead: false }, personalSquad: { state: 'RESERVE' },
    canRefitSquad: () => true, patrol, civilianCommand: { returningActorIds: [] as string[] },
    eagleGarrison,
  }
  // Only the renderer-free eligibility method is exercised; actor and mount behavior have their own real-actor owners.
  const town = Object.assign(Object.create(TownScene.prototype), state) as typeof state & { townEquipmentContext(): TownEquipmentContext; usesNativeRangerCat(): boolean }
  return { id, npc, town, read: () => town.townEquipmentContext() }
}

/** Coordinator state is supplied at the caller seam; physical eagle return/refit is owned by TownEagleGarrisonRuntime. */
function groundedEagleFixture(duty: TownEagleDuty) {
  const f = fixture('town-eagle-rider:1')
  f.npc.combatOwnership = undefined; f.npc.faction = Faction.TOWN
  f.npc.mount = { isAirborne: false }
  f.town.eagleGarrison.dutyFor = () => duty
  return f
}

const commandOwnedEagles = (['mounted-waiting', 'standby', 'resting'] as const).flatMap(duty => [
  { duty, owner: 'actor tag' as const }, { duty, owner: 'garrison coordinator' as const },
])

describe('Town equipment actual caller readiness and ownership', () => {
  it('allows the permanently authorized peaceful training residents instead of treating Town command ownership as a mission lock', () => {
    const f = fixture()
    expect(f.read().safeActorIds.has(f.id)).toBe(true)
    expect(f.read().townFaction).toBe('roman')
  })
  it('excludes an ENGAGING Patrol-owned resident even while its NPC is IDLE, then allows peaceful Patrol states', () => {
    const f = fixture('town-patrol:a:captain')
    const spec: TownActorSpec = { id: f.id, role: 'melee_cavalry', unitKind: 'sword_cavalry', duty: 'patrol',
      patrolId: 'A', patrolLeader: true, mounted: true, training: false, tier: 4, index: 0,
      assaultObjective: false, x: 0, z: 0 }
    const npc = Object.assign(f.npc, { currentState: AIState.IDLE, combatPosition: new THREE.Vector3(), group: new THREE.Group() })
    // The real Patrol owner only needs identity and an anchor here; no NPC/Mount or full 20-member squad is materialized.
    const patrol = new TownCavalryPatrolController([{ spec, npc: npc as unknown as NPC }])
    f.town.patrol = patrol
    const squad = patrol.squads[0]
    squad.state = 'ENGAGING'; squad.participants.add(f.id)

    expect(npc.currentState).toBe(AIState.IDLE)
    expect(npc.inCombat).toBe(false)
    expect(f.read().safeActorIds.has(f.id)).toBe(false)
    squad.state = 'PATROLLING'
    expect(f.read().safeActorIds.has(f.id)).toBe(true)
    squad.state = 'PAUSED'
    expect(f.read().safeActorIds.has(f.id)).toBe(true)
  })
  it.each(commandOwnedEagles)('keeps a grounded IDLE eagle in $duty unavailable while its $owner owns commands', ({ duty, owner }) => {
    const f = groundedEagleFixture(duty)
    if (owner === 'actor tag') f.npc.combatOwnership = 'town-eagle-command'
    else f.town.eagleGarrison.isPlayerCommandOwned = () => true

    expect(f.npc.currentState).toBe(AIState.IDLE)
    expect(f.npc.inCombat).toBe(false)
    expect(f.npc.mount?.isAirborne).toBe(false)
    expect(f.read().safeActorIds.has(f.id)).toBe(false)
  })
  it('allows grounded native eagle duties when all player command ownership is absent', () => {
    const f = groundedEagleFixture('standby')
    for (const duty of ['mounted-waiting', 'standby', 'resting'] as const) {
      f.town.eagleGarrison.dutyFor = () => duty
      expect(f.read().safeActorIds.has(f.id), `unowned native eagle with ${duty} duty`).toBe(true)
    }
  })
  it('keeps a dismissed eagle unavailable through native return and refit readiness before allowing standby', () => {
    const f = groundedEagleFixture('mounted-waiting')
    f.npc.combatOwnership = 'town-eagle-command'; f.town.eagleGarrison.isPlayerCommandOwned = () => true
    expect(f.read().safeActorIds.has(f.id)).toBe(false)

    f.npc.combatOwnership = undefined; f.town.eagleGarrison.isPlayerCommandOwned = () => false
    for (const duty of ['return-queue', 'returning', 'walking-to-standby'] as const) {
      f.town.eagleGarrison.dutyFor = () => duty
      expect(f.read().safeActorIds.has(f.id), `released eagle with native ${duty} duty`).toBe(false)
    }
    f.town.eagleGarrison.dutyFor = () => 'standby'; f.town.canRefitSquad = () => false
    expect(f.read().safeActorIds.has(f.id)).toBe(false)
    f.town.canRefitSquad = () => true
    expect(f.read().safeActorIds.has(f.id)).toBe(true)
  })
  it.each(['dead', 'isFalling', 'inCombat'] as const)('excludes a %s resident without spawning or altering any actor', flag => {
    const f = fixture(); f.npc[flag] = true
    expect(f.read().safeActorIds.has(f.id)).toBe(false)
  })
  it('rejects a foreign mission owner and an enemy with the same stable actor ID', () => {
    const f = fixture(); f.npc.combatOwnership = 'mission-official'
    expect(f.read().safeActorIds.has(f.id)).toBe(false)
    f.npc.combatOwnership = 'town-command'; f.npc.faction = Faction.ENEMY
    expect(f.read().safeActorIds.has(f.id)).toBe(false)
  })
  it('keeps the native Maki/Cat binding only while the persisted native token still belongs to Maki', () => {
    const f = fixture()
    expect(f.town.usesNativeRangerCat()).toBe(true)
    f.town.profile.ownedMounts = ['horse']
    const result = changeTownEquipment(() => f.town.profile, { townFaction: 'roman', peaceful: true,
      personalState: 'RESERVE', safeActorIds: new Set(['ranger']) }, 'ranger', 'mount', 'horse', next => {
        Object.assign(f.town.profile, next); return true
      })
    expect(result.changed).toBe(true)
    expect(f.town.usesNativeRangerCat()).toBe(false)
  })
  it('requires the registered instance, not merely a copied actor ID or UI selection', () => {
    const f = fixture(); f.town.event.allActors.set(f.id, { ...f.npc })
    expect(f.read().safeActorIds.has(f.id)).toBe(false)
  })
  it('keeps Town, patrol, civilian and garrison return owners unavailable until their physical return completes', () => {
    const f = fixture(); f.town.profile.townCommandSquad.state = 'RETURNING'
    f.town.profile.townCommandSquad.members = { [f.id]: { status: 'deployed', order: 'formation',
      formation: { commandId: TOWN_COMMAND_RETURN_ID, position: { x: 0, z: 0, yaw: 0 }, reached: false } } }
    expect(f.read().safeActorIds.has(f.id)).toBe(false)
    f.town.profile.townCommandSquad.state = 'TRAINING'; f.town.profile.townCommandSquad.members = {}
    f.town.patrol.isRefitting = () => true
    expect(f.read().safeActorIds.has(f.id)).toBe(false)
    f.town.patrol.isRefitting = () => false; f.town.civilianCommand.returningActorIds = [f.id]
    expect(f.read().safeActorIds.has(f.id)).toBe(false)
    f.town.civilianCommand.returningActorIds = []; f.town.eagleGarrison.dutyFor = () => 'returning'
    expect(f.read().safeActorIds.has(f.id)).toBe(false)
    f.town.eagleGarrison.dutyFor = () => 'resting'
    expect(f.read().safeActorIds.has(f.id)).toBe(true)
  })
})
