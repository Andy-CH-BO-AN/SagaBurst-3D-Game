import * as THREE from 'three'
import type { ObstacleData, WalkRampSurface } from '../world/Terrain'

/**
 * Plan of the Valhöll longhouse duel arena. The hall's long axis is world Z,
 * the entrance doors are at -Z and Odin's throne dais at +Z. All structure is
 * axis-aligned, so every visible wall, pillar and hearth has an exact box.
 */
export const VALHALLA = Object.freeze({
  groundY: 0,
  /** Interior faces of the outer walls. */
  halfWidth: 17,
  frontZ: -38,
  backZ: 36,
  wallThickness: 1.2,
  eaveY: 10.5,
  ridgeY: 25,
  pillarX: 11.2,
  pillarHalf: 0.8,
  pillarZ: Object.freeze([-30, -20, -10, 0, 10, 20]),
  hearthHalfLength: 2.5,
  hearthHalfWidth: 0.65,
  hearthHeight: 0.55,
  /** Central fighting floor is clear between the pillar lines. */
  centralHalfWidth: 10.2,
  dais: Object.freeze({ halfWidth: 9, frontZ: 27, topY: 3 }),
  stair: Object.freeze({ halfWidth: 3.5, lowZ: 20.6, landingZ: 28.6 }),
  throne: Object.freeze({ halfWidth: 1.4, minZ: 30.6, maxZ: 32.6, height: 3.6 }),
  relief: Object.freeze({ halfWidth: 7, minZ: 33.4, topY: 22 }),
  gallery: Object.freeze({ innerX: 13.6, floorY: 5.5, railHeight: 1.1, minZ: -33, maxZ: 23 }),
})

const box = (minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): THREE.Box3 =>
  new THREE.Box3(new THREE.Vector3(minX, minY, minZ), new THREE.Vector3(maxX, maxY, maxZ))

export const VALHALLA_SPAWNS = Object.freeze({
  player: Object.freeze({ x: 0, y: VALHALLA.groundY, z: -14, yaw: 0 }),
  opponent: Object.freeze({ x: 0, y: VALHALLA.groundY, z: 6, yaw: Math.PI }),
})

export const VALHALLA_SAFETY_BOUND = 60

export function valhallaHearthCenters(): number[] {
  const z = VALHALLA.pillarZ
  const centers: number[] = []
  for (let i = 0; i + 1 < z.length; i++) centers.push((z[i] + z[i + 1]) / 2)
  return centers
}

export function valhallaBrazierPositions(): { x: number; y: number; z: number }[] {
  const d = VALHALLA.dais
  return [
    // Corners of the floor (by the doors and beside the dais), clear of the duel lane.
    { x: -8.6, y: VALHALLA.groundY, z: -35.6 }, { x: 8.6, y: VALHALLA.groundY, z: -35.6 },
    { x: -9.3, y: VALHALLA.groundY, z: 25.6 }, { x: 9.3, y: VALHALLA.groundY, z: 25.6 },
    { x: -6.6, y: d.topY, z: d.frontZ + 1.2 }, { x: 6.6, y: d.topY, z: d.frontZ + 1.2 },
  ]
}

/** Aisle furniture along the side walls: barrels and spear racks. */
export function valhallaAisleProps(): { kind: 'barrel' | 'rack'; x: number; z: number }[] {
  const props: { kind: 'barrel' | 'rack'; x: number; z: number }[] = []
  for (const side of [-1, 1]) {
    for (const z of [-34.5, -15, 5.5]) props.push({ kind: 'barrel', x: side * 16.1, z })
    for (const z of [-25, -5, 15]) props.push({ kind: 'rack', x: side * 16.25, z })
  }
  return props
}

export function valhallaPropBox(prop: { kind: 'barrel' | 'rack'; x: number; z: number }): THREE.Box3 {
  return prop.kind === 'barrel'
    ? box(prop.x - 0.55, VALHALLA.groundY, prop.z - 0.55, prop.x + 0.55, VALHALLA.groundY + 1.15, prop.z + 0.55)
    : box(prop.x - 0.35, VALHALLA.groundY, prop.z - 1.3, prop.x + 0.35, VALHALLA.groundY + 2.4, prop.z + 1.3)
}

export function valhallaStairSurface(): WalkRampSurface {
  const { stair, dais } = VALHALLA
  const run = dais.frontZ - stair.lowZ
  return {
    startX: 0, startZ: stair.lowZ, dirX: 0, dirZ: 1, halfWidth: stair.halfWidth,
    length: run, landing: stair.landingZ - dais.frontZ, startY: VALHALLA.groundY, topY: dais.topY, mounted: true,
  }
}

