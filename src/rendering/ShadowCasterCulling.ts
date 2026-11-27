import type * as THREE from 'three'
import {
  applyLod1ShadowProxy, lod1ProxyApplicable, proveLod1ShadowProxy, restoreLod1ShadowProxy,
  type Lod1ShadowProxyPlan,
} from './Lod1ShadowProxy'

/**
 * Visits each actor root with the LOD level that decides which of its meshes cast shadows.
 * `humanoidVisual` (the node holding the humanoid `THREE.LOD`) opts a LOD1 actor into the
 * LOD2 shadow proxy.
 */
export type ShadowCullTargets = (visit: (root: THREE.Object3D, shadowLevel: number, humanoidVisual?: THREE.Object3D) => void) => void

/** Each cached proof is redone at least this often even when the root's LOD level is unchanged. */
export const SHADOW_CULL_REVALIDATE_PASSES = 30

interface Entry { level: number; casterFree: boolean; nextCheck: number }
interface ProxyEntry { plan: Lod1ShadowProxyPlan | null; nextCheck: number }

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
  private readonly proxies = new WeakMap<THREE.Object3D, ProxyEntry>()
  private readonly swapped: Lod1ShadowProxyPlan[] = []
  private pass = 0
  private stagger = 0
  /** Shadow policy switch: LOD1 humanoids draw their LOD2 mesh into the shadow map (DEV A/B toggles it). */
  lod1ProxyEnabled = true
  private readonly visit = (root: THREE.Object3D, shadowLevel: number, humanoidVisual?: THREE.Object3D): void => {
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
    if (entry.casterFree) {
      root.visible = false
      this.hidden.push(root)
      return
    }
    if (this.lod1ProxyEnabled && shadowLevel === 1 && humanoidVisual?.visible) this.swapToProxy(humanoidVisual)
  }

  /** The proof is cached per visual and redone at least every SHADOW_CULL_REVALIDATE_PASSES passes. */
  private swapToProxy(visual: THREE.Object3D): void {
    let entry = this.proxies.get(visual)
    if (!entry || this.pass >= entry.nextCheck) {
      entry = { plan: proveLod1ShadowProxy(visual), nextCheck: this.pass + SHADOW_CULL_REVALIDATE_PASSES + this.stagger++ % SHADOW_CULL_REVALIDATE_PASSES }
      this.proxies.set(visual, entry)
    }
    const plan = entry.plan
    if (!plan || !lod1ProxyApplicable(plan)) return
    applyLod1ShadowProxy(plan)
    this.swapped.push(plan)
  }

  hide(targets: ShadowCullTargets): void {
    this.pass++
    targets(this.visit)
  }

  restore(): void {
    for (const root of this.hidden) root.visible = true
    this.hidden.length = 0
    for (const plan of this.swapped) restoreLod1ShadowProxy(plan)
    this.swapped.length = 0
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

const installed = new WeakMap<THREE.WebGLShadowMap, { targets: ShadowCullTargets | null; culling: ShadowCasterCulling }>()

/** DEV A/B of the LOD1 shadow proxy policy; production keeps it on. Returns the applied state or null if not installed. */
export function setLod1ShadowProxyEnabled(renderer: THREE.WebGLRenderer, enabled: boolean): boolean | null {
  const state = installed.get(renderer.shadowMap)
  if (!state) return null
  state.culling.lod1ProxyEnabled = Boolean(enabled)
  return state.culling.lod1ProxyEnabled
}

/**
 * Wraps `renderer.shadowMap.render` once per renderer; a later call only replaces the target
 * provider (null stops culling). The original pass always runs, and roots are restored even if
 * it throws.
 */
export function installShadowCasterCulling(renderer: THREE.WebGLRenderer, targets: ShadowCullTargets | null): void {
  const shadowMap = renderer.shadowMap
  const existing = installed.get(shadowMap)
  if (existing) { existing.targets = targets; return }
  const culling = new ShadowCasterCulling()
  const state = { targets, culling }
  installed.set(shadowMap, state)
  const render = shadowMap.render
  shadowMap.render = function (this: THREE.WebGLShadowMap, ...args: Parameters<THREE.WebGLShadowMap['render']>) {
    if (state.targets) culling.hide(state.targets)
    try { return render.apply(this, args) } finally { culling.restore() }
  }
}
