import { TownScene } from '../../src/town/TownScene'
import { SpatialGrid } from '../../src/world/SpatialGrid'
import { TemporaryBattlefieldMounts } from '../../src/career/TemporaryBattlefieldMounts'
import { createCareerProfile } from '../../src/career/CareerProfile'

export function createTownCombatFixture(): any {
  return Object.assign(Object.create(TownScene.prototype), {
    profile: createCareerProfile('roman'),
    combatMountGrid: new SpatialGrid(8), combatMounts: [], meleeMountCandidates: [],
    temporaryMounts: new TemporaryBattlefieldMounts(), nearbyTemporaryMount: null,
  })
}
