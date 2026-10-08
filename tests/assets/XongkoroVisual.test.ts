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

function footSupportHeights(visual: XongkoroVisual): number[] {
  const body = visual.lod.levels[0].object as THREE.SkinnedMesh
  const indices = body.geometry.getAttribute('skinIndex'), weights = body.geometry.getAttribute('skinWeight')
  const point = new THREE.Vector3()
  visual.root.updateWorldMatrix(true, true)
  return ['L', 'R'].map(side => {
    let lowest = Infinity
    for (let vertex = 0; vertex < indices.count; vertex++) {
      let footWeight = 0
      for (let joint = 0; joint < 4; joint++) {
        const name = visual.skeleton.bones[indices.getComponent(vertex, joint)].name
        if (name === `Bip01_${side}_Foot` || name.startsWith(`BN_Toe_${side}_`)) footWeight += weights.getComponent(vertex, joint)
      }
      if (footWeight < .6) continue
      body.getVertexPosition(vertex, point); body.localToWorld(point)
      lowest = Math.min(lowest, point.y)
    }
    return lowest
  })
}

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
    expect(mount.aimColliders[0].parent).toBe(visual.torsoSocket)
    // Real Mount materialization must plant both independent foot surfaces.
    for (const foot of footSupportHeights(visual)) expect(Math.abs(foot)).toBeLessThan(.01)
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
    // The ten-metre measurement is defined in the source reference, not the
    // shorter horizontal projection of a chest-raised standing bird.
    visual.update(0, state)
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

  it('blends off support, preserves the current base on death and replants both feet on return without pose drift', () => {
    const visual = new XongkoroVisual()
    onTestFinished(() => visual.dispose())
    visual.update(0, { ...state, flying: false })
    const standing = visual.standingSocket.getWorldPosition(new THREE.Vector3())
    const head = visual.headAttackSocket.getWorldPosition(new THREE.Vector3())
    const feet = footSupportHeights(visual)
    for (const foot of feet) expect(Math.abs(foot)).toBeLessThan(.01)
    visual.update(.016, state)
    const transitioning = visual.standingSocket.getWorldPosition(new THREE.Vector3())
    expect(transitioning.distanceTo(standing)).toBeGreaterThan(0)
    expect(transitioning.distanceTo(standing)).toBeLessThan(.3)
    visual.update(.5, state)
    const airborne = visual.standingSocket.getWorldPosition(new THREE.Vector3())
    expect(airborne.distanceTo(standing)).toBeGreaterThan(.5)
    visual.update(.2, { ...state, flying: false, dead: true, attackWeight: 1 })
    expect(visual.standingSocket.getWorldPosition(new THREE.Vector3()).distanceTo(airborne)).toBeLessThan(1e-5)
    visual.update(0, { ...state, flying: false })
    expect(visual.standingSocket.getWorldPosition(new THREE.Vector3()).distanceTo(standing)).toBeLessThan(1e-5)
    visual.update(0, { ...state, flying: false, attackWeight: 1 })
    visual.update(.2, { ...state, flying: false, dead: true })
    expect(visual.headAttackSocket.getWorldPosition(new THREE.Vector3()).distanceTo(head)).toBeLessThan(1e-5)
    for (let frame = 0; frame < 30; frame++) visual.update(1 / 60, { ...state, flying: false })
    footSupportHeights(visual).forEach((foot, side) => expect(foot).toBeCloseTo(feet[side], 5))
    expect(visual.standingSocket.getWorldPosition(new THREE.Vector3()).distanceTo(standing)).toBeLessThan(1e-5)
    // The source may reach support on any flap phase. Blending the folded
    // flight legs must not send their rotation arc through the support plane.
    for (const phase of [.08, .29, .5]) {
      visual.update(0, state)
      visual.update(phase, state)
      for (let frame = 0; frame < 20; frame++) {
        visual.update(.02, { ...state, flying: false })
        for (const foot of footSupportHeights(visual)) expect(foot).toBeGreaterThan(-1e-5)
      }
      footSupportHeights(visual).forEach(foot => expect(Math.abs(foot)).toBeLessThan(.01))
    }
  })

  it('limits live downstrokes near support and preserves the last wing pose when the mount dies', () => {
    const visual = new XongkoroVisual()
    onTestFinished(() => visual.dispose())
    const body = visual.lod.levels[0].object as THREE.SkinnedMesh
    const indices = body.geometry.getAttribute('skinIndex'), weights = body.geometry.getAttribute('skinWeight')
    const wing: number[] = []
    for (let vertex = 0; vertex < indices.count; vertex++) {
      let influence = 0
      for (let joint = 0; joint < 4; joint++) {
        if (visual.skeleton.bones[indices.getComponent(vertex, joint)].name.includes('Wing')) influence += weights.getComponent(vertex, joint)
      }
      if (influence > .5) wing.push(vertex)
    }
    expect(wing.length).toBeGreaterThan(0)
    const point = new THREE.Vector3()
    const step = template.animations.find(clip => clip.name === 'fly')!.duration / 24
    for (const [clearance, bank] of [[0, 0], [3, 0], [6, 0], [9, 0], [6, .55], [9, .55], [15, .55]]) {
      visual.root.rotation.z = bank
      visual.root.updateWorldMatrix(true, true)
      visual.update(0, { ...state, groundClearance: clearance })
      for (let sample = 0; sample < 24; sample++) {
        visual.update(step, { ...state, groundClearance: clearance })
        let lowest = Infinity
        for (const vertex of wing) {
          body.getVertexPosition(vertex, point); body.localToWorld(point)
          lowest = Math.min(lowest, point.y + clearance)
        }
        expect(lowest).toBeGreaterThan(-.01)
      }
    }
    visual.update(step * 9, { ...state, groundClearance: 9 })
    const wingTip = visual.skeleton.bones.find(bone => bone.name === 'BN_Wing_L_04')!
    const held = wingTip.getWorldPosition(new THREE.Vector3())
    visual.update(.2, { ...state, flying: false, dead: true, groundClearance: 0 })
    expect(wingTip.getWorldPosition(new THREE.Vector3()).distanceTo(held)).toBeLessThan(1e-5)
  })

  it('rejects missing torso, standing bones or foot surfaces and retries without publishing a partial template', async () => {
    vi.resetModules()
    const { XongkoroVisual: FreshVisual } = await import('../../src/world/XongkoroVisual')
    const scene = cloneSkeleton(template.scene) as THREE.Group
    scene.getObjectByName('socket_rider_standing')!.removeFromParent()
    const noCalf = cloneSkeleton(template.scene) as THREE.Group
    noCalf.getObjectByName('Bip01_L_Calf')!.name = 'unavailable'
    const noFeet = cloneSkeleton(template.scene) as THREE.Group
    const footlessBody = noFeet.getObjectByName('eagle_body_lod0') as THREE.SkinnedMesh
    footlessBody.geometry = footlessBody.geometry.clone()
    onTestFinished(() => footlessBody.geometry.dispose())
    const weights = footlessBody.geometry.getAttribute('skinWeight')
    for (let vertex = 0; vertex < weights.count; vertex++) weights.setXYZW(vertex, 0, 0, 0, 0)
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify(manifest))))
    const loader = vi.spyOn(GLTFLoader.prototype, 'loadAsync')
      .mockResolvedValueOnce({ ...template, scene })
      .mockResolvedValueOnce({ ...template, scene: noCalf })
      .mockResolvedValueOnce({ ...template, scene: noFeet })
      .mockResolvedValueOnce(template)
    await expect(FreshVisual.preload()).rejects.toThrow('socket_rider_standing')
    expect(FreshVisual.ready).toBe(false)
    await expect(FreshVisual.preload()).rejects.toThrow('Bip01_L_Calf')
    expect(FreshVisual.ready).toBe(false)
    await expect(FreshVisual.preload()).rejects.toThrow('L foot surface')
    expect(FreshVisual.ready).toBe(false)
    await FreshVisual.preload()
    expect(FreshVisual.ready).toBe(true)
    expect(loader).toHaveBeenCalledTimes(4)
  })
})
