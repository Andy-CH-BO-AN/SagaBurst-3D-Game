import { Box3, MathUtils, Matrix4, Vector3 } from 'three'
import { getTerrainHeight, getWalkRampHeight, type ObstacleData, type WalkRampSurface } from '../world/Terrain'
import { townGatePoint, type TownGateSpec } from './TownLayout'

// Gate-local +Z faces out. Leave the siege dock approaches (|x| >= 17m)
// outside these permanent rampart openings.
export const TOWN_GATEHOUSE = {
  towerCenter: 11.25, towerInner: 8.8, towerOuter: 13.8,
  linkWidth: 4.4, linkRailStart: -2.85, deckBack: 0, deckFront: 4.1, galleryCenter: 2,
  railThickness: .24, railHeight: 1.05, headroom: 3.7, slab: .35,
} as const

/** The masonry/timber shell around the unchanged walk surfaces. Towers bite into
 * the curtain (z>=.2) and project past the gallery; the outer face stays at
 * towerOuter so the siege docks (|x|>=17, half width 3) keep their clearance. */
export const GATEHOUSE_SHELL = {
  inner: 8.75, outer: TOWN_GATEHOUSE.towerOuter, front: 4.9, back: -.35, skin: .35, portal: 7,
  /** Tower eave and the tower door head, above the walk floor. */
  eave: TOWN_GATEHOUSE.headroom + 1.8, doorHead: 3.95, windowHead: 3.3,
  /** Exterior collision envelope of the tower footing, including plinth and trim. */
  footFront: 5.15, footOuter: 13.95,
  wingStart: TOWN_GATEHOUSE.linkRailStart, wingInner: 8.75, wingOuter: 13.8,
} as const
export const GATEHOUSE_STATUE = {
  roman: { height: 2.7, belowFloor: 1.75, niche: 1.9, recess: .45, ledge: 1 },
  viking: { height: 2.5, belowFloor: 1.45, niche: 0, recess: 0, ledge: .95 },
} as const
export type TownGatehouseStyle = keyof typeof GATEHOUSE_STATUE

export const GATEHOUSE_SIDES = [-1, 1] as const
export type TownGatehouseSide = (typeof GATEHOUSE_SIDES)[number]

