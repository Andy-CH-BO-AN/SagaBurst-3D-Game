import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { CorgiVisual, CORGI_RIDER_PELVIS_CLEARANCE } from '../src/world/CorgiVisual'
import { Mount, MountState, MountType, mountTypeFromSave } from '../src/world/Mount'

describe('reference armored corgi', () => {
  it('grounds four paws in metre coordinates and preserves CORGI saves', () => {
    const mount = new Mount(new THREE.Scene(), mountTypeFromSave('CORGI'), 0, 0, 0)
    expect(mount.type).toBe(MountType.CORGI)
    expect(mount.group.scale.toArray()).toEqual([1, 1, 1])
    mount.group.updateWorldMatrix(true, true)
    for (const end of ['front', 'rear']) for (const side of [-1, 1]) {
      const paw = mount.group.getObjectByName(`corgi_leg_${end}_${side}_foot`)!
      expect(new THREE.Box3().setFromObject(paw).min.y).toBeCloseTo(0, 3)
    }
  })

  it('transforms the actual animated seat with translation, heading and scale', () => {
    const mount = new Mount(new THREE.Scene(), MountType.CORGI, 5, 9, 3)
    mount.group.rotation.y = Math.PI / 2
    mount.group.scale.setScalar(1.2)
    expect(mount.getRiderPelvisSeatWorld().x).toBeCloseTo(5 - 0.16 * 1.2)
    expect(mount.getSaddleSeatWorld().y).toBeCloseTo(3 + 1.63 * 1.2)
    expect(mount.getRiderPelvisSeatWorld().y).toBeCloseTo(3 + (1.63 + CORGI_RIDER_PELVIS_CLEARANCE) * 1.2)
    mount.visualHold = true
    mount.state = MountState.CONTROLLED
    mount.playStudioClip('gallop'); mount.update(0.17, [])
    const socket = mount.corgiVisual!.riderPelvisSeat.getWorldPosition(new THREE.Vector3())
    expect(mount.getRiderPelvisSeatWorld().distanceTo(socket)).toBeLessThan(1e-8)
    expect(mount.getSaddleSeatLocal().y).not.toBeCloseTo(1.63, 4)
  })

  it('keeps anatomical pelvis clearance in the saddle frame through pitch, roll and replay', () => {
    const mount = new Mount(new THREE.Scene(), MountType.CORGI, 3, 7, 2)
    mount.group.rotation.set(0.2, 0.8, -0.1)
    mount.group.scale.setScalar(1.3)
    for (const clip of ['idle', 'gallop', 'jump', 'land', 'death', 'idle'] as const) {
      mount.playStudioClip(clip); mount.corgiVisual!.update(0.2)
      const seat = mount.corgiVisual!.saddleSeat
      const pelvisInSeat = seat.worldToLocal(mount.getRiderPelvisSeatWorld())
      expect(pelvisInSeat.x).toBeCloseTo(0)
      expect(pelvisInSeat.y).toBeCloseTo(CORGI_RIDER_PELVIS_CLEARANCE)
      expect(pelvisInSeat.z).toBeCloseTo(0)
      expect(mount.group.localToWorld(mount.getRiderPelvisSeatLocal()).distanceTo(mount.getRiderPelvisSeatWorld())).toBeLessThan(1e-8)
    }
  })

  it('shares render resources while keeping joints, equipment and pause independent', () => {
    const a = new CorgiVisual(), b = new CorgiVisual()
    const meshes = (v: CorgiVisual) => { const found: THREE.Mesh[] = []; v.root.traverse(o => { if (o instanceof THREE.Mesh) found.push(o) }); return found }
    expect(meshes(a)[0].geometry).toBe(meshes(b)[0].geometry)
    const name = 'corgi_leg_front_-1'
    a.playStudioClip('gallop'); a.update(0.13); a.togglePaused()
    const angle = a.root.getObjectByName(name)!.rotation.x
    a.update(1)
    expect(a.root.getObjectByName(name)!.rotation.x).toBe(angle)
    expect(b.root.getObjectByName(name)!.rotation.x).toBeCloseTo(0)
    a.setEquipmentVisible(false)
    expect(b.root.getObjectByName('corgi_equipment')!.visible).toBe(true)
    const dispose = vi.spyOn(meshes(b)[0].geometry, 'dispose')
    a.dispose()
    expect(dispose).not.toHaveBeenCalled()
    dispose.mockRestore()
    expect(meshes(b)[0].geometry.getAttribute('position').count).toBeGreaterThan(0)
  })

  it('holds an airborne tuck until landing and restores the rest pose after death replay', () => {
    const mount = new Mount(new THREE.Scene(), MountType.CORGI, 0, 0, 0)
    mount.onGround = true; mount.startJump(8)
    mount.corgiVisual!.update(1)
    expect(mount.corgiVisual!.debugState().clip).toBe('jump')
    mount.corgiVisual!.playOnce('land'); mount.corgiVisual!.update(0.2)
    expect(mount.corgiVisual!.debugState().clip).toBe('land')
    mount.corgiVisual!.update(0.6)
    expect(mount.corgiVisual!.debugState().clip).toBe('idle')
    mount.takeDamage(1000); mount.update(1, [])
    expect(mount.corgiVisual!.root.getObjectByName('corgi_torso')!.rotation.z).toBeCloseTo(Math.PI / 2)
    mount.playStudioClip('idle'); mount.corgiVisual!.update(0)
    expect(mount.getSaddleSeatLocal().toArray()).toEqual([0, 1.63, -0.16])
  })
})
