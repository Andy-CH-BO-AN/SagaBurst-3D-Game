import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TOWN_SITES, townActorCaptainProfile, townCaptainProfile, townRoster, townMilitaryEquipment, townSettlementRoster, townAssaultObjectiveRoster } from '../src/town/TownRules'
import { TownCavalryPatrolController } from '../src/town/TownCavalryPatrolController'
import { townPatrolRoute, townPatrolDeparture } from '../src/town/TownPatrolRoute'
import { TOWN_CITY, TOWN_GATES } from '../src/town/TownLayout'
import { TownWorld } from '../src/town/TownWorld'
import { NavigationWorld } from '../src/navigation/NavigationWorld'
import { AIType, Faction, NPC } from '../src/world/NPC'
import { Mount, MountType } from '../src/world/Mount'
import { PLAYABLE_WORLD_BOUND, getTerrainHeight, isObstaclePathClear } from '../src/world/Terrain'
import { selectMissionCavalryActorIds } from '../src/career/BanditMissionController'
import { createTownDefenseGroups } from '../src/career/TownDefenseState'
import { combatActor, combatFixture } from './helpers/townMissionCombat'

// Only rendering is substituted; NPC movement, mount physics/collision and navigation are real.
vi.mock('../src/world/HorseAssetRegistry', async importOriginal => ({ ...(await importOriginal<typeof import('../src/world/HorseAssetRegistry')>()), HorseAssetRegistry: {
  ready: true,
  createInstance: () => {
    const root = new THREE.Group(), saddleSeat = new THREE.Object3D(); saddleSeat.position.y = 1.7; root.add(saddleSeat)
    return { root, saddleSeat, lod: new THREE.LOD(), skeleton: null,
      setLocomotion() {}, setAppearanceVariant() {}, playOnce() {}, playDeath() {}, playStudioClip() {}, update() {}, dispose() {} }
  },
} }))

const cleanup: (() => void)[] = []
afterEach(() => { cleanup.splice(0).reverse().forEach(f => f()); vi.restoreAllMocks(); vi.unstubAllGlobals() })
function harness(faction: 'roman' | 'viking' = 'roman', withWorld = false) {
  const scene = new THREE.Scene()
  const context = new Proxy({ measureText: () => ({ width: 100 }) }, { get: (target, key) => (target as any)[key] ?? (() => {}) })
  vi.stubGlobal('ImageData', class { constructor(public data: unknown, public width: number, public height: number) {} })
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => context }) })
  const world = withWorld ? new TownWorld(faction, scene) : undefined
  if (world) cleanup.push(() => world.dispose())
  const residents = townRoster().filter(s => s.duty === 'patrol').map(spec => {
    const equipment = townMilitaryEquipment(faction, spec)
    const npc = new NPC(scene, spec.x, spec.z, Faction.TOWN, faction, AIType.MELEE, spec.id, equipment.level, true, equipment.loadout, equipment.presetId, undefined, spec.id)
    const homeMount = new Mount(scene, MountType.HORSE, spec.x, spec.z)
    homeMount.group.rotation.y = spec.yaw!; npc.mountVehicle(homeMount); npc.setTownPeaceful()
    cleanup.push(() => { npc.dispose(); homeMount.dispose() })
    return { spec, npc, homeMount, cycle: -1, walkTime: 0 }
  })
  const controller = new TownCavalryPatrolController(residents), navigation = new NavigationWorld(), camera = new THREE.Vector3(0, 0, 100)
  const obstacles = world?.obstacles ?? []; navigation.sync(obstacles)
  const step = (frames = 1, excluded = new Set<NPC>()) => {
    for (let frame = 0; frame < frames; frame++) {
      navigation.beginFrame(); controller.beginFrame(excluded)
      for (const r of residents) controller.updateResident(r, .1, camera, obstacles, navigation)
    }
  }
  return { residents, controller, navigation, camera, obstacles, world, step }
}

