import { publicAssetUrl } from '../assets/publicAssetUrl'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DEFAULT_BOW_GRIP_PROFILE, type BowGripProfile } from './BowAttachmentContract'
import { HERO_ASSETS } from './HeroAssetCatalog'

/** Asset identity only; never a UnitTier or a production faction/loadout. */
export const MAKI_HERO = HERO_ASSETS['maki-archer-t4'].descriptor
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
      // Extracted body/string use the same -Z shot and +Y limb basis as ordinary bows.
      longitudinalAxis: DEFAULT_BOW_GRIP_PROFILE.longitudinalAxis.clone(),
      contactNormal: DEFAULT_BOW_GRIP_PROFILE.contactNormal.clone(),
      handCalibrations: {
        'maki-archer-t4': {
          longitudinalAxis: new THREE.Vector3(...metadata.longitudinalAxis as [number, number, number]),
          contactNormal: new THREE.Vector3(...metadata.contactNormal as [number, number, number]),
        },
      },
    }
    return { model: gltf.scene, profile, topTip: new THREE.Vector3(...metadata.topTip as [number, number, number]), bottomTip: new THREE.Vector3(...metadata.bottomTip as [number, number, number]) }
  })()
  const asset = await bowTemplate
  readyBow = asset
  return cloneBowAsset(asset)
}
