import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { type ObstacleData, type WalkRampSurface } from '../world/Terrain'
import { slabGeometry, surfaceBox } from './TownRamparts'
import { TOWN_COMMAND_WATCHTOWER as C, getTownCommandWatchtowerRails, getTownCommandWatchtowerUnderfill, watchtowerSurface, type CommandWatchtowerLayout } from './TownCommandWatchtowerLayout'

type Materials = { stone: THREE.Material; wood: THREE.Material; dark: THREE.Material; plaster: THREE.Material; snow: THREE.Material; accent: THREE.Material }
/** Permanent static construction, never registered as a damageable residence. */
export function createTownCommandWatchtower(layout: CommandWatchtowerLayout, faction: 'roman' | 'viking', obstacles: ObstacleData[], materials: Materials): THREE.Group {
  const root = new THREE.Group(); root.name = 'town-command-watchtower'
  const batches = new Map<THREE.Material, THREE.BufferGeometry[]>()
  const structure = faction === 'roman' ? materials.stone : materials.wood
  const trim = faction === 'roman' ? materials.plaster : materials.dark
  const add = (geometry: THREE.BufferGeometry, material = structure) => {
    let batch = batches.get(material); if (!batch) batches.set(material, batch = []); batch.push(geometry)
  }
  const box = (b: THREE.Box3, material: THREE.Material, navigationPassable = false) => {
    const size = b.getSize(new THREE.Vector3()), center = b.getCenter(new THREE.Vector3())
    add(new THREE.BoxGeometry(size.x, size.y, size.z).translate(center.x, center.y, center.z), material)
    obstacles.push({ box: b, isBarricade: false, navigationPassable })
  }
  const block = (x: number, bottom: number, z: number, width: number, height: number, depth: number, material: THREE.Material, passable = false) =>
    box(new THREE.Box3(new THREE.Vector3(x - width / 2, bottom, z - depth / 2), new THREE.Vector3(x + width / 2, bottom + height, z + depth / 2)), material, passable)
  const surfaceSlice = (s: WalkRampSurface, from: number, to: number) => {
    const point = (at: number) => ({ x: s.startX + s.dirX * at, z: s.startZ + s.dirZ * at, y: s.startY + (s.topY - s.startY) * at / s.length })
    const a = point(from), b = point(to)
    return watchtowerSurface(a.x, a.z, a.y, b.x, b.z, b.y, s.halfWidth * 2)
  }
  const foundations = getTownCommandWatchtowerUnderfill(layout)
  const all = [layout.entrance, ...layout.ramps, ...layout.landings, ...layout.platform]
  for (const s of all) {
    const foundation = foundations.find(obstacle => obstacle.walkSurface === s)
    if (foundation) {
      const halfWidth = Math.abs(s.dirX) > .5 ? (foundation.box.max.z - foundation.box.min.z) / 2
        : (foundation.box.max.x - foundation.box.min.x) / 2
      add(slabGeometry({ ...s, halfWidth }, C.slabThickness, foundation.solidBelow))
      obstacles.push(foundation)
      continue
    }
    add(slabGeometry(s, C.slabThickness))
    const count = Math.max(1, Math.ceil(s.length / .4))
    const projectileBoxes = Array.from({ length: count }, (_, i) => surfaceBox(surfaceSlice(s, i / count * s.length, (i + 1) / count * s.length), C.slabThickness))
    // Only the first ground-connected approach is a ground-navigation barrier.
    // Elevated rings are passable below; the physical solid core/posts are not.
    obstacles.push({ box: surfaceBox(s), walkSurface: s, projectileBoxes, isBarricade: false,
      navigationPassable: s !== layout.entrance && s !== layout.ramps[0] && s !== layout.landings[0] })
  }
  for (const rail of getTownCommandWatchtowerRails(layout)) {
    const s = rail.surface
    add(slabGeometry({ ...s, startY: s.startY + C.railHeight, topY: s.topY + C.railHeight }, C.railHeight), trim)
    obstacles.push(...rail.obstacles)
  }
  box(layout.core.clone(), structure)
  // Stone footing and strong external columns carry both circuits. All supports
  // stay within the validated exterior envelope and outside the 5m clear lanes.
  block(C.x, layout.core.min.y, C.z, 10, 1.4, 20, materials.stone)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    // Thick corner buttresses carry the upper deck; narrow standards rise above
    // it without enclosing the observation floor.
    block(C.x + sx * 4.5, layout.core.min.y, C.z + sz * 9.5, 1.05, layout.platformY - layout.core.min.y + 1.7, 1.05, trim)
    block(C.x + sx * 4.5, layout.platformY + 1.7, C.z + sz * 9.5, .16, C.totalHeight - C.platformHeight - 1.7, .16, materials.dark, true)
    block(C.x + sx * 4.5, layout.groundY + C.totalHeight - .16, C.z + sz * 9.5, .3, .16, .3, structure, true)
    add(new THREE.BoxGeometry(.04, 1.4, 1.1).translate(C.x + sx * 4.5, layout.groundY + C.totalHeight - 1, C.z + sz * 9.5 - sz * .55), materials.accent)
  }
  // Broad horizontal ties are part of the tower face, not free-floating detail.
  for (const h of [2, 10, 19, 27]) {
    block(C.x, layout.groundY + h, C.z, 10.16, .32, 20.16, trim)
  }
  // Sparse recessed-looking arrow slits and battlements give the massive core
  // a military silhouette, without introducing rooms or per-frame decoration.
  for (const h of [6, 14.5, 23]) for (const side of [-1, 1]) {
    for (const dz of [-5, 5]) add(new THREE.BoxGeometry(.025, 1.45, .35).translate(C.x + side * 5.01, layout.groundY + h, C.z + dz), materials.dark)
    add(new THREE.BoxGeometry(.35, 1.45, .025).translate(C.x, layout.groundY + h, C.z + side * 10.01), materials.dark)
  }
  for (const z of [-7, -3, 1]) for (const side of [-1, 1]) {
    block(C.x + side * 5, layout.platformY + C.railHeight, C.z + z, .3, .55, 1.2, trim, true)
  }
  for (const x of [-2, 2]) for (const side of [-1, 1]) block(C.x + x, layout.platformY + C.railHeight, C.z + side * 10, 1.2, .55, .3, trim, true)
  if (faction === 'viking') {
    // Thin snow caps are decorative only and never raise the walk surface.
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(new THREE.BoxGeometry(.3, .06, .3).translate(C.x + sx * 4.5, layout.groundY + C.totalHeight - .03, C.z + sz * 9.5), materials.snow)
  }
  for (const [material, geometries] of batches) {
    const geometry = mergeGeometries(geometries)!
    geometries.forEach(part => part.dispose())
    const mesh = new THREE.Mesh(geometry, material); mesh.castShadow = mesh.receiveShadow = true; root.add(mesh)
  }
  return root
}
