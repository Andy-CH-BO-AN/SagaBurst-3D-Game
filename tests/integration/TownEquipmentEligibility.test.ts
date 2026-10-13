import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { TownScene } from '../../src/town/TownScene'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { emptyPersonalContribution } from '../../src/combat/CommandMerit'
import { AIState, Faction, type NPC } from '../../src/world/NPC'
import { TownCavalryPatrolController } from '../../src/town/TownCavalryPatrolController'
import type { TownActorSpec } from '../../src/town/TownRules'
import type { CombatOwnership } from '../../src/combat/CombatFaction'
import { changeTownEquipment, type TownEquipmentContext } from '../../src/career/CareerTownEquipment'

/** Status-only caller seam: zero NPC/Mount/TownWorld. The existing refit suite owns combat-contact timing. */
function fixture(id = 'cavalry-training:melee_cavalry:0') {
  const profile = { ...createCareerProfile('roman'), rank: 'commander' as const, totalMerit: 60000,
    townCommandSquad: { type: 'town-command' as const, townFaction: 'roman' as const, squadId: 1 as const,
      actorIds: [id], contribution: emptyPersonalContribution(), authorized: true,
      state: 'TRAINING' as 'TRAINING' | 'RETURNING', sceneKey: 'town-home' },
  }
  const npc = { combatantId: id, dead: false, isFalling: false, inCombat: false, mount: null,
    faction: Faction.PLAYER, hostileToPlayer: false, tacticalOrder: 'defend', combatOwnership: 'town-command' as CombatOwnership }
  const patrol: Pick<TownCavalryPatrolController, 'isRefitting' | 'combatEnabled'> = { isRefitting: () => false, combatEnabled: () => false }
  const state = { profile, residents: [{ spec: { id }, npc }], event: { hostile: false, allActors: new Map([[id, npc]]) },
    player: { dead: false }, personalSquad: { state: 'RESERVE' },
    canRefitSquad: () => true, patrol, civilianCommand: { returningActorIds: [] as string[] },
    eagleGarrison: { dutyFor: () => undefined as string | undefined },
  }
  // Only the renderer-free eligibility method is exercised; actor and mount behavior have their own real-actor owners.
  const town = Object.assign(Object.create(TownScene.prototype), state) as typeof state & { townEquipmentContext(): TownEquipmentContext; usesNativeRangerCat(): boolean }
  return { id, npc, town, read: () => town.townEquipmentContext() }
}

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
    expect(f.read().safeActorIds.has(f.id)).toBe(false)
    f.town.profile.townCommandSquad.state = 'TRAINING'; f.town.patrol.isRefitting = () => true
    expect(f.read().safeActorIds.has(f.id)).toBe(false)
    f.town.patrol.isRefitting = () => false; f.town.civilianCommand.returningActorIds = [f.id]
    expect(f.read().safeActorIds.has(f.id)).toBe(false)
    f.town.civilianCommand.returningActorIds = []; f.town.eagleGarrison.dutyFor = () => 'returning'
    expect(f.read().safeActorIds.has(f.id)).toBe(false)
    f.town.eagleGarrison.dutyFor = () => 'resting'
    expect(f.read().safeActorIds.has(f.id)).toBe(true)
  })
})
