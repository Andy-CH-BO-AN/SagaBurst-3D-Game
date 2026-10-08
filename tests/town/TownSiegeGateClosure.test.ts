import * as THREE from 'three'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { createTownFortifications } from '../../src/town/TownFortifications'
import { closeSiegeGate, overlapsGateClosure } from '../../src/town/TownSiegeGateClosure'
import { siegeOutward, siegePoint } from '../../src/career/TownSiege'
import type { ObstacleData } from '../../src/world/Terrain'

describe('Shared Town gate closure', () => {
  it('pushes every overlapping body outward at North without moving actors already clear', () => {
    const id = 'north' as const
    const obstacles: ObstacleData[] = [], material = new THREE.MeshBasicMaterial()
    let root: THREE.Group | undefined
    onTestFinished(() => {
      const geometries = new Set<THREE.BufferGeometry>()
      root?.traverse(child => { if (child instanceof THREE.Mesh) geometries.add(child.geometry) })
      geometries.forEach(geometry => geometry.dispose()); material.dispose()
    })
    const city = createTownFortifications('roman', obstacles, { stone: material, wood: material, dark: material, snow: material })
    root = city.root
    const gate = city.gates.get(id)!, outward = siegeOutward(id)
    const bodies = [0.6, 0.5, 1.5].map((radius, index) => {
      const position = siegePoint(id, index - 1, 0)
      return { position, radius, hp: 100, moveTo: vi.fn((point: THREE.Vector3) => position.copy(point)) }
    })
    const untouched = [-20, 20].map(inward => {
      const position = siegePoint(id, 0, inward)
      return { position, radius: .6, hp: 100, moveTo: vi.fn() }
    })
    const hp = gate.damageable.currentHp
    expect(closeSiegeGate(id, gate, [...bodies, ...untouched], obstacles)).toBe(true)
    expect(gate.state).toBe('closed')
    expect(gate.damageable.currentHp).toBe(hp)
    for (const body of bodies) {
      expect(body.moveTo).toHaveBeenCalledOnce()
      expect(body.position.clone().sub(siegePoint(id, 0, 0)).dot(outward)).toBeGreaterThan(body.radius)
      expect(obstacles.some(o => overlapsGateClosure(o.navigationBox ?? o.box, body.position, body.radius))).toBe(false)
      expect(body.hp).toBe(100)
    }
    for (const body of untouched) expect(body.moveTo).not.toHaveBeenCalled()
  })
})
