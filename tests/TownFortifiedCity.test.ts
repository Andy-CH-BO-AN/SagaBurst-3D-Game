import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTownFortifications } from '../src/town/TownFortifications'
import { TOWN_CITY, TOWN_GATES, TOWN_CITY_ROADS, townGatePoint, townSceneryExcluded } from '../src/town/TownLayout'
import { TownEvent, townRoster, townMilitaryEquipment, townSettlementRoster, townAssaultObjectiveRoster } from '../src/town/TownRules'
import { TownWorld } from '../src/town/TownWorld'
import { siegeDefensePlans } from '../src/career/TownSiege'
import { createEnemyTownAssaultMission } from '../src/career/EnemyTownAssault'
import { NavigationWorld } from '../src/navigation/NavigationWorld'
import { findBlockingProjectileObstacleAlongPath, getTerrainHeight, resolveObstacleCollision, type ObstacleData } from '../src/world/Terrain'
import { UNIT_PRESETS } from '../src/battle/UnitPresetCatalog'
import { CampaignBreachController } from '../src/campaign/CampaignGate'
import { ObstacleCollisionSpatialIndex } from '../src/world/ObstacleCollisionSpatialIndex'

afterEach(() => vi.unstubAllGlobals())

function fortifications(faction: 'roman' | 'viking') {
  const obstacles: ObstacleData[] = []
  const material = new THREE.MeshStandardMaterial()
  const result = createTownFortifications(faction, obstacles, { stone: material, wood: material, dark: material, snow: material })
  const dispose = () => {
    const geometries = new Set<THREE.BufferGeometry>()
    result.root.traverse(child => { if (child instanceof THREE.Mesh) { geometries.add(child.geometry); if (child instanceof THREE.InstancedMesh) child.dispose() } })
    geometries.forEach(geometry => geometry.dispose()); material.dispose()
  }
  return { ...result, obstacles, dispose }
}

describe('Fortified city explicit rosters', () => {
  it('distributes the complete military roster into four disjoint gate defense plans', () => {
    const roster = townRoster(), groups = siegeDefensePlans([...roster].reverse())
    expect(roster).toHaveLength(225)
    expect(new Set(roster.map(actor => actor.id)).size).toBe(225)
    expect(groups).toHaveLength(4)
    const ids = groups.flatMap(group => [...group.infantry, ...group.cavalry])
    expect(ids).toHaveLength(203); expect(new Set(ids).size).toBe(203)
    expect(roster.filter(actor => actor.defenseGroup).every(actor => actor.duty === 'training' && actor.training && !actor.mounted)).toBe(true)
    for (const [prefix, count, role] of [['melee_cavalry', 5, 'melee_infantry'], ['lancer_cavalry', 5, 'spearman_infantry'], ['ranged_cavalry', 10, 'ranged_infantry']] as const) {
      for (let i = 0; i < count; i++) expect(roster.find(actor => actor.id === `${prefix}-${i}`)).toMatchObject({ role, mounted: false, duty: 'training', training: true })
    }
  })

  it.each(['roman', 'viking'] as const)('equips sixty %s T2 riders, twenty per actual preset, separately from infantry', faction => {
    const roster = townRoster().filter(actor => actor.training && actor.mounted)
    expect(roster).toHaveLength(60)
    for (const kind of ['sword_cavalry', 'lancer', 'horse_archer']) {
      expect(roster.filter(actor => townMilitaryEquipment(faction, actor).presetId === `${faction}_${kind}`)).toHaveLength(20)
    }
    for (const actor of roster) {
      const equipment = townMilitaryEquipment(faction, actor)
      expect(actor).toMatchObject({ tier: 2, duty: 'training', settlementObjective: false, assaultObjective: false })
      expect(actor.defenseGroup).toBeUndefined()
      expect(equipment.tier).toBe(2); expect(equipment.loadout).toEqual(UNIT_PRESETS[equipment.presetId].tierLoadouts[2]); expect(equipment.loadout.mountId).toBe('horse')
      if (faction === 'viking' && actor.unitKind === 'sword_cavalry') expect(equipment.loadout.meleeWeaponId).toBe('viking_axe_t2')
    }
    for (let i = 0; i < roster.length; i++) for (let j = i + 1; j < roster.length; j++) {
      expect(Math.hypot(roster[i].x - roster[j].x, roster[i].z - roster[j].z)).toBeGreaterThanOrEqual(6)
    }
  })

  it.each(['roman', 'viking'] as const)('assigns forty %s T2 guards, four swords/axes, three spears and three real archers at each gate', faction => {
    const guards = townRoster().filter(actor => actor.duty === 'gate_guard')
    expect(guards).toHaveLength(40)
    for (const gate of TOWN_GATES) {
      const group = guards.filter(actor => actor.gateId === gate.id)
      expect(group).toHaveLength(10)
      expect(group.filter(actor => actor.unitKind === 'melee')).toHaveLength(4)
      expect(group.filter(actor => actor.unitKind === 'spearman')).toHaveLength(3)
      const archers = group.filter(actor => actor.unitKind === 'archer'); expect(archers).toHaveLength(3)
      archers.forEach(actor => expect(townMilitaryEquipment(faction, actor).presetId).toBe(`${faction}_archer`))
      for (const actor of group) {
        expect(actor).toMatchObject({ tier: 2, mounted: false, training: false, yaw: gate.yaw })
        expect(actor.defenseGroup).toBeUndefined()
        const side = (actor.x - gate.x) * Math.cos(gate.yaw) - (actor.z - gate.z) * Math.sin(gate.yaw)
        const inward = -(actor.x - gate.x) * Math.sin(gate.yaw) - (actor.z - gate.z) * Math.cos(gate.yaw)
        expect(Math.abs(side)).toBeGreaterThan(TOWN_CITY.gateWidth / 2 + 2); expect(inward).toBeGreaterThan(0)
      }
    }
  })

  it('settles using explicit principals while living ambient troops do not block completion', () => {
    const roster = townRoster(), event = new TownEvent(townSettlementRoster(roster))
    event.hostile = true
    roster.forEach(actor => event.register(actor.id, { dead: actor.settlementObjective }))
    event.complete(); expect(event.actors.size).toBe(85); expect(event.evaluate(false)).toBe('town_defeated')
    expect(event.evaluate(true)).toBe('player_defeated')
    const missing = new TownEvent(); townSettlementRoster().slice(1).forEach(actor => missing.register(actor.id, { dead: true }))
    expect(() => missing.complete()).toThrow('objective roster incomplete')
  })

  it('assault acceptance targets exactly the scripted military identities, independent of ambient troops', () => {
    const mission = createEnemyTownAssaultMission('fortified-assault')
    expect(mission.targetActorIds).toEqual(townAssaultObjectiveRoster().map(actor => actor.id))
    expect(mission.targetActorIds).toHaveLength(203)
    const all = new Set(townRoster().map(actor => actor.id))
    expect(mission.targetActorIds.every(id => all.has(id))).toBe(true)
    expect(mission.targetActorIds.some(id => id.startsWith('gate:') || id.startsWith('cavalry-training:'))).toBe(true)
    expect(mission.civilianActorIds).toHaveLength(20)
  })
})

