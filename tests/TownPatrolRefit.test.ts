import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { TOWN_SITES, townCaptainProfile } from '../src/town/TownRules'
import { TownCavalryPatrolController } from '../src/town/TownCavalryPatrolController'
import { MountType, mountTypeFromId } from '../src/world/Mount'
import { getTerrainHeight, isObstaclePathClear } from '../src/world/Terrain'
import { advanceUntil } from './helpers/simulation'
import { createTownPatrolFixture } from './helpers/townPatrolFixture'

function expectBarracksRefitPoint(point: { x: number; z: number; yaw?: number }) {
  const barracks = TOWN_SITES.barracks, dx = point.x - barracks.x, dz = point.z - barracks.z
  const side = Math.cos(barracks.yaw) * dx - Math.sin(barracks.yaw) * dz
  const forward = Math.sin(barracks.yaw) * dx + Math.cos(barracks.yaw) * dz
  // The actual hut is at (34, 30); its clear southern courtyard is local side 22..40, forward -31.5..0.
  expect(side).toBeGreaterThanOrEqual(22 - 1e-8); expect(side).toBeLessThanOrEqual(40 + 1e-8)
  expect(forward).toBeGreaterThanOrEqual(-31.5 - 1e-8); expect(forward).toBeLessThanOrEqual(1e-8)
  if (point.yaw !== undefined) expect(point.yaw).toBe(barracks.yaw)
}

