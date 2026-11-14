import { Box3, Matrix4, Vector3 } from 'three'
import { getTerrainHeight, getWalkRampHeight, type ObstacleData, type WalkRampSurface } from '../world/Terrain'
import { townGatePoint, type TownGateSpec } from './TownLayout'

// Gate-local +Z faces out. The rampart walk (z -11.2..-1.2) runs straight into
// the gallery over the gate; siege dock approaches (|x| >= 17m) stay outside.
export const TOWN_GATEHOUSE = {
  towerCenter: 10.4, towerInner: 7, towerOuter: 13.8,
  /** Merged walk: rampart outer edge to gallery front. */
  deckRear: -1.2, deckBack: 0, deckFront: 4.1, galleryCenter: 2,
  railThickness: .24, railHeight: 1.05, headroom: 3.7, slab: .35,
} as const

/** Each tower replaces the curtain over |x| 7..13.8: its base is the portal's
 * side wall, carries the curtain's outer contour and projects outward; the
 * rampart walk enters it from both sides. The curtain itself now stops at the
 * tower's outer face (TownFortifications). The outer face stays at towerOuter
 * so the siege docks (|x|>=17, half width 3) keep their clearance. */
export const GATEHOUSE_SHELL = {
  inner: 7, outer: TOWN_GATEHOUSE.towerOuter, portal: 7, skin: .35,
  /** Exterior face, tall body's town face, the ground base's town face and the
   * walk storey's town face (just past the rampart deck's inner edge). */
  front: 4.9, back: -3.5, baseBack: -3, townFace: -11.45,
  /** Wall between the walk passage and the gallery-level front room. */
  wallBack: -1.25, partition: -.5,
  /** Tower eave and window head above the walk floor; the walk storey's ceiling. */
  eave: TOWN_GATEHOUSE.headroom + 3.3, windowHead: 3.3, walkCeiling: TOWN_GATEHOUSE.headroom + .05, terrace: .3,
  /** Exterior collision envelope of the tower footing, including plinth and trim. */
  footFront: 5.15, footOuter: 13.95,
} as const
/** Window piers of the walk storey's town face (local |x|). */
export const GATEHOUSE_TOWN_WINDOWS = { piers: [[7, 7.9], [9.7, 11.1], [12.9, 13.8]], windows: [[7.9, 9.7], [11.1, 12.9]] } as const
export const GATEHOUSE_STATUE = {
  roman: { height: 2.7, belowFloor: 1.75, niche: 1.9, recess: .45, ledge: 1 },
  viking: { height: 2.5, belowFloor: 1.45, niche: 0, recess: 0, ledge: .95 },
} as const
export type TownGatehouseStyle = keyof typeof GATEHOUSE_STATUE

export const GATEHOUSE_SIDES = [-1, 1] as const
export type TownGatehouseSide = (typeof GATEHOUSE_SIDES)[number]

/** Above the original Roman arch (8.5m) with a solid slab, and never below the
 * native crown anywhere across the towers: the walk only rises onto it. */
export function gatehouseFloorY(groundY: number, crownMax: number): number { return Math.max(groundY + 9.25, crownMax) }

/** Local x samples of the walk inside each tower span. */
const WALK_SAMPLE_STEP = .5
export interface TownGatehouse {
  readonly gate: TownGateSpec
  readonly groundY: number
  readonly floorY: number
  /** Gallery and the strip joining it to the rampart walk, one level at floorY. */
  readonly deck: WalkRampSurface
  /** Native crown where the walk leaves each tower span ([-x side, +x side]). */
  readonly crownY: readonly [number, number]
  /** Real walk height every 0.5m across each tower span, from its portal face out. */
  readonly towerWalkY: readonly [readonly number[], readonly number[]]
}

type Point = { x: number; y: number; z: number }
type GatehouseBox = [x0: number, y0: number, z0: number, x1: number, y1: number, z1: number]
/** 'fill' is solid to projectiles and sight only: it closes masonry under a
 * walk surface where a body-solid top would catch hooves on the slope. */
