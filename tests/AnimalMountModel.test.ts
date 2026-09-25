import * as THREE from 'three'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { validateAnimalMountManifest, type AnimalMountManifest } from '../src/world/AnimalMountModel'
import { Mount, MountType, mountTypeFromSave } from '../src/world/Mount'

describe('Black Cat and Corgi war mount assets', () => {
  for (const [type, folder] of [[MountType.BLACK_CAT, 'black_cat'], [MountType.CORGI, 'corgi']] as const) {
    it(`${type} ships a skinned, three-LOD GLB with validated mount proportions`, () => {
      const base = `../public/models/mounts/v1/${folder}/`
      const manifest = JSON.parse(readFileSync(new URL(`${base}manifest.json`, import.meta.url), 'utf8')) as AnimalMountManifest
      expect(() => validateAnimalMountManifest(manifest, type)).not.toThrow()
      expect(manifest.triangles.lod0).toBeGreaterThanOrEqual(8000)
      expect(manifest.triangles.lod1).toBeGreaterThanOrEqual(3000)
      expect(manifest.triangles.lod2).toBeGreaterThanOrEqual(1000)
      const glb = readFileSync(new URL(`${base}mount.glb`, import.meta.url))
      expect(glb.toString('ascii', 0, 4)).toBe('glTF')
      const jsonLength = glb.readUInt32LE(12)
      const asset = JSON.parse(glb.toString('utf8', 20, 20 + jsonLength)) as {
        nodes: Array<{ name?: string; mesh?: number }>
        meshes: Array<{ primitives: Array<{ attributes: Record<string, number> }> }>
        skins: Array<{ joints: number[] }>
      }
      expect(asset.skins).toHaveLength(1)
      const names = new Set(asset.nodes.map((node) => node.name))
      for (const name of [...manifest.bones, ...manifest.sockets, ...[0, 1, 2].map((lod) => `${folder}_body_lod${lod}`)]) {
        expect(names.has(name), `${folder} missing ${name}`).toBe(true)
      }
      for (const lod of [0, 1, 2]) {
        const node = asset.nodes.find((item) => item.name === `${folder}_body_lod${lod}`)!
        const primitives = asset.meshes[node.mesh!].primitives
        expect(primitives.every((primitive) => 'JOINTS_0' in primitive.attributes && 'WEIGHTS_0' in primitive.attributes)).toBe(true)
      }
    })

    it(`${type} keeps the synchronous gameplay seat and independent test rigs`, () => {
      const scene = new THREE.Scene()
      const first = new Mount(scene, type, 2, 3, 0)
      const second = new Mount(scene, type, 5, 3, 0)
      const seat = first.getRiderPelvisSeatLocal()
      expect(first.group.scale.toArray()).toEqual([1, 1, 1])
      expect(seat.y).toBeCloseTo(type === MountType.BLACK_CAT ? .94 : 1.82, 2)
      expect(first.animalVisual?.root.getObjectByName('socket_saddle_seat')).toBe(first.animalVisual?.saddleSeat)
      expect(first.animalVisual?.root.getObjectByName('socket_camera')).toBe(first.animalVisual?.cameraSocket)
      expect(first.mountSkeleton).not.toBe(second.mountSkeleton)
      expect(mountTypeFromSave(type)).toBe(type)
    })
  }
})
