import type * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { installShadowCasterCulling, setLod1ShadowProxyEnabled } from '../../src/rendering/ShadowCasterCulling'

/** Narrow scene-node double: only the fields the culling proof and toggle read. */
interface FakeNode { name: string; visible: boolean; castShadow: boolean; isMesh?: boolean; children: FakeNode[] }
const node = (name: string, children: FakeNode[] = [], caster = false): FakeNode =>
  ({ name, visible: true, castShadow: caster, isMesh: caster || undefined, children })
const asObject = (fake: FakeNode): THREE.Object3D => Object.assign(fake, {
  traverseVisible(this: FakeNode, visit: (o: FakeNode) => void) {
    const walk = (n: FakeNode): void => { if (!n.visible) return; visit(n); n.children.forEach(walk) }
    walk(this)
  },
}) as unknown as THREE.Object3D

describe('shadow pass caster-free culling', () => {
  it('hides only caster-free roots during the pass, re-proves on LOD change and always restores', () => {
    const farMesh = node('far-lod2', [], false), nearMesh = node('near-lod1', [], true)
    const far = asObject(node('far', [farMesh])), near = asObject(node('near', [nearMesh]))
    const corpse = asObject(node('corpse', [node('body', [], true)]))
    corpse.visible = false
    const levels = new Map<THREE.Object3D, number>([[far, 2], [near, 1], [corpse, 2]])
    const seen: Record<string, boolean>[] = []
    let fail = false
    const shadowMap = { render() {
      seen.push({ far: far.visible, near: near.visible, corpse: corpse.visible })
      if (fail) throw new Error('pass failed')
    } }
    const renderer = { shadowMap } as unknown as THREE.WebGLRenderer
    installShadowCasterCulling(renderer, visit => { for (const [root, level] of levels) visit(root, level) })
    // A second install swaps the provider instead of wrapping the pass twice.
    installShadowCasterCulling(renderer, visit => { for (const [root, level] of levels) visit(root, level) })

    shadowMap.render()
    expect(seen.at(-1)).toEqual({ far: false, near: true, corpse: false })
    expect([far.visible, near.visible, corpse.visible]).toEqual([true, true, false])

    // The far actor comes into LOD1 range and now casts: its new level forces a new proof.
    farMesh.castShadow = true; (farMesh as FakeNode & { isMesh: boolean }).isMesh = true
    levels.set(far, 1)
    shadowMap.render()
    expect(seen.at(-1)).toEqual({ far: true, near: true, corpse: false })

    // Back to a caster-free LOD: hidden again, and restored even when the pass throws.
    farMesh.castShadow = false
    levels.set(far, 2)
    fail = true
    expect(() => shadowMap.render()).toThrow('pass failed')
    expect(seen.at(-1)?.far).toBe(false)
    expect([far.visible, near.visible, corpse.visible]).toEqual([true, true, false])
    expect(seen).toHaveLength(3)
  })
})

/** Plain-data LOD graph: level objects with a shared parent, one skinned mesh each on one shared skeleton. */
function fakeHumanoidLod(sameSkeleton: boolean) {
  const identity: number[] = new Array<number>(16).fill(0).map((_, i) => (i % 5 === 0 ? 1 : 0))
  const skeleton = {}, parent = { name: 'lod' }
  const mesh = (name: string, skel: object, cast: boolean) => ({
    name, isMesh: true, isSkinnedMesh: true, material: {}, skeleton: skel, bindMode: 'detached', bindMatrix: { elements: identity },
    matrix: { elements: identity }, matrixWorld: { elements: [...identity], copy(m: { elements: number[] }) { this.elements = [...m.elements] } },
    castShadow: cast, parent: null as unknown,
  })
  const level = (m: ReturnType<typeof mesh>, visible: boolean) => {
    const object = { visible, parent, matrix: { elements: identity }, traverse(visit: (o: unknown) => void) { visit(this); visit(m) } }
    m.parent = object
    return object
  }
  const m1 = mesh('lod1', skeleton, true), m2 = mesh('lod2', sameSkeleton ? skeleton : {}, false)
  m1.matrixWorld.elements[12] = 7
  const level0 = level(mesh('lod0', skeleton, true), false), level1 = level(m1, true), level2 = level(m2, false)
  const lod = { isLOD: true, levels: [level0, level1, level2].map(object => ({ object })) }
  const visual = { visible: true, traverse(visit: (o: unknown) => void) { visit(this); visit(lod) } } as unknown as THREE.Object3D
  return { visual, level1, level2, m1, m2 }
}

describe('LOD1 shadow proxy', () => {
  const run = (rig: ReturnType<typeof fakeHumanoidLod>, enabled = true) => {
    const seen: Array<{ lod1: boolean; lod2: boolean; cast: boolean; x: number }> = []
    let fail = false
    const shadowMap = { render() {
      seen.push({ lod1: rig.level1.visible, lod2: rig.level2.visible, cast: rig.m2.castShadow, x: rig.m2.matrixWorld.elements[12] })
      if (fail) throw new Error('pass failed')
    } }
    const renderer = { shadowMap } as unknown as THREE.WebGLRenderer
    const root = asObject(node('actor', [node('body', [], true)]))
    installShadowCasterCulling(renderer, visit => visit(root, 1, rig.visual))
    setLod1ShadowProxyEnabled(renderer, enabled)
    return { seen, shadowMap, fail: () => { fail = true } }
  }

  it('draws the shared-skeleton LOD2 mesh at the LOD1 pose during the pass and restores afterwards, even on failure', () => {
    const rig = fakeHumanoidLod(true), h = run(rig)
    h.shadowMap.render()
    expect(h.seen[0]).toEqual({ lod1: false, lod2: true, cast: true, x: 7 })
    expect([rig.level1.visible, rig.level2.visible, rig.m2.castShadow]).toEqual([true, false, false])
    h.fail()
    expect(() => h.shadowMap.render()).toThrow('pass failed')
    expect([rig.level1.visible, rig.level2.visible, rig.m2.castShadow]).toEqual([true, false, false])
  })

  it('keeps LOD1 as the caster when the policy is off or the skeletons are not shared', () => {
    const off = fakeHumanoidLod(true), disabled = run(off, false)
    disabled.shadowMap.render()
    expect(disabled.seen[0]).toMatchObject({ lod1: true, lod2: false, cast: false })
    const unshared = fakeHumanoidLod(false), h = run(unshared)
    h.shadowMap.render()
    expect(h.seen[0]).toMatchObject({ lod1: true, lod2: false, cast: false })
  })
})
