import { afterEach, describe, expect, it, vi } from 'vitest'
import { createVeteranFieldFixture, type VeteranFieldFixture, type VeteranFieldFixtureOptions } from '../../tests/helpers/veteranFieldFixture'
import { NavigationWorld } from '../navigation/NavigationWorld'
import { TOWN_PLAYABLE_WORLD_BOUND, TOWN_NAVIGATION_BOUNDS } from '../town/TownBounds'

vi.mock('./MissionGuide', () => ({ MissionGuide: class {
  update(): void {}
  hide(): void {}
  dispose(): void {}
} }))

const fixtures: VeteranFieldFixture[] = []
afterEach(() => {
  fixtures.splice(0).reverse().forEach(fixture => fixture.dispose())
  vi.restoreAllMocks()
})
function field(options: VeteranFieldFixtureOptions) {
  const fixture = createVeteranFieldFixture(options)
  fixtures.push(fixture)
  return fixture
}

describe('VeteranFieldDeployment', () => {
  it.each(['veteran-scout-hunters', 'veteran-village-intercept', 'veteran-spear-line-hunt', 'veteran-tragedy-of-the-scouts'] as const)(
    'deploys %s mission enemies at the map edge and scouts at the opposite edge', templateId => {
      const setup = field({ templateId })
      const enemies = setup.enemies
      expect(enemies.length).toBeGreaterThan(0)
      const navigation = new NavigationWorld(TOWN_NAVIGATION_BOUNDS)
      navigation.sync([])
      for (const enemy of enemies) {
        expect(enemy.combatPosition.x).toBeGreaterThan(TOWN_PLAYABLE_WORLD_BOUND - 45)
        expect(Math.abs(enemy.combatPosition.x)).toBeLessThan(TOWN_PLAYABLE_WORLD_BOUND - 10)
        expect(Math.abs(enemy.combatPosition.z)).toBeLessThan(TOWN_PLAYABLE_WORLD_BOUND - 10)
        expect(navigation.areConnected(enemy.combatPosition, { x: 0, z: 0 })).toBe(true)
      }
      if (templateId === 'veteran-tragedy-of-the-scouts') {
        for (const scout of setup.actors) {
          expect(scout.combatPosition.z).toBeGreaterThan(TOWN_PLAYABLE_WORLD_BOUND - 60)
          expect(scout.combatPosition.z).toBeLessThan(TOWN_PLAYABLE_WORLD_BOUND - 10)
          expect(navigation.areConnected(scout.combatPosition, { x: 0, z: 0 })).toBe(true)
        }
      }
    })

  it('keeps every Veteran spawn inside terrain bounds', () => {
    const setup = field({ templateId: 'veteran-village-intercept' })
    expect(setup.start).toBe(true)
    for (const actor of [...setup.actors, ...setup.enemies]) {
      expect(Math.abs(actor.combatPosition.x)).toBeLessThan(TOWN_PLAYABLE_WORLD_BOUND - 20)
      expect(Math.abs(actor.combatPosition.z)).toBeLessThan(TOWN_PLAYABLE_WORLD_BOUND - 20)
      if (actor.mount && !actor.mount.dead) {
        expect(Math.abs(actor.mount.group.position.x)).toBeLessThan(TOWN_PLAYABLE_WORLD_BOUND - 20)
        expect(Math.abs(actor.mount.group.position.z)).toBeLessThan(TOWN_PLAYABLE_WORLD_BOUND - 20)
      }
    }
  })
})
