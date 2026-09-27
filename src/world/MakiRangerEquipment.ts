import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { BowGripProfile } from './BowAttachmentContract'
import type { HumanoidAssetDescriptor } from './HumanoidAssetRegistry'

/** Asset identity only; never a UnitTier or a production faction/loadout. */
export const MAKI_HERO: HumanoidAssetDescriptor = {
  assetId: 'maki-archer-t4', faction: 'viking', heightM: 1.457503, maxShoulderWidthM: .274, neckLengthM: .078,
}
export type MakiEquipmentMode = 'ranged' | 'ammo-exhausted'
/** Phase 2 integration point. Proximity/charge cannot trigger melee fallback. */
export function resolveMakiEquipmentMode(arrows: number): MakiEquipmentMode {
  if (!Number.isFinite(arrows) || arrows < 0) throw new Error('Maki arrow count must be finite and non-negative')
  return arrows > 0 ? 'ranged' : 'ammo-exhausted'
}
export const MAKI_FALLBACK = { weaponId: 'maki-ranger-bow', animation: 'axeAttack2H', shield: false } as const

export interface MakiBowAsset {
  model: THREE.Object3D
  profile: BowGripProfile
  topTip: THREE.Vector3
  bottomTip: THREE.Vector3
}
let bowTemplate: Promise<MakiBowAsset> | undefined
export async function loadMakiRangerBow(): Promise<MakiBowAsset> {
  bowTemplate ??= (async () => {
    const base = '/models/weapons/maki-ranger-bow'
    const [gltf, metadata] = await Promise.all([
      new GLTFLoader().loadAsync(`${base}/bow.glb`),
      fetch(`${base}/attachment.json`).then(r => { if (!r.ok) throw new Error('Missing Maki bow calibration'); return r.json() }),
    ])
    const profile: BowGripProfile = {
      id: metadata.id, gripRadius: metadata.gripRadius, gripLength: metadata.gripLength, visualScale: 1,
      gripCenterLocal: new THREE.Vector3(...metadata.gripCenterLocal as [number, number, number]),
      // The extracted bow's string lies on +Z. Match its own grip frame to
      // Maki's authored palm; this changes only the weapon attachment.
      shootingAxis: new THREE.Vector3(0, 0, -1), longitudinalAxis: new THREE.Vector3(...metadata.longitudinalAxis as [number, number, number]),
      contactNormal: new THREE.Vector3(...metadata.contactNormal as [number, number, number]),
    }
    return { model: gltf.scene, profile, topTip: new THREE.Vector3(...metadata.topTip as [number, number, number]), bottomTip: new THREE.Vector3(...metadata.bottomTip as [number, number, number]) }
  })()
  const asset = await bowTemplate
  return { ...asset, model: asset.model.clone(true) }
}
