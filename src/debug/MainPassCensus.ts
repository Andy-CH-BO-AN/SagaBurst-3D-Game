import type * as THREE from 'three'

export interface MainPassCensusScene {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.Camera
  npcs: Array<{ group: THREE.Object3D, characterVisualGroup: THREE.Object3D,
    characterFaction?: string,
    equipmentVisualLOD: { forEachRoot(fn: (kind: string, root: THREE.Object3D) => void): void } }>
  mounts: Array<{ horseVisual: { root: THREE.Object3D, lod: THREE.LOD } | null }>
  player: { group: THREE.Object3D }
  arrows: Array<{ mesh: THREE.Object3D }>
  pickups: Array<{ group: THREE.Object3D }>
  _aimTargetRegistry: { targets: THREE.Object3D[] }
}

export interface MainPassCensusMetrics {
  instances: number
  submittedMeshes: number
  submittedSkinnedMeshes: number
  submittedMaterialGroups: number
  uniqueMaterials: number
  mainSubmissions: number
  triangles: number
  transmissionSubmissions: number
}

export interface MainPassCensusRow extends MainPassCensusMetrics {
  category: string
}

export interface MainPassCensus {
  mainCalls: number
  mainTriangles: number
  attributedCalls: number
  unattributedCalls: number
  categories: MainPassCensusRow[]
  parts: MainPassCensusRow[]
  /** Per category, split by canvas versus the main-camera offscreen pass. */
  passes: MainPassCensusRow[]
  /** Main-camera totals only; shadow cameras never reach this census. */
  passTotals: {
    canvas: MainPassCensusMetrics
    offscreen: MainPassCensusMetrics
    totalNonShadow: MainPassCensusMetrics
  }
  /** Requested broad categories, separately attributed to each main-camera pass. */
  categoryPasses: MainPassCensusRow[]
}

interface CensusAccumulator {
  instances: Set<number>
  meshes: Set<number>
  skinned: Set<number>
  groups: Set<string>
  materials: Set<number>
  submissions: number
  triangles: number
  transmissionSubmissions: number
}

function accumulator(): CensusAccumulator {
  return {
    instances: new Set<number>(), meshes: new Set<number>(), skinned: new Set<number>(),
    groups: new Set<string>(), materials: new Set<number>(), submissions: 0, triangles: 0,
    transmissionSubmissions: 0,
  }
}

function broadCategory(category: string): string {
  if (category.startsWith('Humanoid ') || /^(Viking|Roman) Humanoid /.test(category)) return 'Humanoid'
  if (category.startsWith('Horse ')) return 'Horse'
  if (category.startsWith('Equipment/')) return 'Equipment'
  if (category === 'Player') return 'Player'
  if (category.startsWith('Projectile/')) return 'Projectiles'
  if (category === 'Terrain') return 'Terrain'
  if (category === 'Trees/static' || category === 'Pickups') return 'Static environment'
  return 'Other'
}

/** One synchronous diagnostic render. Never install in a frame loop or timed window.
 * Count actual renderer.info increments: groups, double-sided transparent draws,
 * empty ranges and instancing need not map one-to-one to Mesh objects.
 * Shadow cameras are excluded. Main counts include the transmission prepass;
 * passes separates offscreen and canvas submissions. Instrumentation is restored
 * even on failure, but the renderer frame ID must remain monotonic for GPU caches.
 */
