import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { AerialViewPolicy, usesAerialView } from '../../src/camera/AerialViewPolicy'

describe('scoped aerial viewing', () => {
  it.each([[false, false, 30, false], [false, true, 14, false], [false, true, 20, true], [true, false, 2, true]] as const)(
    'eagle=%s observer=%s at %im AGL enables=%s', (eagle, observer, height, expected) => {
      expect(usesAerialView(eagle, observer, height)).toBe(expected)
    })

  it.each([[400, 120, 350], [500, 35, 180]])('restores scene ground far/fog %s/%s/%s after aerial viewing', (far, near, fogFar) => {
    const camera = new THREE.PerspectiveCamera(58, 1, .1, far)
    const scene = new THREE.Scene()
    scene.fog = new THREE.Fog(0xffffff, near, fogFar)
    const update = vi.spyOn(camera, 'updateProjectionMatrix')
    const policy = new AerialViewPolicy()
    policy.update(camera, scene, false)
    expect(update).not.toHaveBeenCalled()
    policy.update(camera, scene, true)
    expect(camera.far).toBe(700)
    expect(scene.fog).toMatchObject({ near: 300, far: 700 })
    policy.update(camera, scene, true)
    expect(update).toHaveBeenCalledTimes(1)
    policy.update(camera, scene, false)
    expect(camera.far).toBe(far)
    expect(scene.fog).toMatchObject({ near, far: fogFar })
  })
})
