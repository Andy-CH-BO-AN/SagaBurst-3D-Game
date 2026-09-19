import type * as THREE from 'three'

export interface ShadowPassCensusScene {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.Camera
  npcs: Array<{
    group: THREE.Object3D
    characterVisualGroup: THREE.Object3D
    characterFaction?: string
    equipmentVisualLOD: { forEachRoot(fn: (kind: string, root: THREE.Object3D) => void): void }
  }>
  mounts: Array<{
    group: THREE.Object3D
    horseVisual: { root: THREE.Object3D; lod: THREE.LOD } | null
  }>
  player: { group: THREE.Object3D }
  arrows: Array<{ mesh: THREE.Object3D }>
  pickups: Array<{ group: THREE.Object3D }>
  _aimTargetRegistry: { targets: THREE.Object3D[] }
}

export interface ShadowPassCensusRow {
  category: string
  shadowSubmissions: number
  shadowTriangles: number
  instances: number
  submittedMeshes: number
  submittedSkinnedMeshes: number
}

export interface ShadowPassCensus {
  totalSubmissions: number
  totalTriangles: number
  categories: ShadowPassCensusRow[]
  details: ShadowPassCensusRow[]
}

interface CensusAccumulator {
  instances: Set<number>
  meshes: Set<number>
  skinned: Set<number>
  submissions: number
  triangles: number
}

function createAccumulator(): CensusAccumulator {
  return {
    instances: new Set<number>(),
    meshes: new Set<number>(),
    skinned: new Set<number>(),
    submissions: 0,
    triangles: 0,
  }
}

/**
 * Finds all active shadow cameras belonging to shadow-casting lights in the scene.
 * Enforces strict camera matching rather than loose drawCamera !== mainCamera filtering.
 */
export function findSceneShadowCameras(scene: THREE.Scene): Set<THREE.Camera> {
  const shadowCameras = new Set<THREE.Camera>()
  scene.traverse((object) => {
    const light = object as unknown as THREE.Light & { shadow?: { camera?: THREE.Camera } }
    if (light && (light as any).isLight && light.castShadow && light.shadow?.camera) {
      shadowCameras.add(light.shadow.camera)
    }
  })
  return shadowCameras
}

export function broadShadowCategory(
  category: string
): 'Horse' | 'Viking Humanoid' | 'Roman Humanoid' | 'Equipment' | 'Other / Static' {
  if (category.startsWith('Horse')) return 'Horse'
  if (category.startsWith('Viking Humanoid')) return 'Viking Humanoid'
  if (category.startsWith('Roman Humanoid')) return 'Roman Humanoid'
  if (category.startsWith('Equipment/')) return 'Equipment'
  return 'Other / Static'
}

/**
 * Collects a one-frame diagnostic snapshot of shadow pass submissions.
 *
 * Intercepts renderer.renderBufferDirect with strict try/finally restoration.
 * Only draws matching scene shadow cameras are recorded.
 */
