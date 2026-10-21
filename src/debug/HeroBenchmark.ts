import type * as THREE from 'three'
import { createEmptyBattleConfig, type BattleConfig } from '../battle/BattleConfig'
import type { BattleSpawnPlan } from '../battle/BattleSpawner'
import { HERO_COMBAT_PROFILE_BY_ASSET, HERO_COMBAT_PROFILES } from '../battle/HeroCombatProfile'
import { AIType, Faction, type NPC } from '../world/NPC'
import type { HeroAssetId } from '../world/HeroAssetCatalog'

export interface HeroBenchmarkSettings {
  faction: 'roman' | 'viking'
  tier: 4 | 5
  view: 'near' | 'mid' | 'far'
}

export const HERO_BENCHMARK_NPC_COUNT = 100
export const HERO_BENCHMARK_PROTOCOL = 'hero-100-continuous-melee-v1'

export function parseHeroBenchmarkQuery(query: URLSearchParams): HeroBenchmarkSettings | null {
  if (query.get('devcombat') !== 'commander') return null
  const faction = query.get('commanderFaction') ?? 'roman'
  const tier = Number(query.get('commanderTier') ?? '5')
  const view = query.get('commanderView') ?? 'mid'
  if (faction !== 'roman' && faction !== 'viking') throw new Error('Commander benchmark requires roman or viking')
  if (tier !== 4 && tier !== 5) throw new Error('Commander benchmark requires tier 4 or 5')
  if (view !== 'near' && view !== 'mid' && view !== 'far') throw new Error('Commander benchmark requires near, mid or far view')
  if (['perfNoShadow', 'perfHalfResolution', 'perfSimpleMaterial', 'legacyhumanoids'].some(key => query.has(key))) {
    throw new Error('Commander acceptance benchmark requires normal assets and unchanged quality settings')
  }
  return { faction, tier, view }
}

/** Independent DEV plan. Never add these counts or tiers to a public mode's roster. */
export function createHeroBenchmarkScenario(settings: HeroBenchmarkSettings): {
  config: BattleConfig; plan: BattleSpawnPlan; assetId: HeroAssetId
  camera: { position: [number, number, number]; target: [number, number, number] }
} {
  const assetId: HeroAssetId = `${settings.faction}-hero-t${settings.tier}`
  const config = createEmptyBattleConfig()
  config.spectator = true
  config.playerFaction = settings.faction
  config.rules = { respawnEnabled: false, includeCamps: false }
  const plan: BattleSpawnPlan = { playerSpawn: { x: 0, z: 100 }, npcSpecs: [], pickupSpecs: [], horseSpecs: [] }
  const loadout = { meleeWeaponId: settings.faction === 'roman' ? 'paladin_sword_t4' : 'paladin_mace_t4',
    rangedWeaponId: null, shieldId: null, mountId: null }
  for (let pair = 0; pair < 50; pair++) {
    for (const side of [0, 1] as const) {
      plan.npcSpecs.push({
        actorId: `hero-benchmark:${pair}:${side}`, x: (pair % 10 - 4.5) * 3.5,
        z: (Math.floor(pair / 10) - 2) * 5 + (side ? 1.2 : -1.2),
        faction: side ? Faction.ENEMY : Faction.PLAYER, characterFaction: settings.faction,
        aiType: AIType.MELEE, name: `Commander benchmark ${pair}:${side}`,
        tier: 4, cavalry: false, respawnEnabled: false, loadout: { ...loadout },
        visualAssetId: assetId, combatProfileId: HERO_COMBAT_PROFILE_BY_ASSET[assetId],
      })
    }
  }
  const positions: Record<HeroBenchmarkSettings['view'], [number, number, number]> = {
    near: [0, 12, 12], mid: [0, 30, 32], far: [0, 55, 72],
  }
  return { config, plan, assetId, camera: { position: positions[settings.view], target: [0, 0, 0] } }
}

/** A disclosed DEV fixture keeps all 100 real actors fighting through the measured window.
 * Restore before each hit, then execute the original receiver, hit reactions and attribution.
 * A lethal single hit remains a real death and makes the recorder reject the run. */
export function configureHeroBenchmarkActors(npcs: readonly NPC[]): () => void {
  if (npcs.length !== HERO_BENCHMARK_NPC_COUNT) throw new Error('Commander benchmark requires exactly 100 NPCs')
  if (npcs.some(npc => npc.dead)) throw new Error('Commander benchmark cannot begin with dead actors')
  const restore: Array<() => void> = []
  for (const npc of npcs) {
    npc.setTacticalOrder('attack')
    npc.group.rotation.y = npc.faction === Faction.PLAYER ? 0 : Math.PI
    const original = npc.takeDamage
    npc.takeDamage = function (amount: number): boolean {
      this.restoreCombatHealth(this.maxHp)
      return original.call(this, amount)
    }
    restore.push(() => { npc.takeDamage = original })
  }
  return () => restore.forEach(fn => fn())
}