export type GatehouseRole = 'base' | 'rail' | 'post' | 'roof' | 'vault' | 'shell' | 'perch' | 'brace' | 'trim' | 'fill'
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

/** The lower portal keeps its original clearance; the rampart walk already rises to floorY over the gate. */
export function getTownGatehouse(gate: TownGateSpec, floorY: number, ringHeight: (x: number, z: number) => number | null): TownGatehouse {
  const G = TOWN_GATEHOUSE, S = GATEHOUSE_SHELL, groundY = getTerrainHeight(gate.x, gate.z)
  const mid = (G.deckRear + G.deckFront) / 2
  const deck = walkSurface(gatehousePoint(gate, -G.towerOuter, mid, floorY), gatehousePoint(gate, G.towerOuter, mid, floorY), G.deckFront - G.deckRear)
  const sample = (x: number) => {
    const p = gatehousePoint(gate, x, -6.2, 0), y = ringHeight(p.x, p.z)
    if (y === null) throw new Error(`Missing gatehouse rampart at ${gate.id}:${x}`)
    return y
  }
  const crownY = [sample(-G.towerOuter), sample(G.towerOuter)] as const
  const count = Math.ceil((S.footOuter - S.inner) / WALK_SAMPLE_STEP)
  const towerWalkY = GATEHOUSE_SIDES.map(side => Array.from({ length: count + 1 }, (_, i) => sample(side * Math.min(S.footOuter, S.inner + i * WALK_SAMPLE_STEP)))) as unknown as TownGatehouse['towerWalkY']
  return { gate, groundY, floorY, deck, crownY, towerWalkY }
}

/** Only actual elevated gallery points qualify; the portal underneath never enters this layer. */
export function gatehouseSection(house: TownGatehouse, p: Point): 'gallery' | null {
  if (Math.max(Math.abs(p.x - house.gate.x), Math.abs(p.z - house.gate.z)) > TOWN_GATEHOUSE.towerOuter + 5) return null
  const y = getWalkRampHeight(house.deck, p.x, p.z)
  return y !== null && Math.abs(y - p.y) < 1.3 ? 'gallery' : null
}

/** The rampart's outer parapet is replaced across the whole gatehouse: open
 * over the gate, the towers' own walls over their spans. Local X. */
