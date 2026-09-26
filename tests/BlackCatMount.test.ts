import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { BlackCatVisual } from '../src/world/BlackCatVisual'
import { Mount, MountState, MountType, mountTypeFromSave } from '../src/world/Mount'

describe('reference black cat mount', () => {
  it('keeps all four paws on the same ground plane after the feline hock adjustment', () => {
    const cat = new BlackCatVisual()
    cat.root.updateMatrixWorld(true)
    for (const end of ['front', 'rear']) for (const side of [-1, 1]) {
      const foot = cat.root.getObjectByName(`cat_leg_${end}_${side}_foot`)!
      const bounds = new THREE.Box3().setFromObject(foot)
      expect(bounds.min.y).toBeGreaterThan(-0.035)
      expect(bounds.min.y).toBeLessThan(0.025)
    }
  })

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
    const leg = a.root.getObjectByName('cat_leg_front_-1')!
    expect(leg.rotation.x).not.toBe(0)
    expect(b.root.getObjectByName(leg.name)!.rotation.x).toBeCloseTo(0)
    a.togglePaused()
    const angle = leg.rotation.x
    a.update(0.5)
    expect(leg.rotation.x).toBe(angle)
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
    expect(cat.root.getObjectByName('cat_leg_front_-1')!.rotation.x).toBe(0)
  })
})
