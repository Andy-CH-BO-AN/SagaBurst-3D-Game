import { expect, it } from 'vitest'
import { Vector3 } from 'three'
import { Faction } from '../../src/combat/CombatFaction'
import { FriendlyMovementBypass, type BypassActor } from '../../src/navigation/FriendlyMovementBypass'

function actor(id: string, x: number, z: number): BypassActor {
  return { combatantId: id, combatPosition: new Vector3(x, 0, z), faction: Faction.TOWN, dead: false, isMounted: false }
}

it('recovers around a friendly row on the open side, keeps that side, then resumes the untouched goal', () => {
  const bypass = new FriendlyMovementBypass(), self = actor('captain', 0, 0), goal = new Vector3(0, 0, 10)
  const neighbors = [self, actor('guard-left', -1, 1.5), actor('guard-right', 1, 1.5)]
  const direction = new Vector3(0, 0, 1), originalGoal = goal.clone()
  // A wall closes the negative-X side; the real selector must choose positive X.
  const clear = (a: Vector3, b: Vector3) => a.x >= 0 && b.x >= 0
  expect(bypass.steer(.6, self, goal, direction, neighbors, clear)).toBe(false)
  expect(bypass.steer(.6, self, goal, direction, neighbors, clear)).toBe(true)
  expect(direction.x).toBeGreaterThan(0)
  let completed = false
  for (let i = 0; i < 180; i++) {
    direction.copy(goal).sub(self.combatPosition).setY(0).normalize()
    const active = bypass.steer(.05, self, goal, direction, neighbors, clear)
    if (!active) { completed = true; break }
    self.combatPosition.addScaledVector(direction, .15)
    expect(self.combatPosition.x).toBeGreaterThanOrEqual(0)
    for (const other of neighbors.slice(1)) expect(self.combatPosition.distanceTo(other.combatPosition)).toBeGreaterThan(.92)
  }
  expect(completed).toBe(true)
  expect(self.combatPosition.z).toBeGreaterThan(3)
  expect(goal).toEqual(originalGoal)
})

it('leaves progressing travel alone and bounds a recovery when its mover stops', () => {
  const bypass = new FriendlyMovementBypass(), self = actor('referee', 0, 0), goal = new Vector3(0, 0, 12)
  const direction = new Vector3(0, 0, 1), nearby = [self, actor('guard', 0, 3)]
  const clear = () => true
  expect(bypass.steer(.6, self, goal, direction, nearby, clear)).toBe(false)
  self.combatPosition.z = .8
  expect(bypass.steer(.6, self, goal, direction, nearby, clear)).toBe(false)
  expect(direction).toEqual(new Vector3(0, 0, 1))
  expect(bypass.steer(1.2, self, goal, direction, nearby, clear)).toBe(true)
  expect(bypass.steer(8.1, self, goal, direction, nearby, clear)).toBe(false)
  expect(goal).toEqual(new Vector3(0, 0, 12))
})
