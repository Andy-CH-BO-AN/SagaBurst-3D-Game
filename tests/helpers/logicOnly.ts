import { vi } from 'vitest'

// Real math/data exports remain intact. Forbidden constructors THROW instead
// of producing substitute models, so heavy tests/import side effects fail.
vi.mock('three', async importOriginal => {
  const real = await importOriginal<typeof import('three')>()
  const guarded: Record<string, unknown> = { ...real }
  for (const [name, value] of Object.entries(real)) {
    if (typeof value !== 'function') continue
    if (/Geometry$|Material$|Texture$/.test(name)
      || ['Object3D', 'Skeleton', 'AnimationMixer', 'AnimationClip', 'AnimationAction', 'WebGLRenderer'].includes(name)
      || value.prototype instanceof real.Object3D) {
      guarded[name] = new Proxy(value, {
        construct() { throw new Error(`Logic-only tests cannot construct THREE.${name}; use production data/state logic`) },
      })
    }
  }
  return guarded
})