function expectBarracksRefitPoint(point: { x: number; z: number; yaw?: number }) {
  const barracks = TOWN_SITES.barracks, dx = point.x - barracks.x, dz = point.z - barracks.z
  const side = Math.cos(barracks.yaw) * dx - Math.sin(barracks.yaw) * dz
  const forward = Math.sin(barracks.yaw) * dx + Math.cos(barracks.yaw) * dz
  // The actual hut is at (34, 30); its clear southern courtyard is local side 22..40, forward -31.5..0.
  expect(side).toBeGreaterThanOrEqual(22 - 1e-8); expect(side).toBeLessThanOrEqual(40 + 1e-8)
  expect(forward).toBeGreaterThanOrEqual(-31.5 - 1e-8); expect(forward).toBeLessThanOrEqual(1e-8)
  if (point.yaw !== undefined) expect(point.yaw).toBe(barracks.yaw)
}

describe('Town patrol roster and route contracts', () => {
  it.each(['roman', 'viking'] as const)('has stable 2 × 20 %s mounted residents and two T4 Horse officers, independent of service Captain', faction => {
    const roster = townRoster(), patrol = roster.filter(s => s.duty === 'patrol')
    expect(roster).toHaveLength(225); expect(patrol).toHaveLength(40)
    expect(new Set(roster.map(s => s.id)).size).toBe(225); expect(townRoster()).toEqual(roster)
    expect(roster.filter(s => s.role === 'captain')).toHaveLength(1)
    for (const id of ['A', 'B']) {
      const members = patrol.filter(s => s.patrolId === id)
      expect(members).toHaveLength(20); expect(members.filter(s => s.patrolLeader)).toHaveLength(1)
      expect(members.filter(s => !s.patrolLeader)).toHaveLength(19)
      for (const s of members) {
        expect(s).toMatchObject({ mounted: true, training: false, settlementObjective: false, assaultObjective: false, tier: s.patrolLeader ? 4 : 2 })
        expect(s.defenseGroup).toBeUndefined(); expect(s.role).not.toBe('captain')
        const equipment = townMilitaryEquipment(faction, s)
        expect(equipment.presetId).toBe(`${faction}_sword_cavalry`); expect(equipment.loadout.mountId).toBe('horse')
        if (s.patrolLeader) expect(townActorCaptainProfile(faction, s)).toEqual({ ...townCaptainProfile(faction), mountOverride: 'horse' })
        else { expect(equipment.level).toBe(2); expect(townActorCaptainProfile(faction, s)).toBeUndefined() }
        if (faction === 'viking' && !s.patrolLeader) expect(equipment.loadout.meleeWeaponId).toBe('viking_axe_t2')
      }
    }
    expect(townSettlementRoster()).toHaveLength(85); expect(townAssaultObjectiveRoster()).toHaveLength(63)
    expect(createTownDefenseGroups(roster).map(g => g.actorIds.length)).toEqual([10, 10, 10, 10, 10, 10])
    expect(roster.filter(s => s.mounted && s.duty === 'training')).toHaveLength(60)
    expect(roster.filter(s => s.duty === 'gate_guard')).toHaveLength(40)
    const fake = roster.map(spec => ({ spec, npc: { dead: false, combatantId: spec.id, mount: { dead: false } } as NPC }))
    expect(selectMissionCavalryActorIds(fake, 59)).toEqual(selectMissionCavalryActorIds(fake.filter(r => r.spec.duty !== 'patrol'), 59))
  })

  it.each(['roman', 'viking'] as const)('has unobstructed %s muster, a closed exterior loop and connected opposite gates', faction => {
    const h = harness(faction, true), route = townPatrolRoute()
    for (const r of h.residents) {
      const position = r.npc.combatPosition
      expect(isObstaclePathClear(position, position, 1.1, 2.6, 0, h.obstacles), r.spec.id).toBe(true)
      expect(h.navigation.areConnected(position, { x: 0, z: 0 })).toBe(true)
    }
    for (let i = 0; i < h.residents.length; i++) for (let j = i + 1; j < h.residents.length; j++) expect(h.residents[i].npc.combatPosition.distanceTo(h.residents[j].npc.combatPosition)).toBeGreaterThan(4)
    for (let i = 0; i < route.length; i++) {
      const p = route[i], q = route[(i + 1) % route.length]
      expect(Math.max(Math.abs(p.x), Math.abs(p.z))).toBeLessThan(PLAYABLE_WORLD_BOUND)
      for (let t = 0; t <= 1; t += .1) {
        const sample = p.clone().lerp(q, t)
        const distance = Math.hypot(Math.max(TOWN_CITY.minX - sample.x, 0, sample.x - TOWN_CITY.maxX), Math.max(TOWN_CITY.minZ - sample.z, 0, sample.z - TOWN_CITY.maxZ))
        expect(distance).toBeGreaterThan(10); expect(distance).toBeLessThan(15)
      }
      const start = p.clone(); start.y = getTerrainHeight(p.x, p.z)
      const end = q.clone(); end.y = getTerrainHeight(q.x, q.z)
      expect(isObstaclePathClear(start, end, 1, 2.6, 0, h.obstacles), `segment ${i}`).toBe(true)
    }
    const a = townPatrolDeparture('A'), b = townPatrolDeparture('B')
    expect(a.direction).toBe('clockwise'); expect(b.direction).toBe('clockwise'); expect(a.phase).not.toBe(b.phase)
    for (const squad of h.controller.squads) {
      const start = h.residents.find(r => r.spec.id === squad.canonicalLeaderActorId)!.npc.combatPosition
      expect(h.navigation.areConnected(start, route[squad.departure.phase])).toBe(true)
    }
    for (const gate of h.world!.gates.values()) gate.close()
    h.navigation.sync(h.obstacles)
    expect(h.navigation.areConnected(h.residents[0].npc.combatPosition, route[a.phase])).toBe(false)
  })
})

