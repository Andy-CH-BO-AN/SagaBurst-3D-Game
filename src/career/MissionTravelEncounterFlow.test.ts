import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { BanditMissionController } from './BanditMissionController'
import { MissionTravelEncounter } from './MissionTravelEncounter'
import { CareerMissionCheckpoint } from './CareerMissionCheckpoint'
import { createCareerProfile, type CareerProfile } from './CareerProfile'
import { createActiveCareerMission, type CareerMissionPhase } from './CareerMissionState'
import type { NPC } from '../world/NPC'
import type { Player } from '../player/Player'
import { Faction } from '../combat/CombatFaction'
import { SpatialGrid } from '../world/SpatialGrid'
import { townSitePoint } from '../town/TownRules'
import { TownMissionCombat } from '../town/TownMissionCombat'

function actor(id: string, x = 0, faction = Faction.TOWN): NPC {
  const a = {
    combatantId: id, faction, dead: false, combatPosition: new THREE.Vector3(x, 0, 0),
    tacticalOrder: 'follow', encounterAggroState: 'alerted', hostileToPlayer: faction === Faction.BANDIT,
    group: new THREE.Group(), mount: null, isMounted: false, clearEncounter: vi.fn(),
    setTacticalOrder: vi.fn((order: string) => { a.tacticalOrder = order }),
    assignFormationTarget: vi.fn(), assignFollowTarget: vi.fn(),
  }
  return a as unknown as NPC
}
function fixture(phase: CareerMissionPhase = 'MARCHING') {
  let profile = createCareerProfile('roman')
  const leader = actor('leader'), follower = actor('borrowed-patrol', -4)
  const player = actor('player', 0, Faction.PLAYER) as unknown as Player
  const target = actor('formal-enemy', 200, Faction.BANDIT)
  const roaming = actor('roaming', 5, Faction.BANDIT)
  profile.activeMission = createActiveCareerMission('recruit-bandits-01', 0, 1, 0, 'mission', 'bandit', 'leader')
  Object.assign(profile.activeMission, { phase, routeStage: 4, friendlyActorIds: ['leader', 'borrowed-patrol'], borrowedActorIds: ['borrowed-patrol'], targetActorIds: ['formal-enemy'] })
  const readProfile = () => profile
  const commit = vi.fn((next: CareerProfile) => { profile = next; return true })
  const route = Array.from({ length: 7 }, (_, i) => new THREE.Vector3(80 + i * 20, 0, 0))
  const navigation = { queryPath: vi.fn(), beginFrame: vi.fn() }
  // Exercise the real controller flow without constructing render assets or DOM guides.
  const controller = Object.assign(Object.create(BanditMissionController.prototype), {
    friendlies: [leader, follower], travelEncounter: new MissionTravelEncounter(), readProfile, commit,
    player: () => player, leader, route, routeIndex: 4, commandId: 10,
    checkpoint: new CareerMissionCheckpoint(readProfile, commit), tracker: null,
    guide: { update: vi.fn(), hide: vi.fn() }, navigation,
    camps: [{ id: 0, center: new THREE.Vector3(200, 0, 0), mission: [target], ambient: [] }],
    mountedMarch: null, fieldActorMounts: new Map(), borrowedTemporaryMounts: [], cavalryMounts: [],
    residents: [], perceptionElapsed: 0,
  }) as BanditMissionController
  const grid = new SpatialGrid<NPC>(); grid.insert(roaming)
  const runtime = { owns: (npc: NPC) => npc === roaming, squadMembersFor: (npc: NPC) => [npc] }
  return { controller, leader, follower, player, target, roaming, runtime, grid, navigation, route, commit,
    get profile() { return profile },
  }
}

