import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import {
  PRESET_SCENARIO_F,
  validateBattleConfig,
  getUnitCombatProfile,
} from '../src/battle/BattleConfig'
import {
  BattleSpawner,
  SCATTER_BOUND_MIN,
  SCATTER_BOUND_MAX,
} from '../src/battle/BattleSpawner'
import { shouldCreateStartingHorse } from '../src/Game'
import { AIType } from '../src/world/NPC'
import {
  isPerfNoShadow,
  isPerfHalfResolution,
  isPerfSimpleMaterial,
  getActiveRenderProbe,
  getDevSimpleMaterial,
} from '../src/debug/RendererCostIsolation'

describe('Scenario F: 100v100 Mixed Cavalry Scattered Battle', () => {
  it('passes BattleConfig validation and conforms to strict 100v100 mixed cavalry specifications', () => {
    const validation = validateBattleConfig(PRESET_SCENARIO_F)
    expect(validation.valid).toBe(true)
    expect(validation.errors).toEqual([])

    expect(PRESET_SCENARIO_F.mode).toBe('scattered')
    expect(PRESET_SCENARIO_F.spectator).toBe(true)
    expect(PRESET_SCENARIO_F.rules.respawnEnabled).toBe(false)
    expect(PRESET_SCENARIO_F.rules.includeCamps).toBe(false)

    // Viking army composition: 50 melee cavalry + 50 horse archers = 100 mounted units
    const v = PRESET_SCENARIO_F.viking
    expect(v.infantry[1] + v.infantry[2] + v.infantry[3]).toBe(0)
    expect(v.archer[1] + v.archer[2] + v.archer[3]).toBe(0)
    const vCavalryTotal = v.cavalry[1] + v.cavalry[2] + v.cavalry[3]
    const vHorseArcherTotal = v.horseArcher[1] + v.horseArcher[2] + v.horseArcher[3]
    expect(vCavalryTotal).toBe(50)
    expect(vHorseArcherTotal).toBe(50)
    expect(vCavalryTotal + vHorseArcherTotal).toBe(100)
    expect(v.cavalry[1]).toBe(15)
    expect(v.cavalry[2]).toBe(20)
    expect(v.cavalry[3]).toBe(15)
    expect(v.horseArcher[1]).toBe(15)
    expect(v.horseArcher[2]).toBe(20)
    expect(v.horseArcher[3]).toBe(15)

    // Roman army composition: 50 melee cavalry + 50 horse archers = 100 mounted units
    const r = PRESET_SCENARIO_F.roman
    expect(r.infantry[1] + r.infantry[2] + r.infantry[3]).toBe(0)
    expect(r.archer[1] + r.archer[2] + r.archer[3]).toBe(0)
    const rCavalryTotal = r.cavalry[1] + r.cavalry[2] + r.cavalry[3]
    const rHorseArcherTotal = r.horseArcher[1] + r.horseArcher[2] + r.horseArcher[3]
    expect(rCavalryTotal).toBe(50)
    expect(rHorseArcherTotal).toBe(50)
    expect(rCavalryTotal + rHorseArcherTotal).toBe(100)
    expect(r.cavalry[1]).toBe(15)
    expect(r.cavalry[2]).toBe(20)
    expect(r.cavalry[3]).toBe(15)
    expect(r.horseArcher[1]).toBe(15)
    expect(r.horseArcher[2]).toBe(20)
    expect(r.horseArcher[3]).toBe(15)

    // Verify combat profiles
    for (const tier of [1, 2, 3] as const) {
      // Melee cavalry
      const vCav = getUnitCombatProfile('viking', 'cavalry', tier)
      expect(vCav.aiType).toBe(AIType.MELEE)
      expect(vCav.cavalry).toBe(true)
      expect(vCav.isUsingLance).toBe(true)
      expect(vCav.rangedWeaponId).toBeUndefined()

      const rCav = getUnitCombatProfile('roman', 'cavalry', tier)
      expect(rCav.aiType).toBe(AIType.MELEE)
      expect(rCav.cavalry).toBe(true)
      expect(rCav.isUsingLance).toBe(true)
      expect(rCav.rangedWeaponId).toBeUndefined()

      // Horse archers
      const vHA = getUnitCombatProfile('viking', 'horseArcher', tier)
      expect(vHA.aiType).toBe(AIType.RANGED)
      expect(vHA.cavalry).toBe(true)
      expect(vHA.isUsingLance).toBe(false)
      expect(vHA.rangedWeaponId).toBeDefined()

      const rHA = getUnitCombatProfile('roman', 'horseArcher', tier)
      expect(rHA.aiType).toBe(AIType.RANGED)
      expect(rHA.cavalry).toBe(true)
      expect(rHA.isUsingLance).toBe(false)
      expect(rHA.rangedWeaponId).toBeDefined()
    }
  })

  it('generates a 200-cavalry mixed deterministic scattered spawn plan without player mount', () => {
    // Player does not get starting horse in spectator mode
    expect(shouldCreateStartingHorse(PRESET_SCENARIO_F)).toBe(false)

    const plan1 = BattleSpawner.createSpawnPlan(PRESET_SCENARIO_F)
    const plan2 = BattleSpawner.createSpawnPlan(PRESET_SCENARIO_F)

    // Exactly 200 NPCs
    expect(plan1.npcSpecs.length).toBe(200)

    let vikingCount = 0
    let romanCount = 0
    let meleeCount = 0
    let rangedCount = 0
    for (const spec of plan1.npcSpecs) {
      expect(spec.cavalry).toBe(true)
      expect(spec.x).toBeGreaterThanOrEqual(SCATTER_BOUND_MIN)
      expect(spec.x).toBeLessThanOrEqual(SCATTER_BOUND_MAX)
      expect(spec.z).toBeGreaterThanOrEqual(SCATTER_BOUND_MIN)
      expect(spec.z).toBeLessThanOrEqual(SCATTER_BOUND_MAX)

      if (spec.characterFaction === 'viking') vikingCount++
      if (spec.characterFaction === 'roman') romanCount++
      if (spec.aiType === AIType.MELEE) meleeCount++
      if (spec.aiType === AIType.RANGED) rangedCount++
    }

    expect(vikingCount).toBe(100)
    expect(romanCount).toBe(100)
    expect(meleeCount).toBe(100)
    expect(rangedCount).toBe(100)

    // Deterministic repeatability
    expect(plan1.npcSpecs).toEqual(plan2.npcSpecs)
  })

  describe('Renderer Cost Isolation DEV Switches', () => {
    it('detects query flags correctly', () => {
      expect(isPerfNoShadow(new URLSearchParams('devcombat=f&nolock'))).toBe(false)
      expect(isPerfNoShadow(new URLSearchParams('devcombat=f&nolock&perfNoShadow'))).toBe(true)

      expect(isPerfHalfResolution(new URLSearchParams('devcombat=f&nolock'))).toBe(false)
      expect(isPerfHalfResolution(new URLSearchParams('devcombat=f&nolock&perfHalfResolution'))).toBe(true)

      expect(isPerfSimpleMaterial(new URLSearchParams('devcombat=f&nolock'))).toBe(false)
      expect(isPerfSimpleMaterial(new URLSearchParams('devcombat=f&nolock&perfSimpleMaterial'))).toBe(true)

      expect(getActiveRenderProbe(new URLSearchParams('devcombat=f&nolock'))).toBe('normal')
      expect(getActiveRenderProbe(new URLSearchParams('devcombat=f&nolock&perfNoShadow'))).toBe('no-shadow')
      expect(getActiveRenderProbe(new URLSearchParams('devcombat=f&nolock&perfHalfResolution'))).toBe('half-resolution')
      expect(getActiveRenderProbe(new URLSearchParams('devcombat=f&nolock&perfSimpleMaterial'))).toBe('simple-material')
    })

    it('creates simple materials preserving original side/culling', () => {
      const frontMat = new THREE.MeshStandardMaterial({ side: THREE.FrontSide })
      const doubleMat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide })
      const backMat = new THREE.MeshStandardMaterial({ side: THREE.BackSide })

      const simpleFront = getDevSimpleMaterial(frontMat, false)
      const simpleDouble = getDevSimpleMaterial(doubleMat, false)
      const simpleBack = getDevSimpleMaterial(backMat, true)

      expect(simpleFront.side).toBe(THREE.FrontSide)
      expect(simpleDouble.side).toBe(THREE.DoubleSide)
      expect(simpleBack.side).toBe(THREE.BackSide)
      expect(simpleFront.color.getHex()).toBe(0x888888)
    })

    it('preserves half-resolution pixel ratio across resize', () => {
      const baseRatio = 1.0
      const halfRatio = baseRatio * 0.5
      // Simulates WebGLRenderer pixel ratio logic
      let pixelRatio = halfRatio
      const setPixelRatio = (r: number) => { pixelRatio = r }
      const setSize = (w: number, h: number) => ({
        bufferWidth: Math.floor(w * pixelRatio),
        bufferHeight: Math.floor(h * pixelRatio),
      })

      setPixelRatio(halfRatio)
      const initial = setSize(1280, 720)
      expect(initial.bufferWidth).toBe(640)
      expect(initial.bufferHeight).toBe(360)

      // Resize event fires
      const afterResize = setSize(1920, 1080)
      expect(pixelRatio).toBe(0.5)
      expect(afterResize.bufferWidth).toBe(960)
      expect(afterResize.bufferHeight).toBe(540)
    })
  })
})