describe('Patrol runtime movement and individual ownership', () => {
  it('elects acting leaders, preserves metadata and mission orders, and reclaims Captain only after physically catching up', () => {
    const h = harness(), squad = h.controller.squads[0], [captain, first, second] = h.residents
    h.step(); expect(squad.activeLeaderActorId).toBe(captain.spec.id)
    h.controller.relinquish(captain.spec.id)
    const missionGoal = new THREE.Vector3(120, 0, 70)
    captain.npc.assignFormationTarget(987, missionGoal, new THREE.Vector3(1, 0, 0))
    h.step(20); expect(squad.activeLeaderActorId).toBe(first.spec.id); expect(captain.npc.formationCommandId).toBe(987)
    expect(first.spec.tier).toBe(2); expect(first.spec.patrolLeader).toBe(false); expect(captain.spec.patrolLeader).toBe(true)
    h.controller.relinquish(first.spec.id); h.step(); expect(squad.activeLeaderActorId).toBe(second.spec.id)
    captain.homeMount.group.position.set(-40, getTerrainHeight(-40, 60), 60)
    const before = captain.npc.combatPosition.clone()
    h.controller.reclaim(captain.spec.id); h.step()
    expect(squad.activeLeaderActorId).toBe(second.spec.id)
    expect(captain.npc.combatPosition.distanceTo(before)).toBeLessThan(2)
    for (let i = 0; i < 2000 && squad.activeLeaderActorId !== captain.spec.id; i++) h.step()
    expect(squad.activeLeaderActorId).toBe(captain.spec.id)
    expect(second.npc.activeFollowTarget).toBe(captain.npc)
  }, 20000)

  it('pauses an empty squad without losing progress and skips dead or unmounted candidates', () => {
    const h = harness(), squad = h.controller.squads[0]
    h.step(100); const progress = [squad.waypoint, squad.departureIndex]
    for (const r of squad.members) h.controller.relinquish(r.spec.id)
    h.step(10); expect(squad.state).toBe('PAUSED'); expect([squad.waypoint, squad.departureIndex]).toEqual(progress)
    const [captain, first, second, third] = h.residents
    captain.npc.takeDamage(999999); first.npc.dismountFromMount()
    h.controller.reclaim(captain.spec.id); h.controller.reclaim(first.spec.id); h.controller.reclaim(second.spec.id); h.controller.reclaim(third.spec.id)
    h.step(); expect(squad.activeLeaderActorId).toBe(second.spec.id)
    second.npc.takeDamage(999999); h.step(); expect(squad.activeLeaderActorId).toBe(third.spec.id)
  })

  it.each(['field', 'duel', 'defense'] as const)('continues during active %s while excluding only actual mission actors', kind => {
    const h = harness(), borrowed = h.residents[1], before = h.residents[0].npc.combatPosition.clone()
    const mission = combatFixture({ simulation: {
      residents: h.residents, navigation: h.navigation,
      preparePeaceResidents: excluded => h.controller.beginFrame(excluded),
      peaceResident: (r, dt) => { h.controller.updateResident(r, dt, h.camera, h.obstacles, h.navigation) },
    } })
    if (kind === 'field') mission.field.active = { kind: 'cavalry-sweep' } as any
    else if (kind === 'duel') { mission.duel.active = {} as any; mission.duel.phase = 'PREPARING' }
    else { mission.defense.active = {} as any; mission.defense.phase = 'PREPARING' }
    mission.combat.update(.1, 0, 0)
    expect(h.residents[0].npc.combatPosition.distanceTo(before)).toBeGreaterThan(0)
    if (kind === 'field') mission.field.fieldNpcs = [borrowed.npc]
    else if (kind === 'duel') mission.duel.fieldNpcs = [borrowed.npc]
    else mission.defense.fieldNpcs = [borrowed.npc]
    const travel = vi.spyOn(borrowed.npc, 'updateTownTravel')
    vi.spyOn(borrowed.npc, 'update').mockImplementation(() => {})
    mission.combat.update(.1, 0, 1); expect(travel).not.toHaveBeenCalled()
  })

  it('hands all forty positions to hostile AI without teleporting or issuing later patrol commands', () => {
    const h = harness(); h.step(20)
    const positions = h.residents.map(r => r.npc.combatPosition.clone())
    const travels = h.residents.map(r => vi.spyOn(r.npc, 'updateTownTravel'))
    h.controller.stopForHostility()
    h.residents.forEach(r => r.npc.beginTownHostility())
    h.step(10)
    h.residents.forEach((r, i) => {
      expect(r.npc.combatPosition.equals(positions[i])).toBe(true)
      expect(r.npc.hostileToPlayer).toBe(true); expect(r.npc.activeFollowTarget).toBeNull()
      expect(travels[i]).not.toHaveBeenCalled()
    })
  })

  it.each(['roman', 'viking'] as const)('moves all %s riders through real gates and loops without combat search, teleportation or per-frame follower A*', faction => {
    const h = harness(faction, true)
    const targets = h.residents.map(r => vi.spyOn(r.npc as any, '_getTarget'))
    const loops = [0, 0], exited = new Set<string>(), visited = [new Set<number>(), new Set<number>()]
    let minSpacing = Infinity
    const path = vi.spyOn(h.navigation.grid, 'findPathCells')
    for (let frame = 0; frame < 3300; frame++) {
      const previous = h.residents.map(r => r.npc.combatPosition.clone())
      const waypoints = h.controller.squads.map(s => s.waypoint)
      h.step()
      h.controller.squads.forEach((s, i) => { if (s.state === 'PATROLLING') { visited[i].add(s.waypoint); if (s.waypoint < waypoints[i]) loops[i]++ } })
      h.residents.forEach((r, i) => {
        const p = r.npc.combatPosition
        expect(p.distanceTo(previous[i]), r.spec.id).toBeLessThan(2)
        for (const gate of TOWN_GATES) {
          const axis = gate.id === 'east' || gate.id === 'west' ? 'x' : 'z', other = axis === 'x' ? 'z' : 'x'
          if ((previous[i][axis] - gate[axis]) * (p[axis] - gate[axis]) >= 0) continue
          const along = previous[i][other] + (p[other] - previous[i][other]) * (gate[axis] - previous[i][axis]) / (p[axis] - previous[i][axis])
          const onWall = other === 'x' ? along >= TOWN_CITY.minX && along <= TOWN_CITY.maxX : along >= TOWN_CITY.minZ && along <= TOWN_CITY.maxZ
          if (onWall) expect(Math.abs(along - gate[other]), `${r.spec.id} crossing ${gate.id}`).toBeLessThan(TOWN_CITY.gateWidth / 2 - 1)
        }
        for (let j = i + 1; j < h.residents.length; j++) {
          const q = h.residents[j].npc.combatPosition
          minSpacing = Math.min(minSpacing, Math.hypot(p.x - q.x, p.z - q.z))
        }
        if (p.x > TOWN_CITY.maxX + 2 || p.x < TOWN_CITY.minX - 2 || p.z > TOWN_CITY.maxZ + 2 || p.z < TOWN_CITY.minZ - 2) exited.add(r.spec.id)
      })
    }
    expect(minSpacing).toBeGreaterThan(1.5)
    expect(exited.size).toBe(40); expect(loops.every(n => n >= 1)).toBe(true)
    expect(visited.map(points => points.size)).toEqual([h.controller.route.length, h.controller.route.length])
    for (const target of targets) expect(target).not.toHaveBeenCalled()
    expect(path.mock.calls.length).toBeLessThan(400)
    for (const squad of h.controller.squads) {
      const leader = h.residents.find(r => r.spec.id === squad.activeLeaderActorId)!.npc
      for (const r of squad.members) expect(r.npc.combatPosition.distanceTo(leader.combatPosition), r.spec.id).toBeLessThan(70)
    }
  }, 60000)
})

