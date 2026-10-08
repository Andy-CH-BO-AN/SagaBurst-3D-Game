import * as THREE from 'three'

/** Create a real Three.js scene without installing browser globals. */
export function createThreeTestScene(): THREE.Scene {
  return new THREE.Scene()
}

/** Install only the requested globals and return an idempotent cleanup function. */
export function installTestGlobals(values: Record<string, unknown>): () => void {
  const previous = new Map<string, PropertyDescriptor | undefined>()
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  let active = true
  return () => {
    if (!active) return
    active = false
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
}

export interface FakeCanvasEnvironmentOptions {
  context: CanvasRenderingContext2D | Record<string, unknown>
  document?: Record<string, unknown>
  imageData?: unknown
}

/** Install a deliberately small canvas environment; callers choose their own document behavior. */
export function installFakeCanvasEnvironment(options: FakeCanvasEnvironmentOptions): () => void {
  const canvas = { width: 0, height: 0, getContext: () => options.context }
  const document = { createElement: () => canvas, ...options.document }
  const globals: Record<string, unknown> = { document }
  if (options.imageData) globals.ImageData = options.imageData
  return installTestGlobals(globals)
}