export function gatehouseRailOpenings(): readonly (readonly [number, number])[] {
  return [[-GATEHOUSE_SHELL.outer, GATEHOUSE_SHELL.outer]]
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

/** Lowest walk height (gate-local) over one tower-span slice [|x0|, |x1|]. */
export function gatehouseTowerWalk(house: TownGatehouse, side: TownGatehouseSide, x0: number, x1: number): number {
  const S = GATEHOUSE_SHELL, walk = house.towerWalkY[side < 0 ? 0 : 1]
  const index = (x: number) => Math.max(0, Math.min(walk.length - 1, Math.round((x - S.inner) / WALK_SAMPLE_STEP)))
  let y = Infinity
  for (let i = index(x0); i <= index(x1); i++) y = Math.min(y, walk[i])
  return y - house.groundY
}

/** Local solids shared by the visual dressing and real body/projectile collision.
 * Only the tower bases block the ground grid (and are the portal's side walls);
 * the portal keeps the native arch/lintel clearance and the upper parts never
 * project into ground A*. */
export function townGatehouseParts(house: TownGatehouse, style: TownGatehouseStyle = 'roman'): GatehousePart[] {
  const G = TOWN_GATEHOUSE, S = GATEHOUSE_SHELL, floor = house.floorY - house.groundY
  const parts: GatehousePart[] = []
  const add = (role: GatehouseRole, box: GatehouseBox, side?: TownGatehouseSide) => parts.push({ role, box, overhead: role !== 'base', ...(side ? { side } : {}) })
  const rail = G.railThickness, frontZ = G.deckFront - rail
  const ceiling = floor + G.headroom, eave = floor + S.eave, rise = gatehouseRoofRise(style), walkTop = floor + S.walkCeiling
  for (const side of GATEHOUSE_SIDES) {
    const span = (a: number, b: number): [number, number] => side < 0 ? [-b, -a] : [a, b]
    const shell = (a: number, b: number, y0: number, y1: number, z0: number, z1: number) => { const [x0, x1] = span(a, b); add('shell', [x0, y0, z0, x1, y1, z1], side) }
    const terrain = [S.townFace, S.baseBack, 0, S.footFront].flatMap(z => [S.inner, S.footOuter].map(x => {
      const p = gatehousePoint(house.gate, side * x, z, 0); return getTerrainHeight(p.x, p.z) - house.groundY
    }))
    const bottom = Math.min(0, ...terrain) - .8, crown = house.crownY[side < 0 ? 0 : 1] - house.groundY
    // Tower base: the portal's side wall, the curtain's own line and the outward projection.
    const [fx0, fx1] = span(S.inner, S.footOuter)
    add('base', [fx0, bottom, G.deckRear, fx1, floor - .4, S.footFront], side)
    // Town-side part of the base under the walk, stepped to the walk's real
    // height. The body-solid steps stay a mounted radius' rise below the slope.
    for (let x = S.inner; x < S.footOuter - 1e-6; x += .5) {
      const x1 = Math.min(S.footOuter, x + .5), [bx0, bx1] = span(x, x1), walk = gatehouseTowerWalk(house, side, x, x1)
      add('base', [bx0, bottom, S.baseBack, bx1, walk - 1.2, G.deckRear], side)
      add('fill', [bx0, walk - 1.2, S.baseBack, bx1, walk - G.slab, G.deckRear], side)
    }
    // Walk storey: the rampart walk passes through along the wall. Its town face
    // has piers past the walk's inner rail; the storey is ceiled at walkTop.
    const deckUnder = Math.min(crown, floor) - G.slab - .45, face = S.townFace + .25
    // Town face: a solid wall with two windows, past the walk's inner rail.
    shell(S.inner, S.outer, deckUnder, floor + 1, S.townFace, face)
    for (const [a, b] of GATEHOUSE_TOWN_WINDOWS.piers) shell(a, b, floor + 1, floor + 2.8, S.townFace, face)
    shell(S.inner, S.outer, floor + 2.8, walkTop, S.townFace, face)
    // The town-side corners come down to the ground as legs carrying a beam
    // under the walk; the ground under the walk stays open (garrison stations).
    for (const [a, b] of [[S.inner, S.inner + .7], [S.outer - .7, S.outer]]) {
      const [lx0, lx1] = span(a, b)
      add('base', [lx0, bottom, S.townFace, lx1, deckUnder, S.townFace + .7], side)
    }
    shell(S.inner + .7, S.outer - .7, deckUnder - 1, deckUnder, S.townFace, S.townFace + .7)
    shell(S.inner, S.outer, walkTop, walkTop + S.terrace, S.townFace, S.back)
    // Terrace merlons along both sides only: the town edge stays at terrace
    // height under the eagle approach crossing the north gate's walk.
    for (let z = -9.9; z < S.back - .9; z += 1.6) for (const [a, b] of [[S.inner, S.inner + .35], [S.outer - .35, S.outer]]) shell(a, b, walkTop + S.terrace, walkTop + S.terrace + .9, z, z + .8)
    // Tall body over the walk passage, then the gallery-level front room.
    shell(S.inner, S.outer, walkTop, eave, S.back, S.wallBack)
    shell(S.inner, S.outer, Math.min(crown, floor) - 1.1, eave, S.wallBack, S.partition)
    const end = side * G.towerOuter
    add('rail', [end - (side > 0 ? rail : 0), floor, S.partition, end + (side < 0 ? rail : 0), floor + G.railHeight, G.deckFront], side)
    const outerSkin = S.outer - S.skin
    shell(outerSkin, S.outer, floor, floor + G.railHeight, S.partition, frontZ)
    shell(outerSkin, S.outer, floor + S.windowHead, eave, S.partition, frontZ)
    for (const [z0, z1] of [[S.partition, .5], [1.6, 2.5], [3.6, frontZ]]) shell(outerSkin, S.outer, floor, eave, z0, z1)
    shell(S.inner, S.outer, floor, floor + G.railHeight, frontZ, S.front)
    shell(S.inner, S.outer, floor + S.windowHead, eave, frontZ, S.front)
    for (const [x0, x1] of [[S.inner, 7.9], [9.6, 11.2], [12.9, S.outer]]) shell(x0, x1, floor, eave, frontZ, S.front)
    // Gallery-side opening into the front room: the head matches the gallery ceiling.
    shell(S.inner, S.inner + .3, ceiling, eave, S.partition, frontZ)
    const [rx0, rx1] = span(S.inner - .3, G.towerOuter + .35)
    add('roof', [rx0, eave, S.back - .3, rx1, eave + rise, S.front + .3], side)
    const statue = gatehouseStatueSite(house, side, style)
    const ledge = GATEHOUSE_STATUE[style].ledge
    add('perch', [statue.x - ledge, statue.y - (style === 'roman' ? .7 : 1.3), S.front, statue.x + ledge, statue.top + .1,
      style === 'roman' ? S.front + .6 : S.front + .95], side)
    const cx = side * (S.inner + S.outer) / 2
    if (style === 'viking') {
      // Lynx finial on the outward gable, and carved lynx on the tall body's town face.
      add('trim', [cx - .5, eave + rise - .25, S.front, cx + .5, eave + rise + 1.9, S.front + 1.1], side)
      add('trim', [cx - .5, walkTop + S.terrace + .2, S.back - .8, cx + .5, eave - .2, S.back], side)
      // Knee braces from the timber portal posts to the main beam.
      const [bx0, bx1] = span(5.5, S.portal)
      add('brace', [bx0, 5.5, G.deckFront, bx1, VIKING_PORTAL_HEAD, G.deckFront + .3], side)
    }
  }
  // Gallery between the towers: front parapet, posts and its own roof only.
  add('rail', [-S.inner, floor, frontZ, S.inner, floor + G.railHeight, G.deckFront])
  for (const x of [-5.85, 0, 5.85]) add('post', [x - .12, floor, G.deckFront - .25, x + .12, ceiling, G.deckFront - .01])
  add('roof', [-S.inner, ceiling, G.deckBack - .6, S.inner, ceiling + 1.6, G.deckFront + .38])
  // Solid structure between the native portal and the gallery floor, plus the
  // entablature/main beam carried across it. The portal clearance is unchanged.
  const top = floor - .35
  // Body-solid masonry stays well below the walk, where riders come up the
  // tower-span slopes onto this level; the rest up to the slab is fill.
  const solidTop = floor - 1.2
  if (style === 'roman') {
    for (let x = -S.portal; x < S.portal - 1e-6; x += .5) {
      const intrados = Math.max(romanPortalIntrados(x), romanPortalIntrados(x + .5))
      add('vault', [x, intrados, S.baseBack, x + .5, Math.max(intrados + .1, solidTop), G.deckFront + .15])
    }
    add('roof', [-6.2, ceiling, 1.9, 6.2, ceiling + 3.2, G.deckFront + .6])
  } else {
    add('vault', [-S.portal, VIKING_PORTAL_HEAD, S.baseBack, S.portal, Math.max(VIKING_PORTAL_HEAD + .1, solidTop), G.deckFront + .35])
  }
  add('fill', [-S.portal, solidTop, S.baseBack, S.portal, top, G.deckFront + .15])
  add('trim', [-S.inner, floor - 1, G.deckFront, S.inner, top, G.deckFront + .35])
  return parts
}

export function townGatehouseObstacle(house: TownGatehouse, local: GatehouseBox, overhead: boolean): ObstacleData {
  const [x0, y0, z0, x1, y1, z1] = local, { gate, groundY } = house
  const box = new Box3(new Vector3(x0, y0, z0), new Vector3(x1, y1, z1))
    .applyMatrix4(new Matrix4().makeRotationY(gate.yaw)).translate(new Vector3(gate.x, groundY, gate.z))
  return { box, isBarricade: false, ...(overhead ? { navigationPassable: true } : {}) }
}