describe('Town patrol return, refit and mount lifecycle', () => {
  it.each([
    ['roman', 'captain'], ['roman', 'mount'], ['viking', 'captain'], ['viking', 'mount'],
  ] as const)('keeps both %s Captains on their canonical mount through %s death, refit and Town reload', (faction, casualty) => {
    const h = createTownPatrolFixture({ faction, withWorld: true }), expected = mountTypeFromId(townCaptainProfile(faction).mountOverride)
    for (const resident of h.residents.filter(r => r.spec.patrolLeader)) {
      const mount = resident.homeMount
      h.controller.relinquish(resident.spec.id)
      mount.group.position.set(20, getTerrainHeight(20, 140), 140)
      if (casualty === 'captain') resident.npc.takeDamage(999999)
      else mount.takeDamage(999999)
      h.controller.beginMissionReturn(resident.spec.id)
      h.advanceUntil(() => h.controller.returnStateFor(resident.spec.id) === 'REJOIN_PATROL', {
        maxSimulationSeconds: 250, failureMessage: `${resident.spec.id} must finish barracks refit`,
      })
      expect(h.controller.returnStateFor(resident.spec.id)).toBe('REJOIN_PATROL')
      expect(resident.npc.dead).toBe(false); expect(resident.npc.mount).toBe(mount)
      expect(mount.dead).toBe(false); expect(mount.type).toBe(expected)
    }
    const reload = createTownPatrolFixture({ faction })
    expect(reload.residents.filter(r => r.homeMount.type === expected)).toHaveLength(2)
    expect(reload.residents.filter(r => r.homeMount.type === MountType.HORSE)).toHaveLength(38)
  })

  it.each(['roman', 'viking'] as const)('restores all 40 %s identities at distinct, navigable real Barracks slots independent of startup positions and roster order', faction => {
    const h = createTownPatrolFixture({ faction, withWorld: true })
    const controller = new TownCavalryPatrolController([...h.residents].reverse())
    const points: THREE.Vector3[] = []
    for (const resident of h.residents) {
      const npc = resident.npc, mount = resident.homeMount, actorId = resident.spec.id
      const restoreImplementation = npc.restoreForTown.bind(npc)
      const restore = vi.spyOn(npc, 'restoreForTown')
      // Changing the Patrol startup formation must never move the Barracks refit area.
      resident.spec.x = 210 + resident.spec.index; resident.spec.z = -210
      controller.relinquish(actorId); npc.takeDamage(999999); mount.takeDamage(999999)
      restore.mockImplementation(destination => {
        expect(controller.returnStateFor(actorId)).toBe('REFIT')
        expect(controller.isReserveAvailable(actorId)).toBe(false)
        return restoreImplementation(destination)
      })
      expect(controller.beginMissionReturn(actorId)).toBe(true)
      const point = restore.mock.calls[0][0]!
      expectBarracksRefitPoint(point)
      const position = npc.combatPosition.clone()
      expect(isObstaclePathClear(position, position, 1.1, 2.6, 0, h.obstacles), actorId).toBe(true)
      expect(h.navigation.areConnected(position, controller.route[0]), actorId).toBe(true)
      for (const other of points) expect(Math.hypot(position.x - other.x, position.z - other.z), actorId).toBeGreaterThanOrEqual(4.5 - 1e-8)
      points.push(position)
      expect(resident.npc).toBe(npc); expect(npc.combatantId).toBe(actorId)
      expect(npc.mount).toBe(mount); expect(npc.hpRatio).toBe(1); expect(mount.currentHp).toBe(mount.maxHp)
      expect(mount.type).toBe(resident.spec.patrolLeader ? mountTypeFromId(townCaptainProfile(faction).mountOverride) : MountType.HORSE)
      expect(controller.returnStateFor(actorId)).toBe('REJOIN_PATROL')
      expect(controller.isReserveAvailable(actorId)).toBe(true)
    }
    expect(points).toHaveLength(40)
  })

  it('finishes a rear ordinary follower rejoin at its own slot while remaining farther than nine metres from the leader', () => {
    const h = createTownPatrolFixture({ withWorld: true }), resident = h.residents[19], squad = h.controller.squads[0]
    h.advanceUntil(() => h.controller.squads.every(s => s.state === 'PATROLLING'), {
      maxSimulationSeconds: 200, failureMessage: 'both squads must reach the exterior patrol loop',
    })
    expect(h.controller.relinquish(resident.spec.id)).toBe(true)
    resident.npc.takeDamage(999999)
    h.controller.beginMissionReturn(resident.spec.id)
    expect(h.controller.returnStateFor(resident.spec.id)).toBe('REJOIN_PATROL')
    advanceUntil(
      () => h.controller.returnStateFor(resident.spec.id) === null,
      () => {
        const previous = resident.npc.combatPosition.clone()
        h.stepFrame()
        expect(resident.npc.combatPosition.distanceTo(previous)).toBeLessThan(2)
      },
      { maxSimulationSeconds: 250, secondsPerStep: .1, failureMessage: 'resident must complete physical return' },
    )
    expect(resident.npc.activeFollowSlotIndex).toBeGreaterThanOrEqual(15)
    expect(resident.npc.activeFollowTarget).toBe(squad.members.find(r => r.spec.id === squad.activeLeaderActorId)!.npc)
    expect(h.controller.returnStateFor(resident.spec.id)).toBeNull()
    expect(resident.npc.combatPosition.distanceTo(resident.npc.activeFollowTarget!.combatPosition)).toBeGreaterThan(9)
    expect(resident.npc.isFormationTargetReached(-1)).toBe(true)
  })

  it.each([1, 0, 20])('resident %i walks through real navigation after its Horse dies and replaces it only at barracks', index => {
    const h = createTownPatrolFixture({ withWorld: true }), resident = h.residents[index]
    h.advanceUntil(() => h.controller.squads.every(s => s.state === 'PATROLLING'), {
      maxSimulationSeconds: 200, failureMessage: 'both squads must reach the exterior patrol loop',
    })
    h.controller.relinquish(resident.spec.id)
    resident.homeMount.group.position.set(20, getTerrainHeight(20, 140), 140)
    resident.homeMount.takeDamage(999999); resident.npc.takeDamage(30)
    const horsePosition = resident.homeMount.group.position.clone(), hp = resident.npc.hp
    const restoreHorse = vi.spyOn(resident.homeMount, 'restoreForTown')
    h.controller.beginMissionReturn(resident.spec.id)
    expect(resident.npc.isMounted).toBe(false)
    // During these two seconds on foot, the dead mount must remain at the casualty site.
    h.stepFrames(20)
    expect(resident.npc.combatPosition.distanceTo(horsePosition)).toBeGreaterThan(1)
    expect(resident.npc.hp).toBe(hp); expect(resident.homeMount.dead).toBe(true)
    expect(resident.homeMount.group.position.equals(horsePosition)).toBe(true); expect(restoreHorse).not.toHaveBeenCalled()
    advanceUntil(
      () => h.controller.returnStateFor(resident.spec.id) === 'REJOIN_PATROL',
      () => {
        const previous = resident.npc.combatPosition.clone()
        h.stepFrame()
        expect(resident.npc.encounterIsAlerted).toBe(false)
        expect(h.controller.combatEnabled(resident.npc)).toBe(false)
        expect(resident.npc.combatPosition.distanceTo(previous)).toBeLessThan(2)
      },
      { maxSimulationSeconds: 250, secondsPerStep: .1, failureMessage: 'resident must complete physical return' },
    )
    expect(restoreHorse).toHaveBeenCalledTimes(1)
    const [x, z, yaw] = restoreHorse.mock.calls[0]
    expectBarracksRefitPoint({ x, z, yaw })
    expect(resident.npc.combatPosition.x).toBe(x); expect(resident.npc.combatPosition.z).toBe(z)
    expect(h.controller.returnStateFor(resident.spec.id)).toBe('REJOIN_PATROL')
    expect(resident.npc.mount).toBe(resident.homeMount); expect(resident.npc.hpRatio).toBe(1)
    expect(resident.homeMount.dead).toBe(false); expect(resident.homeMount.type).toBe(resident.spec.patrolLeader ? MountType.CORGI : MountType.HORSE)
    expect(resident.npc.encounterIsAlerted).toBe(false)
    expect(resident.npc.encounterAggroState).toBe('idle')
    expect(h.controller.combatEnabled(resident.npc)).toBe(false)
  })
})
