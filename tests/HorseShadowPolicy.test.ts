import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  HORSE_LOD0_SHADOW_KEEP_MESHES,
  shouldHorseCastShadow,
} from '../src/world/HorseShadowPolicy'

interface GlbDocument {
  nodes?: Array<{ name?: string, mesh?: number, children?: number[] }>
}

function parseGlb(path: string): GlbDocument {
  const data = readFileSync(path)
  expect(data.subarray(0, 4).toString('ascii')).toBe('glTF')
  expect(data.readUInt32LE(16)).toBe(0x4e4f534a)
  return JSON.parse(data.subarray(20, 20 + data.readUInt32LE(12)).toString('utf8')) as GlbDocument
}

const PACKAGE_ROOT = resolve('public/models/mounts/v1/horse')
const EXPECTED_LOD0_MESHES = [
  'bit_0P_Metal_Bare_mqm',
  'bridle_4F_Leather_Brown_Worn_mqm',
  'bridle_body_0P_Metal_Bare_mqm',
  'bridle_body_4F_Leather_Brown_Worn_mqm',
  'horse_body_lod0',
  'horse_groom_mane_lod0',
  'horse_groom_tail_lod0',
  'horse_horse_cornea',
  'horse_horse_eyes',
  'horse_horse_gums',
  'horse_horse_hooves',
  'horse_horse_teeth',
  'reins_4F_Leather_Brown_Worn_mqm',
  'saddle_pad_quilt_random',
  'saddle_quilt_dark',
  'saddle_saddle_random',
  'saddle_stirrup_0F_Corten_mqm',
  'saddle_stirrup_strap_4C_Leather_Black_mqm',
].sort()

describe('Horse shadow policy contracts (3-caster candidate)', () => {
  it('is fail-closed for unknown names and all non-LOD0 levels', () => {
    expect(shouldHorseCastShadow('unreviewed_future_horse_mesh', 0)).toBe(false)
    for (const name of HORSE_LOD0_SHADOW_KEEP_MESHES) {
      expect(shouldHorseCastShadow(name, 1)).toBe(false)
      expect(shouldHorseCastShadow(name, 2)).toBe(false)
    }
  })

  it('applies exactly body, tail, and hooves to the real shipped GLB', () => {
    const document = parseGlb(resolve(PACKAGE_ROOT, 'horse_runtime.glb'))
    const nodes = document.nodes ?? []
    const meshesForLod = (lodName: string): string[] => {
      const lod = nodes.find((node) => node.name === lodName)
      expect(lod).toBeDefined()
      return (lod!.children ?? []).map((index) => nodes[index])
        .filter((node): node is { name: string, mesh: number } => Boolean(node?.name && node.mesh !== undefined))
        .map((node) => node.name)
    }

    const lod0 = meshesForLod('horse_lod0')
    expect(lod0.sort()).toEqual(EXPECTED_LOD0_MESHES)
    expect(lod0.filter((name) => shouldHorseCastShadow(name, 0)).sort()).toEqual([
      'horse_body_lod0',
      'horse_groom_tail_lod0',
      'horse_horse_hooves',
    ])
    expect(lod0.filter((name) => shouldHorseCastShadow(name, 0))).toHaveLength(3)

    for (const lodName of ['horse_lod1', 'horse_lod2']) {
      const lodIndex = lodName === 'horse_lod1' ? 1 : 2
      const names = meshesForLod(lodName)
      expect(names.length).toBeGreaterThan(0)
      expect(names.filter((name) => shouldHorseCastShadow(name, lodIndex))).toHaveLength(0)
    }
  })
})
