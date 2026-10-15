import { createTownFortifications } from '../../src/town/TownFortifications'
import { Player } from '../../src/player/Player'
import * as THREE from 'three'
import { describe, expect, it, onTestFinished } from 'vitest'
import { getTownRampartLayout, townRampartHeight, createTownRamparts } from '../../src/town/TownRamparts'
import { TownLayeredNavigation } from '../../src/navigation/TownLayeredNavigation'
import { NavigationWorld } from '../../src/navigation/NavigationWorld'
import { getTerrainHeight, getWalkRampHeight, resolveObstacleCollision, type ObstacleData } from '../../src/world/Terrain'
import { townRoster } from '../../src/town/TownRules'
import { TOWN_GATES } from '../../src/town/TownLayout'
import { NPC, AIType, Faction } from '../../src/world/NPC'

// Town-specific perimeter geometry/routing; shared ramp physics remains owned by OutpostLayeredNavigation.
describe('Town perimeter and mounted access layout', () => {
  it('connects four gatehouses and four corners without losing the 6.4 metre surface', () => {
    const layout = getTownRampartLayout()
    for (const gate of TOWN_GATES) {
      const x = gate.x - Math.sin(gate.yaw) * 4.4, z = gate.z - Math.cos(gate.yaw) * 4.4
      expect(townRampartHeight(layout, x, z), gate.id).not.toBeNull()
    }
    for (const corner of layout.corners) {
      expect(townRampartHeight(layout, corner.x, corner.z)).toBeCloseTo(corner.y)
    }
    expect(layout.decks.filter(d => !d.id.startsWith('landing:')).every(d => d.surface.halfWidth === 3.2)).toBe(true)
    for (const ramp of layout.ramps) {
      expect((ramp.surface.topY - ramp.surface.startY) / ramp.surface.length, ramp.gateId).toBeLessThanOrEqual(.42)
      expect(ramp.surface.halfWidth).toBe(2)
      expect(ramp.surface.mounted).toBe(true)
      const horizontal = ramp.gateId === 'north' || ramp.gateId === 'south'
      expect(Math.abs(horizontal ? ramp.surface.dirX : ramp.surface.dirZ)).toBeCloseTo(1)
      expect(townRampartHeight(layout, ramp.connection.x, ramp.connection.z)).toBeCloseTo(ramp.surface.topY)
    }
  })

  it('uses continuous elevated routes around all four corners and distinct Follow slots', () => {
    const layout = getTownRampartLayout(), nav = new TownLayeredNavigation(layout)
    const current = layout.corners[0].clone(), out = new THREE.Vector3()
    for (const target of [...layout.corners.slice(1), layout.corners[0]]) {
      for (let step = 0; step < 500 && current.distanceTo(target) > .3; step++) {
        expect(nav.resolveMoveTarget(current, target, out)?.ground).toBe(false)
        const delta = out.clone().sub(current); current.addScaledVector(delta, Math.min(1, .8 / delta.length()))
        current.y = townRampartHeight(layout, current.x, current.z)!
        expect(nav.isElevated(current)).toBe(true)
      }
      expect(current.distanceTo(target)).toBeLessThan(.3)
    }
    const slots = Array.from({ length: 30 }, (_, i) => { const p = new THREE.Vector3(); nav.clampFollow(p, current, i, true); return p })
    expect(new Set(slots.map(p => `${p.x}:${p.z}`)).size).toBe(30)
    expect(slots.every(p => nav.isElevated(p))).toBe(true)
  })

  it('assigns only the existing ordinary population to 42 ranged, 58 foot and 60 mounted stations', () => {
    const roster = townRoster(), layout = getTownRampartLayout()
    for (const [kind, count] of [['rampart', 42], ['gate', 58], ['reserve', 60]] as const) expect(roster.filter(a => a.garrison?.kind === kind)).toHaveLength(count)
    expect(TOWN_GATES.map(g => roster.filter(a => a.garrison?.kind === 'rampart' && a.garrison.gateId === g.id).length)).toEqual([10, 10, 11, 11])
    expect(TOWN_GATES.map(g => roster.filter(a => a.garrison?.kind === 'reserve' && a.garrison.gateId === g.id).length)).toEqual([15, 15, 15, 15])
    expect(roster.filter(a => a.duty === 'patrol')).toHaveLength(40)
    expect(roster.filter(a => a.role === 'civilian')).toHaveLength(20)
    expect(roster.filter(a => a.duty === 'service' || a.duty === 'patrol' || a.duty === 'eagle_garrison').every(a => !a.garrison)).toBe(true)
    const stations = roster.flatMap(a => a.garrison?.kind === 'rampart' ? [a.garrison] : [])
    for (const p of stations) expect(townRampartHeight(layout, p.x, p.z)).toBeCloseTo(p.y)
    for (let i = 0; i < stations.length; i++) for (let j = i + 1; j < stations.length; j++) expect(Math.hypot(stations[i].x - stations[j].x, stations[i].z - stations[j].z)).toBeGreaterThan(1)
  })

  it('follows a leader stopped midway on a ramp without routing past them to its summit', () => {
    const layout = getTownRampartLayout(), nav = new TownLayeredNavigation(layout), s = layout.ramps[0].surface
    const point = (fraction: number) => new THREE.Vector3(s.startX + s.dirX * s.length * fraction,
      s.startY + (s.topY - s.startY) * fraction, s.startZ + s.dirZ * s.length * fraction)
    const out = new THREE.Vector3(), goal = point(.5)
    for (const current of [point(.2), point(.8)]) {
      expect(nav.resolveMoveTarget(current, goal, out)?.ground).toBe(false)
      expect(out).toEqual(goal)
    }
  })

  it.each(['north', 'south', 'east', 'west'])('walks a real NPC up and down the %s ramp with production collision', gateId => {
    // One real NPC: tests the caller's route + gravity + collider integration, not a full Town population.
    const layout = getTownRampartLayout(), obstacles: ObstacleData[] = [], material = new THREE.MeshBasicMaterial()
    const root = createTownRamparts(layout, obstacles, material, material)
    const scene = new THREE.Scene(), nav = new NavigationWorld()
    nav.setTownRamparts(layout); nav.sync(obstacles)
    const ramp = layout.ramps.find(r => r.gateId === gateId)!
    const npc = new NPC(scene, ramp.entrance.x, ramp.entrance.z, Faction.TOWN, 'roman', AIType.MELEE, 'guard', 2)
    onTestFinished(() => { npc.dispose(); root.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose() }); material.dispose() })
    for (const [index, goal] of [ramp.connection, ramp.entrance].entries()) {
      npc.assignFormationTarget(900 + index, goal, new THREE.Vector3(0, 0, 1))
      for (let frame = 0; frame < 2400 && !npc.isFormationTargetReached(900 + index); frame++) { nav.beginFrame(); npc.updateTownTravel(1 / 30, 0, [], obstacles, nav) }
      expect(npc.combatPosition.distanceTo(goal), `${gateId} ${index}: ${npc.combatPosition.toArray()}`).toBeLessThan(1)
    }
  })

  it('requires a real gate breach before a ground melee attacker can climb to a wall defender', () => {
    const scene = new THREE.Scene(), material = new THREE.MeshBasicMaterial(), obstacles: ObstacleData[] = []
    const city = createTownFortifications('roman', obstacles, { stone: material, wood: material, dark: material, snow: material })
    const nav = new NavigationWorld(); nav.setTownRamparts(city.rampartLayout); nav.sync(obstacles)
    const goal = city.rampartLayout.ramps.find(r => r.gateId === 'north')!.connection
    const player = new Player(scene), npc = new NPC(scene, 0, -127, Faction.ENEMY, 'viking', AIType.MELEE, 'attacker', 2)
    player.position.copy(goal).add(new THREE.Vector3(0, .9, 0)); npc.setTacticalOrder('attack')
    const step = () => { nav.sync(obstacles); nav.beginFrame(); npc.update(1 / 30, player, [], [], obstacles, { setFill() {} }, () => {}, () => {}, false, 0, null, null, nav) }
    onTestFinished(() => { npc.dispose(); player.dispose(); city.root.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose() }); material.dispose() })
    for (const gate of city.gates.values()) gate.close()
    for (let frame = 0; frame < 120; frame++) step()
    expect(npc.position.z).toBeLessThan(-114)
    expect(nav.townNav!.isElevated(npc.position)).toBe(false)
    city.gates.get('north')!.destroy()
    for (let frame = 0; frame < 6000 && !nav.townNav!.isElevated(npc.position); frame++) step()
    expect(nav.townNav!.isElevated(npc.position), `attacker stalled at ${npc.position.toArray()}`).toBe(true)
  })

  it('allows a body below the elevated deck without an invisible wall', () => {
    const layout = getTownRampartLayout(), deck = layout.decks[5], s = deck.surface
    const x = s.startX + s.dirX, z = s.startZ + s.dirZ, y = getTerrainHeight(x, z)
    const previous = new THREE.Vector3(x, y, z), next = previous.clone().add(new THREE.Vector3(.1, 0, .1))
    const obstacles = [{ box: deck.box, walkSurface: s, isBarricade: false }]
    resolveObstacleCollision(next, previous, 0, true, .5, 1.8, 0, obstacles, { walkSurfaces: true })
    expect(next.y).toBe(y)
    expect(getWalkRampHeight(s, x, z)! - y).toBeGreaterThan(5)
    expect(next.x).toBeCloseTo(x + .1)
  })
})
