/**
 * Sky.ts
 * Sets up scene background colour, atmospheric fog, and directional sun light.
 */
import * as THREE from 'three'

export const PRODUCTION_SHADOW_MAP_SIZE = 256
const SHADOW_MAP_SIZE_OPTIONS = [2048, 1024, 512, 256] as const

export function resolveShadowMapSize(query: URLSearchParams): number {
  if (!import.meta.env.DEV) return PRODUCTION_SHADOW_MAP_SIZE

  const requested = Number(query.get('shadowMapSize'))
  return SHADOW_MAP_SIZE_OPTIONS.includes(requested as (typeof SHADOW_MAP_SIZE_OPTIONS)[number])
    ? requested
    : PRODUCTION_SHADOW_MAP_SIZE
}

export function createSky(scene: THREE.Scene, shadowMapSize = PRODUCTION_SHADOW_MAP_SIZE): void {
  scene.background = new THREE.Color(0x87ceeb)

  // Atmospheric fog
  scene.fog = new THREE.Fog(0xd4e8f5, 35, 180)

  // Ambient light
  const ambient = new THREE.AmbientLight(0xfff5e0, 0.52)
  scene.add(ambient)

  // Directional sun light
  const sun = new THREE.DirectionalLight(0xfff0cc, 1.8)
  sun.position.set(60, 80, 40)
  sun.castShadow = true
  sun.shadow.mapSize.width = shadowMapSize
  sun.shadow.mapSize.height = shadowMapSize
  sun.shadow.camera.near = 0.5
  sun.shadow.camera.far = 300
  sun.shadow.camera.left = -80
  sun.shadow.camera.right = 80
  sun.shadow.camera.top = 80
  sun.shadow.camera.bottom = -80
  sun.shadow.bias = -0.0003
  scene.add(sun)

  // Hemisphere light
  const hemi = new THREE.HemisphereLight(0x9bc9e2, 0x46513f, 0.72)
  scene.add(hemi)
}
