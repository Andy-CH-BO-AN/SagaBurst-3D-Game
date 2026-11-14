import { Box3, Matrix4, Vector3 } from 'three'
import { getTerrainHeight, getWalkRampHeight, type ObstacleData, type WalkRampSurface } from '../world/Terrain'
import { townGatePoint, type TownGateSpec } from './TownLayout'

// Gate-local +Z faces out. The rampart walk (z -11.2..-1.2) runs straight into
// the gallery over the gate; siege dock approaches (|x| >= 17m) stay outside.
export const TOWN_GATEHOUSE = {
  towerCenter: 11.25, towerInner: 8.8, towerOuter: 13.8,
  /** Merged walk: rampart outer edge to gallery front. */
  deckRear: -1.2, deckBack: 0, deckFront: 4.1, galleryCenter: 2,
  railThickness: .24, railHeight: 1.05, headroom: 3.7, slab: .35,
} as const

/** Towers straddle the curtain: footing from the wall to past the gallery, upper
 * rooms above the floor, and a partition toward the covered rampart walk. The
 * outer face stays at towerOuter so the siege docks (|x|>=17, half width 3)
 * keep their clearance. Between the towers the walk is one open level. */
export const GATEHOUSE_SHELL = {
  inner: 8.75, outer: TOWN_GATEHOUSE.towerOuter, front: 4.9, back: -1.25, partition: -.5, skin: .35, portal: 7,
  /** Tower eave above the walk floor. */
  eave: TOWN_GATEHOUSE.headroom + 3.3, windowHead: 3.3,
  /** Exterior collision envelope of the tower footing, including plinth and trim. */
  footFront: 5.15, footOuter: 13.95,
} as const
/** One roof over the whole merged level between the towers (gallery and
 * rampart walk), with posts only in the inner safety-rail line. */
export const GATEHOUSE_WALK_ROOF = {
  innerLine: -11.04, back: -11, front: 4.48, half: 8.8,
  innerPosts: [-4.4, 0, 4.4], post: .24, beam: .35,
} as const
/** Lower town-side half of each tower, straddling the rampart walk: an open
 * storey the walk passes through along the wall, under a lean-to roof that
 * rises to the tall front half. Kept low for the eagle approaches over the
 * walk (north gate). */
export const GATEHOUSE_WING = { townFace: -11.45, face: .25, eave: TOWN_GATEHOUSE.headroom + .2, top: TOWN_GATEHOUSE.headroom + 1.7, lintel: TOWN_GATEHOUSE.headroom + .05 } as const
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

export interface TownGatehouse {
  readonly gate: TownGateSpec
  readonly groundY: number
  readonly floorY: number
  /** Gallery and the strip joining it to the rampart walk, one level at floorY. */
  readonly deck: WalkRampSurface
  /** Native crown where the walk leaves each tower span ([-x side, +x side]). */
  readonly crownY: readonly [number, number]
  /** Covered rampart walk: world eave height and the real deck height at each inner post. */
  readonly walkRoof: { readonly eaveY: number; readonly inner: readonly number[] }
}

type Point = { x: number; y: number; z: number }
type GatehouseBox = [x0: number, y0: number, z0: number, x1: number, y1: number, z1: number]
export type GatehouseRole = 'base' | 'rail' | 'post' | 'roof' | 'vault' | 'shell' | 'perch' | 'brace' | 'trim' | 'cover' | 'beam'
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
  const G = TOWN_GATEHOUSE, R = GATEHOUSE_WALK_ROOF, groundY = getTerrainHeight(gate.x, gate.z)
  const mid = (G.deckRear + G.deckFront) / 2
  const deck = walkSurface(gatehousePoint(gate, -G.towerOuter, mid, floorY), gatehousePoint(gate, G.towerOuter, mid, floorY), G.deckFront - G.deckRear)
  const sample = (x: number, z: number) => { const p = gatehousePoint(gate, x, z, 0); return ringHeight(p.x, p.z) }
  const crown = (x: number) => {
    const y = sample(x, -6.2)
    if (y === null) throw new Error(`Missing gatehouse rampart at ${gate.id}:${x}`)
    return y
  }
  const crownY = [crown(-G.towerOuter), crown(G.towerOuter)] as const
  const inner = R.innerPosts.map(x => sample(x, R.innerLine) ?? floorY)
  // Between the towers the walk is the merged floor; sample the roof's own edges too.
  const walk = [...inner]
  for (const x of [-R.half, 0, R.half]) for (const z of [-1.6, -6.2, R.innerLine]) { const y = sample(x, z); if (y !== null) walk.push(y) }
  const walkRoof = { eaveY: Math.max(floorY, ...walk) + G.headroom, inner }
  return { gate, groundY, floorY, deck, crownY, walkRoof }
}

