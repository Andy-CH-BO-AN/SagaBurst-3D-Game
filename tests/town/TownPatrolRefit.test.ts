import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { TOWN_SITES, townRoster, townPatrolRefitPoint } from '../../src/town/TownRules'
import { TownCavalryPatrolController } from '../../src/town/TownCavalryPatrolController'
import { MountType } from '../../src/world/Mount'
import { getTerrainHeight, isObstaclePathClear } from '../../src/world/Terrain'
import { advanceUntil } from '../helpers/simulation'
import { installTownPatrolFixtureEnvironment } from '../helpers/townPatrolFixture'

vi.mock('../../src/world/CorgiVisual', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/world/CorgiVisual')>()),
  CorgiVisual: (await import('../helpers/gameplayQuadrupedVisual')).GameplayQuadrupedVisualDouble,
}))
vi.mock('../../src/world/BlackCatVisual', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/world/BlackCatVisual')>()),
  BlackCatVisual: (await import('../helpers/gameplayQuadrupedVisual')).GameplayQuadrupedVisualDouble,
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

describe('Town patrol return, refit and mount lifecycle', () => {
  it.each(['captain', 'mount'] as const)('keeps both Roman Captains on their canonical mount through %s death, refit and Town reload', casualty => {
    const h = createTownPatrolFixture({ faction: 'roman', patrolMembers: { A: 1, B: 1 } }), expected = MountType.CORGI
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
    const reload = createTownPatrolFixture({ faction: 'roman', patrolMembers: { A: 1, B: 1 } })
    expect(reload.residents.filter(r => r.homeMount.type === expected)).toHaveLength(2)
    expect(reload.residents.filter(r => r.homeMount.type === MountType.HORSE)).toHaveLength(0)
  })

  it('maps all 40 production refit specs to distinct navigable Barracks points without actors, independent of startup positions', () => {
    const h = createTownPatrolFixture({ withWorld: true, patrolMembers: {} })
    const points: THREE.Vector3[] = []
    for (const spec of townRoster().filter(spec => spec.duty === 'patrol').reverse()) {
      const movedSpec = { ...spec, x: 210 + spec.index, z: -210 }
      const point = townPatrolRefitPoint(movedSpec)
      expectBarracksRefitPoint(point)
      const position = new THREE.Vector3(point.x, getTerrainHeight(point.x, point.z), point.z)
      expect(isObstaclePathClear(position, position, 1.1, 2.6, 0, h.obstacles), spec.id).toBe(true)
      expect(h.navigation.areConnected(position, h.controller.route[0]), spec.id).toBe(true)
      for (const other of points) expect(Math.hypot(position.x - other.x, position.z - other.z), spec.id).toBeGreaterThanOrEqual(4.5 - 1e-8)
      points.push(position)
    }
    expect(points).toHaveLength(40)
  })

  it('restores one ordinary rider and its mount at REFIT before making it available for rejoin', () => {
    const h = createTownPatrolFixture({ patrolMembers: { A: 2 } }), resident = h.residents[1]
    const { npc, homeMount: mount, spec } = resident, controller = new TownCavalryPatrolController([...h.residents].reverse())
    const restoreImplementation = npc.restoreForTown.bind(npc), restore = vi.spyOn(npc, 'restoreForTown')
    spec.x = 210; spec.z = -210
    controller.relinquish(spec.id); npc.takeDamage(999999); mount.takeDamage(999999)
    restore.mockImplementation(destination => {
      expect(controller.returnStateFor(spec.id)).toBe('REFIT')
      expect(controller.isReserveAvailable(spec.id)).toBe(false)
      return restoreImplementation(destination)
    })
    expect(controller.beginMissionReturn(spec.id)).toBe(true)
    expectBarracksRefitPoint(restore.mock.calls[0][0]!)
    expect(resident.npc).toBe(npc); expect(npc.combatantId).toBe(spec.id)
    expect(npc.mount).toBe(mount); expect(npc.hpRatio).toBe(1); expect(mount.currentHp).toBe(mount.maxHp)
    expect(mount.type).toBe(MountType.HORSE)
    expect(controller.returnStateFor(spec.id)).toBe('REJOIN_PATROL')
    expect(controller.isReserveAvailable(spec.id)).toBe(true)
  })

  it('finishes a rear ordinary follower rejoin at its own slot while remaining farther than nine metres from the leader', () => {
    // Full A is intentional: the deep follower slot (index 19) and >9m leader distance are the input.
    const h = createTownPatrolFixture({ withWorld: true, patrolIds: ['A'] }), resident = h.residents[19], squad = h.controller.squads[0]
    h.advanceUntil(() => h.controller.squads.every(s => s.state === 'PATROLLING'), {
      maxSimulationSeconds: 200, failureMessage: 'Patrol A must reach the exterior patrol loop',
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

  it('ordinary Patrol A rider walks through real navigation after its Horse dies and replaces it only at barracks', () => {
    const h = createTownPatrolFixture({ withWorld: true, patrolMembers: { A: 2 } }), resident = h.residents[1]
    h.advanceUntil(() => h.controller.squads.every(s => s.state === 'PATROLLING'), {
      maxSimulationSeconds: 200, failureMessage: 'Patrol A must reach the exterior patrol loop',
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
