import { describe, expect, it, onTestFinished, vi } from 'vitest'
import * as THREE from 'three'
import { compareHeroFrameSummaries, summarizeHeroFrames, type HeroFrameSummary } from '../../src/debug/HeroBenchmarkMetrics'
import { configureHeroBenchmarkActors, createHeroBenchmarkScenario, heroBenchmarkIdentity, heroBenchmarkLods, parseHeroBenchmarkQuery } from '../../src/debug/HeroBenchmark'
import { Faction, type NPC } from '../../src/world/NPC'
import { characterResourceMetrics } from '../../src/debug/HeroBenchmarkRenderMetrics'

describe('Commander acceptance benchmark', () => {
  it('counts shared character textures once and keeps hidden LOD resources separate from visible bones', () => {
    const texture = new THREE.DataTexture(new Uint8Array(8 * 4 * 4), 8, 4)
    texture.generateMipmaps = false
    const material = new THREE.MeshBasicMaterial({ map: texture })
    const geometry = new THREE.BufferGeometry()
    const root = new THREE.Group(), hidden = new THREE.Group()
    hidden.visible = false; root.add(hidden)
    const skeletons: THREE.Skeleton[] = []
    for (const parent of [root, hidden]) {
      const mesh = new THREE.SkinnedMesh(geometry, material)
      mesh.skeleton = new THREE.Skeleton([new THREE.Bone(), new THREE.Bone()])
      skeletons.push(mesh.skeleton); parent.add(mesh)
    }
    const sharedPalette = new THREE.SkinnedMesh(geometry, material)
    sharedPalette.skeleton = skeletons[0]; root.add(sharedPalette)
    onTestFinished(() => { skeletons.forEach(s => s.dispose()); geometry.dispose(); material.dispose(); texture.dispose() })
    expect(characterResourceMetrics([root])).toEqual({ residentSkinnedMeshes: 3, residentBones: 4,
      visibleSkinnedMeshes: 2, visibleBones: 2, uniqueMaterials: 1, uniqueTextures: 1, textureEstimatedBytes: 128 })
  })

  it('rejects a declared T5 with a T4 render root, wrong stats, or an unpaired allegiance roster', () => {
    const visual = new THREE.Group(), root = new THREE.Group()
    root.name = 'roman-hero-t5-humanoid-v2'; visual.add(root)
    // 100 cheap identity records share one render graph; no actors or assets.
    const actors = Array.from({ length: 100 }, (_, index) => ({ visualAssetId: 'roman-hero-t5' as const,
      combatProfileId: 'roman-commander' as const, characterFaction: 'roman' as const,
      faction: index < 50 ? Faction.PLAYER : Faction.ENEMY, maxHp: 850, characterVisualGroup: visual }))
    const settings = { faction: 'roman', tier: 5, view: 'mid' } as const
    expect(heroBenchmarkIdentity(actors, settings).valid).toBe(true)
    root.name = 'roman-hero-t4-humanoid-v2'
    expect(heroBenchmarkIdentity(actors, settings)).toMatchObject({ valid: false, mismatchedActors: 100 })
    root.name = 'roman-hero-t5-humanoid-v2'
    actors[0].maxHp = 500
    expect(heroBenchmarkIdentity(actors, settings)).toMatchObject({ valid: false, mismatchedActors: 1 })
    actors[0].maxHp = 850
    actors[0].faction = Faction.ENEMY
    expect(heroBenchmarkIdentity(actors, settings)).toMatchObject({ valid: false, mismatchedActors: 0 })
  })

  it('reports each runtime LOD separately from active geometry and excludes hidden descendants, materials and draw ranges', () => {
    const visual = new THREE.Group(), lod = new THREE.LOD(), camera = new THREE.PerspectiveCamera()
    visual.add(lod)
    const mesh = (triangles: number) => {
      const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(triangles * 9), 3))
      const material = new THREE.MeshBasicMaterial()
      onTestFinished(() => { geometry.dispose(); material.dispose() })
      return new THREE.Mesh(geometry, material)
    }
    const near = new THREE.Group(), mid = new THREE.Group(), far = new THREE.Group()
    near.add(mesh(2))
    const hiddenMesh = mesh(20); hiddenMesh.visible = false; near.add(hiddenMesh)
    const hiddenGroup = new THREE.Group(); hiddenGroup.visible = false; hiddenGroup.add(mesh(30)); near.add(hiddenGroup)
    const hiddenMaterial = mesh(40); hiddenMaterial.material.visible = false; near.add(hiddenMaterial)
    const ranged = mesh(10); ranged.geometry.setDrawRange(3, 3); mid.add(ranged)
    far.add(mesh(3))
    lod.addLevel(near, 0); lod.addLevel(mid, 28); lod.addLevel(far, 60)
    camera.position.z = 1; camera.updateMatrixWorld(); visual.updateMatrixWorld(); lod.update(camera)
    expect(heroBenchmarkLods([{ characterVisualGroup: visual }])).toEqual({ counts: [1, 0, 0],
      runtimeVisibleGeometryTrianglesPerLod: [2, 1, 3], activeLodVisibleGeometryTriangles: 2 })
    camera.position.z = 35; camera.updateMatrixWorld(); lod.update(camera)
    expect(heroBenchmarkLods([{ characterVisualGroup: visual }])).toEqual({ counts: [0, 1, 0],
      runtimeVisibleGeometryTrianglesPerLod: [2, 1, 3], activeLodVisibleGeometryTriangles: 1 })
  })

  it('derives mean FPS from duration, 1% low from the slowest ceil 1%, and P95 by nearest rank', () => {
    const summary = summarizeHeroFrames([...Array(198).fill(10), 20, 40])
    expect(summary.sampleCount).toBe(200)
    expect(summary.durationMs).toBe(2040)
    expect(summary.meanFps).toBeCloseTo(200000 / 2040)
    expect(summary.onePercentLowFps).toBeCloseTo(1000 / 30)
    expect(summary.p95FrameMs).toBe(10)
    expect(summarizeHeroFrames([10, 20, 30]).onePercentLowFps).toBeCloseTo(1000 / 30)
    expect(() => summarizeHeroFrames([])).toThrow()
    expect(() => summarizeHeroFrames([16, Number.NaN])).toThrow()
  })

  const baseline: HeroFrameSummary = { sampleCount: 100, durationMs: 1000, meanFps: 60, onePercentLowFps: 50, meanFrameMs: 16, p95FrameMs: 20 }
  it.each([
    ['exact thresholds', 54, 45, 22, true],
    ['53 FPS fails', 53, 45, 22, false],
    ['1% low fails', 60, 44.9, 20, false],
    ['P95 fails', 60, 50, 22.01, false],
  ] as const)('%s requires all three limits to pass', (_name, meanFps, onePercentLowFps, p95FrameMs, passed) => {
    const result = compareHeroFrameSummaries(baseline, { ...baseline, meanFps, onePercentLowFps, p95FrameMs })
    expect(result.passed).toBe(passed)
    expect(result.nearBoundary).toBe(true)
  })

  it.each(['roman', 'viking'] as const)('%s T4 and T5 plans change only hero identity and keep 100 real-actor inputs', faction => {
    const base = createHeroBenchmarkScenario({ faction, tier: 4, view: 'mid' })
    const next = createHeroBenchmarkScenario({ faction, tier: 5, view: 'mid' })
    expect(base.plan.npcSpecs).toHaveLength(100)
    expect(base.plan.npcSpecs.filter(spec => spec.faction === Faction.PLAYER)).toHaveLength(50)
    expect(base.plan.npcSpecs.filter(spec => spec.faction === Faction.ENEMY)).toHaveLength(50)
    expect(next.plan.npcSpecs.every(spec => spec.visualAssetId === `${faction}-hero-t5` && spec.characterFaction === faction)).toBe(true)
    const withoutIdentity = (plan: typeof base.plan) => plan.npcSpecs.map(({ visualAssetId: _asset, combatProfileId: _profile, ...spec }) => spec)
    expect(withoutIdentity(next.plan)).toEqual(withoutIdentity(base.plan))
    expect(next.camera).toEqual(base.camera)
    expect(base.config.spectator).toBe(true)
    expect(base.config.rules).toEqual({ includeCamps: false, respawnEnabled: false })
  })

  it('rejects quality-changing acceptance flags and malformed fixture options', () => {
    expect(parseHeroBenchmarkQuery(new URLSearchParams('devcombat=f'))).toBeNull()
    expect(parseHeroBenchmarkQuery(new URLSearchParams('devcombat=commander&commanderFaction=viking&commanderTier=4&commanderView=near')))
      .toEqual({ faction: 'viking', tier: 4, view: 'near' })
    for (const query of ['perfNoShadow', 'perfHalfResolution', 'perfSimpleMaterial', 'legacyhumanoids', 'commanderTier=3', 'commanderFaction=unknown']) {
      expect(() => parseHeroBenchmarkQuery(new URLSearchParams(`devcombat=commander&${query}`))).toThrow()
    }
  })

  it('refills before invoking original damage and restores the receiver during cleanup', () => {
    const events: string[] = []
    const takeDamage = vi.fn((amount: number) => { events.push(`damage:${amount}`); return true })
    // Recording actors prove the benchmark boundary; combat receiver behavior belongs to HeroBattleComposition.
    const actors = Array.from({ length: 100 }, () => ({ faction: Faction.PLAYER, maxHp: 500,
      group: { rotation: { y: 0 } }, setTacticalOrder: vi.fn(), takeDamage,
      restoreCombatHealth: (hp: number) => { events.push(`restore:${hp}`) },
    })) as unknown as NPC[]
    const cleanup = configureHeroBenchmarkActors(actors)
    expect(actors[0].takeDamage(100)).toBe(true)
    expect(events).toEqual(['restore:500', 'damage:100'])
    cleanup()
    expect(actors[0].takeDamage).toBe(takeDamage)
    expect(() => configureHeroBenchmarkActors(actors.slice(1))).toThrow()
  })
})