describe.each(['roman', 'viking'] as const)('%s fortified city physical perimeter', faction => {
  it('starts all four gates open with rotated leaves, no doorway collision and no breach event', () => {
    const city = fortifications(faction), breach = new CampaignBreachController(), callback = vi.fn(); breach.onBreach(callback)
    expect(city.gates.size).toBe(4)
    for (const gate of city.gates.values()) {
      expect(gate.state).toBe('open'); expect(city.obstacles.some(obstacle => obstacle.damageable === gate.damageable)).toBe(false)
      const leaves = gate.damageable.root.children
      expect(leaves[0].rotation.y).toBeCloseTo(Math.PI / 2); expect(leaves[1].rotation.y).toBeCloseTo(-Math.PI / 2)
      gate.open(); expect(gate.state).toBe('open')
    }
    expect(breach.breached).toBe(false); expect(callback).not.toHaveBeenCalled()
    if (faction === 'roman') expect(TOWN_GATES.every(gate => city.root.getObjectByName(`town-${gate.id}-gate`)?.getObjectByName('roman-stone-arch'))).toBe(true)
    else expect(city.wallRoot.getObjectByName('town-palisade-stakes')).toBeInstanceOf(THREE.InstancedMesh)
    city.dispose()
  })

  it('allows foot and mounted movement through open gates and blocks both bodies and projectiles when closed', () => {
    const city = fortifications(faction)
    for (const spec of TOWN_GATES) {
      const gate = city.gates.get(spec.id)!
      const inside = townGatePoint(spec, 0, 3), outside = townGatePoint(spec, 0, -3)
      const start = new THREE.Vector3(inside.x, getTerrainHeight(spec.x, spec.z) + 1.5, inside.z)
      const end = new THREE.Vector3(outside.x, start.y, outside.z)
      expect(findBlockingProjectileObstacleAlongPath(start, end, city.obstacles)).toBeNull()
      for (const [radius, height, bottomOffset] of [[.42, 1.8, .9], [1.05, 3.2, 0]]) {
        const from = new THREE.Vector3(inside.x, getTerrainHeight(spec.x, spec.z) + bottomOffset, inside.z)
        const position = new THREE.Vector3(spec.x, from.y, spec.z)
        resolveObstacleCollision(position, from, 0, true, radius, height, bottomOffset, city.obstacles)
        expect(position.x).toBeCloseTo(spec.x); expect(position.z).toBeCloseTo(spec.z)
        gate.close()
        const closedPosition = new THREE.Vector3(spec.x, from.y, spec.z)
        resolveObstacleCollision(closedPosition, from, 0, true, radius, height, bottomOffset, city.obstacles)
        expect(Math.hypot(closedPosition.x - spec.x, closedPosition.z - spec.z)).toBeGreaterThan(.4)
        expect(findBlockingProjectileObstacleAlongPath(start, end, city.obstacles)?.damageable).toBe(gate.damageable)
        expect(gate.damageable.root.children.every(hinge => hinge.rotation.y === 0)).toBe(true)
        gate.open()
      }
      expect(gate.destroy()).toBe(true); expect(gate.state).toBe('destroyed'); expect(gate.open()).toBe(false); expect(gate.close()).toBe(false)
      expect(findBlockingProjectileObstacleAlongPath(start, end, city.obstacles)).toBeNull()
    }
    city.dispose()
  })

  it('keeps the complete perimeter sealed when closed and reconnects navigation through each open gate', () => {
    const city = fortifications(faction), navigation = new NavigationWorld()
    for (const gate of city.gates.values()) gate.close()
    navigation.sync(city.obstacles)
    for (const spec of TOWN_GATES) expect(navigation.areConnected({ x: 0, z: 0 }, townGatePoint(spec, 0, -10))).toBe(false)
    for (const spec of TOWN_GATES) {
      city.gates.get(spec.id)!.open(); navigation.sync(city.obstacles)
      expect(navigation.areConnected({ x: 0, z: 0 }, townGatePoint(spec, 0, -10))).toBe(true)
      city.gates.get(spec.id)!.close(); navigation.sync(city.obstacles)
    }
    for (const wall of city.walls) {
      const center = wall.box.getCenter(new THREE.Vector3()); center.y = getTerrainHeight(center.x, center.z) + 1.5
      const horizontal = wall.box.max.x - wall.box.min.x > wall.box.max.z - wall.box.min.z
      const offset = new THREE.Vector3(horizontal ? 0 : 4, 0, horizontal ? 4 : 0)
      expect(findBlockingProjectileObstacleAlongPath(center.clone().sub(offset), center.clone().add(offset), city.obstacles)).toBe(wall)
    }
    city.dispose()
  })

  it('refreshes navigation and local collision when different gates swap states at the same obstacle count', () => {
    const city = fortifications(faction), navigation = new NavigationWorld(), collision = new ObstacleCollisionSpatialIndex()
    for (const gate of city.gates.values()) gate.close()
    const north = city.gates.get('north')!, south = city.gates.get('south')!
    north.open(); navigation.sync(city.obstacles); collision.sync(city.obstacles)
    const count = city.obstacles.length
    expect(collision.queryNear(0, TOWN_CITY.minZ, 1).some(obstacle => obstacle.damageable === north.damageable)).toBe(false)
    north.close(); south.open()
    expect(city.obstacles.length).toBe(count)
    expect(navigation.sync(city.obstacles)).toBe(true)
    expect(navigation.grid.isBlocked(navigation.grid.worldToCell({ x: 0, z: TOWN_CITY.minZ })!)).toBe(true)
    expect(navigation.grid.isBlocked(navigation.grid.worldToCell({ x: 0, z: TOWN_CITY.maxZ })!)).toBe(false)
    collision.sync(city.obstacles)
    expect(collision.queryNear(0, TOWN_CITY.minZ, 1).some(obstacle => obstacle.damageable === north.damageable)).toBe(true)
    expect(collision.queryNear(0, TOWN_CITY.maxZ, 1).some(obstacle => obstacle.damageable === south.damageable)).toBe(false)
    city.dispose()
  })

  it('builds the complete world with unobstructed training spawns, four navigable roads and placement-time scenery exclusions', () => {
    const context = new Proxy({ measureText: () => ({ width: 100 }) }, { get: (target, key) => (target as any)[key] ?? (() => {}) })
    vi.stubGlobal('ImageData', class { constructor(public data: unknown, public width: number, public height: number) {} })
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => context }) })
    const world = new TownWorld(faction, new THREE.Scene())
    const navigation = new NavigationWorld(); navigation.sync(world.obstacles)
    for (const actor of townRoster().filter(actor => actor.duty === 'training' || actor.duty === 'gate_guard')) {
      const groundY = getTerrainHeight(actor.x, actor.z)
      const body = new THREE.Box3(new THREE.Vector3(actor.x - (actor.mounted ? 1.1 : .45), groundY + .1, actor.z - (actor.mounted ? 1.8 : .45)),
        new THREE.Vector3(actor.x + (actor.mounted ? 1.1 : .45), groundY + (actor.mounted ? 3.5 : 1.8), actor.z + (actor.mounted ? 1.8 : .45)))
      expect(world.obstacles.some(obstacle => obstacle.box.intersectsBox(body)), actor.id).toBe(false)
      expect(navigation.areConnected({ x: 0, z: 0 }, actor), actor.id).toBe(true)
    }
    for (const gate of TOWN_GATES) expect(navigation.areConnected({ x: 0, z: 0 }, townGatePoint(gate, 0, -12))).toBe(true)
    expect(townSceneryExcluded(100, -80, 7)).toBe(true)
    for (const road of TOWN_CITY_ROADS) expect(townSceneryExcluded((road.ax + road.bx) / 2, (road.az + road.bz) / 2, 7)).toBe(true)
    expect(world.camps).toHaveLength(5)
    const staticWalls = world.fortifications.wallRoot.children.filter(child => child instanceof THREE.Mesh)
    expect(staticWalls.length).toBeLessThanOrEqual(faction === 'roman' ? 1 : 3)
    world.dispose()
  })
})
