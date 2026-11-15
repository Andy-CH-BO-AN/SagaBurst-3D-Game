import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { publicAssetUrl } from '../assets/publicAssetUrl'

/** The repository's single Basis transcoder (Three's bundled build), shipped beside the horse package. */
export const BASIS_TRANSCODER_PATH = 'models/mounts/v1/horse/basis/'

let detectionRenderer: THREE.WebGLRenderer | undefined
let sharedKtx2: SharedKtx2Loader | undefined

/** Renderers created by scenes register here; transcode targets follow the first one's GPU formats. */
export function registerTextureRenderer(renderer: THREE.WebGLRenderer): void {
  detectionRenderer ??= renderer
}

/** Detects GPU formats on first KTX2 texture load, never on construction, so building a loader
 * (including in logic tests) needs no WebGL context. */
class SharedKtx2Loader extends KTX2Loader {
  private detected = false

  private ensureDetected(): void {
    if (this.detected) return
    let renderer = detectionRenderer, temporary = false
    if (!renderer) { renderer = new THREE.WebGLRenderer(); temporary = true }
    this.detectSupport(renderer)
    if (temporary) { renderer.dispose(); renderer.forceContextLoss() }
    this.detected = true
  }

  override load(...args: Parameters<KTX2Loader['load']>): ReturnType<KTX2Loader['load']> {
    this.ensureDetected()
    return super.load(...args)
  }
}

/** The shared KTX2 loader, also for external `.ktx2` maps (horse packages). */
export function sharedKtx2Loader(): KTX2Loader {
  return ktx2Loader()
}

function ktx2Loader(): SharedKtx2Loader {
  sharedKtx2 ??= new SharedKtx2Loader().setTranscoderPath(publicAssetUrl(BASIS_TRANSCODER_PATH)) as SharedKtx2Loader
  return sharedKtx2
}

/** GLTF loader for every published runtime GLB: KHR_texture_basisu (KTX2) and EXT_meshopt_compression. */
export function createRuntimeGltfLoader(manager?: THREE.LoadingManager): GLTFLoader {
  return new GLTFLoader(manager).setKTX2Loader(ktx2Loader()).setMeshoptDecoder(MeshoptDecoder)
}
