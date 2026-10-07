import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { TOWN_SITES, townMilitaryEquipment } from '../src/town/TownRules'
import { MountType } from '../src/world/Mount'
import { getTerrainHeight } from '../src/world/Terrain'
import { installTownPatrolFixtureEnvironment } from './helpers/townPatrolFixture'

vi.mock('../src/world/CorgiVisual', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/world/CorgiVisual')>()),
  CorgiVisual: (await import('./helpers/gameplayQuadrupedVisual')).GameplayQuadrupedVisualDouble,
}))
vi.mock('../src/world/BlackCatVisual', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/world/BlackCatVisual')>()),
  BlackCatVisual: (await import('./helpers/gameplayQuadrupedVisual')).GameplayQuadrupedVisualDouble,
}))

const createTownPatrolFixture = installTownPatrolFixtureEnvironment()


function expectBarracksRefitPoint(point: { x: number; z: number; yaw?: number }) {
  const barracks = TOWN_SITES.barracks, dx = point.x - barracks.x, dz = point.z - barracks.z
  const side = Math.cos(barracks.yaw) * dx - Math.sin(barracks.yaw) * dz
  const forward = Math.sin(barracks.yaw) * dx + Math.cos(barracks.yaw) * dz
  // The actual hut is at (34, 30); its clear southern courtyard is local side 22..40, forward -31.5..0.
  expect(side).toBeGreaterThanOrEqual(22 - 1e-8); expect(side).toBeLessThanOrEqual(40 + 1e-8)
  expect(forward).toBeGreaterThanOrEqual(-31.5 - 1e-8); expect(forward).toBeLessThanOrEqual(1e-8)
  if (point.yaw !== undefined) expect(point.yaw).toBe(barracks.yaw)
}

