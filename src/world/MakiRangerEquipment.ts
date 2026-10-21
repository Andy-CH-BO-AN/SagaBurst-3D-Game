import { publicAssetUrl } from '../assets/publicAssetUrl'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DEFAULT_BOW_GRIP_PROFILE, type BowGripProfile } from './BowAttachmentContract'
import { HERO_ASSETS } from './HeroAssetCatalog'

/** Asset identity only; never a UnitTier or a production faction/loadout. */
export const MAKI_HERO = HERO_ASSETS['maki-archer-t4'].descriptor

export interface MakiBowAsset {
  model: THREE.Object3D
  profile: BowGripProfile
  topTip: THREE.Vector3
  bottomTip: THREE.Vector3
}
function cloneBowAsset(asset: MakiBowAsset): MakiBowAsset {
  return {
    model: asset.model.clone(true), topTip: asset.topTip.clone(), bottomTip: asset.bottomTip.clone(),
    profile: {
      ...asset.profile,
      gripCenterLocal: asset.profile.gripCenterLocal.clone(),
      shootingAxis: asset.profile.shootingAxis.clone(),
      longitudinalAxis: asset.profile.longitudinalAxis.clone(),
      contactNormal: asset.profile.contactNormal.clone(),
      handCalibrations: Object.fromEntries(Object.entries(asset.profile.handCalibrations ?? {}).map(([id, frame]) => [id, {
        longitudinalAxis: frame.longitudinalAxis.clone(), contactNormal: frame.contactNormal.clone(),
      }])),
    },
  }
}
let bowTemplate: Promise<MakiBowAsset> | undefined
let readyBow: MakiBowAsset | undefined
export async function preloadMakiRangerBow(): Promise<void> {
  await loadMakiRangerBow()
}
export function createMakiRangerBowInstance(): MakiBowAsset {
  if (!readyBow) throw new Error('Maki Ranger Bow was not preloaded')
  return cloneBowAsset(readyBow)
}
export async function loadMakiRangerBow(): Promise<MakiBowAsset> {
  bowTemplate ??= (async () => {
    const base = publicAssetUrl('models/weapons/maki-ranger-bow')
    const [gltf, metadata] = await Promise.all([
      new GLTFLoader().loadAsync(`${base}/bow.glb`),
      fetch(`${base}/attachment.json`).then(r => { if (!r.ok) throw new Error('Missing Maki bow calibration'); return r.json() }),
    ])
    const profile: BowGripProfile = {
      id: metadata.id, gripRadius: metadata.gripRadius, gripLength: metadata.gripLength, visualScale: 1,
      gripCenterLocal: new THREE.Vector3(...metadata.gripCenterLocal as [number, number, number]),
      shootingAxis: new THREE.Vector3(...metadata.shootingAxis as [number, number, number]),
      // Shadow Warden supplies its measured canonical palm frame. The unchanged
      // bow uses the ordinary -Z shot / +Y limb basis, with no old Maki pose override.
      longitudinalAxis: DEFAULT_BOW_GRIP_PROFILE.longitudinalAxis.clone(),
      contactNormal: DEFAULT_BOW_GRIP_PROFILE.contactNormal.clone(),
    }
    return { model: gltf.scene, profile, topTip: new THREE.Vector3(...metadata.topTip as [number, number, number]), bottomTip: new THREE.Vector3(...metadata.bottomTip as [number, number, number]) }
  })()
  const asset = await bowTemplate
  readyBow = asset
  return cloneBowAsset(asset)
}
