import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { getTerrainHeight, getWalkRampHeight, type ObstacleData, type WalkRampSurface } from '../world/Terrain'
import { TOWN_CITY, TOWN_GATES, townGatePoint, type TownGateId } from './TownLayout'

export const TOWN_RAMPART = { width: 6.4, inward: 4.4, rampWidth: 4, slope: .4, landing: 4 } as const
export interface TownWalkway { id: string; gateId: TownGateId; surface: WalkRampSurface; box: THREE.Box3 }
export interface TownRamp { gateId: TownGateId; surface: WalkRampSurface; box: THREE.Box3; entrance: THREE.Vector3; landing: THREE.Vector3; connection: THREE.Vector3 }
export interface TownRampartLayout {
  decks: TownWalkway[]; ramps: TownRamp[]; corners: THREE.Vector3[]; lengths: number[]; perimeter: number
  /** Original wall spans keep garrison station sampling independent of mesh subdivision. */
  wallSpans: Pick<TownWalkway, 'gateId' | 'surface'>[]
}
const C = TOWN_CITY, W = TOWN_RAMPART
const RAMP_ANCHORS: Record<TownGateId, number> = { north: -80, south: 60, east: 70, west: -35 }
export function surfaceBox(s: WalkRampSurface, thickness = .35): THREE.Box3 {
  const endX = s.startX + s.dirX * (s.length + s.landing), endZ = s.startZ + s.dirZ * (s.length + s.landing)
  return new THREE.Box3(new THREE.Vector3(Math.min(s.startX, endX) - Math.abs(s.dirZ) * s.halfWidth, Math.min(s.startY, s.topY) - thickness, Math.min(s.startZ, endZ) - Math.abs(s.dirX) * s.halfWidth),
    new THREE.Vector3(Math.max(s.startX, endX) + Math.abs(s.dirZ) * s.halfWidth, Math.max(s.startY, s.topY), Math.max(s.startZ, endZ) + Math.abs(s.dirX) * s.halfWidth))
}
function surface(a: THREE.Vector3, b: THREE.Vector3, width: number): WalkRampSurface {
  const length = Math.hypot(b.x - a.x, b.z - a.z)
  return { startX: a.x, startZ: a.z, startY: a.y, topY: b.y, dirX: (b.x - a.x) / length, dirZ: (b.z - a.z) / length, length, landing: 0, halfWidth: width / 2, mounted: true }
}
/** Terrain-following wall crowns; corners use the same height on both adjoining walls. */
function crown(x: number, z: number): number { return getTerrainHeight(x, z) + C.wallHeight + .8 }
export function getTownRampartLayout(): TownRampartLayout {
  const corners = [[C.minX, C.minZ], [C.maxX, C.minZ], [C.maxX, C.maxZ], [C.minX, C.maxZ]].map(([x, z]) =>
    new THREE.Vector3(x + (x === C.minX ? W.inward : -W.inward), crown(x, z), z + (z === C.minZ ? W.inward : -W.inward)))
  const decks: TownWalkway[] = [], lengths: number[] = []
  const wallSpans: TownRampartLayout['wallSpans'] = []
  const ids: TownGateId[] = ['north', 'east', 'south', 'west']
  for (let side = 0; side < 4; side++) {
    const a = corners[side], b = corners[(side + 1) % 4], gateId = ids[side]
    const length = Math.hypot(b.x - a.x, b.z - a.z); lengths.push(length)
    const count = Math.ceil(length / 5)
    const samples = Array.from({ length: count + 1 }, (_, i) => {
      const p = a.clone().lerp(b, i / count)
      const wallX = side === 1 ? C.maxX : side === 3 ? C.minX : C.minX + (C.maxX - C.minX) * (side === 0 ? i / count : 1 - i / count)
      const wallZ = side === 0 ? C.minZ : side === 2 ? C.maxZ : C.minZ + (C.maxZ - C.minZ) * (side === 1 ? i / count : 1 - i / count)
      p.y = crown(wallX, wallZ); return p
    })
    for (let i = 0; i < count; i++) wallSpans.push({ gateId, surface: surface(samples[i], samples[i + 1], W.width) })
    const sampledHeight = (distance: number) => {
      const index = Math.min(count - 1, Math.floor(distance / length * count))
      return THREE.MathUtils.lerp(samples[index].y, samples[index + 1].y, distance / length * count - index)
    }
    const gate = TOWN_GATES.find(g => g.id === gateId)!
    const connection = townGatePoint(gate, RAMP_ANCHORS[gateId], W.inward)
    const connectionDistance = Math.hypot(connection.x - a.x, connection.z - a.z)
    const connectionY = sampledHeight(connectionDistance)
    // A transverse flat landing needs a level opening across its full width.
    // The square corner pads likewise share their complete overlap with both walls.
    const plateaus = [
      { from: 0, to: W.width / 2, y: a.y },
      { from: connectionDistance - W.rampWidth / 2, to: connectionDistance + W.rampWidth / 2, y: connectionY },
      { from: length - W.width / 2, to: length, y: b.y },
    ]
    const distances = [...new Set([...samples.map((_, i) => length * i / count), ...plateaus.flatMap(p => [p.from, p.to])])].sort((a, b) => a - b)
    const points = distances.map(distance => {
      const p = a.clone().lerp(b, distance / length)
      p.y = plateaus.find(p => distance >= p.from && distance <= p.to)?.y ?? sampledHeight(distance)
      return p
    })
    for (let i = 0; i < points.length - 1; i++) {
      const s = surface(points[i], points[i + 1], W.width)
      decks.push({ id: `${gateId}:${i}`, gateId, surface: s, box: surfaceBox(s) })
    }
    // Square corner landings fill the outside of the turn, without a step or gap.
    const p = a.clone(); p.z -= W.width / 2
    const s = surface(p, p.clone().add(new THREE.Vector3(0, 0, W.width)), W.width)
    decks.push({ id: `corner:${gateId}`, gateId, surface: s, box: surfaceBox(s) })
  }
  const layout: TownRampartLayout = { decks, wallSpans, ramps: [], corners, lengths, perimeter: lengths.reduce((a, b) => a + b, 0) }
  // Each foot/flight lies parallel to its wall, outside gates, housing and eagle approaches.
  for (const gate of TOWN_GATES) {
    const connection = townGatePoint(gate, RAMP_ANCHORS[gate.id], W.inward)
    const deckY = townRampartHeight(layout, connection.x, connection.z)!
    const top = townGatePoint(gate, RAMP_ANCHORS[gate.id], 10)
    const dirX = Math.cos(gate.yaw), dirZ = -Math.sin(gate.yaw)
    let length = 28, startX = 0, startZ = 0, startY = 0
    for (let i = 0; i < 40; i++) {
      startX = top.x - dirX * (length + W.landing / 2); startZ = top.z - dirZ * (length + W.landing / 2)
      startY = getTerrainHeight(startX, startZ) + .03
      length = Math.max(8, (deckY - startY) / W.slope)
    }
    startX = top.x - dirX * (length + W.landing / 2); startZ = top.z - dirZ * (length + W.landing / 2)
    startY = getTerrainHeight(startX, startZ) + .03
    const s: WalkRampSurface = { startX, startZ, startY, topY: deckY, dirX, dirZ, halfWidth: W.rampWidth / 2, length, landing: W.landing, mounted: true }
    const landing = new THREE.Vector3(top.x, deckY, top.z), end = new THREE.Vector3(connection.x, deckY, connection.z)
    const link = surface(landing, end, W.rampWidth)
    decks.push({ id: `landing:${gate.id}`, gateId: gate.id, surface: link, box: surfaceBox(link) })
    layout.ramps.push({ gateId: gate.id, surface: s, box: surfaceBox(s), landing, connection: end,
      entrance: new THREE.Vector3(startX - dirX * 2.5, getTerrainHeight(startX - dirX * 2.5, startZ - dirZ * 2.5), startZ - dirZ * 2.5) })
  }
  return layout
}
export function townRampartHeight(layout: TownRampartLayout, x: number, z: number): number | null {
  for (const deck of layout.decks) { const y = getWalkRampHeight(deck.surface, x, z); if (y !== null) return y }
  return null
}
/** Exact sloped slab shared by visuals and projectile volumes, with no solid wall below it. */
function slabGeometry(s: WalkRampSurface, thickness = .35): THREE.BufferGeometry {
  // BoxGeometry has vertices only at its ends. Split at the slope/landing knee
  // so its triangles follow the same piecewise surface as getWalkRampHeight.
  if (s.landing > 0) {
    const flight = slabGeometry({ ...s, landing: 0 }, thickness)
    const landing = slabGeometry({ ...s, startX: s.startX + s.dirX * s.length, startZ: s.startZ + s.dirZ * s.length,
      startY: s.topY, length: s.landing, landing: 0 }, thickness)
    const geometry = mergeGeometries([flight, landing])!
    flight.dispose(); landing.dispose(); return geometry
  }
  const g = new THREE.BoxGeometry(s.halfWidth * 2, thickness, s.length + s.landing)
  const p = g.attributes.position
  for (let i = 0; i < p.count; i++) {
    const along = p.getZ(i) + (s.length + s.landing) / 2, lateral = p.getX(i)
    const y = s.startY + (s.topY - s.startY) * Math.min(1, along / s.length)
    // Preserve BoxGeometry's handedness: reflecting its lateral axis turns the
    // top faces inward, so back-face culling exposes the slab's underside.
    p.setXYZ(i, s.startX + s.dirX * along + s.dirZ * lateral, y + p.getY(i) - thickness / 2, s.startZ + s.dirZ * along - s.dirX * lateral)
  }
  g.computeVertexNormals(); return g
}
export function createTownRamparts(layout: TownRampartLayout, obstacles: ObstacleData[], material: THREE.Material, supportMaterial: THREE.Material): THREE.Group {
  const root = new THREE.Group(); root.name = 'town-ramparts'
  const parts: THREE.BufferGeometry[] = [], supports: THREE.BufferGeometry[] = []
  const addBox = (b: THREE.Box3, support = false, navigationPassable = true) => {
    const size = b.getSize(new THREE.Vector3()), center = b.getCenter(new THREE.Vector3())
    ;(support ? supports : parts).push(new THREE.BoxGeometry(size.x, size.y, size.z).translate(center.x, center.y, center.z))
    obstacles.push({ box: b, isBarricade: false, navigationPassable })
  }
  const rail = (s: WalkRampSurface, lateral: number, from: number, to: number, low: number, high: number, halfThickness = .16) => {
    const a = new THREE.Vector3(s.startX + s.dirX * from - s.dirZ * lateral, s.startY + (s.topY - s.startY) * Math.min(1, from / s.length), s.startZ + s.dirZ * from + s.dirX * lateral)
    const b = new THREE.Vector3(s.startX + s.dirX * to - s.dirZ * lateral, s.startY + (s.topY - s.startY) * Math.min(1, to / s.length), s.startZ + s.dirZ * to + s.dirX * lateral)
    // Keep the rail sloped, rather than a staircase of horizontal AABBs.
    a.y += high; b.y += high
    parts.push(slabGeometry(surface(a, b, halfThickness * 2), high - low))
    // A continuous visual rail still needs short collision slices: its full AABB
    // would create an invisible wall below the upper end of a sloped handrail.
    const count = Math.max(1, Math.ceil(Math.abs(b.y - a.y) / .16))
    for (let i = 0; i < count; i++) {
      const box = surfaceBox(surface(a.clone().lerp(b, i / count), a.clone().lerp(b, (i + 1) / count), halfThickness * 2), high - low)
      obstacles.push({ box, isBarricade: false, navigationPassable: true })
    }
  }
  for (const item of [...layout.decks, ...layout.ramps.map(r => ({ ...r, id: `ramp:${r.gateId}` }))]) {
    const s = item.surface; parts.push(slabGeometry(s))
    // Short physical slices precisely approximate the sloped timber/stone, never its empty undercroft.
    const boxes: THREE.Box3[] = [], count = Math.ceil(s.length / .4)
    const cuts = Array.from({ length: count + 1 }, (_, i) => s.length * i / count)
    if (s.landing > 0) cuts.push(s.length + s.landing)
    for (let i = 0; i < cuts.length - 1; i++) {
      const from = cuts[i], to = cuts[i + 1]
      const a = new THREE.Vector3(s.startX + s.dirX * from, s.startY + (s.topY - s.startY) * Math.min(1, from / s.length), s.startZ + s.dirZ * from)
      const b = new THREE.Vector3(s.startX + s.dirX * to, s.startY + (s.topY - s.startY) * Math.min(1, to / s.length), s.startZ + s.dirZ * to)
      boxes.push(surfaceBox(surface(a, b, s.halfWidth * 2)))
    }
    obstacles.push({ box: item.box, walkSurface: s, projectileBoxes: boxes, navigationPassable: !item.id.startsWith('ramp:'), isBarricade: false })
    if (item.id.startsWith('corner:')) {
      const index = ['north', 'east', 'south', 'west'].indexOf(item.gateId), c = layout.corners[index]
      const sx = index === 0 || index === 3 ? -1 : 1, sz = index < 2 ? -1 : 1
      for (const axis of ['x', 'z'] as const) {
        const a = c.clone(), b = c.clone(); a.y = c.y; b.y = c.y + .9
        if (axis === 'x') { a.x += sx * 3.04 - .16; b.x += sx * 3.04 + .16; a.z -= 3.2; b.z += 3.2 }
        else { a.z += sz * 3.04 - .16; b.z += sz * 3.04 + .16; a.x -= 3.2; b.x += 3.2 }
        addBox(new THREE.Box3(a, b))
      }
      continue
    }
    if (item.id.startsWith('landing:')) {
      for (const side of [-1, 1]) rail(s, side * 2.15, W.rampWidth / 2 + .16, s.length - W.width / 2, 0, .9)
      continue
    }
    if (item.id.startsWith('ramp:')) {
      for (const side of [-1, 1]) rail(s, side * 2.15, 0, s.length, 0, .9)
      rail(s, -2.15, s.length, s.length + s.landing, 0, .9)
      const endX = s.startX + s.dirX * (s.length + s.landing), endZ = s.startZ + s.dirZ * (s.length + s.landing)
      addBox(new THREE.Box3(new THREE.Vector3(endX - Math.abs(s.dirZ) * 2.3 - Math.abs(s.dirX) * .16, s.topY, endZ - Math.abs(s.dirX) * 2.3 - Math.abs(s.dirZ) * .16),
        new THREE.Vector3(endX + Math.abs(s.dirZ) * 2.3 + Math.abs(s.dirX) * .16, s.topY + .9, endZ + Math.abs(s.dirX) * 2.3 + Math.abs(s.dirZ) * .16)))
      for (let along = 4; along < s.length; along += 6) for (const side of [-1, 1]) {
        const x = s.startX + s.dirX * along - s.dirZ * side * 1.85, z = s.startZ + s.dirZ * along + s.dirX * side * 1.85
        const top = getWalkRampHeight(s, x, z)! - .35
        if (top > getTerrainHeight(x, z)) {
          const box = new THREE.Box3(new THREE.Vector3(x - .15, getTerrainHeight(x, z) - .1, z - .15), new THREE.Vector3(x + .15, top, z + .15))
          addBox(box, true, false)
          const geometry = supports[supports.length - 1], positions = geometry.attributes.position
          for (let i = 0; i < positions.count; i++) if (positions.getY(i) > box.min.y + .01) {
            positions.setY(i, getWalkRampHeight(s, positions.getX(i), positions.getZ(i))! - .35)
          }
          geometry.computeVertexNormals(); geometry.computeBoundingBox(); box.copy(geometry.boundingBox!)
        }
      }
    } else {
      // Join the inset deck edge to the existing wall crown without a visible slit.
      rail(s, -3.5, 0, s.length, -1.1, 0, .4)
      // Clockwise ring: exterior on the right; crenels alternate every 2.4m.
      rail(s, -3.04, 0, s.length, 0, .45)
      // Leave the four ramp connections open in the inner safety rail.
      const ramp = layout.ramps.find(r => r.gateId === item.gateId)!
      const mid = new THREE.Vector3(s.startX + s.dirX * s.length / 2, 0, s.startZ + s.dirZ * s.length / 2)
      const sideIndex = ['north', 'east', 'south', 'west'].indexOf(item.gateId)
      const startCorner = layout.corners[sideIndex], endCorner = layout.corners[(sideIndex + 1) % 4]
      const railFrom = Math.max(0, 4.5 - Math.hypot(s.startX - startCorner.x, s.startZ - startCorner.z))
      const railTo = Math.min(s.length, Math.hypot(s.startX - endCorner.x, s.startZ - endCorner.z) - 4.5)
      const connectionAlong = (ramp.connection.x - s.startX) * s.dirX + (ramp.connection.z - s.startZ) * s.dirZ
      const openingFrom = connectionAlong - W.rampWidth / 2 - .16, openingTo = connectionAlong + W.rampWidth / 2 + .16
      if (Math.min(railTo, openingFrom) > railFrom) rail(s, 3.04, railFrom, Math.min(railTo, openingFrom), 0, .9)
      if (railTo > Math.max(railFrom, openingTo)) rail(s, 3.04, Math.max(railFrom, openingTo), railTo, 0, .9)
      // Sparse supports stop outside the four 14m gate passages.
      const gate = TOWN_GATES.find(g => g.id === item.gateId)!
      if (Number(item.id.split(':')[1]) % 3 === 0 && Math.hypot(mid.x - gate.x, mid.z - gate.z) > 12) {
        const x = mid.x - s.dirZ * 2.8, z = mid.z + s.dirX * 2.8
        addBox(new THREE.Box3(new THREE.Vector3(x - .2, getTerrainHeight(x, z) - .2, z - .2), new THREE.Vector3(x + .2, (s.startY + s.topY) / 2 - .35, z + .2)), true, false)
      }
    }
  }
  // Subdivision at landings must not move the original crenels into firing slots.
  for (const { surface: s } of layout.wallSpans) for (let along = .85; along < s.length; along += 2.4) {
    const to = Math.min(along + 1, s.length)
    const a = new THREE.Vector3(s.startX + s.dirX * along, 0, s.startZ + s.dirZ * along)
    const b = new THREE.Vector3(s.startX + s.dirX * to, 0, s.startZ + s.dirZ * to)
    a.y = townRampartHeight(layout, a.x, a.z)!; b.y = townRampartHeight(layout, b.x, b.z)!
    const span = surface(a, b, W.width)
    rail(span, -3.04, 0, span.length, .45, 1.3)
  }
  for (const [geometries, mat] of [[parts, material], [supports, supportMaterial]] as const) {
    const geometry = mergeGeometries(geometries); geometries.forEach(g => g.dispose())
    if (geometry) { const mesh = new THREE.Mesh(geometry, mat); mesh.castShadow = mesh.receiveShadow = true; root.add(mesh) }
  }
  return root
}