describe('Patrol mission return and barracks refit', () => {
  it.each(['roman', 'viking'] as const)('restores all 40 %s identities at distinct, navigable real Barracks slots independent of startup positions and roster order', faction => {
    const h = harness(faction, true)
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
      expect(controller.returnStateFor(actorId)).toBe('REJOIN_PATROL')
      expect(controller.isReserveAvailable(actorId)).toBe(true)
    }
    expect(points).toHaveLength(40)
  })

  it('finishes a rear ordinary follower rejoin at its own slot while remaining farther than nine metres from the leader', () => {
    const h = harness('roman', true), resident = h.residents[19], squad = h.controller.squads[0]
    h.step(800)
    expect(h.controller.relinquish(resident.spec.id)).toBe(true)
    resident.npc.takeDamage(999999)
    h.controller.beginMissionReturn(resident.spec.id)
    expect(h.controller.returnStateFor(resident.spec.id)).toBe('REJOIN_PATROL')
    for (let frame = 0; frame < 2500 && h.controller.returnStateFor(resident.spec.id); frame++) {
      const previous = resident.npc.combatPosition.clone()
      h.step()
      expect(resident.npc.combatPosition.distanceTo(previous)).toBeLessThan(2)
    }
    expect(resident.npc.activeFollowSlotIndex).toBeGreaterThanOrEqual(15)
    expect(resident.npc.activeFollowTarget?.combatantId).toBe(squad.activeLeaderActorId)
    expect(h.controller.returnStateFor(resident.spec.id)).toBeNull()
    expect(resident.npc.combatPosition.distanceTo(resident.npc.activeFollowTarget!.combatPosition)).toBeGreaterThan(9)
    expect(resident.npc.isFormationTargetReached(-1)).toBe(true)
  }, 20000)

  it('keeps physical return ownership when an ambient bandit is nearby, without combat enrollment or a spawn reset', () => {
    const h = harness('roman', true), resident = h.residents[1]
    h.controller.relinquish(resident.spec.id)
    resident.homeMount.group.position.set(20, getTerrainHeight(20, 140), 140)
    resident.npc.takeDamage(30)
    h.controller.beginMissionReturn(resident.spec.id)
    const bandit = combatActor('ambient-return-threat', Faction.BANDIT)
    bandit.group.position.copy(resident.npc.combatPosition)
    const combat = combatFixture({ simulation: {
      residents: h.residents, navigation: h.navigation, obstacles: h.obstacles, cameraPosition: h.camera,
      ownsPeacefulTravel: npc => h.controller.returnStateFor(npc.combatantId) !== null,
      preparePeaceResidents: excluded => h.controller.beginFrame(excluded),
      peaceResident: (r, dt) => { h.controller.updateResident(r, dt, h.camera, h.obstacles, h.navigation) },
    } })
    combat.field.ambientBandits = [bandit]; combat.field.fieldNpcs = [bandit]
    const enroll = vi.spyOn(resident.npc, 'beginExternalThreat'), targetSearch = vi.spyOn(resident.npc as any, '_getTarget')
    const start = resident.npc.combatPosition.clone(), hp = resident.npc.hp
    for (let frame = 0; frame < 30; frame++) {
      const previous = resident.npc.combatPosition.clone()
      combat.combat.update(.1, 0, frame / 10)
      expect(resident.npc.combatPosition.distanceTo(previous)).toBeLessThan(2)
    }
    expect(resident.npc.combatPosition.distanceTo(start)).toBeGreaterThan(1)
    expect(enroll).not.toHaveBeenCalled(); expect(targetSearch).not.toHaveBeenCalled()
    expect(resident.npc.hp).toBe(hp)
    expect(h.controller.returnStateFor(resident.spec.id)).toBe('RETURN_TO_BARRACKS')
    combat.field.ambientBandits = []; combat.field.fieldNpcs = []
    const previous = resident.npc.combatPosition.clone()
    combat.combat.update(.1, 0, 3)
    expect(resident.npc.combatPosition.distanceTo(previous)).toBeLessThan(2)
    expect(h.controller.returnStateFor(resident.spec.id)).toBe('RETURN_TO_BARRACKS')
  })

  it('resumes ordinary Patrol navigation at its actual position after an ambient threat ends', () => {
    const h = harness(), captain = h.residents[0]
    h.step(250)
    const bandit = combatActor('ambient-patrol-threat', Faction.BANDIT)
    bandit.group.position.copy(captain.npc.combatPosition)
    const combat = combatFixture({ simulation: {
      residents: h.residents, navigation: h.navigation, cameraPosition: h.camera,
      preparePeaceResidents: excluded => h.controller.beginFrame(excluded),
      peaceResident: (r, dt) => { h.controller.updateResident(r, dt, h.camera, h.obstacles, h.navigation) },
    } })
    h.residents.forEach(r => vi.spyOn(r.npc, 'update').mockImplementation(() => {}))
    combat.field.ambientBandits = [bandit]; combat.field.fieldNpcs = [bandit]
    combat.combat.update(.1, 0, 0)
    expect(captain.npc.formationCommandId).toBeNull()
    combat.field.ambientBandits = []; combat.field.fieldNpcs = []
    const previous = captain.npc.combatPosition.clone()
    combat.combat.update(.1, 0, .1)
    expect(captain.npc.combatPosition.distanceTo(previous)).toBeLessThan(2)
    for (let frame = 0; frame < 20; frame++) combat.combat.update(.1, 0, .2 + frame / 10)
    expect(captain.npc.combatPosition.distanceTo(previous)).toBeGreaterThan(1)
    expect(captain.npc.formationCommandId).toBe(-3)
  })

  it('chooses another deputy when the acting leader is borrowed while a refitted Captain remains far away', () => {
    const h = harness(), [captain, deputy, replacement] = h.residents, squad = h.controller.squads[0]
    h.step(800); h.controller.relinquish(captain.spec.id); h.step(20)
    expect(squad.activeLeaderActorId).toBe(deputy.spec.id)
    captain.npc.takeDamage(999999)
    h.controller.beginMissionReturn(captain.spec.id)
    expect(h.controller.returnStateFor(captain.spec.id)).toBe('REJOIN_PATROL')
    expect(captain.npc.combatPosition.distanceTo(replacement.npc.combatPosition)).toBeGreaterThan(9)
    h.controller.relinquish(deputy.spec.id); h.step()
    expect(squad.activeLeaderActorId).toBe(replacement.spec.id)
    expect(captain.npc.activeFollowTarget).toBe(replacement.npc)
    for (let frame = 0; frame < 2500 && squad.activeLeaderActorId !== captain.spec.id; frame++) h.step()
    expect(squad.activeLeaderActorId).toBe(captain.spec.id)
  }, 20000)

  it('elects a deputy when a borrowed Captain is restored at Barracks before the next frame', () => {
    const h = harness('roman', true), [captain, deputy] = h.residents, squad = h.controller.squads[0]
    h.step(800)
    expect(squad.activeLeaderActorId).toBe(captain.spec.id)
    h.controller.relinquish(captain.spec.id)
    captain.npc.takeDamage(999999)
    h.controller.beginMissionReturn(captain.spec.id)
    expectBarracksRefitPoint(captain.npc.combatPosition)
    expect(h.controller.isReserveAvailable(captain.spec.id)).toBe(true)
    expect(captain.npc.combatPosition.distanceTo(deputy.npc.combatPosition)).toBeGreaterThan(9)
    h.step()
    expect(squad.activeLeaderActorId).toBe(deputy.spec.id)
    expect(captain.npc.activeFollowTarget).toBe(deputy.npc)
    expect(h.controller.returnStateFor(captain.spec.id)).toBe('REJOIN_PATROL')
  })

  it('lets a refitted Captain lead when it is the only remaining available squad member', () => {
    const h = harness(), captain = h.residents[0], squad = h.controller.squads[0]
    h.step(100)
    for (const member of squad.members) h.controller.relinquish(member.spec.id)
    h.step(); expect(squad.state).toBe('PAUSED')
    captain.npc.takeDamage(999999); h.controller.beginMissionReturn(captain.spec.id)
    h.step()
    expect(squad.activeLeaderActorId).toBe(captain.spec.id)
    expect(h.controller.returnStateFor(captain.spec.id)).toBeNull()
  })

  it.each([1, 0, 20])('resident %i physically rides home with mission wounds and loadout, refits at barracks, and can be borrowed during rejoin', index => {
    const h = harness('roman', true), resident = h.residents[index]
    h.step(500)
    const originalEquipment = { weapon: resident.npc.meleeWeaponId, shield: resident.npc.shieldId, tier: resident.npc.tier }
    expect(h.controller.relinquish(resident.spec.id)).toBe(true)
    resident.homeMount.group.position.set(20, getTerrainHeight(20, 140), 140)
    resident.npc.applyTemporaryCombatLoadout(townMilitaryEquipment('roman', 'lancer_cavalry').loadout, 3)
    resident.npc.takeDamage(30); resident.homeMount.takeDamage(40)
    resident.npc.shield.absorb(0, 2)
    const hp = resident.npc.hp, mountHp = resident.homeMount.currentHp, missionWeapon = resident.npc.meleeWeaponId
    const before = resident.npc.combatPosition.clone(), targetSearch = vi.spyOn(resident.npc as any, '_getTarget')
    const restore = vi.spyOn(resident.npc, 'restoreForTown')
    expect(h.controller.beginMissionReturn(resident.spec.id)).toBe(true)
    expect(resident.npc.combatPosition.equals(before)).toBe(true)
    expect(h.controller.returnStateFor(resident.spec.id)).toBe('RETURN_TO_BARRACKS')
    expect(h.controller.isReserveAvailable(resident.spec.id)).toBe(false)
    expect(h.controller.relinquish(resident.spec.id)).toBe(false)
    h.step(20)
    expect(resident.npc.combatPosition.distanceTo(before)).toBeGreaterThan(1)
    expect(resident.npc.hp).toBe(hp); expect(resident.homeMount.currentHp).toBe(mountHp)
    expect(resident.npc.meleeWeaponId).toBe(missionWeapon); expect(restore).not.toHaveBeenCalled()
    for (let i = 0; i < 2500 && h.controller.returnStateFor(resident.spec.id) === 'RETURN_TO_BARRACKS'; i++) {
      const previous = resident.npc.combatPosition.clone()
      h.step()
      expect(resident.npc.combatPosition.distanceTo(previous)).toBeLessThan(2)
    }
    expect(restore).toHaveBeenCalledTimes(1)
    const refitPoint = restore.mock.calls[0][0]!
    expectBarracksRefitPoint(refitPoint)
    expect(resident.npc.combatPosition.x).toBe(refitPoint.x); expect(resident.npc.combatPosition.z).toBe(refitPoint.z)
    expect(Math.hypot(refitPoint.x - resident.spec.x, refitPoint.z - resident.spec.z)).toBeGreaterThan(20)
    expect(h.controller.returnStateFor(resident.spec.id)).toBe('REJOIN_PATROL')
    expect(resident.npc.hpRatio).toBe(1); expect(resident.homeMount.currentHp).toBe(resident.homeMount.maxHp)
    expect(resident.npc.mount).toBe(resident.homeMount); expect(resident.npc.combatAmmo).toBe(0)
    expect(resident.npc.shield.shieldImpactRemaining).toBe(resident.npc.shield.shieldImpactMax)
    expect({ weapon: resident.npc.meleeWeaponId, shield: resident.npc.shieldId, tier: resident.npc.tier }).toEqual(originalEquipment)
    expect(targetSearch).not.toHaveBeenCalled()
    expect(h.controller.isReserveAvailable(resident.spec.id)).toBe(true)
    expect(h.controller.relinquish(resident.spec.id)).toBe(true)
    resident.npc.assignFormationTarget(988, new THREE.Vector3(70, 0, 60), new THREE.Vector3(0, 0, 1))
    h.step(10)
    expect(resident.npc.formationCommandId).toBe(988)
    expect(h.controller.returnStateFor(resident.spec.id)).toBeNull()
  }, 20000)

  it.each([1, 0, 20])('resident %i walks through real navigation after its Horse dies and replaces it only at barracks', index => {
    const h = harness('roman', true), resident = h.residents[index]
    h.step(500); h.controller.relinquish(resident.spec.id)
    resident.homeMount.group.position.set(20, getTerrainHeight(20, 140), 140)
    resident.homeMount.takeDamage(999999); resident.npc.takeDamage(30)
    const horsePosition = resident.homeMount.group.position.clone(), hp = resident.npc.hp
    const restoreHorse = vi.spyOn(resident.homeMount, 'restoreForTown'), targetSearch = vi.spyOn(resident.npc as any, '_getTarget')
    h.controller.beginMissionReturn(resident.spec.id)
    expect(resident.npc.isMounted).toBe(false)
    h.step(20)
    expect(resident.npc.combatPosition.distanceTo(horsePosition)).toBeGreaterThan(1)
    expect(resident.npc.hp).toBe(hp); expect(resident.homeMount.dead).toBe(true)
    expect(resident.homeMount.group.position.equals(horsePosition)).toBe(true); expect(restoreHorse).not.toHaveBeenCalled()
    for (let i = 0; i < 2500 && h.controller.returnStateFor(resident.spec.id) === 'RETURN_TO_BARRACKS'; i++) {
      const previous = resident.npc.combatPosition.clone()
      h.step()
      expect(resident.npc.combatPosition.distanceTo(previous)).toBeLessThan(2)
    }
    expect(restoreHorse).toHaveBeenCalledTimes(1)
    const [x, z, yaw] = restoreHorse.mock.calls[0]
    expectBarracksRefitPoint({ x, z, yaw })
    expect(resident.npc.combatPosition.x).toBe(x); expect(resident.npc.combatPosition.z).toBe(z)
    expect(h.controller.returnStateFor(resident.spec.id)).toBe('REJOIN_PATROL')
    expect(resident.npc.mount).toBe(resident.homeMount); expect(resident.npc.hpRatio).toBe(1)
    expect(resident.homeMount.dead).toBe(false); expect(resident.homeMount.type).toBe(MountType.HORSE)
    expect(targetSearch).not.toHaveBeenCalled()
  }, 20000)

  it('replaces a dead Captain with the same actor and original Horse at barracks, then retains the deputy until physical reunion', () => {
    const h = harness('roman', true), [captain, deputy] = h.residents, squad = h.controller.squads[0]
    h.step(800); h.controller.relinquish(captain.spec.id); h.step(20)
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
    expect(npc.mount).toBe(mount); expect(mount.type).toBe(MountType.HORSE); expect(mount.currentHp).toBe(mount.maxHp)
    expect(h.controller.isReserveAvailable(actorId)).toBe(true)
    h.step()
    expect(squad.activeLeaderActorId).toBe(deputy.spec.id)
    expect(h.controller.returnStateFor(actorId)).toBe('REJOIN_PATROL')
    for (let i = 0; i < 2500 && squad.activeLeaderActorId !== actorId; i++) h.step()
    expect(squad.activeLeaderActorId).toBe(actorId)
    expect(h.controller.returnStateFor(actorId)).toBeNull()
    expect(deputy.npc.activeFollowTarget).toBe(npc)
  }, 20000)

  it('starts a new Town controller with the normal Patrol startup formation and no previous return state', () => {
    const h = harness(), resident = h.residents[1]
    h.controller.relinquish(resident.spec.id)
    resident.homeMount.group.position.set(50, getTerrainHeight(50, 140), 140)
    h.controller.beginMissionReturn(resident.spec.id)
    expect(h.controller.isReserveAvailable(resident.spec.id)).toBe(false)
    const reload = harness(), sameActor = reload.residents.find(r => r.spec.id === resident.spec.id)!
    expect(reload.controller.returnStateFor(sameActor.spec.id)).toBeNull()
    expect(reload.controller.isReserveAvailable(sameActor.spec.id)).toBe(true)
    expect(sameActor.npc.combatPosition.x).toBe(sameActor.spec.x)
    expect(sameActor.npc.combatPosition.z).toBe(sameActor.spec.z)
    expect(sameActor.npc.hpRatio).toBe(1)
    const position = sameActor.npc.combatPosition.clone()
    reload.step(20)
    expect(sameActor.npc.combatPosition.distanceTo(position)).toBeGreaterThan(1)
  })
})
