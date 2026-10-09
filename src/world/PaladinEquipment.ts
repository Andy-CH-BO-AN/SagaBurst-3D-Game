import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { publicAssetUrl } from '../assets/publicAssetUrl'

const FILES = { paladin_sword_t4: 'sword', paladin_mace_t4: 'mace', paladin_shield_t4: 'shield' } as const
type PaladinEquipmentId = keyof typeof FILES
const templates = new Map<PaladinEquipmentId, THREE.Group>()
let pending: Promise<void> | undefined

/** Shared immutable render resources, distinct transforms for each owner. */
export function preloadPaladinEquipment(): Promise<void> {
  pending ??= Promise.all(Object.entries(FILES).map(async ([id, file]) => {
    const gltf = await new GLTFLoader().loadAsync(publicAssetUrl(`models/weapons/paladin/${file}.glb`))
    gltf.scene.traverse(object => {
      if (object instanceof THREE.Mesh) { object.castShadow = true; object.receiveShadow = true }
    })
    templates.set(id as PaladinEquipmentId, gltf.scene)
  })).then(() => undefined).catch(error => { pending = undefined; throw error })
  return pending
}

export function createPaladinEquipment(id: PaladinEquipmentId): THREE.Group {
  const template = templates.get(id)
  if (!template) throw new Error(`Paladin equipment was not preloaded: ${id}`)
  return template.clone(true)
}
