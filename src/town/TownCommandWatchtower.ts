import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { getTerrainHeight, getWalkRampHeight, type ObstacleData, type WalkRampSurface } from '../world/Terrain'
import { slabGeometry, surfaceBox } from './TownRamparts'
import { TOWN_COMMAND_WATCHTOWER as C, watchtowerSurface, type CommandWatchtowerLayout } from './TownCommandWatchtowerLayout'

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
  const surfaceSlice = (s: WalkRampSurface, from: number, to: number, offset = 0, width = s.halfWidth * 2) => {
    const point = (at: number) => ({ x: s.startX + s.dirX * at, z: s.startZ + s.dirZ * at, y: s.startY + (s.topY - s.startY) * at / s.length + offset })
    const a = point(from), b = point(to)
    return watchtowerSurface(a.x, a.z, a.y, b.x, b.z, b.y, width)
  }
  const rail = (s: WalkRampSurface) => {
    add(slabGeometry({ ...s, startY: s.startY + C.railHeight, topY: s.topY + C.railHeight }, C.railHeight), trim)
    // Short height-aware boxes, not the enclosing inclined AABB. Ground actors,
    // camera and projectiles remain free below every raised guardrail.
    const count = Math.max(1, Math.ceil(Math.abs(s.topY - s.startY) / .16))
    for (let i = 0; i < count; i++) obstacles.push({ box: surfaceBox(surfaceSlice(s, i / count * s.length, (i + 1) / count * s.length, C.railHeight), C.railHeight), isBarricade: false, navigationPassable: true })
  }
  const all = [layout.entrance, ...layout.ramps, ...layout.landings, ...layout.platform]
  for (const s of all) {
    add(slabGeometry(s, C.slabThickness))
    const count = Math.max(1, Math.ceil(s.length / .4))
    const projectileBoxes = Array.from({ length: count }, (_, i) => surfaceBox(surfaceSlice(s, i / count * s.length, (i + 1) / count * s.length), C.slabThickness))
    // Only the first ground-connected approach is a ground-navigation barrier.
    // Elevated rings are passable below; the physical solid core/posts are not.
    obstacles.push({ box: surfaceBox(s), walkSurface: s, projectileBoxes, isBarricade: false,
      navigationPassable: s !== layout.entrance && s !== layout.ramps[0] && s !== layout.landings[0] })
  }
  for (const s of [layout.entrance, ...layout.ramps]) for (const side of [-1, 1]) {
    const lateral = side * (s.halfWidth + .15)
    rail({ ...s, startX: s.startX - s.dirZ * lateral, startZ: s.startZ + s.dirX * lateral, halfWidth: .15 })
  }
  // Flat patches share a boundary only at the same height. Split their perimeter
  // at real connections, leaving all ramp mouths and platform links unobstructed.
  const flats = [...layout.landings, ...layout.platform]
  for (const s of flats) {
    const b = surfaceBox(s), y = s.topY
    for (const axis of ['x', 'z'] as const) for (const side of [-1, 1]) {
      const other = axis === 'x' ? 'z' : 'x', fixed = side < 0 ? b.min[axis] : b.max[axis]
      const min = b.min[other], max = b.max[other]
      const openings: [number, number][] = []
      for (const adjacent of all) {
        if (adjacent === s) continue
        // Probe the boundary against endpoint height, so an overhead crossing
        // never erases the lower floor's safety rail.
        const a = surfaceBox(adjacent)
        if (fixed < a.min[axis] - .001 || fixed > a.max[axis] + .001) continue
        const lo = Math.max(min, a.min[other]), hi = Math.min(max, a.max[other])
        if (hi <= lo) continue
        const x = axis === 'x' ? fixed : (lo + hi) / 2, z = axis === 'z' ? fixed : (lo + hi) / 2
        const h = getWalkRampHeight(adjacent, x, z)
        if (h !== null && Math.abs(h - y) < .001) openings.push([lo, hi])
      }
      const cuts = [...new Set([min, max, ...openings.flat()])].sort((a, b) => a - b)
      for (let i = 1; i < cuts.length; i++) {
        const lo = cuts[i - 1], hi = cuts[i], mid = (lo + hi) / 2
        if (hi - lo < .001 || openings.some(([a, b]) => mid > a - .001 && mid < b + .001)) continue
        rail(axis === 'x' ? watchtowerSurface(fixed, lo, y, fixed, hi, y, .3) : watchtowerSurface(lo, fixed, y, hi, fixed, y, .3))
      }
    }
  }
  box(layout.core.clone(), structure)
  // Stone footing and strong external columns carry both circuits. All supports
  // stay within the validated exterior envelope and outside the 5m clear lanes.
  block(C.x, layout.core.min.y, C.z, 10, 1.4, 20, materials.stone)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = C.x + sx * 10.9, z = C.z + sz * 15.9, bottom = getTerrainHeight(x, z) - .5
    block(x, bottom, z, .5, layout.platformY - bottom, .5, trim)
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
  // Sparse angled timber/stone brackets under the flights. They connect the outer columns
  // and outside column line; their solid boxes never enter the walking lane.
  for (const s of layout.ramps) {
    const x = s.startX + s.dirX * s.length / 2, z = s.startZ + s.dirZ * s.length / 2
    const dx = s.dirZ === 0 ? 0 : Math.sign(x - C.x), dz = s.dirX === 0 ? 0 : Math.sign(z - C.z)
    // Outer-face bracing stays beyond the clear lane. Cross-lane braces just
    // beneath the slab can catch a circular mount at the higher end of its radius.
    const a = new THREE.Vector3(s.startX - s.dirX * 5.9 + dx * 2.9, s.startY - 3, s.startZ - s.dirZ * 5.9 + dz * 2.9)
    const b = new THREE.Vector3(s.startX + s.dirX * (s.length + 5.9) + dx * 2.9, s.topY - C.slabThickness, s.startZ + s.dirZ * (s.length + 5.9) + dz * 2.9)
    const length = a.distanceTo(b), geometry = new THREE.BoxGeometry(.32, length, .32)
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize())).translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2)
    add(geometry, trim)
    // Physical narrow slices follow the brace rather than blocking its full AABB.
    for (let i = 0; i < 12; i++) {
      const p = a.clone().lerp(b, i / 12), q = a.clone().lerp(b, (i + 1) / 12)
      obstacles.push({ box: new THREE.Box3().setFromPoints([p, q]).expandByScalar(.16), isBarricade: false, navigationPassable: p.y > getTerrainHeight(p.x, p.z) + 4 })
    }
  }
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
