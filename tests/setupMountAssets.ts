import { beforeAll, expect } from 'vitest'
import { installCorgiTestAsset } from './helpers/corgiAsset'

// Synchronous legacy gameplay fixtures need the same preload as Game.create.
// Visual suites explicitly load their own assets.
const gameplaySuites = new Set([
  'PlayableWorldBoundary.test.ts',
  'DefaultMountedLoadout.test.ts',
  'NPCTargetAcquisition.test.ts',
  'InitialSpectatorMode.test.ts',
  'PlayerDirectionalMovement.test.ts',
  'PlayerDeathAndSpectatorCamera.test.ts',
  'CustomBattleFactionSelection.test.ts',
  'MountedInitialHeading.test.ts',
  'TargetedCombatStanceAndLance.test.ts',
  'NPCOptimization.test.ts',
  'NPCRangedMeleeSwitch.test.ts',
  'NPCNeighborQuery.test.ts',
  'CombatBalance.test.ts',
])
beforeAll(async () => {
  const file = expect.getState().testPath?.split('/').pop() ?? ''
  if (gameplaySuites.has(file)) await installCorgiTestAsset()
})