/** Verify the spawned actors and instantiated render roots, not merely the requested plan. */
export function heroBenchmarkIdentity(npcs: readonly Pick<NPC, 'visualAssetId' | 'combatProfileId' | 'characterFaction' | 'faction' | 'maxHp' | 'characterVisualGroup'>[], settings: HeroBenchmarkSettings) {
  const assetId = `${settings.faction}-hero-t${settings.tier}` as HeroAssetId
  const profileId = HERO_COMBAT_PROFILE_BY_ASSET[assetId]
  const maxHp = HERO_COMBAT_PROFILES[profileId].maxHp
  const counts = {
    visualAssets: {} as Record<string, number>, combatProfiles: {} as Record<string, number>,
    characterFactions: {} as Record<string, number>, allegiances: {} as Record<string, number>,
    maxHp: {} as Record<string, number>, renderRoots: {} as Record<string, number>,
  }
  const add = (map: Record<string, number>, value: unknown) => { const key = String(value); map[key] = (map[key] ?? 0) + 1 }
  let mismatchedActors = 0
  for (const npc of npcs) {
    const renderRoots = npc.characterVisualGroup.children.filter(child => child.name.endsWith('-humanoid-v2'))
    add(counts.visualAssets, npc.visualAssetId); add(counts.combatProfiles, npc.combatProfileId)
    add(counts.characterFactions, npc.characterFaction); add(counts.allegiances, npc.faction); add(counts.maxHp, npc.maxHp)
    add(counts.renderRoots, renderRoots.map(root => root.name).join(',') || 'missing')
    if (npc.visualAssetId !== assetId || npc.combatProfileId !== profileId || npc.characterFaction !== settings.faction
      || npc.maxHp !== maxHp || renderRoots.length !== 1 || renderRoots[0].name !== `${assetId}-humanoid-v2`) mismatchedActors++
  }
  return { expected: { assetId, profileId, maxHp }, counts, mismatchedActors,
    valid: npcs.length === HERO_BENCHMARK_NPC_COUNT && mismatchedActors === 0
      && counts.allegiances[Faction.PLAYER] === 50 && counts.allegiances[Faction.ENEMY] === 50 }
}

export function heroBenchmarkLods(npcs: readonly Pick<NPC, 'characterVisualGroup'>[]): {
  counts: number[]; runtimeVisibleGeometryTrianglesPerLod: number[] | null; activeLodVisibleGeometryTriangles: number
} {
  const counts = [0, 0, 0]
  let runtimeVisibleGeometryTrianglesPerLod: number[] | null = null
  let activeLodVisibleGeometryTriangles = 0
  // Ignore the LOD root's selection visibility when comparing each representation,
  // but honor all hidden descendants. This is geometry, not frustum/shadow submissions.
  const visibleGeometryTriangles = (root: THREE.Object3D): number => {
    let triangles = 0
    const visit = (part: THREE.Object3D) => {
      const mesh = part as THREE.Mesh
      if (mesh.isMesh) {
        const count = mesh.geometry.index?.count ?? mesh.geometry.attributes.position?.count ?? 0
        const start = Math.max(0, mesh.geometry.drawRange.start)
        const end = Math.min(count, start + mesh.geometry.drawRange.count)
        if (Array.isArray(mesh.material)) {
          for (const group of mesh.geometry.groups) {
            if (!mesh.material[group.materialIndex ?? 0]?.visible) continue
            triangles += Math.max(0, Math.min(end, group.start + group.count) - Math.max(start, group.start)) / 3
          }
        } else if (mesh.material.visible) triangles += Math.max(0, end - start) / 3
      }
      for (const child of part.children) if (child.visible) visit(child)
    }
    visit(root)
    return triangles
  }
  for (const npc of npcs) {
    npc.characterVisualGroup.traverse(object => {
      const lod = object as THREE.LOD
      if (!lod.isLOD) return
      const current = lod.getCurrentLevel()
      counts[current]++
      const active = lod.levels[current]?.object
      if (npc.characterVisualGroup.visible && lod.visible && active?.visible) activeLodVisibleGeometryTriangles += visibleGeometryTriangles(active)
      runtimeVisibleGeometryTrianglesPerLod ??= lod.levels.map(level => visibleGeometryTriangles(level.object))
    })
  }
  return { counts, runtimeVisibleGeometryTrianglesPerLod, activeLodVisibleGeometryTriangles }
}
