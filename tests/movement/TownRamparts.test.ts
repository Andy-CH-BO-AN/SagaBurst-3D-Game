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
  it.each(['roman', 'viking'] as const)('%s visible slabs match walk and projectile surfaces through every flight and landing', faction => {
    // Real fortification meshes/obstacles, zero actors or TownWorld instances.
    const material = new THREE.MeshBasicMaterial(), obstacles: ObstacleData[] = []
    const city = createTownFortifications(faction, obstacles, { stone: material, wood: material, dark: material, snow: material })
    onTestFinished(() => { city.root.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose() }); material.dispose() })
    city.root.updateMatrixWorld(true)
    const root = city.root.getObjectByName('town-ramparts')!
    expect(root.children).toHaveLength(2) // Decks/rails and supports retain two static batches.
    const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0))
    const check = (x: number, z: number, expected: number, label: string) => {
      ray.ray.origin.set(x, expected + 2, z)
      const hit = ray.intersectObject(root, true)[0]
      expect(hit, label).toBeDefined()
      expect(hit.point.y, label).toBeCloseTo(expected, 4)
      const surfaces = obstacles.filter(o => o.walkSurface && getWalkRampHeight(o.walkSurface, x, z) !== null)
      expect(surfaces.length, label).toBeGreaterThan(0)
      for (const obstacle of surfaces) {
        expect(getWalkRampHeight(obstacle.walkSurface!, x, z), label).toBeCloseTo(expected, 4)
        expect(obstacle.projectileBoxes!.some(b => x >= b.min.x - 1e-6 && x <= b.max.x + 1e-6
          && z >= b.min.z - 1e-6 && z <= b.max.z + 1e-6 && expected >= b.min.y && expected <= b.max.y + 1e-6), label).toBe(true)
      }
    }
    for (const ramp of city.rampartLayout.ramps) {
      const s = ramp.surface
      // The slope/flat knee was absent from the old BoxGeometry, although physics had it.
      for (const along of [s.length / 2, s.length - .1, s.length, s.length + s.landing / 4, s.length + s.landing * .9]) {
        for (const lateral of [-s.halfWidth + .5, 0, s.halfWidth - .5]) {
          const x = s.startX + s.dirX * along - s.dirZ * lateral, z = s.startZ + s.dirZ * along + s.dirX * lateral
          check(x, z, getWalkRampHeight(s, x, z)!, `${faction} ${ramp.gateId} flight ${along}/${lateral}`)
        }
      }
      for (const fraction of [.15, .45, .75]) for (const side of [-1, 1]) {
        const along = s.length * fraction
        const x = s.startX + s.dirX * along - s.dirZ * side * 2.15, z = s.startZ + s.dirZ * along + s.dirX * side * 2.15
        const y = s.startY + (s.topY - s.startY) * fraction + .9
        ray.ray.origin.set(x, y + 2, z)
        expect(ray.intersectObject(root, true)[0]?.point.y, `${ramp.gateId} sloped rail ${fraction}/${side}`).toBeCloseTo(y, 4)
      }
      // Sweep the full turning corridor across both T junctions, including overlap edges.
      for (let i = 0; i <= 40; i++) for (const lateral of [-1.5, 0, 1.5]) {
        const p = ramp.landing.clone().lerp(ramp.connection, i / 40).addScaledVector(new THREE.Vector3(s.dirX, 0, s.dirZ), lateral)
        check(p.x, p.z, ramp.landing.y, `${faction} ${ramp.gateId} turn ${i}/${lateral}`)
      }
    }
    for (const corner of city.rampartLayout.corners) for (const dx of [-2.7, 0, 2.7]) for (const dz of [-2.7, 0, 2.7]) {
      check(corner.x + dx, corner.z + dz, corner.y, `${faction} corner ${corner.toArray()} ${dx}/${dz}`)
    }
    for (const gate of TOWN_GATES) {
      const deck = city.rampartLayout.decks.find(d => d.gateId === gate.id && !d.id.includes('corner') && !d.id.includes('landing'))!
      const x = Math.abs(deck.surface.dirX) > .5 ? gate.x : deck.surface.startX
      const z = Math.abs(deck.surface.dirZ) > .5 ? gate.z : deck.surface.startZ
      check(x, z, townRampartHeight(city.rampartLayout, x, z)!, `${faction} ${gate.id} gatehouse`)
    }
  })

  it('shares heights across wall segment seams and the entire four corner turning areas', () => {
    const layout = getTownRampartLayout()
    for (const deck of layout.decks.filter(d => !d.id.startsWith('landing:'))) {
      const s = deck.surface
      for (const along of [.001, s.length / 2, s.length - .001]) {
        const x = s.startX + s.dirX * along, z = s.startZ + s.dirZ * along
        const y = getWalkRampHeight(s, x, z)!
        for (const other of layout.decks) {
          const shared = getWalkRampHeight(other.surface, x, z)
          if (shared !== null) expect(shared, `${deck.id} overlaps ${other.id}`).toBeCloseTo(y, 6)
        }
      }
    }
  })

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
    // Subdividing the West landing used to shift these existing deployment slots.
    for (const [id, z] of [['ranged_infantry-11', -34.59761904761905], ['ranged_infantry-19', -39.50714285714285]] as const) {
      expect(roster.find(a => a.id === id)!.garrison!.x).toBeCloseTo(-107.6, 8)
      expect(roster.find(a => a.id === id)!.garrison!.z).toBeCloseTo(z, 8)
    }
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
