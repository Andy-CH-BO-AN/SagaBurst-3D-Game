import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { createTerrain } from '../src/world/Terrain'
import { createSky, getDirectionalShadowMapSize } from '../src/world/Sky'

describe('campaign environment selection', () => {
  it('uses snow only for Viking defense and resets to meadow for Roman/custom battles', () => {
    const samples: { faction: string | null; color: number[]; blades: number }[] = []
    for (const faction of ['viking', 'roman', null] as const) {
      const scene = new THREE.Scene()
      const { terrainMesh } = createTerrain(scene, { fortifiedCampFaction: faction })
      const color = terrainMesh.geometry.getAttribute('color')
      let blades = 0
      scene.traverse(object => {
        if (object instanceof THREE.InstancedMesh && object.name.startsWith('meadow-')) {
          blades += object.count
        }
      })
      samples.push({ faction, color: [color.getX(0), color.getY(0), color.getZ(0)], blades })
    }
    const [snow, roman, custom] = samples
    expect(snow.color[2]).toBeGreaterThan(snow.color[0])
    expect(snow.color[0]).toBeGreaterThan(0.5)
    for (const meadow of [roman, custom]) {
      expect(meadow.color[1]).toBeGreaterThan(meadow.color[2])
      expect(meadow.color[0]).toBeLessThan(0.4)
      expect(meadow.blades).toBeGreaterThan(snow.blades * 4)
    }
  })

  it('changes winter atmosphere without changing shadow resolution', () => {
    const summer = new THREE.Scene(), winter = new THREE.Scene()
    createSky(summer)
    createSky(winter, 256, true)
    expect((winter.background as THREE.Color).getHex()).not.toBe((summer.background as THREE.Color).getHex())
    expect((winter.fog as THREE.Fog).color.getHex()).not.toBe((summer.fog as THREE.Fog).color.getHex())
    expect(getDirectionalShadowMapSize(winter)).toBe(getDirectionalShadowMapSize(summer))
  })
})