export function collectMainPassCensus(game: MainPassCensusScene): MainPassCensus {
  const { renderer, scene, camera } = game
  const tags = new Map<THREE.Object3D, { category: string, instance: number }>()
  const tag = (root: THREE.Object3D, category: string, instance = root.id) =>
    root.traverse(object => tags.set(object, { category, instance }))
  for (const root of game._aimTargetRegistry.targets) {
    if (root.parent === scene) tag(root, root.name === 'terrain' ? 'Terrain' : 'Trees/static')
  }
  tag(game.player.group, 'Player')
  for (const npc of game.npcs) {
    tag(npc.group, 'NPC other')
    const faction = npc.characterFaction
      ? `${npc.characterFaction.charAt(0).toUpperCase()}${npc.characterFaction.slice(1)}`
      : null
    npc.characterVisualGroup.traverse(object => {
      if ((object as THREE.LOD).isLOD) (object as THREE.LOD).levels.forEach((level, i) =>
        tag(level.object, `${faction ? `${faction} ` : ''}Humanoid LOD${i}`, npc.group.id))
    })
    npc.equipmentVisualLOD.forEachRoot((kind, root) => tag(root, `Equipment/${kind}`, npc.group.id))
  }
  for (const mount of game.mounts) mount.horseVisual?.lod.levels.forEach((level, i) =>
    tag(level.object, `Horse LOD${i}`, mount.horseVisual!.root.id))
  for (const arrow of game.arrows) tag(arrow.mesh, `Projectile/${arrow.mesh.name}`)
  for (const pickup of game.pickups) tag(pickup.group, 'Pickups')

  const rows = new Map<string, CensusAccumulator>()
  const parts = new Map<string, CensusAccumulator>()
  const passes = new Map<string, CensusAccumulator>()
  const passTotals = new Map<string, CensusAccumulator>()
  const categoryPasses = new Map<string, CensusAccumulator>()
  const original = renderer.renderBufferDirect
  const autoReset = renderer.info.autoReset
  const { calls, triangles, points, lines } = renderer.info.render
  const savedInfo = { calls, triangles, points, lines }
  renderer.renderBufferDirect = function (drawCamera, drawScene, geometry, material, object, group) {
    const before = renderer.info.render.calls
    const triangles = renderer.info.render.triangles
    original.call(this, drawCamera, drawScene, geometry, material, object, group)
    if (drawCamera !== camera) return
    const calls = renderer.info.render.calls - before
    if (!calls) return
    const label = tags.get(object) ?? { category: 'Other/unknown', instance: object.id }
    const transmission = (material as THREE.MeshPhysicalMaterial).transmission ?? 0
    const record = (map: Map<string, CensusAccumulator>, key: string) => {
      let row = map.get(key)
      if (!row) map.set(key, row = accumulator())
      row.instances.add(label.instance)
      if ((object as THREE.Mesh).isMesh) row.meshes.add(object.id)
      if ((object as THREE.SkinnedMesh).isSkinnedMesh) row.skinned.add(object.id)
      row.groups.add(`${object.id}:${group ? geometry.groups.indexOf(group) : 'single'}`)
      row.materials.add(material.id)
      row.submissions += calls
      row.triangles += renderer.info.render.triangles - triangles
      if (transmission > 0) row.transmissionSubmissions += calls
    }
    record(rows, label.category)
    record(parts, `${label.category}/${object.name || object.type}/${material.name || material.type}`)
    const pass = renderer.getRenderTarget() ? 'offscreen' : 'canvas'
    record(passes, `${pass}/${label.category}`)
    record(passTotals, pass)
    record(passTotals, 'totalNonShadow')
    record(categoryPasses, `${pass}/${broadCategory(label.category)}`)
  }
  try {
    renderer.info.autoReset = true
    renderer.render(scene, camera)
    const serialize = (map: Map<string, CensusAccumulator>): MainPassCensusRow[] => [...map].map(([category, row]) => ({ category,
      instances: row.instances.size, submittedMeshes: row.meshes.size,
      submittedSkinnedMeshes: row.skinned.size, submittedMaterialGroups: row.groups.size,
      uniqueMaterials: row.materials.size, mainSubmissions: row.submissions, triangles: row.triangles,
      transmissionSubmissions: row.transmissionSubmissions,
    })).sort((a, b) => b.mainSubmissions - a.mainSubmissions)
    const emptyMetrics = (): MainPassCensusMetrics => ({
      instances: 0, submittedMeshes: 0, submittedSkinnedMeshes: 0, submittedMaterialGroups: 0,
      uniqueMaterials: 0, mainSubmissions: 0, triangles: 0, transmissionSubmissions: 0,
    })
    const serializeMetrics = (key: string): MainPassCensusMetrics => {
      const row = passTotals.get(key)
      if (!row) return emptyMetrics()
      const { category: _category, ...metrics } = serialize(new Map([[key, row]]))[0]
      return metrics
    }
    const categories = serialize(rows)
    const attributedCalls = categories.reduce((sum, row) => sum + row.mainSubmissions, 0)
    return { mainCalls: renderer.info.render.calls, mainTriangles: renderer.info.render.triangles,
      attributedCalls, unattributedCalls: renderer.info.render.calls - attributedCalls,
      categories, parts: serialize(parts), passes: serialize(passes),
      passTotals: {
        canvas: serializeMetrics('canvas'),
        offscreen: serializeMetrics('offscreen'),
        totalNonShadow: serializeMetrics('totalNonShadow'),
      },
      categoryPasses: serialize(categoryPasses),
    }
  } finally {
    renderer.renderBufferDirect = original
    renderer.info.autoReset = autoReset
    Object.assign(renderer.info.render, savedInfo)
  }
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as any).__collectMainPassCensus = collectMainPassCensus
}
