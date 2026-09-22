import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  getSiegeFallbackDelay,
  isFortificationKind,
  selectFortificationBreachTarget,
  SIEGE_GATE_EXTRA_TRAVEL_BUDGET,
  SIEGE_STRUCTURE_STUCK_SECONDS,
  SIEGE_TREE_STUCK_SECONDS,
} from './SiegePolicy'
import { DamageableObstacle } from '../world/DamageableObstacle'
import type { DamageableObstacleKind } from '../world/DamageableObstacle'
import type { ObstacleData } from '../world/Terrain'

function obstacle(
  kind: DamageableObstacleKind,
  ownerFaction: 'roman' | 'viking' | null,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
): ObstacleData {
  const root = new THREE.Group()
  return {
    box: new THREE.Box3(
      new THREE.Vector3(minX, 0, minZ),
      new THREE.Vector3(maxX, 3, maxZ),
    ),
    isBarricade: kind === 'gate' || kind === 'palisade' || kind === 'chevaux_de_frise',
    damageable: new DamageableObstacle({
      kind,
      maxHp: 100,
      root,
      ownerFaction,
    }),
  }
}

describe('SiegePolicy', () => {
  it('keeps non-fortification structures as delayed fallback targets', () => {
    expect(getSiegeFallbackDelay('tent')).toBe(SIEGE_STRUCTURE_STUCK_SECONDS)
    expect(getSiegeFallbackDelay('campfire')).toBe(SIEGE_STRUCTURE_STUCK_SECONDS)
  })

  it('makes trees the lowest-priority destruction fallback', () => {
    expect(getSiegeFallbackDelay('tree')).toBe(SIEGE_TREE_STUCK_SECONDS)
    expect(SIEGE_TREE_STUCK_SECONDS).toBeGreaterThan(SIEGE_STRUCTURE_STUCK_SECONDS)
  })

  it('classifies defensive works separately from natural/camp obstacles', () => {
    expect(isFortificationKind('gate')).toBe(true)
    expect(isFortificationKind('palisade')).toBe(true)
    expect(isFortificationKind('chevaux_de_frise')).toBe(true)
    expect(isFortificationKind('tree')).toBe(false)
    expect(isFortificationKind('tent')).toBe(false)
    expect(isFortificationKind('campfire')).toBe(false)
  })

  it('converges nearby attackers on the shared enemy gate', () => {
    const palisade = obstacle('palisade', 'roman', 9, 11, 4, 6)
    const gate = obstacle('gate', 'roman', -2, 2, 4, 6)
    const obstacles = [palisade, gate]
    const attackerPosition = new THREE.Vector3(10, 0, 0)

    expect(SIEGE_GATE_EXTRA_TRAVEL_BUDGET).toBeGreaterThan(0)
    expect(
      selectFortificationBreachTarget(
        'viking',
        attackerPosition,
        palisade,
        obstacles,
      ),
    ).toBe(gate)
  })

  it('lets flank attackers open a local palisade when the gate is too far away', () => {
    const palisade = obstacle('palisade', 'roman', 39, 41, 4, 6)
    const gate = obstacle('gate', 'roman', -2, 2, 4, 6)
    const obstacles = [palisade, gate]
    const attackerPosition = new THREE.Vector3(40, 0, 0)

    expect(
      selectFortificationBreachTarget(
        'viking',
        attackerPosition,
        palisade,
        obstacles,
      ),
    ).toBe(palisade)
  })

  it('clears a blocking chevaux-de-frise before trying to reach the gate', () => {
    const stakes = obstacle('chevaux_de_frise', 'roman', -1, 1, 2, 4)
    const gate = obstacle('gate', 'roman', -2, 2, 8, 10)
    const obstacles = [stakes, gate]

    expect(
      selectFortificationBreachTarget(
        'viking',
        new THREE.Vector3(0, 0, 0),
        stakes,
        obstacles,
      ),
    ).toBe(stakes)
  })

  it('never treats friendly or neutral non-fortifications as active breach targets', () => {
    const friendlyGate = obstacle('gate', 'viking', -2, 2, 4, 6)
    const tree = obstacle('tree', null, -2, 2, 4, 6)
    const obstacles = [friendlyGate, tree]
    const position = new THREE.Vector3(0, 0, 0)

    expect(
      selectFortificationBreachTarget('viking', position, friendlyGate, obstacles),
    ).toBeNull()
    expect(
      selectFortificationBreachTarget('viking', position, tree, obstacles),
    ).toBeNull()
  })
})
