import { describe, expect, it } from 'vitest'
import { parseEnemyEaglePatrolCheckpoint, type EnemyEaglePatrolCheckpoint } from '../../src/town/EnemyEaglePatrolState'
// Pure policy/state suite: zero actors, worlds, navigation or assets.
describe('enemy eagle patrol policy and saved generations', () => {
  const state = (): EnemyEaglePatrolCheckpoint => ({
    version: 1,
    pairs: [
      {
        id: 1,
        generation: 4,
        state: 'RESPAWN_COOLDOWN',
        waypoint: 2,
        elapsed: 87,
        restRemaining: 0,
        respawnRemaining: 1,
        home: { x: -180, z: -265, yaw: Math.PI / 2 },
      },
    ],
  })
  it('round trips cooldown and pending arrival state while absent legacy extension stays optional', () => {
    expect(parseEnemyEaglePatrolCheckpoint(undefined)).toBeUndefined()
    const saved = state()
    expect(parseEnemyEaglePatrolCheckpoint(JSON.parse(JSON.stringify(saved)))).toEqual(saved)
    saved.pairs[0].state = 'SPAWNING'
    saved.pairs[0].arrivalState = 'RETURN_QUEUE'
    expect(parseEnemyEaglePatrolCheckpoint(JSON.parse(JSON.stringify(saved)))).toEqual(saved)
  })
  it('rejects malformed negative generation and nonfinite cooldown before materialization', () => {
    const savedNegative = state()
    savedNegative.pairs[0].generation = -1
    expect(parseEnemyEaglePatrolCheckpoint(savedNegative)).toBeUndefined()

    const savedNonfinite = state()
    savedNonfinite.pairs[0].respawnRemaining = Infinity
    expect(parseEnemyEaglePatrolCheckpoint(savedNonfinite)).toBeUndefined()
  })
})
