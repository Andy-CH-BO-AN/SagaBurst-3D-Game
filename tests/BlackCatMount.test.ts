import * as THREE from 'three'
import { beforeAll, describe, expect, it } from 'vitest'
import { installBlackCatTestAsset } from './helpers/blackCatAsset'
import { BlackCatVisual } from '../src/world/BlackCatVisual'
import { Mount, MountState, MountType, mountTypeFromSave } from '../src/world/Mount'

describe('reference black cat mount', () => {
  beforeAll(installBlackCatTestAsset)

  it('keeps the source paws on the ground with normalized skin weights', () => {
    const cat = new BlackCatVisual()
    cat.root.updateMatrixWorld(true)
    const mesh = cat.root.getObjectByName('cat_body_lod0') as THREE.SkinnedMesh
    const bounds = new THREE.Box3().setFromObject(mesh)
    expect(bounds.min.y).toBeGreaterThan(-0.005)
    expect(bounds.min.y).toBeLessThan(0.025)
    const weights = mesh.geometry.getAttribute('skinWeight')
    for (let i = 0; i < weights.count; i++) {
      expect(weights.getX(i) + weights.getY(i) + weights.getZ(i) + weights.getW(i)).toBeCloseTo(1, 4)
    }
  }, 15000)

  it('uses metre scale and transforms its actual saddle socket with heading and position', () => {
    const mount = new Mount(new THREE.Scene(), MountType.BLACK_CAT, 5, 9, 3)
    mount.group.rotation.y = Math.PI / 2
    expect(mount.group.scale.toArray()).toEqual([1, 1, 1])
    const seat = mount.getRiderPelvisSeatWorld()
    expect(seat.x).toBeCloseTo(4.85)
    expect(seat.y).toBeCloseTo(4.65)
    expect(seat.z).toBeCloseTo(9)
    expect(mount.getSaddleSeatLocal().y).toBeCloseTo(1.65)
    expect(mountTypeFromSave('BLACK_CAT')).toBe(MountType.BLACK_CAT)
  })

  it('shares immutable meshes while keeping independent gait and pause state', () => {
    const a = new BlackCatVisual(), b = new BlackCatVisual()
    a.playStudioClip('gallop')
    a.update(0.12)
    const leg = a.root.getObjectByName('cat_front_upper_r')!
    expect(leg.quaternion.angleTo(b.root.getObjectByName(leg.name)!.quaternion)).toBeGreaterThan(.01)
    expect(a.skeleton).not.toBe(b.skeleton)
    expect(a.mixer).not.toBe(b.mixer)
    expect(a.root.getObjectByName('cat_head')).not.toBe(b.root.getObjectByName('cat_head'))
    a.togglePaused()
    const angle = leg.quaternion.clone()
    a.update(0.5)
    expect(leg.quaternion.angleTo(angle)).toBeCloseTo(0)
    const meshes = (root: THREE.Object3D) => {
      const result: THREE.Mesh[] = []
      root.traverse(o => { if (o instanceof THREE.Mesh) result.push(o) })
      return result
    }
    expect(meshes(a.root)[0].geometry).toBe(meshes(b.root)[0].geometry)
    a.dispose()
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
    mount.takeDamage(999)
    mount.update(1, [])
    expect(mount.dead).toBe(true)
    expect(mount.catVisual!.debugState().clip).toBe('death')
    mount.playStudioClip('idle')
    mount.catVisual!.update(0)
    expect(mount.getRiderPelvisSeatWorld().x).toBeCloseTo(0)
    expect(mount.getRiderPelvisSeatWorld().y).toBeCloseTo(1.65)
  })

  it('keeps jump tucked until landing, then recovers to locomotion', () => {
    const cat = new BlackCatVisual()
    cat.playOnce('jump')
    cat.update(1)
    expect(cat.debugState().clip).toBe('jump')
    cat.playOnce('land')
    cat.update(0.2)
    expect(cat.debugState().clip).toBe('land')
    cat.update(1)
    expect(cat.debugState().clip).toBe('idle')
    cat.update(.2)
    const idle = new BlackCatVisual()
    expect(cat.root.getObjectByName('cat_front_upper_r')!.quaternion.angleTo(idle.root.getObjectByName('cat_front_upper_r')!.quaternion)).toBeCloseTo(0)
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