export function collectShadowPassCensus(game: ShadowPassCensusScene): ShadowPassCensus {
  const { renderer, scene, camera } = game
  const shadowCameras = findSceneShadowCameras(scene)

  const tags = new Map<THREE.Object3D, { category: string; instance: number }>()
  const tag = (root: THREE.Object3D, category: string, instance = root.id) =>
    root.traverse((object) => tags.set(object, { category, instance }))

  for (const root of game._aimTargetRegistry.targets) {
    if (root.parent === scene) tag(root, root.name === 'terrain' ? 'Terrain' : 'Trees/static')
  }
  tag(game.player.group, 'Player')

  for (const npc of game.npcs) {
    tag(npc.group, 'NPC other')
    const faction = npc.characterFaction
      ? `${npc.characterFaction.charAt(0).toUpperCase()}${npc.characterFaction.slice(1)}`
      : null
    npc.characterVisualGroup.traverse((object) => {
      if ((object as THREE.LOD).isLOD) {
        ;(object as THREE.LOD).levels.forEach((level, i) =>
          tag(level.object, `${faction ? `${faction} ` : ''}Humanoid LOD${i}`, npc.group.id)
        )
      }
    })
    npc.equipmentVisualLOD.forEachRoot((kind, root) => tag(root, `Equipment/${kind}`, npc.group.id))
  }

  for (const mount of game.mounts) {
    tag(mount.group, 'Horse other')
    mount.horseVisual?.lod.levels.forEach((level, i) =>
      tag(level.object, `Horse LOD${i}`, mount.horseVisual!.root.id)
    )
  }

  for (const arrow of game.arrows) tag(arrow.mesh, `Projectile/${arrow.mesh.name}`)
  for (const pickup of game.pickups) tag(pickup.group, 'Pickups')

  const rows = new Map<string, CensusAccumulator>()
  const details = new Map<string, CensusAccumulator>()

  const original = renderer.renderBufferDirect
  const autoReset = renderer.info.autoReset
  const { calls, triangles, points, lines } = renderer.info.render
  const savedInfo = { calls, triangles, points, lines }

  renderer.renderBufferDirect = function (drawCamera, drawScene, geometry, material, object, group) {
    const beforeCalls = renderer.info.render.calls
    const beforeTriangles = renderer.info.render.triangles

    original.call(this, drawCamera, drawScene, geometry, material, object, group)

    // Strict shadow camera check: only count when drawCamera is an active shadow camera!
    if (!shadowCameras.has(drawCamera)) return

    const submittedCalls = renderer.info.render.calls - beforeCalls
    if (!submittedCalls) return
    const submittedTriangles = renderer.info.render.triangles - beforeTriangles

    const tagInfo = tags.get(object) ?? { category: 'Other / Static', instance: object.id }
    const broad = broadShadowCategory(tagInfo.category)

    const record = (map: Map<string, CensusAccumulator>, key: string) => {
      let acc = map.get(key)
      if (!acc) {
        acc = createAccumulator()
        map.set(key, acc)
      }
      acc.instances.add(tagInfo.instance)
      if ((object as THREE.Mesh).isMesh) acc.meshes.add(object.id)
      if ((object as THREE.SkinnedMesh).isSkinnedMesh) acc.skinned.add(object.id)
      acc.submissions += submittedCalls
      acc.triangles += submittedTriangles
    }

    record(rows, broad)
    record(details, tagInfo.category)
  }

  try {
    renderer.info.autoReset = true
    renderer.render(scene, camera)

    const serialize = (map: Map<string, CensusAccumulator>): ShadowPassCensusRow[] =>
      [...map]
        .map(([category, acc]) => ({
          category,
          shadowSubmissions: acc.submissions,
          shadowTriangles: acc.triangles,
          instances: acc.instances.size,
          submittedMeshes: acc.meshes.size,
          submittedSkinnedMeshes: acc.skinned.size,
        }))
        .sort((a, b) => b.shadowSubmissions - a.shadowSubmissions)

    const BROAD_ORDER: Array<'Horse' | 'Viking Humanoid' | 'Roman Humanoid' | 'Equipment' | 'Other / Static'> = [
      'Horse',
      'Viking Humanoid',
      'Roman Humanoid',
      'Equipment',
      'Other / Static',
    ]

    const categories: ShadowPassCensusRow[] = BROAD_ORDER.map((category) => {
      const acc = rows.get(category)
      return {
        category,
        shadowSubmissions: acc?.submissions ?? 0,
        shadowTriangles: acc?.triangles ?? 0,
        instances: acc?.instances.size ?? 0,
        submittedMeshes: acc?.meshes.size ?? 0,
        submittedSkinnedMeshes: acc?.skinned.size ?? 0,
      }
    })

    const totalSubmissions = categories.reduce((sum, r) => sum + r.shadowSubmissions, 0)
    const totalTriangles = categories.reduce((sum, r) => sum + r.shadowTriangles, 0)

    return {
      totalSubmissions,
      totalTriangles,
      categories,
      details: serialize(details),
    }
  } finally {
    renderer.renderBufferDirect = original
    renderer.info.autoReset = autoReset
    Object.assign(renderer.info.render, savedInfo)
  }
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as any).__collectShadowPassCensus = collectShadowPassCensus
}
