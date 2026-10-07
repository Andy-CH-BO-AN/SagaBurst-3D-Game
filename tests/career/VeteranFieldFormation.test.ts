import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createVeteranFieldFixture, type VeteranFieldFixture, type VeteranFieldFixtureOptions } from '../helpers/veteranFieldFixture'
import { Faction } from '../../src/world/NPC'
import { NavigationWorld } from '../../src/navigation/NavigationWorld'
import { VETERAN_FIELD_LAYOUT } from '../../src/career/BanditMissionController'
import { PLAYABLE_WORLD_BOUND, type ObstacleData } from '../../src/world/Terrain'
import { TOWN_PLAYABLE_WORLD_BOUND, TOWN_NAVIGATION_BOUNDS } from '../../src/town/TownBounds'

vi.mock('../../src/career/MissionGuide', () => ({ MissionGuide: class {
  update(): void {}
  hide(): void {}
  dispose(): void {}
} }))

const fixtures: VeteranFieldFixture[] = []
afterEach(() => {
  fixtures.splice(0).reverse().forEach(fixture => fixture.dispose())
  vi.restoreAllMocks()
})
function field(options: VeteranFieldFixtureOptions) {
  const fixture = createVeteranFieldFixture(options)
  fixtures.push(fixture)
  return fixture
}