/** Only actual elevated gallery points qualify; the portal underneath never enters this layer. */
export function gatehouseSection(house: TownGatehouse, p: Point): 'gallery' | null {
  if (Math.max(Math.abs(p.x - house.gate.x), Math.abs(p.z - house.gate.z)) > TOWN_GATEHOUSE.towerOuter + 5) return null
  const y = getWalkRampHeight(house.deck, p.x, p.z)
  return y !== null && Math.abs(y - p.y) < 1.3 ? 'gallery' : null
}

/** Permanent openings of the rampart's outer parapet, in local X: the merged walk between the towers. */
export function gatehouseRailOpenings(): readonly (readonly [number, number])[] {
  return [[-GATEHOUSE_SHELL.inner, GATEHOUSE_SHELL.inner]]
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

/** Pitched roof over the covered rampart walk, gate-local (y above the gate ground). */
export function gatehouseWalkRoof(house: TownGatehouse, style: TownGatehouseStyle) {
  const R = GATEHOUSE_WALK_ROOF, eave = house.walkRoof.eaveY - house.groundY, rise = style === 'roman' ? 1.9 : 2.6
  return { x0: -R.half, x1: R.half, z0: R.back, z1: R.front, cz: (R.back + R.front) / 2, halfSpan: (R.front - R.back) / 2, eave, rise, ridge: eave + rise }
}

/** Local solids shared by the visual dressing and real body/projectile collision.
 * Only the tower footings and portal returns block the ground grid; the portal
 * itself keeps the native arch/lintel clearance and the upper parts never
 * project into ground A*. */
export function townGatehouseParts(house: TownGatehouse, style: TownGatehouseStyle = 'roman'): GatehousePart[] {
  const G = TOWN_GATEHOUSE, S = GATEHOUSE_SHELL, floor = house.floorY - house.groundY
  const parts: GatehousePart[] = []
  const add = (role: GatehouseRole, box: GatehouseBox, side?: TownGatehouseSide) => parts.push({ role, box, overhead: role !== 'base', ...(side ? { side } : {}) })
  const rail = G.railThickness
  const ceiling = floor + G.headroom, eave = floor + S.eave, rise = gatehouseRoofRise(style)
  for (const side of GATEHOUSE_SIDES) {
    const span = (a: number, b: number): [number, number] => side < 0 ? [-b, -a] : [a, b]
    const low = gatehousePoint(house.gate, side * G.towerCenter, -.9, 0), high = gatehousePoint(house.gate, side * G.towerCenter, S.footFront, 0)
    const bottom = Math.min(0, getTerrainHeight(low.x, low.z) - house.groundY, getTerrainHeight(high.x, high.z) - house.groundY) - .8
    // The tower footing bites into the curtain and carries the upper rooms.
    const [fx0, fx1] = span(S.inner, S.footOuter)
    add('base', [fx0, bottom, .2, fx1, floor - .4, S.footFront], side)
    // Portal return between the native jamb and the tower: a solid passage wall.
    const [px0, px1] = span(S.portal, S.inner)
    add('base', [px0, bottom, 1.2, px1, floor - .4, G.deckFront + .15], side)
    const end = side * G.towerOuter
    add('rail', [end - (side > 0 ? rail : 0), floor, S.partition, end + (side < 0 ? rail : 0), floor + G.railHeight, G.deckFront], side)
    // Upper room shell. The partition stands over the rampart's outer parapet,
    // where the walk ramps back down to the native crown inside the tower span.
    const shell = (a: number, b: number, y0: number, y1: number, z0: number, z1: number) => { const [x0, x1] = span(a, b); add('shell', [x0, y0, z0, x1, y1, z1], side) }
    const crown = house.crownY[side < 0 ? 0 : 1] - house.groundY
    shell(S.inner, S.outer, Math.min(crown, floor) - 1.1, eave, S.back, S.partition)
    const outerSkin = S.outer - S.skin, frontZ = G.deckFront - rail
    shell(outerSkin, S.outer, floor, floor + G.railHeight, S.partition, frontZ)
    shell(outerSkin, S.outer, floor + S.windowHead, eave, S.partition, frontZ)
    for (const [z0, z1] of [[S.partition, .5], [1.6, 2.5], [3.6, frontZ]]) shell(outerSkin, S.outer, floor, eave, z0, z1)
    shell(S.inner, S.outer, floor, floor + G.railHeight, frontZ, S.front)
    shell(S.inner, S.outer, floor + S.windowHead, eave, frontZ, S.front)
    for (const [x0, x1] of [[S.inner, 9.45], [10.65, 11.9], [13.1, S.outer]]) shell(x0, x1, floor, eave, frontZ, S.front)
    // Gallery-side opening: the head matches the gallery ceiling.
    shell(S.inner, S.inner + .3, ceiling, eave, S.partition, frontZ)
    // Town-side wing over the rampart walk: open along the wall (the walk
    // passes through), piers in the town face, lean-to roof up to the tall half.
    const W = GATEHOUSE_WING, deckUnder = Math.min(crown, floor) - .55
    for (const [a, b] of [[S.inner, S.inner + .6], [(S.inner + S.outer) / 2 - .3, (S.inner + S.outer) / 2 + .3], [S.outer - .6, S.outer]]) {
      shell(a, b, deckUnder, floor + W.eave, W.townFace, W.townFace + W.face)
    }
    shell(S.inner, S.outer, floor + W.lintel, floor + W.eave, W.townFace, W.townFace + W.face)
    for (const [a, b] of [[S.inner, S.inner + .3], [S.outer - .3, S.outer]]) shell(a, b, floor + W.lintel, floor + W.eave, W.townFace, S.back)
    const [wx0, wx1] = span(S.inner - .15, S.footOuter)
    for (let z = W.townFace; z < S.back - 1e-6; z += .5) {
      const z1 = Math.min(S.back, z + .5), t = (z1 - W.townFace) / (S.back - W.townFace)
      add('cover', [wx0, floor + W.eave, z, wx1, floor + W.eave + (W.top - W.eave) * t + .3, z1], side)
    }
    if (style === 'viking') {
      // Knee braces in the town-face openings, outside the walk.
      for (const x of [S.inner + .6, (S.inner + S.outer) / 2 - .3, (S.inner + S.outer) / 2 + .3, S.outer - .6]) {
        const toward = x < (S.inner + S.outer) / 2 ? 1 : -1, [b0, b1] = span(Math.min(x, x + toward * .9), Math.max(x, x + toward * .9))
        add('brace', [b0, floor + W.lintel - .9, W.townFace, b1, floor + W.lintel, W.townFace + W.face], side)
      }
    }
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
      // Carved lynx on the tall half's town face, above the wing roof.
      add('trim', [cx - .5, floor + GATEHOUSE_WING.top + .2, S.back - .8, cx + .5, eave - .2, S.back], side)
      // Knee braces from the timber portal posts to the main beam.
      const [bx0, bx1] = span(5.5, S.portal)
      add('brace', [bx0, 5.5, G.deckFront, bx1, VIKING_PORTAL_HEAD, G.deckFront + .3], side)
    }
  }
  // Only the gallery front keeps a parapet; its rear is open onto the rampart walk.
  add('rail', [-G.towerOuter, floor, G.deckFront - rail, G.towerOuter, floor + G.railHeight, G.deckFront])
  for (const x of [-13.5, -9.03, -5.85, 0, 5.85, 9.03, 13.5]) {
    const y = Math.abs(x) > G.towerInner ? floor + G.headroom + 1.05 : floor + G.headroom
    add('post', [x - .12, floor, G.deckFront - .25, x + .12, y, G.deckFront - .01])
  }
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
  // One roof over the whole merged level between the towers, gallery included.
  const R = GATEHOUSE_WALK_ROOF, roof = gatehouseWalkRoof(house, style), coverEave = roof.eave
  // Collision follows the pitched roof in short slices (panel, boards and snow
  // included), so the walk below and the flight airspace above stay exact.
  for (let z = roof.z0; z < roof.z1 - 1e-6; z += .5) {
    const z1 = Math.min(roof.z1, z + .5), d = Math.max(0, Math.min(Math.abs(z - roof.cz), Math.abs(z1 - roof.cz), z <= roof.cz && z1 >= roof.cz ? 0 : Infinity))
    add('cover', [roof.x0 - .3, roof.eave, z, roof.x1 + .3, roof.eave + roof.rise * (1 - d / roof.halfSpan) + .35, z1])
  }
  const half = R.post / 2
  add('beam', [-S.inner, coverEave - R.beam, R.innerLine - .16, S.inner, coverEave, R.innerLine + .16])
  R.innerPosts.forEach((x, i) => add('post', [x - half, house.walkRoof.inner[i] - house.groundY, R.innerLine - half, x + half, coverEave - R.beam, R.innerLine + half]))
  return parts
}

export function townGatehouseObstacle(house: TownGatehouse, local: GatehouseBox, overhead: boolean): ObstacleData {
  const [x0, y0, z0, x1, y1, z1] = local, { gate, groundY } = house
  const box = new Box3(new Vector3(x0, y0, z0), new Vector3(x1, y1, z1))
    .applyMatrix4(new Matrix4().makeRotationY(gate.yaw)).translate(new Vector3(gate.x, groundY, gate.z))
  return { box, isBarricade: false, ...(overhead ? { navigationPassable: true } : {}) }
}
