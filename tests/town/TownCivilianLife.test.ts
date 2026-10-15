import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { civilianDistrict, civilianHomeAnchor, civilianPointLegal, TownCivilianLife } from '../../src/town/TownCivilianLife'
import { townRoster } from '../../src/town/TownRules'
import { townHousing, TOWN_PLAZA } from '../../src/town/TownLayout'
import { getTerrainHeight } from '../../src/world/Terrain'

// Data/layout owner: zero NPC, Mount, GLB or TownWorld constructions.
describe('Town civilian home anchors and bounded daily walks', () => {
  it.each(['roman', 'viking'] as const)('%s keeps 20 stable identities in 8 plaza, 8 housing and 4 street anchors with ground clearance', faction => {
    const roster = townRoster(), civilians = roster.filter(a => a.role === 'civilian')
    expect(civilians.map(a => a.id)).toEqual(Array.from({ length: 20 }, (_, i) => `civilian-${i}`))
    expect(civilians.map(a => civilianDistrict(a.index)).filter(d => d === 'plaza')).toHaveLength(8)
    expect(civilians.map(a => civilianDistrict(a.index)).filter(d => d === 'housing')).toHaveLength(8)
    expect(civilians.map(a => civilianDistrict(a.index)).filter(d => d === 'street')).toHaveLength(4)
    const soldiers = roster.filter(a => a.role !== 'civilian').map(a => a.garrison ?? a)
    for (const c of civilians) {
      expect(civilianPointLegal(c, soldiers), c.id).toBe(true)
      expect(c.y).toBe(getTerrainHeight(c.x, c.z))
      for (const h of townHousing(faction)) expect(Math.abs(c.x - h.x) > h.width / 2 + .8 || Math.abs(c.z - h.z) > h.depth / 2 + .8, `${c.id} in ${h.id}`).toBe(true)
      if (c.index < 8) { expect(c.x).toBeGreaterThan(TOWN_PLAZA.minX); expect(c.x).toBeLessThan(TOWN_PLAZA.maxX); expect(c.z).toBeGreaterThan(TOWN_PLAZA.minZ); expect(c.z).toBeLessThan(TOWN_PLAZA.maxZ) }
    }
    expect(townRoster().filter(a => a.role === 'civilian')).toEqual(civilians)
    expect(civilianHomeAnchor(3)).toEqual(civilianHomeAnchor(3))
    expect(townHousing(faction)).toHaveLength(12)
  })
  it('takes slow legal local steps, pauses, and rejects a blocked route without any A* requests', () => {
    const home = civilianHomeAnchor(0), position = new THREE.Vector3(home.x, home.y, home.z), life = new TownCivilianLife()
    const navigation = { areConnected: vi.fn(() => true) }
    let walking = 0, idle = 0
    for (let frame = 0; frame < 600; frame++) {
      const previous = position.clone(), movement = life.update('civilian-0', home, position, .05, navigation, [], [])
      if (movement.speed) walking++; else idle++
      expect(position.distanceTo(previous)).toBeLessThan(.08)
      expect(civilianPointLegal(position)).toBe(true)
      expect(Math.hypot(position.x - home.x, position.z - home.z)).toBeLessThanOrEqual(2.21)
    }
    expect(walking).toBeGreaterThan(0); expect(idle).toBeGreaterThan(0)
    expect(navigation.areConnected.mock.calls.length).toBeLessThan(10)
    life.suspend('civilian-0')
    const before = position.clone(), wall = { isBarricade: false, box: new THREE.Box3(new THREE.Vector3(-100, -100, -100), new THREE.Vector3(140, 100, 95)) }
    for (let frame = 0; frame < 300; frame++) life.update('civilian-0', home, position, .05, navigation, [wall], [])
    expect(position).toEqual(before)
  })
})
