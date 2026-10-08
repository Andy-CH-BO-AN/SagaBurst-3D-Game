import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { afterAll, afterEach, beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest'
import { loadTestGlbAsset } from '../helpers/testGlbAsset'
import { XongkoroVisual } from '../../src/world/XongkoroVisual'
import { Mount, MountType } from '../../src/world/Mount'
import { XONGKORO } from '../../src/movement/XongkoroConfig'

const manifest = JSON.parse(readFileSync('public/models/mounts/v2/xongkoro/manifest.json', 'utf8'))
const state = { flying: true, sprinting: false, attackWeight: 0, dead: false }

describe('xongkoro shipped asset and visual ownership', () => {
  let template: GLTF
  beforeAll(async () => {
    // One real GLB owner; preserve material flags, omit only DOM texture decoding.
    template = await loadTestGlbAsset('public/models/mounts/v2/xongkoro/xongkoro.glb', { keepMaterialProperties: true })
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(manifest))))
    vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockResolvedValue(template)
    await XongkoroVisual.preload()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
  afterAll(() => {
    const geometry = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>()
    template.scene.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return
      geometry.add(object.geometry)
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material)
    })
    for (const resource of [...geometry, ...materials]) resource.dispose()
  })

  it('preloads a unit-scale instance with standing feet attached to the torso and all gameplay attack sockets', () => {
    const mount = new Mount(new THREE.Scene(), MountType.XONGKORO, 0, 0, 0)
    const visual = mount.eagleVisual!
    onTestFinished(() => mount.dispose())
    expect(mount.aimColliders).toHaveLength(2)
    const headProxy = mount.aimColliders[1]
    const headSize = headProxy.geometry.boundingBox!.getSize(new THREE.Vector3()).multiply(headProxy.getWorldScale(new THREE.Vector3()))
    // The source socket scale is about 29.7; the anatomical hurt shape stays metres.
    XONGKORO.headHurtSize.forEach((expected, axis) => expect(headSize.getComponent(axis)).toBeCloseTo(expected, 4))
    expect(headProxy.parent).toBe(visual.headAttackSocket)
    expect(visual.root.scale.toArray()).toEqual([1, 1, 1])
    expect(visual.standingSocket.parent?.name).toBe('Bip01_Spine1')
    expect(visual.lod.levels.map(level => level.object.name)).toEqual(['eagle_body_lod0', 'eagle_body_lod1', 'eagle_body_lod2'])
    for (const entry of visual.lod.levels) {
      const material = (entry.object as THREE.SkinnedMesh).material as THREE.MeshStandardMaterial
      // Feather cutout must write opaque depth or claws/underside show through the back.
      expect(material.transparent).toBe(false)
      expect(material.depthWrite).toBe(true)
      expect(material.alphaTest).toBe(.5)
    }
    expect(visual.skeleton.bones).toContain(visual.standingSocket.parent)
    const body = visual.lod.levels[0].object as THREE.SkinnedMesh
    const indices = body.geometry.getAttribute('skinIndex'), weights = body.geometry.getAttribute('skinWeight')
    const point = new THREE.Vector3()
    let rear = Infinity, front = -Infinity
    visual.skeleton.update()
    for (let vertex = 0; vertex < body.geometry.getAttribute('position').count; vertex++) {
      let axialWeight = 0
      for (let joint = 0; joint < 4; joint++) {
        const name = visual.skeleton.bones[indices.getComponent(vertex, joint)].name
        if (/Pelvis|Spine|Neck|Head|Jaw|Tai/.test(name)) axialWeight += weights.getComponent(vertex, joint)
      }
      if (axialWeight <= .5) continue
      body.getVertexPosition(vertex, point); body.localToWorld(point)
      rear = Math.min(rear, point.z); front = Math.max(front, point.z)
    }
    // Gameplay depends on ten metres head-to-tail, independently of wing span.
    expect(front - rear).toBeCloseTo(10, 3)
    const seat = visual.standingSocket.getWorldPosition(new THREE.Vector3())
    expect(seat.y).toBeGreaterThan(2)
    expect(seat.y).toBeLessThan(4)
    visual.root.position.set(5, 20, -3)
    visual.root.rotation.set(.3, .7, -.4)
    visual.root.updateWorldMatrix(true, true)
    const expected = seat.clone().applyMatrix4(visual.root.matrixWorld)
    expect(visual.standingSocket.getWorldPosition(new THREE.Vector3()).distanceTo(expected)).toBeLessThan(1e-5)
    for (const socket of [visual.headAttackSocket, visual.leftClawAttackSocket, visual.rightClawAttackSocket]) {
      expect(socket.parent).toBeInstanceOf(THREE.Bone)
      expect(socket.getWorldPosition(new THREE.Vector3()).toArray().every(Number.isFinite)).toBe(true)
    }
  })

  it('keeps attack pose and mixer independent and restores the sampled pose on cancellation or death', () => {
    const a = new XongkoroVisual(), b = new XongkoroVisual()
    onTestFinished(() => { a.dispose(); b.dispose() })
    expect(a.skeleton).not.toBe(b.skeleton)
    expect(a.mixer).not.toBe(b.mixer)
    const sample = b.headAttackSocket.getWorldPosition(new THREE.Vector3())
    const claws = [b.leftClawAttackSocket, b.rightClawAttackSocket].map(socket => socket.getWorldPosition(new THREE.Vector3()))
    a.update(0, { ...state, attackWeight: 1 })
    const attacked = a.headAttackSocket.getWorldPosition(new THREE.Vector3())
    expect(attacked.distanceTo(sample)).toBeGreaterThan(.2)
    // Contact sockets must follow the attacking anatomy, not the full wing box.
    for (const [index, socket] of [a.leftClawAttackSocket, a.rightClawAttackSocket].entries()) {
      const point = socket.getWorldPosition(new THREE.Vector3())
      expect(point.z).toBeGreaterThan(claws[index].z)
      expect(point.y).toBeLessThan(claws[index].y)
    }
    expect(b.headAttackSocket.getWorldPosition(new THREE.Vector3()).distanceTo(sample)).toBeLessThan(1e-6)
    a.update(0, { ...state, attackWeight: 1 })
    expect(a.headAttackSocket.getWorldPosition(new THREE.Vector3()).distanceTo(attacked)).toBeLessThan(1e-5)
    a.update(0, { ...state, dead: true, attackWeight: 1 })
    expect(a.headAttackSocket.getWorldPosition(new THREE.Vector3()).distanceTo(sample)).toBeLessThan(1e-5)
    const geometry = (a.lod.levels[0].object as THREE.SkinnedMesh).geometry
    expect(geometry).toBe((b.lod.levels[0].object as THREE.SkinnedMesh).geometry)
    const dispose = vi.spyOn(geometry, 'dispose')
    a.dispose()
    expect(dispose).not.toHaveBeenCalled()
  })

  it('switches source-derived LOD while retaining the authority sockets and flight playback', () => {
    const visual = new XongkoroVisual(), camera = new THREE.PerspectiveCamera()
    onTestFinished(() => visual.dispose())
    visual.update(.13, state)
    const seat = visual.standingSocket.getWorldPosition(new THREE.Vector3())
    for (const [level, distance] of [3, 90, 200].entries()) {
      camera.position.set(0, 0, distance); camera.updateMatrixWorld(true)
      visual.lod.update(camera)
      expect(visual.lod.getCurrentLevel()).toBe(level)
      expect(visual.lod.levels.filter(entry => entry.object.visible)).toHaveLength(1)
      expect((visual.lod.levels[level].object as THREE.SkinnedMesh).skeleton).toBe(visual.skeleton)
      expect(visual.standingSocket.getWorldPosition(new THREE.Vector3()).distanceTo(seat)).toBeLessThan(1e-5)
      expect(visual.mixer.time).toBeCloseTo(.13)
    }
  })

  it('rejects a missing torso socket and retries its failed preload without publishing a partial template', async () => {
    vi.resetModules()
    const { XongkoroVisual: FreshVisual } = await import('../../src/world/XongkoroVisual')
    const scene = cloneSkeleton(template.scene) as THREE.Group
    scene.getObjectByName('socket_rider_standing')!.removeFromParent()
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify(manifest))))
    const loader = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockResolvedValueOnce({ ...template, scene }).mockResolvedValueOnce(template)
    await expect(FreshVisual.preload()).rejects.toThrow('socket_rider_standing')
    expect(FreshVisual.ready).toBe(false)
    await FreshVisual.preload()
    expect(FreshVisual.ready).toBe(true)
    expect(loader).toHaveBeenCalledTimes(2)
  })
})
