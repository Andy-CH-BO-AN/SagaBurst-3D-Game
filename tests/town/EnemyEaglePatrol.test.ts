import { describe, expect, it } from 'vitest'
import {
  enemyEagleActorId,
  enemyEaglePatrolEnabled,
  enemyEagleRoute,
  enemyEagleSpawnSpec,
  resolveEnemyEagleHomes,
} from '../../src/town/EnemyEaglePatrolRules'
import { parseEnemyEaglePatrolCheckpoint, type EnemyEaglePatrolCheckpoint } from '../../src/town/EnemyEaglePatrolState'
import { isEagleLandingClear } from '../../src/world/EagleLanding'
import { isEagleApproachClear } from '../../src/world/EagleApproach'
// Pure policy/state suite: zero actors, worlds, navigation or assets.
describe('enemy eagle patrol policy and saved generations', () => {
  it.each([
    ['recruit', false],
    ['soldier', false],
    ['veteran', false],
    ['captain', true],
    ['commander', true],
  ] as const)('%s appointment enables patrol=%s', (rank, enabled) => {
    expect(enemyEaglePatrolEnabled({ rank })).toBe(enabled)
  })
  it.each(['roman', 'viking'] as const)('%s town gets three distinct opposite-faction legal T3 bow riders', (town) => {
    const home = { x: 220, z: -100, yaw: 0 }
    const roster = [1, 2, 3].map((id) => enemyEagleSpawnSpec(id, 0, town, town, home))
    expect(roster.map((s) => s.actorId)).toEqual([1, 2, 3].map((id) => `enemy-eagle-patrol:${id}:generation:0:rider`))
    for (const spec of roster) {
      expect(spec.characterFaction).toBe(town === 'roman' ? 'viking' : 'roman')
      expect(spec.tier).toBe(3)
      expect(spec.loadout?.mountId).toBe('xongkoro')
      expect(spec.loadout?.rangedWeaponId).toBeTruthy()
      expect(JSON.stringify(spec.loadout)).not.toMatch(/ranger|t4/)
      expect(spec.respawnEnabled).toBe(false)
    }
    expect(
      new Set(
        [0, 1, 2].flatMap((g) =>
          [1, 2, 3].flatMap((id) =>
            ['rider', 'mount'].map((kind) => enemyEagleActorId(id, g, kind as 'rider' | 'mount')),
          ),
        ),
      ).size,
    ).toBe(18)
  })
  it('uses three bounded distinct patrol sectors and safe external reciprocal approach corridors', () => {
    const homes = resolveEnemyEagleHomes([])
    expect(homes).toHaveLength(3)
    for (const [index, home] of homes.entries()) {
      expect(Math.hypot(home.x, home.z)).toBeGreaterThanOrEqual(195)
      expect(
        isEagleLandingClear(
          home,
          [],
          homes.filter((h) => h !== home),
          350,
        ),
      ).toBe(true)
      expect(isEagleApproachClear(home, [], [], 350, 35)).toBe(true)
      expect(isEagleApproachClear({ ...home, yaw: home.yaw + Math.PI }, [], [], 350, 35)).toBe(true)
      for (const w of enemyEagleRoute(index + 1)) {
        expect(Math.abs(w.x)).toBeLessThan(300)
        expect(Math.abs(w.z)).toBeLessThan(300)
      }
    }
    expect(new Set([1, 2, 3].map((id) => JSON.stringify(enemyEagleRoute(id)))).size).toBe(3)
  })
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
    'duplicate',
    'negative generation',
    'nonfinite cooldown',
    'invalid home',
    'invalid waypoint',
    'unknown version',
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
