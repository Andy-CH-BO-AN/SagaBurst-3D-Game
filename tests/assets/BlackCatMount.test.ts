import * as THREE from 'three'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { beforeAll, describe, expect, it, onTestFinished } from 'vitest'
import { installBlackCatTestAsset } from '../helpers/blackCatAsset'
import { BlackCatVisual } from '../../src/world/BlackCatVisual'
import { Mount, MountState, MountType, mountTypeFromSave } from '../../src/world/Mount'

describe('reference black cat mount', () => {
  let gltf: GLTF
  beforeAll(async () => { gltf = await installBlackCatTestAsset() })


  it('uses metre scale and transforms its actual saddle socket with heading and position', () => {
    const reference = new BlackCatVisual()
    onTestFinished(() => reference.dispose())
    const idleSeat = reference.saddleSeat.getWorldPosition(new THREE.Vector3())
    const mount = new Mount(new THREE.Scene(), MountType.BLACK_CAT, 5, 9, 3)
    onTestFinished(() => mount.dispose())
    mount.group.rotation.y = Math.PI / 2
    expect(mount.group.scale.toArray()).toEqual([1, 1, 1])
    const seat = mount.getRiderPelvisSeatWorld()
    expect(seat.x).toBeCloseTo(5 + idleSeat.z, 5)
    expect(seat.y).toBeCloseTo(3 + idleSeat.y, 5)
    expect(seat.z).toBeCloseTo(9 - idleSeat.x, 5)
    expect(mount.getSaddleSeatLocal().y).toBeCloseTo(idleSeat.y, 5)
    expect(mountTypeFromSave('BLACK_CAT')).toBe(MountType.BLACK_CAT)
    mount.dispose()
  })

  it('shares immutable meshes while keeping independent gait and pause state', () => {
    const a = new BlackCatVisual()
    let aDisposed = false
    onTestFinished(() => { if (!aDisposed) a.dispose() })
    const b = new BlackCatVisual()
    onTestFinished(() => b.dispose())
    const initialB = b.skeleton.bones.map(bone => ({
      position: bone.position.toArray(), quaternion: bone.quaternion.toArray(), scale: bone.scale.toArray(),
    }))
    a.playStudioClip('run')
    a.update(0.12)
    expect(a.skeleton).not.toBe(b.skeleton)
    expect(a.mixer).not.toBe(b.mixer)
    expect(a.skeleton.bones).toHaveLength(b.skeleton.bones.length)
    for (const [index, bone] of b.skeleton.bones.entries()) {
      expect(bone).not.toBe(a.skeleton.bones[index])
      expect({ position: bone.position.toArray(), quaternion: bone.quaternion.toArray(), scale: bone.scale.toArray() }).toEqual(initialB[index])
    }
    expect(a.debugState()).toMatchObject({ clip: 'run', paused: false })
    expect(a.debugState().time).toBeCloseTo(.12)
    expect(a.mixer.time).toBeCloseTo(.12)
    expect(b.debugState()).toMatchObject({ clip: 'idle', time: 0, paused: false })
    expect(b.mixer.time).toBe(0)
    a.togglePaused()
    const pausedTime = a.mixer.time
    a.update(0.5)
    expect(a.debugState().paused).toBe(true)
    expect(a.debugState().time).toBeCloseTo(.12)
    expect(a.mixer.time).toBe(pausedTime)
    const meshes = (root: THREE.Object3D) => {
      const result: THREE.Mesh[] = []
      root.traverse(o => { if (o instanceof THREE.Mesh) result.push(o) })
      return result
    }
    expect(meshes(a.root)[0].geometry).toBe(meshes(b.root)[0].geometry)
    a.dispose()
    aDisposed = true
    expect(meshes(b.root)[0].geometry.getAttribute('position').count).toBeGreaterThan(0)
  })

  it('updates studio playback while the mount is held and controlled', () => {
    const mount = new Mount(new THREE.Scene(), MountType.BLACK_CAT, 0, 0, 0)
    mount.state = MountState.CONTROLLED
    mount.visualHold = true
    mount.playStudioClip('walk')
    mount.update(0.2, [])
    expect(mount.catVisual!.debugState().time).toBeCloseTo(0.2)
    expect(mount.group.position.toArray()).toEqual([0, 0, 0])
  })

  it('replays upright after death and restores the saddle transform', () => {
    const mount = new Mount(new THREE.Scene(), MountType.BLACK_CAT, 0, 0, 0)
    const uprightSeat = mount.getRiderPelvisSeatWorld()
    mount.takeDamage(999)
    mount.update(1, [])
    expect(mount.dead).toBe(true)
    expect(mount.catVisual!.debugState().clip).toBe('death')
    mount.playStudioClip('idle')
    mount.catVisual!.update(0)
    expect(mount.getRiderPelvisSeatWorld().distanceTo(uprightSeat)).toBeLessThan(1e-6)
    mount.dispose()
  })

  it('keeps jump tucked until landing, then recovers to locomotion', () => {
    const cat = new BlackCatVisual()
    onTestFinished(() => cat.dispose())
    const jump = gltf.animations.find(clip => clip.name === 'jump')
    const land = gltf.animations.find(clip => clip.name === 'land')
    expect(jump).toBeDefined()
    expect(land).toBeDefined()
    cat.playOnce('jump')
    cat.update(jump!.duration + .1)
    expect(cat.debugState().clip).toBe('jump')
    cat.playOnce('land')
    cat.update(land!.duration / 2)
    expect(cat.debugState().clip).toBe('land')
    cat.update(land!.duration / 2 + .01)
    expect(cat.debugState().clip).toBe('idle')
    cat.update(.2)
    expect(cat.debugState().clip).toBe('idle')
  })

  it('shows exactly one source-derived body at each LOD while sharing one skin', () => {
    const cat = new BlackCatVisual(), camera = new THREE.PerspectiveCamera()
    for (const [level, distance] of [3, 25, 50].entries()) {
      camera.position.set(0, 0, distance); camera.updateMatrixWorld(true)
      cat.lod.update(camera)
      expect(cat.lod.getCurrentLevel()).toBe(level)
      expect(cat.lod.levels.filter(entry => entry.object.visible)).toHaveLength(1)
      expect((cat.lod.levels[level].object as THREE.SkinnedMesh).skeleton).toBe(cat.skeleton)
    }
  })
})
