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
  it.each([
    'negative generation',
    'nonfinite cooldown',
  ])('rejects malformed %s before materialization', (kind) => {
    const saved = state()
    if (kind === 'duplicate') saved.pairs.push({ ...saved.pairs[0] })
    if (kind === 'negative generation') saved.pairs[0].generation = -1
    if (kind === 'nonfinite cooldown') saved.pairs[0].respawnRemaining = Infinity
    if (kind === 'invalid home') saved.pairs[0].home.x = 999
    if (kind === 'invalid waypoint') saved.pairs[0].waypoint = 4
    if (kind === 'unknown version') Object.assign(saved, { version: 2 })
    expect(parseEnemyEaglePatrolCheckpoint(saved)).toBeUndefined()
  })
})