describe('Town patrol leadership and ownership lifecycle', () => {
  it('elects acting leaders, preserves metadata and mission orders, and reclaims Captain only after physically catching up', () => {
    const h = createTownPatrolFixture(), squad = h.controller.squads[0], [captain, first, second] = h.residents
    h.stepFrame(); expect(squad.activeLeaderActorId).toBe(captain.spec.id)
    h.controller.relinquish(captain.spec.id)
    const missionGoal = new THREE.Vector3(120, 0, 70)
    captain.npc.assignFormationTarget(987, missionGoal, new THREE.Vector3(1, 0, 0))
    h.stepFrames(20); expect(squad.activeLeaderActorId).toBe(first.spec.id); expect(captain.npc.formationCommandId).toBe(987)
    expect(first.spec.tier).toBe(2); expect(first.spec.patrolLeader).toBe(false); expect(captain.spec.patrolLeader).toBe(true)
    h.controller.relinquish(first.spec.id); h.stepFrame(); expect(squad.activeLeaderActorId).toBe(second.spec.id)
    captain.homeMount.group.position.set(-40, getTerrainHeight(-40, 60), 60)
    const before = captain.npc.combatPosition.clone()
    h.controller.reclaim(captain.spec.id); h.stepFrame()
    expect(squad.activeLeaderActorId).toBe(second.spec.id)
    expect(captain.npc.combatPosition.distanceTo(before)).toBeLessThan(2)
    h.advanceUntil(() => squad.activeLeaderActorId === captain.spec.id, {
      maxSimulationSeconds: 200, failureMessage: 'reclaimed captain must resume as patrol leader',
    })
    expect(squad.activeLeaderActorId).toBe(captain.spec.id)
    expect(second.npc.activeFollowTarget).toBe(captain.npc)
  })

  it('pauses an empty squad without losing progress and skips dead or unmounted candidates', () => {
    const h = createTownPatrolFixture(), squad = h.controller.squads[0]
    h.advanceUntil(() => squad.departureIndex > 0, {
      maxSimulationSeconds: 100, failureMessage: 'squad must advance along its departure path',
    })
    const progress = [squad.waypoint, squad.departureIndex]
    for (const r of squad.members) h.controller.relinquish(r.spec.id)
    h.stepFrames(10); expect(squad.state).toBe('PAUSED'); expect([squad.waypoint, squad.departureIndex]).toEqual(progress)
    const [captain, first, second, third] = h.residents
    captain.npc.takeDamage(999999); first.npc.dismountFromMount()
    h.controller.reclaim(captain.spec.id); h.controller.reclaim(first.spec.id); h.controller.reclaim(second.spec.id); h.controller.reclaim(third.spec.id)
    h.stepFrame(); expect(squad.activeLeaderActorId).toBe(second.spec.id)
    second.npc.takeDamage(999999); h.stepFrame(); expect(squad.activeLeaderActorId).toBe(third.spec.id)
  })

  it('restarts the barracks departure after siege instead of reusing an exhausted waypoint index', () => {
    const h = createTownPatrolFixture(), squad = h.controller.squads[0]

    // Reach the normal patrol loop first, so departureIndex is exactly one past
    // the final departure waypoint before the siege takes ownership.
    h.advanceUntil(() => squad.state === 'PATROLLING', {
      maxSimulationSeconds: 200, failureMessage: 'squad must finish its departure before siege recall',
    })
    expect(squad.state).toBe('PATROLLING')
    expect(squad.departureIndex).toBe(squad.departure.waypoints.length)

    h.controller.recallForSiege()
    h.controller.releaseSiegeOwnership()

    expect(squad.state).toBe('BARRACKS')
    expect(squad.departureIndex).toBe(0)
    expect(squad.waypoint).toBe(squad.departure.phase)

    // Defense settlement sends Patrol identities through beginMissionReturn.
    // A casualty refits immediately, then the next peaceful frame must have a
    // valid departure waypoint instead of reading goal.x from undefined.
    const captain = squad.members.find(member => member.spec.patrolLeader)!
    captain.npc.takeDamage(999999)
    expect(h.controller.beginMissionReturn(captain.spec.id)).toBe(true)
    expect(h.controller.returnStateFor(captain.spec.id)).toBe('REJOIN_PATROL')
    expect(() => h.stepFrame()).not.toThrow()
    expect(squad.state).toBe('MOVING_TO_ROUTE')
  })

  it('hands all forty positions to hostile AI without teleporting or issuing later patrol commands', () => {
    const h = createTownPatrolFixture(); h.stepFrames(20)
    const positions = h.residents.map(r => r.npc.combatPosition.clone())
    const travels = h.residents.map(r => vi.spyOn(r.npc, 'updateTownTravel'))
    h.controller.stopForHostility()
    h.residents.forEach(r => r.npc.beginTownHostility())
    h.stepFrames(10)
    h.residents.forEach((r, i) => {
      expect(r.npc.combatPosition.equals(positions[i])).toBe(true)
      expect(r.npc.hostileToPlayer).toBe(true); expect(r.npc.activeFollowTarget).toBeNull()
      expect(travels[i]).not.toHaveBeenCalled()
    })
  })

  it('cancels a pending barracks refit and preserves defeated Patrol identities during hostility', () => {
    const h = createTownPatrolFixture(), resident = h.residents[0]
    h.controller.beginMissionReturn(resident.spec.id)
    resident.npc.takeDamage(999999)
    h.controller.stopForHostility(); h.residents.forEach(r => r.npc.beginTownHostility())
    // Ten simulated seconds must not revive a defeated actor or resume refit.
    h.stepFrames(100)
    expect(resident.npc.dead).toBe(true); expect(resident.npc.respawnEnabled).toBe(false)
    expect(h.controller.returnStateFor(resident.spec.id)).toBeNull()
    expect(h.controller.beginMissionReturn(resident.spec.id)).toBe(false)
  })

  it('chooses another deputy when the acting leader is borrowed while a refitted Captain remains far away', () => {
    const h = createTownPatrolFixture(), [captain, deputy, replacement] = h.residents, squad = h.controller.squads[0]
    h.advanceUntil(() => h.controller.squads.every(s => s.state === 'PATROLLING'), {
      maxSimulationSeconds: 200, failureMessage: 'both squads must reach the exterior patrol loop',
    })
    h.controller.relinquish(captain.spec.id); h.stepFrames(20)
    expect(squad.activeLeaderActorId).toBe(deputy.spec.id)
    captain.npc.takeDamage(999999)
    h.controller.beginMissionReturn(captain.spec.id)
    expect(h.controller.returnStateFor(captain.spec.id)).toBe('REJOIN_PATROL')
    expect(captain.npc.combatPosition.distanceTo(replacement.npc.combatPosition)).toBeGreaterThan(9)
    h.controller.relinquish(deputy.spec.id); h.stepFrame()
    expect(squad.activeLeaderActorId).toBe(replacement.spec.id)
    expect(captain.npc.activeFollowTarget).toBe(replacement.npc)
    h.advanceUntil(() => squad.activeLeaderActorId === captain.spec.id, {
      maxSimulationSeconds: 250, failureMessage: 'captain must physically rejoin and reclaim leadership',
    })
    expect(squad.activeLeaderActorId).toBe(captain.spec.id)
  })

  it('elects a deputy when a borrowed Captain is restored at Barracks before the next frame', () => {
    const h = createTownPatrolFixture({ withWorld: true }), [captain, deputy] = h.residents, squad = h.controller.squads[0]
    h.advanceUntil(() => h.controller.squads.every(s => s.state === 'PATROLLING'), {
      maxSimulationSeconds: 200, failureMessage: 'both squads must reach the exterior patrol loop',
    })
    expect(squad.activeLeaderActorId).toBe(captain.spec.id)
    h.controller.relinquish(captain.spec.id)
    captain.npc.takeDamage(999999)
    h.controller.beginMissionReturn(captain.spec.id)
    expectBarracksRefitPoint(captain.npc.combatPosition)
    expect(h.controller.isReserveAvailable(captain.spec.id)).toBe(true)
    expect(captain.npc.combatPosition.distanceTo(deputy.npc.combatPosition)).toBeGreaterThan(9)
    h.stepFrame()
    expect(squad.activeLeaderActorId).toBe(deputy.spec.id)
    expect(captain.npc.activeFollowTarget).toBe(deputy.npc)
    expect(h.controller.returnStateFor(captain.spec.id)).toBe('REJOIN_PATROL')
  })

  it('lets a refitted Captain lead when it is the only remaining available squad member', () => {
    const h = createTownPatrolFixture(), captain = h.residents[0], squad = h.controller.squads[0]
    h.advanceUntil(() => squad.departureIndex > 0, {
      maxSimulationSeconds: 100, failureMessage: 'squad must advance along its departure path',
    })
    for (const member of squad.members) h.controller.relinquish(member.spec.id)
    h.stepFrame(); expect(squad.state).toBe('PAUSED')
    captain.npc.takeDamage(999999); h.controller.beginMissionReturn(captain.spec.id)
    h.stepFrame()
    expect(squad.activeLeaderActorId).toBe(captain.spec.id)
    expect(h.controller.returnStateFor(captain.spec.id)).toBeNull()
  })

  it('replaces a dead Captain with the same actor and original Corgi at barracks, then retains the deputy until physical reunion', () => {
    const h = createTownPatrolFixture({ withWorld: true }), [captain, deputy] = h.residents, squad = h.controller.squads[0]
    h.advanceUntil(() => h.controller.squads.every(s => s.state === 'PATROLLING'), {
      maxSimulationSeconds: 200, failureMessage: 'both squads must reach the exterior patrol loop',
    })
    h.controller.relinquish(captain.spec.id); h.stepFrames(20)
    expect(squad.activeLeaderActorId).toBe(deputy.spec.id)
    const npc = captain.npc, actorId = npc.combatantId, mount = captain.homeMount
    npc.applyTemporaryCombatLoadout(townMilitaryEquipment('roman', 'lancer_cavalry').loadout, 4)
    npc.takeDamage(999999); mount.takeDamage(999999)
    const restore = vi.spyOn(npc, 'restoreForTown')
    h.controller.beginMissionReturn(actorId)
    expect(captain.npc).toBe(npc); expect(npc.combatantId).toBe(actorId)
    expect(restore).toHaveBeenCalledTimes(1)
    expectBarracksRefitPoint(restore.mock.calls[0][0]!)
    expectBarracksRefitPoint(npc.combatPosition)
    expect(npc.dead).toBe(false); expect(npc.hpRatio).toBe(1); expect(npc.tier).toBe(4)
    expect(npc.meleeWeaponId).toBe(townMilitaryEquipment('roman', captain.spec).loadout.meleeWeaponId)
    expect(npc.mount).toBe(mount); expect(mount.type).toBe(MountType.CORGI); expect(mount.currentHp).toBe(mount.maxHp)
    expect(h.controller.isReserveAvailable(actorId)).toBe(true)
    h.stepFrame()
    expect(squad.activeLeaderActorId).toBe(deputy.spec.id)
    expect(h.controller.returnStateFor(actorId)).toBe('REJOIN_PATROL')
    h.advanceUntil(() => squad.activeLeaderActorId === actorId, {
      maxSimulationSeconds: 250, failureMessage: 'captain must physically rejoin and reclaim leadership',
    })
    expect(squad.activeLeaderActorId).toBe(actorId)
    expect(h.controller.returnStateFor(actorId)).toBeNull()
    expect(deputy.npc.activeFollowTarget).toBe(npc)
  })

  it('starts a new Town controller with the normal Patrol startup formation and no previous return state', () => {
    const h = createTownPatrolFixture(), resident = h.residents[1]
    h.controller.relinquish(resident.spec.id)
    resident.homeMount.group.position.set(50, getTerrainHeight(50, 140), 140)
    h.controller.beginMissionReturn(resident.spec.id)
    expect(h.controller.isReserveAvailable(resident.spec.id)).toBe(false)
    const reload = createTownPatrolFixture(), sameActor = reload.residents.find(r => r.spec.id === resident.spec.id)!
    expect(reload.controller.returnStateFor(sameActor.spec.id)).toBeNull()
    expect(reload.controller.isReserveAvailable(sameActor.spec.id)).toBe(true)
    expect(sameActor.npc.combatPosition.x).toBe(sameActor.spec.x)
    expect(sameActor.npc.combatPosition.z).toBe(sameActor.spec.z)
    expect(sameActor.npc.hpRatio).toBe(1)
    const position = sameActor.npc.combatPosition.clone()
    reload.stepFrames(20)
    expect(sameActor.npc.combatPosition.distanceTo(position)).toBeGreaterThan(1)
  })
})
