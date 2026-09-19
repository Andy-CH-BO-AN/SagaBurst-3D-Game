import type { Object3D, LOD, Mesh } from 'three'

export type EquipmentVisualLOD = 0 | 1 | 2
export type EquipmentKind = 'sword' | 'shield' | 'bow' | 'lance' | 'pilum'
export type EquipmentShadowPolicy = -1 | 0 | 1

/** Builder annotation only: shared Player/pickup builders remain full detail. */
export function equipmentDetail<T extends Object3D>(object: T, lastVisibleLOD: 0 | 1): T {
  object.userData.equipmentLastVisibleLOD = lastVisibleLOD
  return object
}

/**
 * Annotation defining up to which EquipmentVisualLOD this mesh should cast shadows.
 * -1: Never cast shadows (LOD0, LOD1, LOD2 all false)
 *  0: Cast shadow only at LOD0 (LOD1 and LOD2 false)
 *  1: Cast shadow at LOD0 and LOD1 (LOD2 false)
 */
export function equipmentShadowUntil<T extends Object3D>(object: T, lastShadowLOD: EquipmentShadowPolicy): T {
  object.userData.equipmentLastShadowLOD = lastShadowLOD
  return object
}

/** Owns static detail visibility and NPC mesh shadows, never gameplay/dynamic visibility. */
export class EquipmentVisualLODController {
  private readonly entries = new Map<EquipmentKind, {
    root: Object3D
    details: Array<{ object: Object3D; lastLOD: number }>
    shadows: Array<{ mesh: Mesh; lastShadowLOD: EquipmentShadowPolicy; originalCastShadow: boolean }>
  }>()
  // Re-registering an existing mesh at LOD2 must not capture our temporary false.
  private readonly originalShadows = new WeakMap<Mesh, boolean>()
  private level: EquipmentVisualLOD = 0

  get currentLevel(): EquipmentVisualLOD { return this.level }

  /** Called at construction / equipment rebuild, never during steady-state updates. */
  register(kind: EquipmentKind, root: Object3D): void {
    const details: Array<{ object: Object3D; lastLOD: number }> = []
    const shadows: Array<{ mesh: Mesh; lastShadowLOD: EquipmentShadowPolicy; originalCastShadow: boolean }> = []
    root.traverse(object => {
      const lastLOD = object.userData.equipmentLastVisibleLOD
      if (lastLOD === 0 || lastLOD === 1) {
        details.push({ object, lastLOD })
        object.visible = this.level <= lastLOD
      }
      const mesh = object as Mesh
      if (mesh.isMesh) {
        if (!this.originalShadows.has(mesh)) this.originalShadows.set(mesh, mesh.castShadow)
        const originalCastShadow = this.originalShadows.get(mesh)!

        // Resolve shadow policy from mesh or nearest ancestor inside root
        let current: Object3D | null = object
        let policy: EquipmentShadowPolicy | undefined = undefined
        while (current && current !== root.parent) {
          if (current.userData.equipmentLastShadowLOD !== undefined) {
            policy = current.userData.equipmentLastShadowLOD
            break
          }
          current = current.parent
        }
        const lastShadowLOD: EquipmentShadowPolicy = policy !== undefined ? policy : 1

        shadows.push({ mesh, lastShadowLOD, originalCastShadow })
        mesh.castShadow = this.level !== 2 && this.level <= lastShadowLOD && originalCastShadow
      }
    })
    this.entries.set(kind, { root, details, shadows })
  }

  setLOD(level: EquipmentVisualLOD): void {
    if (level === this.level) return
    this.level = level
    for (const { details, shadows } of this.entries.values()) {
      for (const { object, lastLOD } of details) object.visible = level <= lastLOD
      for (const { mesh, lastShadowLOD, originalCastShadow } of shadows) {
        mesh.castShadow = level !== 2 && level <= lastShadowLOD && originalCastShadow
      }
    }
  }

  /** NPC instance only. Preserve Three's thresholds, zoom, and existing animation hook. */
  followHumanoid(lod: LOD): void {
    const update = lod.update.bind(lod)
    lod.update = camera => {
      update(camera)
      this.setLOD(lod.getCurrentLevel() as EquipmentVisualLOD)
    }
    this.setLOD(lod.getCurrentLevel() as EquipmentVisualLOD)
  }

  /** On-demand DEV census; callers must not invoke it in the frame loop. */
  forEachRoot(visit: (kind: EquipmentKind, root: Object3D) => void): void {
    for (const [kind, { root }] of this.entries) visit(kind, root)
  }
}
