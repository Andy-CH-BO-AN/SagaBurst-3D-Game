import type { Object3D, LOD, Mesh } from 'three'

export type EquipmentVisualLOD = 0 | 1 | 2
export type EquipmentKind = 'sword' | 'shield' | 'bow' | 'lance' | 'pilum'

/** Builder annotation only: shared Player/pickup builders remain full detail. */
export function equipmentDetail<T extends Object3D>(object: T, lastVisibleLOD: 0 | 1): T {
  object.userData.equipmentLastVisibleLOD = lastVisibleLOD
  return object
}

/** Owns static detail visibility and NPC mesh shadows, never gameplay/dynamic visibility. */
export class EquipmentVisualLODController {
  private readonly entries = new Map<EquipmentKind, {
    root: Object3D
    details: Array<{ object: Object3D; lastLOD: number }>
    shadows: Array<{ mesh: Mesh; originalCastShadow: boolean }>
  }>()
  // Re-registering an existing mesh at LOD2 must not capture our temporary false.
  private readonly originalShadows = new WeakMap<Mesh, boolean>()
  private level: EquipmentVisualLOD = 0

  get currentLevel(): EquipmentVisualLOD { return this.level }

  /** Called at construction / equipment rebuild, never during steady-state updates. */
  register(kind: EquipmentKind, root: Object3D): void {
    const details: Array<{ object: Object3D; lastLOD: number }> = []
    const shadows: Array<{ mesh: Mesh; originalCastShadow: boolean }> = []
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
        shadows.push({ mesh, originalCastShadow })
        mesh.castShadow = this.level === 2 ? false : originalCastShadow
      }
    })
    this.entries.set(kind, { root, details, shadows })
  }

  setLOD(level: EquipmentVisualLOD): void {
    if (level === this.level) return
    this.level = level
    for (const { details, shadows } of this.entries.values()) {
      for (const { object, lastLOD } of details) object.visible = level <= lastLOD
      for (const { mesh, originalCastShadow } of shadows) mesh.castShadow = level === 2 ? false : originalCastShadow
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
