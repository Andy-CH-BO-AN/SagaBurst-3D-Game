import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NavigationWorld } from '../../src/navigation/NavigationWorld'
import { findTownDuelArena, DUEL_ARENA_HALF_SIZE, DUEL_OPPONENT_OFFSET, DUEL_PLAYER_OFFSET, DUEL_REFEREE_OFFSET } from '../../src/town/TownDuelArena'
import { TOWN_NAVIGATION_BOUNDS } from '../../src/town/TownBounds'
import { TOWN_CAVALRY_FIELD } from '../../src/town/TownLayout'
import { townRoster, townSitePoint } from '../../src/town/TownRules'
import { TownWorld } from '../../src/town/TownWorld'

afterEach(() => vi.unstubAllGlobals())

describe('Duel training forecourt placement', () => {
  it('finds a clear, connected arena in the existing Roman world', () => {
    const context = new Proxy({ measureText: () => ({ width: 100 }) }, { get: (target, key) => (target as any)[key] ?? (() => {}) })
    vi.stubGlobal('ImageData', class { constructor(public data: unknown, public width: number, public height: number) {} })
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => context }) })
    const world = new TownWorld('roman', new THREE.Scene())
    try {
      const navigation = new NavigationWorld(TOWN_NAVIGATION_BOUNDS); navigation.sync(world.obstacles)
      const roster = townRoster(), area = findTownDuelArena(world.obstacles, navigation, roster)!
      expect(area).not.toBeNull()
      expect(area.x).toBeLessThan(TOWN_CAVALRY_FIELD.maxX)
      expect(area.z).toBeGreaterThan(TOWN_CAVALRY_FIELD.maxZ)
      const bounds = new THREE.Box3().setFromCenterAndSize(area.clone().setY(0), new THREE.Vector3(DUEL_ARENA_HALF_SIZE * 2, 1000, DUEL_ARENA_HALF_SIZE * 2))
      expect(world.obstacles.some(obstacle => obstacle.box.intersectsBox(bounds))).toBe(false)
      expect(roster.filter(spec => spec.duty === 'training').some(spec => bounds.containsPoint(new THREE.Vector3(spec.x, 0, spec.z)))).toBe(false)
      for (const offset of [DUEL_OPPONENT_OFFSET, DUEL_PLAYER_OFFSET, DUEL_REFEREE_OFFSET]) {
        const slot = area.clone().add(offset)
        expect(navigation.areConnected(townSitePoint('barracks', 0, 15), slot)).toBe(true)
        for (const spec of roster.filter(spec => spec.role === 'captain' || spec.duty === 'training')) expect(navigation.areConnected(spec, slot), spec.id).toBe(true)
      }
    } finally { world.dispose() }
  })

  it('rejects an obstructed forecourt instead of silently using an unrelated fallback', () => {
    const obstacle = { box: new THREE.Box3(new THREE.Vector3(80, -1000, -55), new THREE.Vector3(145, 1000, 0)), isBarricade: false }
    const navigation = new NavigationWorld(TOWN_NAVIGATION_BOUNDS); navigation.sync([obstacle])
    expect(findTownDuelArena([obstacle], navigation, townRoster())).toBeNull()
  })
})
