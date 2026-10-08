import { completeNpcDeployment, gameplayNpcSpawnDriver } from '../helpers/npcSpawnFrames'
import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { BanditMissionController } from '../../src/career/BanditMissionController'
import { TownDefenseController } from '../../src/career/TownDefenseController'
import { createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { createActiveCareerMission, createTownDefenseMission } from '../../src/career/CareerMissionState'
import type { NavigationWorld } from '../../src/navigation/NavigationWorld'
import type { Player } from '../../src/player/Player'
import type { TownWorld } from '../../src/town/TownWorld'
import type { TownActorSpec } from '../../src/town/TownRules'
import type { Mount } from '../../src/world/Mount'
import { Faction, type NPC } from '../../src/world/NPC'
import { getTerrainHeight } from '../../src/world/Terrain'

vi.mock('../../src/career/MissionGuide', () => ({ MissionGuide: class { hide = vi.fn(); dispose = vi.fn(); update = vi.fn(); updateTownDefense = vi.fn() } }))

const zeroStats = () => ({ damageDealt: 0, damageTaken: 0, kills: 0, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0 })

function actor(combatantId: string) {
  const npc = { combatantId, name: combatantId, dead: false, group: new THREE.Group(), mount: null,
    faction: Faction.TOWN, tacticalOrder: 'attack',
    get combatPosition() { return this.group.position },
    assignFormationTarget: vi.fn(), assignFollowTarget: vi.fn(), setTacticalOrder: vi.fn(), dispose: vi.fn(),
  }
  return npc as unknown as NPC
}

function profileOwner(initial: CareerProfile) {
  let profile = initial, saving = true
  const commit = vi.fn((next: CareerProfile) => { if (!saving) return false; profile = next; return true })
  return { read: () => profile, commit, setSaving: (value: boolean) => { saving = value } }
}

function banditFixture(path: { x: number; z: number }[] = [], phase: 'RETURNING' | 'ASSEMBLING' = 'RETURNING') {
  const profile = createCareerProfile('roman')
  profile.activeMission = { ...createActiveCareerMission('recruit-bandits-01', 0, 3, 0, 'bandit-checkpoint', 'bandit', 'captain'),
    phase, playerDead: false, routeStage: 0, playerStats: zeroStats(),
    mountState: { activeMountId: 'horse', hp: { horse: 43 }, unavailable: ['corgi'] },
  }
  // A returning party has already accounted for the complete defeated target roster.
  profile.activeMission.deadTargetActorIds = [...profile.activeMission.targetActorIds]
  const owner = profileOwner(profile), captain = actor('captain')
  const player = { dead: false, combatPosition: new THREE.Vector3() } as Player
  const world = { camps: [], obstacles: [] } as unknown as TownWorld
  const navigation = { sync: vi.fn(), beginFrame: vi.fn(), queryPath: () => ({ status: 'path', path }),
    grid: { findNearestWalkableCell: () => null, cellToWorld: (point: { x: number; z: number }) => new THREE.Vector3(point.x, 0, point.z) },
  } as unknown as NavigationWorld
  const controller = new BanditMissionController(new THREE.Scene(), world, navigation, captain,
    [{ spec: { id: 'captain', role: 'captain' } as TownActorSpec, npc: captain }], () => player, owner.read, owner.commit)
  controller.camps.push({ id: 0, center: new THREE.Vector3(200, 0, -200), ambient: [], mission: [] })
  expect(completeNpcDeployment(() => controller.startActiveMission(), gameplayNpcSpawnDriver)).toBe(true)
  if (phase === 'RETURNING') captain.group.position.set(500, 0, 500)
  const damage = (amount: number) => controller.events.emit({ type: 'damage_applied',
    source: { actorId: 'player', actorType: 'player', allegiance: Faction.PLAYER, characterFaction: 'roman' },
    target: { targetId: profile.activeMission!.targetActorIds[0], targetType: 'npc', name: 'Bandit' },
    method: 'melee', requestedDamage: amount, appliedDamage: amount,
  })
  return { ...owner, controller, captain, player, damage }
}

function defenseFixture() {
  const profile = createCareerProfile('roman')
  profile.activeMission = { ...createTownDefenseMission(['captain'], ['civilian'], 'defense-checkpoint'), phase: 'ATTACKING',
    playerDead: false, defenseElapsed: 0, defensePreparationElapsed: 0, playerStats: zeroStats(),
    mountState: { activeMountId: 'horse', hp: { horse: 43 }, unavailable: ['corgi'] },
  }
  const owner = profileOwner(profile), captain = actor('captain'), civilian = actor('civilian')
  const player = { dead: false, combatPosition: new THREE.Vector3() } as Player
  const cat = { dead: false } as Mount
  const controller = new TownDefenseController(new THREE.Scene(), [
    { spec: { id: 'captain', role: 'captain' } as TownActorSpec, npc: captain },
    { spec: { id: 'civilian', role: 'civilian' } as TownActorSpec, npc: civilian },
  ], () => player, owner.read, owner.commit, cat, {} as NavigationWorld)
  const enemy = actor(profile.activeMission.targetActorIds[0])
  controller.enemies.push(enemy)
  return { ...owner, controller, captain, civilian, enemy, player, cat }
}

describe('constructed controller checkpoint wiring', () => {
  it('Bandit cleanup and restart give a new mission its own full checkpoint interval', () => {
    const h = banditFixture()
    h.controller.updateFlow(4.99, 0)
    expect(h.commit).not.toHaveBeenCalled()
    h.read().activeMission = undefined
    h.controller.cleanupMission()
    const mission = createActiveCareerMission('recruit-bandits-01', 0, 3, 0, 'bandit-next', 'bandit', 'captain')
    h.read().activeMission = { ...mission, phase: 'RETURNING', routeStage: 0, playerStats: zeroStats(),
      deadTargetActorIds: [...mission.targetActorIds],
    }
    expect(completeNpcDeployment(() => h.controller.startActiveMission(), gameplayNpcSpawnDriver)).toBe(true)
    h.captain.group.position.set(500, 0, 500)
    h.damage(100)
    h.controller.updateFlow(.01, 0)
    expect(h.commit).not.toHaveBeenCalled()
    expect(h.read().activeMission!.playerStats!.damageDealt).toBe(0)
    expect(h.controller.snapshot().player.damageDealt).toBe(100)
    h.controller.updateFlow(4.99, 0)
    expect(h.commit).toHaveBeenCalledOnce()
    expect(h.read().activeMission).toMatchObject({ id: 'bandit-next', playerStats: { damageDealt: 100 } })
    h.controller.dispose()
  })

  it('Bandit preserves the five-second cadence and retries fresh player totals without another dt', () => {
    const h = banditFixture()
    h.damage(100)
    h.controller.updateFlow(4.99, 0)
    expect(h.commit).not.toHaveBeenCalled()
    h.setSaving(false)
    h.controller.updateFlow(.01, 0)
    expect(h.read().activeMission!.playerStats!.damageDealt).toBe(0)
    h.damage(20)
    h.setSaving(true)
    h.controller.persistRuntimeProgress()
    expect(h.read().activeMission!.playerStats!.damageDealt).toBe(120)
    h.damage(20)
    h.controller.updateFlow(4.99, 0)
    expect(h.read().activeMission!.playerStats!.damageDealt).toBe(120)
    h.controller.updateFlow(.01, 0)
    expect(h.read().activeMission!.playerStats!.damageDealt).toBe(140)
    h.controller.dispose()
  })

  it('Bandit saves current stats with an immediate casualty and does not force unchanged data', () => {
    const h = banditFixture()
    h.controller.persistRuntimeProgress(true)
    expect(h.commit).not.toHaveBeenCalled()
    h.damage(70)
    h.controller.updateFlow(1, 0)
    expect(h.commit).not.toHaveBeenCalled()
    h.captain.dead = true
    h.controller.persistRuntimeProgress()
    expect(h.read().activeMission).toMatchObject({ deadFriendlyActorIds: ['captain'], playerStats: { damageDealt: 70 },
      mountState: { hp: { horse: 43 }, unavailable: ['corgi'] },
    })
    h.damage(10)
    h.controller.updateFlow(4.99, 0)
    expect(h.read().activeMission!.playerStats!.damageDealt).toBe(70)
    h.controller.updateFlow(.01, 0)
    expect(h.read().activeMission!.playerStats!.damageDealt).toBe(80)
    h.controller.persistRuntimeProgress(true)
    expect(h.commit).toHaveBeenCalledTimes(2)
    h.controller.dispose()
  })

  it('Bandit saves every third route stage and the last stage through its public flow', () => {
    const points = Array.from({ length: 6 }, (_, index) => ({ x: index * 20, z: 120 }))
    const h = banditFixture(points)
    for (const [index, point] of points.entries()) {
      h.captain.group.position.set(point.x, getTerrainHeight(point.x, point.z), point.z)
      h.controller.updateFlow(0, 0)
      expect(h.commit).toHaveBeenCalledTimes(index < 2 ? 0 : index < 5 ? 1 : 2)
    }
    expect(h.commit.mock.calls.map(([profile]) => profile.activeMission!.routeStage)).toEqual([3, 6])
    h.controller.dispose()
  })

  it('Bandit commits a phase before issuing orders and Follow, and only once after a retry', () => {
    const h = banditFixture([], 'ASSEMBLING'), follow = vi.fn()
    h.controller.onMarchStarted = follow
    h.player.combatPosition.copy(h.captain.combatPosition)
    h.captain.assignFormationTarget.mockClear()
    h.setSaving(false)
    h.controller.updateFlow(.1, 0)
    expect(h.controller.phase).toBe('ASSEMBLING')
    expect(h.captain.assignFormationTarget).not.toHaveBeenCalled()
    expect(follow).not.toHaveBeenCalled()
    h.setSaving(true)
    h.controller.updateFlow(.1, 0)
    h.controller.updateFlow(.1, 0)
    expect(h.controller.phase).toBe('MARCHING')
    expect(follow).toHaveBeenCalledOnce()
    expect(h.captain.assignFormationTarget).toHaveBeenCalledOnce()
    h.controller.dispose()
  })

  it('Defense saves its clock every second and does not force unchanged data', () => {
    const h = defenseFixture()
    h.controller.persistRuntimeProgress(true)
    h.controller.updateFlow(.99, 0)
    expect(h.commit).not.toHaveBeenCalled()
    h.controller.updateFlow(.01, 0)
    expect(h.read().activeMission!.defenseElapsed).toBe(1)
    h.controller.updateFlow(.99, 0)
    expect(h.commit).toHaveBeenCalledOnce()
    h.controller.updateFlow(.01, 0)
    expect(h.commit).toHaveBeenCalledTimes(2)
    expect(h.read().activeMission!.defenseElapsed).toBe(2)
    h.controller.dispose()
  })

  it('Defense retries the current snapshot and keeps resident, attacker, civilian, cat and reserve state distinct', () => {
    const h = defenseFixture()
    h.setSaving(false)
    h.controller.updateFlow(1, 0)
    expect(h.read().activeMission!.defenseElapsed).toBe(0)
    h.civilian.dead = true
    h.cat.dead = true
    h.setSaving(true)
    h.controller.persistRuntimeProgress()
    expect(h.read().activeMission).toMatchObject({ defenseElapsed: 1, defenseReserveCharged: false, defenseCatDead: true,
      deadCivilianActorIds: ['civilian'], deadTargetActorIds: [], deadFriendlyActorIds: [],
      playerStats: zeroStats(), mountState: { hp: { horse: 43 }, unavailable: ['corgi'] },
    })
    h.captain.dead = true
    h.enemy.dead = true
    h.player.dead = true
    h.controller.persistRuntimeProgress()
    expect(h.read().activeMission).toMatchObject({ playerDead: true, deadFriendlyActorIds: ['captain'],
      deadTargetActorIds: [h.enemy.combatantId], deadCivilianActorIds: ['civilian'],
    })
    h.controller.dispose()
  })
})
