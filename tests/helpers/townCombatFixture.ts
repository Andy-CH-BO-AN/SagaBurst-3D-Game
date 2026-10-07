import { TownScene } from '../../src/town/TownScene'
import { SpatialGrid } from '../../src/world/SpatialGrid'
import { TemporaryBattlefieldMounts } from '../../src/career/TemporaryBattlefieldMounts'

export function createTownCombatFixture(): any {
  return Object.assign(Object.create(TownScene.prototype), {
    combatMountGrid: new SpatialGrid(8), combatMounts: [], meleeMountCandidates: [],
    temporaryMounts: new TemporaryBattlefieldMounts(), nearbyTemporaryMount: null,
  })
}
