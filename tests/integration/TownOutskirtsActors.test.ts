import * as THREE from 'three'
import { afterAll, beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest'
import { TownOutskirtsWarfareController } from '../../src/town/TownOutskirtsWarfareController'
import { NavigationWorld } from '../../src/navigation/NavigationWorld'
import { TOWN_NAVIGATION_BOUNDS } from '../../src/town/TownBounds'
import { MountType } from '../../src/world/Mount'
import { NpcSpawnTestDriver } from '../helpers/npcSpawnFrames'
import { preloadTinyRangerBow } from '../helpers/rangerBowVisual'

// Visual boundaries only. This suite owns default production NPC constructors,
// combat profile application and real Mount rider binding, with two actors per row.
vi.mock('../../src/world/CorgiVisual', async () => ({
  CorgiVisual: (await import('../helpers/gameplayQuadrupedVisual')).GameplayQuadrupedVisualDouble,
}))
vi.mock('../../src/world/BlackCatVisual', async () => ({
  BlackCatVisual: (await import('../helpers/gameplayQuadrupedVisual')).GameplayQuadrupedVisualDouble,
}))
vi.mock('../../src/world/PaladinEquipment', () => ({ createPaladinEquipment: () => new THREE.Group() }))
let bow: Awaited<ReturnType<typeof preloadTinyRangerBow>>
beforeAll(async () => { bow = await preloadTinyRangerBow() })
afterAll(() => bow?.dispose())

describe('Outskirts native elite actors', () => {
  it.each(['roman', 'viking'] as const)('applies %s enemy hero profiles and independent native mount binding through the default deployment path', town => {
    const driver = new NpcSpawnTestDriver(), navigation = new NavigationWorld(TOWN_NAVIGATION_BOUNDS)
    navigation.rebuild([])
    // A saved partial Siege selection owns the other eight members; unrelated
    // squads are cancelled before construction. Do not replace the roster producer.
    const claimed = [1, 2, 3, 4, 6, 7, 8, 9].map(i => `outskirts:cavalry:a:${i}`)
    const controller = new TownOutskirtsWarfareController(new THREE.Scene(), town,
      () => ({ rank: 'commander', faction: town }), [], navigation, undefined,
      ['outskirts:cavalry:b', 'outskirts:cavalry:c'], driver.scheduler, claimed)
    onTestFinished(() => controller.dispose())
    for (const batch of controller.batches) if ([...batch.actors.keys()].every(id => id.startsWith('outskirts:bandit:'))) batch.cancel()
    driver.drain()
    expect(controller.batches.filter(batch => batch.status === 'failed').map(batch => batch.error)).toEqual([])
    expect(controller.actors).toHaveLength(2)
    expect(controller.mounts).toHaveLength(2)
    const [captain, ranger] = controller.actors
    expect(captain.combatantId).toBe('outskirts:cavalry:a:0')
    expect(captain.visualAssetId).toBe(town === 'roman' ? 'viking-hero-t4' : 'roman-hero-t4')
    expect(captain.combatProfileId).toBe(town === 'roman' ? 'varangian' : 'praetorian')
    expect(captain.maxHp).toBe(500)
    expect(captain.mount?.type).toBe(town === 'roman' ? MountType.BLACK_CAT : MountType.CORGI)
    expect(ranger.combatantId).toBe('outskirts:cavalry:a:5')
    expect(ranger.visualAssetId).toBe('maki-archer-t4')
    expect(ranger.combatProfileId).toBe('ranger')
    expect(ranger.specialCombatProfile).toBe('maki-ranger')
    expect(ranger.maxHp).toBe(300)
    expect(ranger.rangedWeaponId).toBe('maki-ranger-bow-ranged')
    expect(ranger.hasActiveRangedWeapon).toBe(true)
    expect(ranger.mount?.type).toBe(MountType.BLACK_CAT)
    expect(captain.mount).not.toBe(ranger.mount)
    expect(captain.mount?.riderNpc).toBe(captain)
    expect(ranger.mount?.riderNpc).toBe(ranger)
    const rangerMount = ranger.mount!
    rangerMount.takeDamage(rangerMount.maxHp + 1)
    expect(ranger.mount).toBeNull()
    expect(ranger.dead).toBe(false)
    expect(captain.isMounted).toBe(true)
  })
})
