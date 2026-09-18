import type { NPC } from '../world/NPC'
import type { Mesh } from 'three'
import { isEffectivelyVisible } from './HorseRenderCensus'

/** Explicit snapshot only. Visibility is ancestor-aware, not camera/frustum coverage. */
export function collectEquipmentRenderCensus(npcs: readonly NPC[]) {
  const lodCounts = [0, 0, 0]
  const visibleMeshes = { sword: 0, shield: 0, bow: 0, lance: 0, pilum: 0 }
  const visibleShadowCastersByKind = { sword: 0, shield: 0, bow: 0, lance: 0, pilum: 0 }
  let visibleShadowCasters = 0
  for (const npc of npcs) {
    lodCounts[npc.equipmentVisualLOD.currentLevel]++
    npc.equipmentVisualLOD.forEachRoot((kind, root) => {
      root.traverse(object => {
        if (!(object as Mesh).isMesh || !isEffectivelyVisible(object)) return
        visibleMeshes[kind]++
        if (object.castShadow) {
          visibleShadowCasters++
          visibleShadowCastersByKind[kind]++
        }
      })
    })
  }
  return {
    npcCount: npcs.length, lodCounts, visibleMeshes,
    totalVisibleMeshes: Object.values(visibleMeshes).reduce((sum, count) => sum + count, 0),
    visibleShadowCasters, visibleShadowCastersByKind,
  }
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as any).__collectEquipmentCensus = collectEquipmentRenderCensus
}
