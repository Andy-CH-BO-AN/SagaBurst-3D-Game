import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  createSky,
  getDirectionalShadowMapSize,
  PRODUCTION_SHADOW_MAP_SIZE,
  resolveShadowMapSize,
  setDirectionalShadowMapSize,
} from '../src/world/Sky'

describe('shadow map size', () => {
  it('uses the production blob-shadow resolution by default', () => {
    expect(PRODUCTION_SHADOW_MAP_SIZE).toBe(256)
    expect(resolveShadowMapSize(new URLSearchParams())).toBe(256)
  })

  it('accepts only the four supported DEV benchmark resolutions', () => {
    for (const size of [2048, 1024, 512, 256]) {
      expect(resolveShadowMapSize(new URLSearchParams(`shadowMapSize=${size}`))).toBe(size)
    }

    expect(resolveShadowMapSize(new URLSearchParams('shadowMapSize=768'))).toBe(256)
  })

  it('updates and reports the actual directional shadow map size', () => {
    const scene = new THREE.Scene()
    createSky(scene, 2048)

    expect(getDirectionalShadowMapSize(scene)).toBe(2048)
    expect(setDirectionalShadowMapSize(scene, 256)).toBe(256)
    expect(getDirectionalShadowMapSize(scene)).toBe(256)
  })
})
