import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { QUADRUPED_REQUIRED_CLIPS } from './QuadrupedMountAnimation'

interface QuadrupedAssetConfig {
  readonly baseUrl: string
  readonly name: string
  readonly bodyPrefix: string
}

/** Each asset owner caches its preload; only a fully validated template is published. */
export function createQuadrupedAssetPreload(config: QuadrupedAssetConfig, publish: (template: GLTF) => void): () => Promise<void> {
  let loading: Promise<void> | null = null

  async function load(): Promise<void> {
    const response = await fetch(`${config.baseUrl}/manifest.json`, { cache: 'no-cache' })
    if (!response.ok) throw new Error(`Cannot load ${config.name.toLowerCase()} manifest (${response.status})`)
    const manifest = await response.json()
    if (manifest.status !== 'ready' || manifest.forward !== '+Z' || !manifest.source?.license) {
      throw new Error(`${config.name} asset has not passed source and visual validation`)
    }
    const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(`${config.baseUrl}/${manifest.file}`)
    for (const clip of QUADRUPED_REQUIRED_CLIPS) {
      if (!gltf.animations.some(animation => animation.name === clip)) throw new Error(`${config.name} is missing ${clip}`)
    }
    for (const name of [0, 1, 2].map(index => `${config.bodyPrefix}_body_lod${index}`).concat('socket_saddle_seat')) {
      if (!gltf.scene.getObjectByName(name)) throw new Error(`${config.name} is missing ${name}`)
    }
    gltf.scene.traverse(object => {
      if (object instanceof THREE.Mesh) { object.castShadow = true; object.receiveShadow = true }
    })
    publish(gltf)
  }

  return () => {
    loading ??= load().catch(error => { loading = null; throw error })
    return loading
  }
}
