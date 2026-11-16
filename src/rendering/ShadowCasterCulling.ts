import type * as THREE from 'three'

/** Visits each actor root with the LOD level that decides which of its meshes cast shadows. */
export type ShadowCullTargets = (visit: (root: THREE.Object3D, shadowLevel: number) => void) => void

/** Each cached proof is redone at least this often even when the root's LOD level is unchanged. */
export const SHADOW_CULL_REVALIDATE_PASSES = 30

interface Entry { level: number; casterFree: boolean; nextCheck: number }

/**
 * Three's shadow pass walks every visible node of the scene for every caster light, although
 * far actors (LOD2 humanoids, non-LOD0 mounts) contain no shadow caster at all. While the pass
 * runs, roots proven caster-free are hidden and restored right after, so the shadow map is
 * unchanged and the main pass (already projected) is untouched.
 *
 * Proof: a root is caster-free when no visible Mesh/Line/Points below it has `castShadow` (with
 * PCF shadows only casters are drawn). The proof is cached per root and redone whenever its LOD
 * level changes, and at least every SHADOW_CULL_REVALIDATE_PASSES passes (staggered per root).
 */
export class ShadowCasterCulling {
  private readonly entries = new WeakMap<THREE.Object3D, Entry>()
  private readonly hidden: THREE.Object3D[] = []
  private pass = 0
  private stagger = 0
  private readonly visit = (root: THREE.Object3D, shadowLevel: number): void => {
    if (!root.visible) return
    let entry = this.entries.get(root)
    if (!entry) {
      entry = { level: shadowLevel, casterFree: false, nextCheck: 0 }
      this.entries.set(root, entry)
      this.prove(root, entry, 1 + this.stagger++ % SHADOW_CULL_REVALIDATE_PASSES)
    } else if (entry.level !== shadowLevel || this.pass >= entry.nextCheck) {
      entry.level = shadowLevel
      this.prove(root, entry, SHADOW_CULL_REVALIDATE_PASSES)
    }
    if (!entry.casterFree) return
    root.visible = false
    this.hidden.push(root)
  }

  hide(targets: ShadowCullTargets): void {
    this.pass++
    targets(this.visit)
  }

  restore(): void {
    for (const root of this.hidden) root.visible = true
    this.hidden.length = 0
  }

  private prove(root: THREE.Object3D, entry: Entry, revalidateIn: number): void {
    entry.casterFree = !hasVisibleShadowCaster(root)
    entry.nextCheck = this.pass + revalidateIn
  }
}

export function hasVisibleShadowCaster(root: THREE.Object3D): boolean {
  let found = false
  root.traverseVisible(object => {
    if (!found && object.castShadow && ((object as THREE.Mesh).isMesh || (object as THREE.Line).isLine || (object as THREE.Points).isPoints)) found = true
  })
  return found
}

const installed = new WeakMap<THREE.WebGLShadowMap, { targets: ShadowCullTargets | null }>()

/**
 * Wraps `renderer.shadowMap.render` once per renderer; a later call only replaces the target
 * provider (null stops culling). The original pass always runs, and roots are restored even if
 * it throws.
 */
export function installShadowCasterCulling(renderer: THREE.WebGLRenderer, targets: ShadowCullTargets | null): void {
  const shadowMap = renderer.shadowMap
  const existing = installed.get(shadowMap)
  if (existing) { existing.targets = targets; return }
  const state = { targets }
  installed.set(shadowMap, state)
  const culling = new ShadowCasterCulling()
  const render = shadowMap.render
  shadowMap.render = function (this: THREE.WebGLShadowMap, ...args: Parameters<THREE.WebGLShadowMap['render']>) {
    if (state.targets) culling.hide(state.targets)
    try { return render.apply(this, args) } finally { culling.restore() }
  }
}
