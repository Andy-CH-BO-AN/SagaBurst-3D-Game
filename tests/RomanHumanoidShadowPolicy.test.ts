import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { readFileSync } from 'node:fs'
import { readGlb, loadRig } from '../tools/lib/humanoid-glb.mjs'
import {
  ROMAN_SHADOW_DROP_ALL_LODS,
  ROMAN_SHADOW_DROP_LOD1,
  shouldRomanHumanoidCastShadow,
} from '../src/world/RomanHumanoidShadowPolicy'

const ALL_AUDITED_ROMAN_MESH_NAMES = [
  'Armour_top_1',
  'Armour_top_2',
  'Boots',
  'Dangles',
  'Full_figure_42_T_pose',
  'Helmet3_1',
  'Helmet3_2',
  'New_arms',
  'New_eye',
  'New_eye_2',
  'New_head',
  'New_legs',
  'RomanUndertunic_l',
  'RomanUndertunic_r',
  'Ties',
  'Tunic_1',
  'Wrist_guard1',
] as const

describe('Roman Humanoid Shadow Policy Contracts', () => {
  it('enforces strict superset rule: any mesh dropped in LOD0 MUST also be dropped in LOD1', () => {
    for (const mesh of ROMAN_SHADOW_DROP_ALL_LODS) {
      expect(ROMAN_SHADOW_DROP_LOD1.has(mesh)).toBe(true)
      expect(shouldRomanHumanoidCastShadow(mesh, 0)).toBe(false)
      expect(shouldRomanHumanoidCastShadow(mesh, 1)).toBe(false)
    }
  })

  it('unconditionally disables all shadow casting in LOD2', () => {
    for (const mesh of ALL_AUDITED_ROMAN_MESH_NAMES) {
      expect(shouldRomanHumanoidCastShadow(mesh, 2)).toBe(false)
    }
    // Also for arbitrary names
    expect(shouldRomanHumanoidCastShadow('unknown_part', 2)).toBe(false)
    expect(shouldRomanHumanoidCastShadow('Armour_top_1', 3)).toBe(false)
  })

  it('drops exactly 7 non-essential casters in LOD0, keeping 10 primary body casters', () => {
    const lod0Casters = ALL_AUDITED_ROMAN_MESH_NAMES.filter((name) =>
      shouldRomanHumanoidCastShadow(name, 0)
    )
    const lod0Dropped = ALL_AUDITED_ROMAN_MESH_NAMES.filter(
      (name) => !shouldRomanHumanoidCastShadow(name, 0)
    )

    expect(lod0Dropped.sort()).toEqual([
      'Armour_top_2',
      'Helmet3_2',
      'New_eye',
      'New_eye_2',
      'RomanUndertunic_l',
      'RomanUndertunic_r',
      'Ties',
    ].sort())

    expect(lod0Casters.sort()).toEqual([
      'Armour_top_1',
      'Boots',
      'Dangles',
      'Full_figure_42_T_pose',
      'Helmet3_1',
      'New_arms',
      'New_head',
      'New_legs',
      'Tunic_1',
      'Wrist_guard1',
    ].sort())

    expect(lod0Casters.length).toBe(10)
    expect(lod0Dropped.length).toBe(7)
  })

  it('drops 9 casters in LOD1 (7 from LOD0 + Dangles & Wrist_guard1), keeping 8 silhouette casters', () => {
    const lod1Casters = ALL_AUDITED_ROMAN_MESH_NAMES.filter((name) =>
      shouldRomanHumanoidCastShadow(name, 1)
    )
    const lod1Dropped = ALL_AUDITED_ROMAN_MESH_NAMES.filter(
      (name) => !shouldRomanHumanoidCastShadow(name, 1)
    )

    expect(lod1Dropped.sort()).toEqual([
      'Armour_top_2',
      'Dangles',
      'Helmet3_2',
      'New_eye',
      'New_eye_2',
      'RomanUndertunic_l',
      'RomanUndertunic_r',
      'Ties',
      'Wrist_guard1',
    ].sort())

    expect(lod1Casters.sort()).toEqual([
      'Armour_top_1',
      'Boots',
      'Full_figure_42_T_pose',
      'Helmet3_1',
      'New_arms',
      'New_head',
      'New_legs',
      'Tunic_1',
    ].sort())

    expect(lod1Casters.length).toBe(8)
    expect(lod1Dropped.length).toBe(9)
  })

  it('applies exact 10 / 8 / 0 shadow casters to real parsed Roman GLB assets', async () => {
    for (let lodIndex = 0; lodIndex < 3; lodIndex++) {
      const glbPath = `public/models/characters/v2/roman/lod${lodIndex}.glb`
      const rig = await loadRig(readGlb(glbPath))
      const casters: string[] = []
      const nonCasters: string[] = []

      rig.scene.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = shouldRomanHumanoidCastShadow(o.name, lodIndex)
          if (o.castShadow) {
            casters.push(o.name)
          } else {
            nonCasters.push(o.name)
          }
        }
      })

      if (lodIndex === 0) {
        expect(casters.length).toBe(10)
        expect(nonCasters.length).toBe(7)
        expect(casters).toContain('Helmet3_1')
        expect(casters).toContain('Armour_top_1')
        expect(casters).toContain('Dangles')
        expect(casters).toContain('Wrist_guard1')
        expect(nonCasters).toContain('New_eye')
        expect(nonCasters).toContain('New_eye_2')
        expect(nonCasters).toContain('Helmet3_2')
        expect(nonCasters).toContain('Armour_top_2')
        expect(nonCasters).toContain('Ties')
        expect(nonCasters).toContain('RomanUndertunic_l')
        expect(nonCasters).toContain('RomanUndertunic_r')
      } else if (lodIndex === 1) {
        expect(casters.length).toBe(8)
        expect(nonCasters.length).toBe(9)
        expect(casters).toContain('Helmet3_1')
        expect(casters).toContain('Armour_top_1')
        expect(nonCasters).toContain('Dangles')
        expect(nonCasters).toContain('Wrist_guard1')
      } else if (lodIndex === 2) {
        expect(casters.length).toBe(0)
        expect(nonCasters.length).toBeGreaterThan(0)
      }
    }
  })
})
