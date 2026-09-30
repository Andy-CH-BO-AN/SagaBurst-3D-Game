import type { HumanoidAssetDescriptor } from './HumanoidAssetRegistry'

/** Visual identity only. Allegiance, stats and AI remain owned by NPC. */
export const BANDIT_ASSET: HumanoidAssetDescriptor = {
  assetId: 'bandit', faction: 'viking', heightM: 1.75,
  maxShoulderWidthM: .6, neckLengthM: .063,
  animationContract: 'bandit',
}