interface GatehouseLink {
  readonly side: TownGatehouseSide
  readonly surface: WalkRampSurface
  readonly entry: Vector3
  readonly junction: Vector3
  /** Rampart height at the two tower wing walls flanking this link (gate-centre side first). */
  readonly wingRingY: readonly [centre: number, outer: number]
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
export type GatehouseRole = 'base' | 'rail' | 'post' | 'roof' | 'vault' | 'shell' | 'perch' | 'brace' | 'trim'
export type GatehousePart = { role: GatehouseRole; box: GatehouseBox; overhead: boolean; side?: TownGatehouseSide }

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
    const ring = (localX: number) => {
      const p = gatehousePoint(gate, side * localX, -2, 0)
      return ringHeight(p.x, p.z) ?? entry.y
    }
    return { side, entry, junction: gatehousePoint(gate, x, G.galleryCenter, floorY), surface: walkSurface(entry, top, G.linkWidth),
      wingRingY: [ring(GATEHOUSE_SHELL.wingInner + .2), ring(GATEHOUSE_SHELL.wingOuter - .2)] as const }
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

/** Roman arch intrados (TownFortifications): springs at 4m, 7m half span, 3m rise. */
export function romanPortalIntrados(x: number): number {
  return 4 + 3 * Math.sqrt(Math.max(0, 1 - Math.min(1, (x / GATEHOUSE_SHELL.portal) ** 2)))
}
/** Viking lintel underside; the leaves and opening stay at their native height. */
export const VIKING_PORTAL_HEAD = 7.15

/** Tower roof rise above the shell eave. */
export function gatehouseRoofRise(style: TownGatehouseStyle): number { return style === 'roman' ? 2.9 : 3.9 }

/** Statue perch on each tower's exterior face, shared by visuals and collision. */
export function gatehouseStatueSite(house: TownGatehouse, side: TownGatehouseSide, style: TownGatehouseStyle) {
  const S = GATEHOUSE_STATUE[style], floor = house.floorY - house.groundY
  const top = floor - S.belowFloor, y = top - S.height
  const x = side * (GATEHOUSE_SHELL.inner + GATEHOUSE_SHELL.outer) / 2
  const z = style === 'roman' ? GATEHOUSE_SHELL.front - S.recess + .45 : GATEHOUSE_SHELL.front + .48
  return { x, y, z, top, height: S.height }
}

/** A sloped-top prism in gate-local coordinates (y above the gate ground). */
export interface GatehousePrism {
  readonly side: TownGatehouseSide
  readonly kind: 'wing' | 'fill'
  readonly x0: number; readonly x1: number; readonly z0: number; readonly z1: number
  readonly base: number; readonly top0: number; readonly top1: number
}

/** Tower wing walls flanking the last flight of each link, and the solid
 * masonry/timber under that link. Both start from the real rampart deck. */
export function townGatehousePrisms(house: TownGatehouse): GatehousePrism[] {
  const G = TOWN_GATEHOUSE, S = GATEHOUSE_SHELL, prisms: GatehousePrism[] = []
  // The rampart deck's outer edge (TownRamparts: inward 6.2m, 10m wide).
  const deckEdge = -1.2
  for (const link of house.links) {
    const { side, surface } = link
    const ramp = (z: number) => MathUtils.lerp(link.entry.y, house.floorY, Math.min(1, Math.max(0, 1 + z / surface.length))) - house.groundY
    const span = (a: number, b: number): [number, number] => side < 0 ? [-b, -a] : [a, b]
    const edgeIn = G.towerCenter - G.linkWidth / 2, edgeOut = G.towerCenter + G.linkWidth / 2
    const bands: [number, number, number][] = [[S.wingStart, deckEdge, .35], [deckEdge, G.deckBack, 1.1]]
    for (const [z0, z1, drop] of bands) {
      for (const [index, [a, b]] of [[S.wingInner, edgeIn + G.railThickness], [edgeOut - G.railThickness, S.wingOuter]].entries()) {
        const [x0, x1] = span(a, b), base = link.wingRingY[index] - house.groundY - drop
        prisms.push({ side, kind: 'wing', x0, x1, z0, z1, base, top0: ramp(z0) + G.railHeight, top1: ramp(z1) + G.railHeight })
      }
    }
    const ring = link.entry.y - house.groundY
    for (const [z0, z1, drop] of [[-surface.length, deckEdge, .35], [deckEdge, G.deckBack, 1.1]] as const) {
      const top0 = ramp(z0) - G.slab - .02, top1 = ramp(z1) - G.slab - .02, base = ring - drop
      if (Math.max(top0, top1) <= base + .05) continue
      const [x0, x1] = span(edgeIn + .01, edgeOut - .01)
      prisms.push({ side, kind: 'fill', x0, x1, z0, z1, base, top0: Math.max(base, top0), top1: Math.max(base, top1) })
    }
  }
  return prisms
}

/** Short level slices of a sloped prism, like the existing sloped rails. */
export function gatehousePrismBoxes(prism: GatehousePrism): GatehouseBox[] {
  const count = Math.max(1, Math.ceil(Math.abs(prism.top1 - prism.top0) / .16)), boxes: GatehouseBox[] = []
  for (let i = 0; i < count; i++) {
    const t0 = i / count, t1 = (i + 1) / count
    const z0 = prism.z0 + (prism.z1 - prism.z0) * t0, z1 = prism.z0 + (prism.z1 - prism.z0) * t1
    const top = Math.max(MathUtils.lerp(prism.top0, prism.top1, t0), MathUtils.lerp(prism.top0, prism.top1, t1))
    boxes.push([prism.x0, prism.base, z0, prism.x1, top, z1])
  }
  return boxes
}

/** Local solids shared by the visual dressing and real body/projectile collision.
 * Only the tower footings and portal returns block the ground grid; the portal
 * itself keeps the native arch/lintel clearance and the upper parts never
 * project into ground A*. */
export function townGatehouseParts(house: TownGatehouse, style: TownGatehouseStyle = 'roman'): GatehousePart[] {
  const G = TOWN_GATEHOUSE, S = GATEHOUSE_SHELL, floor = house.floorY - house.groundY
  const parts: GatehousePart[] = []
  const add = (role: GatehouseRole, box: GatehouseBox, side?: TownGatehouseSide) => parts.push({ role, box, overhead: role !== 'base', ...(side ? { side } : {}) })
  const openings = gatehouseRailOpenings(), rail = G.railThickness
  const ceiling = floor + G.headroom, eave = floor + S.eave, rise = gatehouseRoofRise(style)
  for (const side of GATEHOUSE_SIDES) {
    const span = (a: number, b: number): [number, number] => side < 0 ? [-b, -a] : [a, b]
    const low = gatehousePoint(house.gate, side * G.towerCenter, -.9, 0), high = gatehousePoint(house.gate, side * G.towerCenter, S.footFront, 0)
    const bottom = Math.min(0, getTerrainHeight(low.x, low.z) - house.groundY, getTerrainHeight(high.x, high.z) - house.groundY) - .8
    // The tower footing bites into the curtain and carries the shell; the ramp
    // still approaches from behind, above it.
    const [fx0, fx1] = span(S.inner, S.footOuter)
    add('base', [fx0, bottom, .2, fx1, floor - .4, S.footFront], side)
    // Portal return between the native jamb and the tower: a solid passage wall.
    const [px0, px1] = span(S.portal, S.inner)
    add('base', [px0, bottom, 1.2, px1, floor - .4, G.deckFront + .15], side)
    const end = side * G.towerOuter
    add('rail', [end - (side > 0 ? rail : 0), floor, G.deckBack, end + (side < 0 ? rail : 0), floor + G.railHeight, G.deckFront], side)
    // Upper storey shell. Door, window and gallery openings keep the full
    // link/gallery width and the mounted headroom.
    const doorIn = G.towerCenter - G.linkWidth / 2 + rail, doorOut = G.towerCenter + G.linkWidth / 2 - rail
    const shell = (a: number, b: number, y0: number, y1: number, z0: number, z1: number) => { const [x0, x1] = span(a, b); add('shell', [x0, y0, z0, x1, y1, z1], side) }
    shell(S.inner, doorIn, floor - .35, eave, S.back, G.deckBack + rail)
    shell(doorOut, S.outer, floor - .35, eave, S.back, G.deckBack + rail)
    shell(doorIn, doorOut, floor + S.doorHead, eave, S.back, G.deckBack + rail)
    const outerSkin = S.outer - S.skin
    shell(outerSkin, S.outer, floor, floor + G.railHeight, G.deckBack + rail, G.deckFront - rail)
    shell(outerSkin, S.outer, floor + S.windowHead, eave, G.deckBack + rail, G.deckFront - rail)
    for (const [z0, z1] of [[G.deckBack + rail, .5], [1.6, 2.5], [3.6, G.deckFront - rail]]) shell(outerSkin, S.outer, floor, eave, z0, z1)
    const frontZ = G.deckFront - rail
    shell(S.inner, S.outer, floor, floor + G.railHeight, frontZ, S.front)
    shell(S.inner, S.outer, floor + S.windowHead, eave, frontZ, S.front)
    for (const [x0, x1] of [[S.inner, 9.45], [10.65, 11.9], [13.1, S.outer]]) shell(x0, x1, floor, eave, frontZ, S.front)
    // Gallery-side opening: the head matches the gallery ceiling.
    shell(S.inner, S.inner + .3, ceiling, eave, G.deckBack + rail, frontZ)
    const [rx0, rx1] = span(S.inner - .3, G.towerOuter + .35)
    add('roof', [rx0, eave, S.back - .3, rx1, eave + rise, S.front + .3], side)
    const statue = gatehouseStatueSite(house, side, style)
    const ledge = GATEHOUSE_STATUE[style].ledge
    add('perch', [statue.x - ledge, statue.y - (style === 'roman' ? .7 : 1.3), S.front, statue.x + ledge, statue.top + .1,
      style === 'roman' ? S.front + .6 : S.front + .95], side)
    if (style === 'viking') {
      // Lynx finials at both gable apexes.
      const cx = side * (S.inner + S.outer) / 2
      add('trim', [cx - .5, eave + rise - .25, S.front, cx + .5, eave + rise + 1.9, S.front + 1.1], side)
      add('trim', [cx - .5, eave + rise - .25, S.back - 1.1, cx + .5, eave + rise + 1.9, S.back], side)
      // Carved lynx over the tower door, seen from the rampart walk.
      add('trim', [cx - .5, floor + S.doorHead, S.back - .75, cx + .5, eave, S.back], side)
      // Knee braces from the timber portal posts to the main beam.
      const [bx0, bx1] = span(5.5, S.portal)
      add('brace', [bx0, 5.5, G.deckFront, bx1, VIKING_PORTAL_HEAD, G.deckFront + .3], side)
    }
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
  add('roof', [-G.towerInner, ceiling, -.28, G.towerInner, ceiling + 1.6, G.deckFront + .38])
  // Solid structure between the native portal and the gallery floor, plus the
  // entablature/main beam carried across it. The portal clearance is unchanged.
  const top = floor - .35
  if (style === 'roman') {
    for (let x = -S.portal; x < S.portal - 1e-6; x += .5) {
      add('vault', [x, Math.max(romanPortalIntrados(x), romanPortalIntrados(x + .5)), -.9, x + .5, top, G.deckFront + .15])
    }
    add('roof', [-6.2, ceiling, 1.9, 6.2, ceiling + 3.2, G.deckFront + .6])
  } else {
    add('vault', [-S.portal, VIKING_PORTAL_HEAD, -.9, S.portal, top, G.deckFront + .35])
  }
  add('trim', [-S.inner, floor - 1, G.deckFront, S.inner, top, G.deckFront + .35])
  return parts
}

export function townGatehouseObstacle(house: TownGatehouse, local: GatehouseBox, overhead: boolean): ObstacleData {
  const [x0, y0, z0, x1, y1, z1] = local, { gate, groundY } = house
  const box = new Box3(new Vector3(x0, y0, z0), new Vector3(x1, y1, z1))
    .applyMatrix4(new Matrix4().makeRotationY(gate.yaw)).translate(new Vector3(gate.x, groundY, gate.z))
  return { box, isBarricade: false, ...(overhead ? { navigationPassable: true } : {}) }
}
