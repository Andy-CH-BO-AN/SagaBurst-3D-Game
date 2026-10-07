import * as THREE from 'three'
import { beforeAll, describe, expect, it } from 'vitest'
import { installCorgiTestAsset } from './helpers/corgiAsset'
import { CorgiVisual, CORGI_DIMENSIONS, CORGI_RIDER_PELVIS_CLEARANCE } from '../src/world/CorgiVisual'
import { Mount, MountState, MountType, mountTypeFromSave } from '../src/world/Mount'

describe('reference source corgi mount', () => {
  let restSeat: THREE.Vector3
  beforeAll(async () => {
    const gltf = await installCorgiTestAsset()
    gltf.scene.updateMatrixWorld(true)
    restSeat = gltf.scene.getObjectByName('socket_saddle_seat')!.getWorldPosition(new THREE.Vector3())
  })


  it('uses metre scale and transforms its actual saddle socket with heading and position', () => {
    const reference = new CorgiVisual()
    const idleSeat = reference.saddleSeat.getWorldPosition(new THREE.Vector3())
    const idlePelvis = reference.riderPelvisSeat.getWorldPosition(new THREE.Vector3())
    const mount = new Mount(new THREE.Scene(), MountType.CORGI, 5, 9, 3)
    mount.group.rotation.y = Math.PI / 2
    expect(mount.group.scale.toArray()).toEqual([1, 1, 1])
    expect(restSeat.x).toBeCloseTo(0, 5)
    expect(restSeat.y).toBeCloseTo(CORGI_DIMENSIONS.saddleHeight, 5)
    expect(restSeat.z).toBeCloseTo(-.2, 5)
    expect(reference.riderPelvisSeat.position.y).toBe(CORGI_RIDER_PELVIS_CLEARANCE)
    const seat = mount.getRiderPelvisSeatWorld()
    expect(seat.x).toBeCloseTo(5 + idlePelvis.z, 5)
    expect(seat.y).toBeCloseTo(3 + idlePelvis.y, 5)
    expect(seat.z).toBeCloseTo(9 - idlePelvis.x, 5)
    expect(mount.getSaddleSeatLocal().y).toBeCloseTo(idleSeat.y, 5)
    expect(mountTypeFromSave('CORGI')).toBe(MountType.CORGI)
    mount.dispose()
    reference.dispose()
  })

  it('shares immutable meshes while keeping independent gait and pause state', () => {
    const a = new CorgiVisual(), b = new CorgiVisual()
    a.playStudioClip('run')
    a.update(0.12)
    const leg = a.root.getObjectByName('corgi_front_upper_r')!
    expect(leg.quaternion.angleTo(b.root.getObjectByName(leg.name)!.quaternion)).toBeGreaterThan(.01)
    expect(a.skeleton).not.toBe(b.skeleton)
    expect(a.mixer).not.toBe(b.mixer)
    expect(a.root.getObjectByName('corgi_head')).not.toBe(b.root.getObjectByName('corgi_head'))
    a.togglePaused()
    const angle = leg.quaternion.clone()
    a.update(0.5)
    expect(leg.quaternion.clone().normalize().angleTo(angle.normalize())).toBeCloseTo(0)
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
    const mount = new Mount(new THREE.Scene(), MountType.CORGI, 0, 0, 0)
    mount.state = MountState.CONTROLLED
    mount.visualHold = true
    mount.playStudioClip('walk')
    mount.update(0.2, [])
    expect(mount.corgiVisual!.debugState().time).toBeCloseTo(0.2)
    expect(mount.group.position.toArray()).toEqual([0, 0, 0])
  })

  it('replays upright after death and restores the saddle transform', () => {
    const mount = new Mount(new THREE.Scene(), MountType.CORGI, 0, 0, 0)
    const uprightSeat = mount.getRiderPelvisSeatWorld()
    mount.takeDamage(999)
    mount.update(1, [])
    expect(mount.dead).toBe(true)
    expect(mount.corgiVisual!.debugState().clip).toBe('death')
    mount.playStudioClip('idle')
    mount.corgiVisual!.update(0)
    expect(mount.getRiderPelvisSeatWorld().distanceTo(uprightSeat)).toBeLessThan(1e-6)
    mount.dispose()
  })

  it('keeps jump tucked until landing, then recovers to locomotion', () => {
    const cat = new CorgiVisual()
    cat.playOnce('jump')
    cat.update(1)
    expect(cat.debugState().clip).toBe('jump')
    cat.playOnce('land')
    cat.update(0.2)
    expect(cat.debugState().clip).toBe('land')
    cat.update(1)
    expect(cat.debugState().clip).toBe('idle')
    cat.update(.2)
    const idle = new CorgiVisual()
    expect(cat.root.getObjectByName('corgi_front_upper_r')!.quaternion.clone().normalize().angleTo(idle.root.getObjectByName('corgi_front_upper_r')!.quaternion.clone().normalize())).toBeCloseTo(0)
  })

  it('shows exactly one source-derived body at each LOD while sharing one skin', () => {
    const cat = new CorgiVisual(), camera = new THREE.PerspectiveCamera()
    for (const [level, distance] of [3, 25, 50].entries()) {
      camera.position.set(0, 0, distance); camera.updateMatrixWorld(true)
      cat.lod.update(camera)
      expect(cat.lod.getCurrentLevel()).toBe(level)
      expect(cat.lod.levels.filter(entry => entry.object.visible)).toHaveLength(1)
      expect((cat.lod.levels[level].object as THREE.SkinnedMesh).skeleton).toBe(cat.skeleton)
    }
  })
})