describe('Mission travel flow integration', () => {
  it.each(['MARCHING', 'RETURNING'] as const)('resumes %s with the same route stage, destination, roster and surviving deputy', phase => {
    const f = fixture(phase)
    const original = structuredClone(f.profile.activeMission)
    f.controller.noteTravelHit(f.follower, f.roaming, f.runtime)
    f.controller.prepareTravelEncounter(0, f.grid, f.runtime)
    expect(f.controller.phase).toBe(phase)
    expect(f.profile.activeMission).toEqual(original)
    Object.assign(f.leader, { dead: true })
    Object.assign(f.roaming, { dead: true })
    f.controller.prepareTravelEncounter(.01, f.grid, f.runtime)
    expect(f.controller.travelEncounter.active).toBe(false)
    expect(f.controller.missionLeader).toBe(f.follower)
    expect(f.follower.assignFormationTarget).toHaveBeenCalledWith(expect.any(Number), f.route[4], expect.any(THREE.Vector3), 7.5)
    expect(f.profile.activeMission?.routeStage).toBe(4)
    expect(f.profile.activeMission?.borrowedActorIds).toEqual(['borrowed-patrol'])
    expect(f.leader.dead).toBe(true)
    expect(f.navigation.queryPath).not.toHaveBeenCalled()
  })

  it('blocks returnComplete at the destination while threats remain, then allows the existing return condition', () => {
    const f = fixture('RETURNING')
    const home = townSitePoint('barracks', 0, 15)
    f.leader.combatPosition.set(home.x, 0, home.z)
    f.player.combatPosition.copy(f.leader.combatPosition)
    f.roaming.combatPosition.copy(f.leader.combatPosition)
    expect(f.controller.returnComplete).toBe(true)
    f.controller.noteTravelHit(f.player, f.roaming, f.runtime)
    expect(f.controller.returnComplete).toBe(false)
    f.controller.updateFlow(.01, 0)
    expect(f.navigation.queryPath).not.toHaveBeenCalled()
    expect(f.profile.activeMission?.routeStage).toBe(4)
    Object.assign(f.roaming, { dead: true })
    f.controller.prepareTravelEncounter(.01, f.grid, f.runtime)
    expect(f.controller.returnComplete).toBe(true)
  })

  it('lets formal combat supersede an encounter without restoring travel', () => {
    const f = fixture()
    f.controller.noteTravelHit(f.player, f.roaming, f.runtime)
    f.controller.engageFormalMission()
    expect(f.controller.phase).toBe('ENGAGING')
    expect(f.controller.travelEncounter.active).toBe(false)
    f.controller.prepareTravelEncounter(.35, f.grid, f.runtime)
    expect(f.follower.assignFollowTarget).not.toHaveBeenCalled()
    expect(f.leader.assignFormationTarget).not.toHaveBeenCalled()
    expect(f.leader.setTacticalOrder).toHaveBeenLastCalledWith('charge')
  })

  it('preserves a temporary encounter and travel intent when formal phase saving fails', () => {
    const f = fixture()
    f.commit.mockImplementation(() => false)
    f.controller.noteTravelHit(f.player, f.roaming, f.runtime)
    f.controller.engageFormalMission()
    expect(f.controller.phase).toBe('MARCHING')
    expect(f.controller.travelEncounter.active).toBe(true)
  })

  it('keeps roaming deaths outside the objective, but observes formal third-party kills', () => {
    const f = fixture()
    f.controller.noteTravelHit(f.player, f.roaming, f.runtime)
    Object.assign(f.roaming, { dead: true })
    expect(f.controller.remainingEnemies).toBe(1)
    expect(f.controller.evaluate(false)).toBeNull()
    expect(f.profile.activeMission?.targetActorIds).toEqual(['formal-enemy'])
    Object.assign(f.target, { dead: true })
    expect(f.controller.remainingEnemies).toBe(0)
    expect(f.controller.evaluate(false)).toBe('victory')
  })

  it('routes effective member and Player hits through the actual combat bridge before a sensor tick', () => {
    const f = fixture()
    const town = { player: () => f.player, outskirts: () => f.runtime, patrol: () => ({ noteHostileHit: vi.fn() }) }
    const combat = new TownMissionCombat({ field: f.controller } as unknown as ConstructorParameters<typeof TownMissionCombat>[0], town as unknown as ConstructorParameters<typeof TownMissionCombat>[1])
    combat.noteExternalHit(f.follower, f.roaming)
    expect(f.controller.travelEncounter.active).toBe(true)
    expect(f.leader.setTacticalOrder).toHaveBeenCalledWith('charge')
    f.controller.travelEncounter.clear()
    f.player.combatPosition.set(100, 0, 0); f.roaming.combatPosition.set(102, 0, 0)
    combat.noteExternalPlayerHit(f.roaming)
    expect(f.controller.travelEncounter.engagementOrigin?.x).toBe(100)
    expect(f.leader.assignFormationTarget).toHaveBeenCalled()
  })
})
