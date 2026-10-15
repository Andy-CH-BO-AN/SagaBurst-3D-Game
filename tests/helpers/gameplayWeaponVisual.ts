import * as THREE from 'three'
import { DEFAULT_BOW_GRIP_PROFILE } from '../../src/world/BowAttachmentContract'

/** Render-only boundary: zero GLBs or actors; real equipment/AI owners remain active. */
export function createGameplayBowAsset() {
  return {
    model: new THREE.Group(), profile: DEFAULT_BOW_GRIP_PROFILE,
    topTip: new THREE.Vector3(0, .85, 0), bottomTip: new THREE.Vector3(0, -.85, 0),
    sampleDraw(_ratio: number) {}, dispose() {},
  }
}
