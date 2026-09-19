import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { readFileSync } from 'node:fs'
import { readGlb, loadRig } from '../tools/lib/humanoid-glb.mjs'
import {
  ROMAN_SHADOW_KEEP_MESHES,
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

describe('Roman Humanoid Shadow Policy Contracts (5-Caster Candidate)', () => {
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

  it('keeps exactly 5 silhouette casters in LOD0, dropping 12 non-essential casters', () => {
    const lod0Casters = ALL_AUDITED_ROMAN_MESH_NAMES.filter((name) =>
      shouldRomanHumanoidCastShadow(name, 0)
    )
    const lod0Dropped = ALL_AUDITED_ROMAN_MESH_NAMES.filter(
      (name) => !shouldRomanHumanoidCastShadow(name, 0)
    )

    expect(lod0Casters.sort()).toEqual([
      'Armour_top_1',
      'Boots',
      'Helmet3_1',
      'Tunic_1',
      'Wrist_guard1',
    ].sort())

    expect(lod0Dropped.sort()).toEqual([
      'Armour_top_2',
      'Dangles',
      'Full_figure_42_T_pose',
      'Helmet3_2',
      'New_arms',
      'New_eye',
      'New_eye_2',
      'New_head',
      'New_legs',
      'RomanUndertunic_l',
      'RomanUndertunic_r',
      'Ties',
    ].sort())

    expect(lod0Casters.length).toBe(5)
    expect(lod0Dropped.length).toBe(12)
  })

  it('keeps exactly 5 silhouette casters in LOD1, dropping 12 non-essential casters', () => {
    const lod1Casters = ALL_AUDITED_ROMAN_MESH_NAMES.filter((name) =>
      shouldRomanHumanoidCastShadow(name, 1)
    )
    const lod1Dropped = ALL_AUDITED_ROMAN_MESH_NAMES.filter(
      (name) => !shouldRomanHumanoidCastShadow(name, 1)
    )

    expect(lod1Casters.sort()).toEqual([
      'Armour_top_1',
      'Boots',
      'Helmet3_1',
      'Tunic_1',
      'Wrist_guard1',
    ].sort())

    expect(lod1Dropped.sort()).toEqual([
      'Armour_top_2',
      'Dangles',
      'Full_figure_42_T_pose',
      'Helmet3_2',
      'New_arms',
      'New_eye',
      'New_eye_2',
      'New_head',
      'New_legs',
      'RomanUndertunic_l',
      'RomanUndertunic_r',
      'Ties',
    ].sort())

    expect(lod1Casters.length).toBe(5)
    expect(lod1Dropped.length).toBe(12)
  })

  it('applies exact 5 / 5 / 0 shadow casters to real parsed Roman GLB assets', async () => {
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
        expect(casters.length).toBe(5)
        expect(nonCasters.length).toBe(12)
        expect(casters).toContain('Helmet3_1')
        expect(casters).toContain('Armour_top_1')
        expect(casters).toContain('Tunic_1')
        expect(casters).toContain('Boots')
        expect(casters).toContain('Wrist_guard1')
        expect(nonCasters).toContain('New_arms')
        expect(nonCasters).toContain('New_legs')
        expect(nonCasters).toContain('New_head')
        expect(nonCasters).toContain('Full_figure_42_T_pose')
        expect(nonCasters).toContain('Dangles')
        expect(nonCasters).toContain('Ties')
      } else if (lodIndex === 1) {
        expect(casters.length).toBe(5)
        expect(nonCasters.length).toBe(12)
        expect(casters).toContain('Helmet3_1')
        expect(casters).toContain('Armour_top_1')
        expect(casters).toContain('Tunic_1')
        expect(casters).toContain('Boots')
        expect(casters).toContain('Wrist_guard1')
        expect(nonCasters).toContain('New_arms')
        expect(nonCasters).toContain('New_legs')
        expect(nonCasters).toContain('Dangles')
      } else if (lodIndex === 2) {
        expect(casters.length).toBe(0)
        expect(nonCasters.length).toBeGreaterThan(0)
      }
    }
  })
})
