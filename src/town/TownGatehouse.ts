import { Box3, Matrix4, Vector3 } from 'three'
import { getTerrainHeight, getWalkRampHeight, type ObstacleData, type WalkRampSurface } from '../world/Terrain'
import { townGatePoint, type TownGateSpec } from './TownLayout'

// Gate-local +Z faces out. Leave the siege dock approaches (|x| >= 17m)
// outside these permanent rampart openings.
export const TOWN_GATEHOUSE = {
  towerCenter: 11.25, towerInner: 8.8, towerOuter: 13.8,
  linkWidth: 4.4, linkRailStart: -2.85, deckBack: 0, deckFront: 4.1, galleryCenter: 2,
  railThickness: .24, railHeight: 1.05, headroom: 3.7, slab: .35,
} as const

export const GATEHOUSE_SIDES = [-1, 1] as const
export type TownGatehouseSide = (typeof GATEHOUSE_SIDES)[number]

interface GatehouseLink {
  readonly side: TownGatehouseSide
  readonly surface: WalkRampSurface
  readonly entry: Vector3
  readonly junction: Vector3
}

export interface TownGatehouse {
  readonly gate: TownGateSpec
  readonly groundY: number
  readonly floorY: number
  readonly deck: WalkRampSurface
  readonly links: readonly GatehouseLink[]
}

type Point = { x: number; y: number; z: number }
type GatehouseBox = [x0: number, y0: number, z0: number, x1: number, y1: number, z1: number]
type GatehousePart = { role: 'base' | 'rail' | 'post' | 'roof'; box: GatehouseBox; overhead: boolean }

export function gatehousePoint(gate: TownGateSpec, x: number, z: number, y: number): Vector3 {
  const p = townGatePoint(gate, x, -z)
  return new Vector3(p.x, y, p.z)
}

export function gatehouseLocal(gate: TownGateSpec, p: { x: number; z: number }): { x: number; z: number } {
  const x = p.x - gate.x, z = p.z - gate.z, c = Math.cos(gate.yaw), s = Math.sin(gate.yaw)
  return { x: x * c - z * s, z: x * s + z * c }
}

function walkSurface(a: Vector3, b: Vector3, width: number): WalkRampSurface {
  const length = Math.hypot(b.x - a.x, b.z - a.z)
  return { startX: a.x, startZ: a.z, startY: a.y, topY: b.y, dirX: (b.x - a.x) / length,
    dirZ: (b.z - a.z) / length, length, halfWidth: width / 2, landing: 0, mounted: true }
}

/** The lower portal keeps its original clearance; both upper approaches inherit their real ring height. */
export function getTownGatehouse(gate: TownGateSpec, ringInward: number, ringHeight: (x: number, z: number) => number | null): TownGatehouse {
  const G = TOWN_GATEHOUSE, groundY = getTerrainHeight(gate.x, gate.z)
  const entries = GATEHOUSE_SIDES.map(side => {
    const entry = gatehousePoint(gate, side * G.towerCenter, -ringInward, 0)
    const y = ringHeight(entry.x, entry.z)
    if (y === null) throw new Error(`Missing gatehouse rampart at ${gate.id}:${side}`)
    entry.y = y
    return { side, entry }
  })
  // Above the original Roman arch (8.5m), including a solid structural slab.
  const floorY = Math.max(groundY + 9.25, ...entries.map(({ entry }) => entry.y))
  const deck = walkSurface(gatehousePoint(gate, -G.towerOuter, (G.deckBack + G.deckFront) / 2, floorY),
    gatehousePoint(gate, G.towerOuter, (G.deckBack + G.deckFront) / 2, floorY), G.deckFront - G.deckBack)
  const links = entries.map(({ side, entry }) => {
    const x = side * G.towerCenter, top = gatehousePoint(gate, x, G.deckBack, floorY)
    return { side, entry, junction: gatehousePoint(gate, x, G.galleryCenter, floorY), surface: walkSurface(entry, top, G.linkWidth) }
  })
  return { gate, groundY, floorY, deck, links }
}