/** Complete static collision of the hall: shell, roof, pillars, hearths, dais, throne and props. */
export function createValhallaObstacles(): ObstacleData[] {
  const v = VALHALLA
  const g = v.groundY
  const w = v.halfWidth, t = v.wallThickness
  const wallTop = v.ridgeY + 2
  const obstacles: ObstacleData[] = [
    { box: box(-w - t, g, v.frontZ - t, -w, wallTop, v.backZ + t), isBarricade: false },
    { box: box(w, g, v.frontZ - t, w + t, wallTop, v.backZ + t), isBarricade: false },
    { box: box(-w - t, g, v.frontZ - t, w + t, wallTop, v.frontZ), isBarricade: false },
    { box: box(-w - t, g, v.backZ, w + t, wallTop, v.backZ + t), isBarricade: false },
    // The roof/eaves volume: nobody can stand there, but arrows and the camera stop at it.
    { box: box(-w, v.eaveY, v.frontZ, w, wallTop, v.backZ), isBarricade: false, navigationPassable: true },
  ]
  for (const z of v.pillarZ) for (const side of [-1, 1]) {
    const x = side * v.pillarX
    obstacles.push({ box: box(x - v.pillarHalf, g, z - v.pillarHalf, x + v.pillarHalf, v.eaveY, z + v.pillarHalf), isBarricade: false })
  }
  for (const z of valhallaHearthCenters()) for (const side of [-1, 1]) {
    const x = side * v.pillarX
    obstacles.push({ box: box(x - v.hearthHalfWidth, g, z - v.hearthHalfLength, x + v.hearthHalfWidth, g + v.hearthHeight, z + v.hearthHalfLength), isBarricade: false })
  }
  // Gallery: floor slab and its support posts (unreachable decor deck, but solid).
  const gallery = v.gallery
  for (const side of [-1, 1]) {
    const inner = side * gallery.innerX, outer = side * w
    obstacles.push({ box: box(Math.min(inner, outer), gallery.floorY - 0.35, gallery.minZ, Math.max(inner, outer), gallery.floorY + gallery.railHeight, gallery.maxZ), isBarricade: false })
    for (let z = gallery.minZ + 2; z <= gallery.maxZ - 1; z += 5) {
      obstacles.push({ box: box(inner - 0.2, g, z - 0.2, inner + 0.2, gallery.floorY, z + 0.2), isBarricade: false })
    }
  }
  // Dais: solid block either side of the stair, the stair itself, throne and relief.
  const dais = v.dais, stair = v.stair
  obstacles.push({ box: box(-dais.halfWidth, g, dais.frontZ, -stair.halfWidth, dais.topY, v.backZ), isBarricade: false })
  obstacles.push({ box: box(stair.halfWidth, g, dais.frontZ, dais.halfWidth, dais.topY, v.backZ), isBarricade: false })
  obstacles.push({ box: box(-stair.halfWidth, g, stair.landingZ, stair.halfWidth, dais.topY, v.backZ), isBarricade: false })
  obstacles.push({
    box: box(-stair.halfWidth, g, stair.lowZ, stair.halfWidth, dais.topY, stair.landingZ), isBarricade: false,
    walkSurface: valhallaStairSurface(), solidBelow: g, navigationPassable: true,
  })
  const throne = v.throne
  obstacles.push({ box: box(-throne.halfWidth, dais.topY, throne.minZ, throne.halfWidth, dais.topY + throne.height, throne.maxZ), isBarricade: false })
  const relief = v.relief
  obstacles.push({ box: box(-relief.halfWidth, g, relief.minZ, relief.halfWidth, relief.topY, v.backZ), isBarricade: false })
  // Raven perches and antler stands beside the throne.
  for (const side of [-1, 1]) {
    obstacles.push({ box: box(side * 2.6 - 0.35, dais.topY, 31.1, side * 2.6 + 0.35, dais.topY + 2.4, 31.8), isBarricade: false })
    obstacles.push({ box: box(side * 4.6 - 0.5, dais.topY, 32.2, side * 4.6 + 0.5, dais.topY + 3.2, 33.4), isBarricade: false })
  }
  for (const prop of valhallaAisleProps()) obstacles.push({ box: valhallaPropBox(prop), isBarricade: false })
  for (const brazier of valhallaBrazierPositions()) {
    obstacles.push({ box: box(brazier.x - 0.36, brazier.y, brazier.z - 0.36, brazier.x + 0.36, brazier.y + 1.35, brazier.z + 0.36), isBarricade: false })
  }
  return obstacles
}

/** Interior containment for grounded bodies (redundant with the walls; guards teleports and spawns). */
export function constrainToValhallaHall(position: THREE.Vector3, radius = 0.4): boolean {
  const v = VALHALLA
  const x = THREE.MathUtils.clamp(position.x, -v.halfWidth + radius, v.halfWidth - radius)
  const z = THREE.MathUtils.clamp(position.z, v.frontZ + radius, v.backZ - radius)
  if (x === position.x && z === position.z) return false
  position.x = x
  position.z = z
  return true
}
