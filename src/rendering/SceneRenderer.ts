import * as THREE from 'three'

/** Pixel-ratio cap for Town and Career arena scenes. */
export const GAMEPLAY_SCENE_MAX_PIXEL_RATIO = 1.5
/** Pixel-ratio cap for the battle scene (Game), which ships its own perf query overrides. */
export const BATTLE_SCENE_MAX_PIXEL_RATIO = 2

export interface SceneRendererOptions {
  /** Upper bound applied to `devicePixelRatio`. */
  maxPixelRatio: number
  /** Multiplier applied after the cap (DEV half-resolution probes). Defaults to 1. */
  pixelRatioScale?: number
  /** PCF soft shadows on by default. */
  shadows?: boolean
  /** Omit to keep the three.js default exposure. */
  toneMappingExposure?: number
}

/**
 * Applies the shared full-window scene policy: capped pixel ratio, window size,
 * PCF soft shadows, sRGB output and ACES filmic tone mapping.
 */
export function configureSceneRenderer(renderer: THREE.WebGLRenderer, options: SceneRendererOptions): void {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, options.maxPixelRatio) * (options.pixelRatioScale ?? 1))
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.shadowMap.enabled = options.shadows ?? true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  if (options.toneMappingExposure !== undefined) renderer.toneMappingExposure = options.toneMappingExposure
}

/** Creates an antialiased renderer configured with {@link configureSceneRenderer}. */
export function createSceneRenderer(options: SceneRendererOptions): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  configureSceneRenderer(renderer, options)
  return renderer
}

/** Keeps camera aspect and renderer size in step with the window until `signal` aborts. */
export function bindWindowResize(camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer, signal: AbortSignal): void {
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
  }, { signal })
}