/** Only actual elevated points qualify. The portal underneath never enters this layer. */
export function gatehouseSection(house: TownGatehouse, p: Point): 'gallery' | TownGatehouseSide | null {
  if (Math.max(Math.abs(p.x - house.gate.x), Math.abs(p.z - house.gate.z)) > TOWN_GATEHOUSE.towerOuter + .02) return null
  const local = gatehouseLocal(house.gate, p)
  if (Math.abs(local.x) > TOWN_GATEHOUSE.towerOuter + .01 || local.z < -7 || local.z > TOWN_GATEHOUSE.deckFront + .01) return null
  const on = (surface: WalkRampSurface) => {
    const y = getWalkRampHeight(surface, p.x, p.z)
    return y !== null && Math.abs(y - p.y) < 1.3
  }
  if (on(house.deck)) return 'gallery'
  return house.links.find(link => local.z > gatehouseLocal(house.gate, link.entry).z + .12 && on(link.surface))?.side ?? null
}

/** Permanent openings, in local X. The exact same width is used by the approach surfaces. */
export function gatehouseRailOpenings(): readonly (readonly [number, number])[] {
  return GATEHOUSE_SIDES.map(side => {
    const center = side * TOWN_GATEHOUSE.towerCenter, half = TOWN_GATEHOUSE.linkWidth / 2
    return [center - half, center + half] as const
  })
}

/** Local solids shared by the visual dressing and real body/projectile collision.
 * Only the two existing outer tower foundations block the ground grid. */
export function townGatehouseParts(house: TownGatehouse): GatehousePart[] {
  const G = TOWN_GATEHOUSE, floor = house.floorY - house.groundY
  const parts: GatehousePart[] = []
  const add = (role: GatehousePart['role'], box: GatehouseBox) => parts.push({ role, box, overhead: role !== 'base' })
  const openings = gatehouseRailOpenings(), rail = G.railThickness
  for (const side of GATEHOUSE_SIDES) {
    const x0 = side < 0 ? -G.towerOuter : G.towerInner, x1 = side < 0 ? -G.towerInner : G.towerOuter
    const low = gatehousePoint(house.gate, (x0 + x1) / 2, -.9, 0), high = gatehousePoint(house.gate, (x0 + x1) / 2, G.deckFront, 0)
    const bottom = Math.min(0, getTerrainHeight(low.x, low.z) - house.groundY, getTerrainHeight(high.x, high.z) - house.groundY) - .8
    // The ramp approaches from behind, above this base. It is not a solid tower core.
    add('base', [x0, bottom, .2, x1, floor - .4, G.deckFront])
    const end = side * G.towerOuter
    add('rail', [end - (side > 0 ? rail : 0), floor, G.deckBack, end + (side < 0 ? rail : 0), floor + G.railHeight, G.deckFront])
  }
  add('rail', [-G.towerOuter, floor, G.deckFront - rail, G.towerOuter, floor + G.railHeight, G.deckFront])
  for (const [x0, x1] of [[-G.towerOuter, openings[0][0]], [openings[0][1], openings[1][0]], [openings[1][1], G.towerOuter]]) {
    add('rail', [x0, floor, G.deckBack, x1, floor + G.railHeight, G.deckBack + rail])
  }
  for (const x of [-13.5, -9.03, -5.85, 0, 5.85, 9.03, 13.5]) {
    const y = Math.abs(x) > G.towerInner ? floor + G.headroom + 1.05 : floor + G.headroom
    add('post', [x - .12, floor, G.deckFront - .25, x + .12, y, G.deckFront - .01])
  }
  for (const x of [-13.7, -8.91, -5.85, 0, 5.85, 8.91, 13.7]) {
    const y = Math.abs(x) > G.towerInner ? floor + G.headroom + 1.05 : floor + G.headroom
    add('post', [x - .06, floor, G.deckBack, x + .06, y, G.deckBack + .18])
  }
  // The roofs' solid lower planes sit above the complete mounted corridor.
  const ceiling = floor + G.headroom
  add('roof', [-G.towerInner, ceiling, -.28, G.towerInner, ceiling + 1.6, G.deckFront + .38])
  for (const side of GATEHOUSE_SIDES) {
    add('roof', [side < 0 ? -G.towerOuter - .35 : G.towerInner, ceiling + 1.05, -.45,
      side < 0 ? -G.towerInner : G.towerOuter + .35, ceiling + 3.7, G.deckFront + .45])
  }
  return parts
}

export function townGatehouseObstacle(house: TownGatehouse, local: GatehouseBox, overhead: boolean): ObstacleData {
  const [x0, y0, z0, x1, y1, z1] = local, { gate, groundY } = house
  const box = new Box3(new Vector3(x0, y0, z0), new Vector3(x1, y1, z1))
    .applyMatrix4(new Matrix4().makeRotationY(gate.yaw)).translate(new Vector3(gate.x, groundY, gate.z))
  return { box, isBarricade: false, ...(overhead ? { navigationPassable: true } : {}) }
}