describe('VeteranFieldFormation', () => {
  it.each(['veteran-scout-hunters', 'veteran-village-intercept', 'veteran-spear-line-hunt'] as const)(
    'keeps borrowed Town actors at home and orders them to ride or walk to muster in %s', templateId => {
      const setup = field({ templateId, autoStart: false })
      const initial = new Map(setup.residents.map(({ npc }) => [npc.combatantId, npc.combatPosition.clone()]))
      expect(setup.deploy()).toBe(true)

      for (const unit of setup.roster.friendly.filter(unit => unit.source === 'town')) {
        const npc = setup.residents.find(resident => resident.npc.combatantId === unit.actorId)!.npc
        expect(npc.combatPosition.distanceTo(initial.get(unit.actorId)!)).toBeLessThan(.001)
        expect(npc.formationTarget ?? npc.assignFollowTarget.mock.calls.length > 0).toBeTruthy()
      }
    })

  it('routes temporary support through the Town entry before assigning its final muster slot', () => {
    const setup = field({ templateId: 'veteran-scout-hunters' })
    expect(setup.start).toBe(true)
    const support = setup.npcFactories.filter(({ spec }) => spec.faction === Faction.TOWN)
      .map(({ npc }) => npc)
    expect(support).toHaveLength(77)
    expect(support.every(npc => npc.combatPosition.x < -270
      && Math.abs(npc.combatPosition.x) <= PLAYABLE_WORLD_BOUND - 4
      && Math.abs(npc.combatPosition.z) < 280)).toBe(true)
    expect(support.every(npc => npc.combatPosition.distanceTo(VETERAN_FIELD_LAYOUT.rally) > 80)).toBe(true)
    expect(support.every(npc => npc.formationTarget !== null)).toBe(true)
    expect(support.every(npc => Math.abs(npc.formationTarget!.position.x - VETERAN_FIELD_LAYOUT.townEntry.x) < 20
      && Math.abs(npc.formationTarget!.position.z - VETERAN_FIELD_LAYOUT.townEntry.z) < 45)).toBe(true)
    const entryTravel = support.reduce((sum, npc) => sum + npc.moveToFormationTarget(), 0) / support.length
    expect(entryTravel).toBeGreaterThan(80)
    expect(support.every(npc => npc.formationTarget!.reached)).toBe(true)

    setup.advanceUntil(() => support.every(npc => Math.abs(npc.formationTarget!.position.x - VETERAN_FIELD_LAYOUT.rally.x) < 20), {
      failureMessage: 'Support must pass the Town entry before receiving muster slots',
    })
    expect(support.every(npc => Math.abs(npc.formationTarget!.position.x - VETERAN_FIELD_LAYOUT.rally.x) < 20
      && Math.abs(npc.formationTarget!.position.z - VETERAN_FIELD_LAYOUT.rally.z) < 45)).toBe(true)
    expect(support.every(npc => !npc.formationTarget!.reached)).toBe(true)
    for (const npc of support) npc.moveToFormationTarget()
    setup.stepFrame()
    expect(setup.profile().activeMission?.phase).toBe('ASSEMBLING')
    const captain = setup.actors.find(npc => npc.combatantId === setup.roster.friendly.find(unit => unit.leader)?.actorId)!
    setup.player.group.position.copy(captain.combatPosition)
    setup.assemble()
    expect(setup.controller.phase).toBe('MARCHING')
  })

  it('places muster and courtyard goals outside Town building and market obstacle volumes', () => {
    const obstacle = (x: number, z: number, width: number, depth: number): ObstacleData => ({
      box: new THREE.Box3(new THREE.Vector3(x - width / 2, -2, z - depth / 2), new THREE.Vector3(x + width / 2, 12, z + depth / 2)),
      isBarricade: false,
    })
    const obstacles = [
      obstacle(11, 23, 4, 2), // solid market stall
      obstacle(34, 30, 7, 7), // barracks
      obstacle(-12, 52, 9, 8), // home
      obstacle(34, -15, 8, 7), obstacle(72, -15, 8, 7), // training tents
      obstacle(86, -9, 1, 38), // fence
    ]
    for (const templateId of ['veteran-scout-hunters', 'veteran-tragedy-of-the-scouts'] as const) {
      const setup = field({ templateId, obstacles })
      const goals = setup.actors.filter(npc => !npc.dead)
        .map(npc => npc.formationTarget?.position ?? npc.combatPosition)
      if (templateId === 'veteran-scout-hunters') {
        const support = setup.npcFactories.filter(({ spec }) => spec.faction === Faction.TOWN)
          .map(({ npc }) => npc)
        for (const npc of support) npc.moveToFormationTarget()
        setup.stepFrame()
        goals.push(...setup.actors.filter(npc => !npc.dead)
          .map(npc => npc.formationTarget?.position ?? npc.combatPosition))
      }
      const enemies = setup.enemies.map(npc => npc.combatPosition)
      for (const point of [...goals, ...enemies]) {
        expect(Math.abs(point.x)).toBeLessThan(TOWN_PLAYABLE_WORLD_BOUND - 20)
        expect(Math.abs(point.z)).toBeLessThan(TOWN_PLAYABLE_WORLD_BOUND - 20)
        expect(obstacles.some(item => item.box.clone().expandByScalar(1.05).containsPoint(new THREE.Vector3(point.x, Math.max(point.y + .8, item.box.min.y), point.z)))).toBe(false)
      }
      const navigation = new NavigationWorld(TOWN_NAVIGATION_BOUNDS)
      navigation.sync(obstacles)
      expect(navigation.areConnected(templateId === 'veteran-tragedy-of-the-scouts' ? VETERAN_FIELD_LAYOUT.scoutEnemyCourtyard : VETERAN_FIELD_LAYOUT.supportApproach,
        templateId === 'veteran-tragedy-of-the-scouts' ? VETERAN_FIELD_LAYOUT.scoutRally : VETERAN_FIELD_LAYOUT.rally)).toBe(true)

    }
  })

  it('faces each held enemy leader toward the friendly rally', () => {
    const setup = field({ templateId: 'veteran-village-intercept' })
    expect(setup.start).toBe(true)
    const friendlyLeader = setup.actors.find(candidate => candidate.combatantId === setup.roster.friendly.find(unit => unit.leader)?.actorId)!
    for (const actor of setup.enemies) {
      const npc = actor
      const towardFriendly = friendlyLeader.combatPosition.clone().sub(actor.combatPosition).setY(0).normalize()
      const facing = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), npc.group.rotation.y)
      expect(facing.dot(towardFriendly)).toBeGreaterThan(.75)
    }
  })

  it.each(['veteran-scout-hunters', 'veteran-village-intercept', 'veteran-spear-line-hunt'] as const)(
    'starts %s when NPCs reach their slots even while the Player stays far away', templateId => {
      const setup = field({ templateId })
      expect(setup.start).toBe(true)
      const captain = setup.actors.find(npc => npc.combatantId === setup.roster.friendly.find(unit => unit.leader)?.actorId)!
      setup.player.group.position.set(-150, 0, -150)
      setup.controller.onMarchStarted = vi.fn()
      setup.stepFrame()
      expect(setup.profile().activeMission?.phase).toBe('ASSEMBLING')
      const candidates = setup.actors
      const borrowedIds = new Set(setup.residents.map(resident => resident.npc.combatantId))
      const support = candidates.filter(npc => !borrowedIds.has(npc.combatantId))
      for (const npc of support) npc.moveToFormationTarget()
      setup.stepFrame()
      for (const npc of candidates.slice(0, Math.ceil(candidates.length * .8))) npc.moveToFormationTarget()
      setup.stepFrame()
      expect(setup.profile().activeMission?.phase).toBe('ASSEMBLING')
      setup.assemble()
      expect(setup.controller.phase).toBe('MARCHING')
      expect(setup.player.combatPosition.distanceTo(captain.combatPosition)).toBeGreaterThan(100)
      expect(setup.controller.onMarchStarted).toHaveBeenCalledOnce()
      setup.stepFrame()
      expect(setup.controller.onMarchStarted).toHaveBeenCalledOnce()
    })

  it('departs with a lagging Captain after 90% assemble without snapping him into place', () => {
    const setup = field({ templateId: 'veteran-village-intercept' })
    setup.controller.onMarchStarted = vi.fn()
    const captain = setup.leader!
    const candidates = setup.actors
    setup.reachAssignedPositions(candidates.filter(npc => npc !== captain))
    const nearby = captain.formationTarget!.position.clone().add(new THREE.Vector3(-8, 0, 0))
    captain.combatPosition.copy(nearby)
    setup.player.group.position.copy(captain.combatPosition)
    expect(captain.formationTarget!.reached).toBe(false)
    expect(candidates.filter(npc => npc.formationTarget?.reached).length)
      .toBeGreaterThanOrEqual(Math.ceil(candidates.length * .9))
    setup.advanceUntil(() => setup.controller.phase === 'MARCHING', {
      failureMessage: 'A 90% assembled squad must depart with its lagging Captain',
    })
    expect(setup.controller.phase).toBe('MARCHING')
    expect(setup.controller.onMarchStarted).toHaveBeenCalledOnce()
    expect(captain.combatPosition).toEqual(nearby)
    expect(setup.controller.missionLeader).toBe(captain)
    expect(['formation', 'charge']).toContain(captain.tacticalOrder)
  })

  it.each(['veteran-scout-hunters', 'veteran-village-intercept', 'veteran-spear-line-hunt'] as const)(
    'keeps T4 leaders independently marching and their own squad following without replaying Follow in %s', templateId => {
      const setup = field({ templateId, initialCheckpoint: { followVoicePlayed: true } })
      setup.controller.onMarchStarted = vi.fn()
      setup.player.group.position.set(-150, 0, -150)
      setup.assemble()
      const leaders = setup.roster.friendly.filter(unit => unit.leader)
      expect(leaders.some(unit => unit.heroRole === 'ranger')).toBe(true)
      for (const unit of leaders) {
        const leader = setup.actors.find(actor => actor.combatantId === unit.actorId)!
        expect(leader.tier).toBe(4)
        expect(leader.tacticalOrder).toBe('formation')
        expect(leader.formationTarget!.position.x).toBeGreaterThan(leader.combatPosition.x)
        expect(leader.followTarget).toBeNull()
        const followers = setup.actors.filter(actor => actor.squadId === unit.squadId && actor !== leader)
        expect(followers.length).toBeGreaterThan(0)
        expect(followers.every(actor => actor.followTarget === leader && actor.tacticalOrder === 'follow')).toBe(true)
      }
      expect(setup.controller.onMarchStarted).not.toHaveBeenCalled()
      expect(setup.controller.phase).toBe('MARCHING')
    })
})
