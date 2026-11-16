import type * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { installShadowCasterCulling } from '../../src/rendering/ShadowCasterCulling'

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
