/**
 * Pure building plans for the Roman and Viking Town architecture.
 *
 * Every plan is authored in building-local metres: origin at the footprint
 * centre on the terrain sampled there, local +Z is the front/door side (the
 * same convention as TownRules.townSitePoint: side = x, forward = z). Visual
 * builders read the same dimension tables, so the colliders, floors, entrance
 * and NPC anchors below describe exactly what is drawn.
 *
 * No Three.js objects are created here; the data is used by placement, the DEV
 * showcase and contract tests.
 */
export type ArchitectureFaction = 'roman' | 'viking'
export type CivicBuildingKind = 'town-center' | 'hr-center' | 'weapons' | 'stable' | 'home-a' | 'home-b' | 'home-c'
export const CIVIC_BUILDING_KINDS: readonly CivicBuildingKind[] = ['town-center', 'hr-center', 'weapons', 'stable', 'home-a', 'home-b', 'home-c']

/** [minX, minY, minZ, maxX, maxY, maxZ]; minY <= DEEP means "down to the foundation base". */
export type LocalBox = readonly [number, number, number, number, number, number]
export const DEEP = -2
export interface LocalRect { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number }
/** `post`: a thin interior post that is solid for bodies and arrows but finer than the 2m navigation grid,
 * so it never seals off the bays between post rows (local steering slides around it). */
export type ColliderRole = 'wall' | 'column' | 'post' | 'prop' | 'statue' | 'roof' | 'overhead'
export interface ArchitectureCollider {
  readonly box: LocalBox
  readonly role: ColliderRole
}
export type AnchorRole = 'officer' | 'recruit' | 'npc' | 'merchant' | 'horse' | 'service'
/** Town Center residents who serve indoors; ids of their `service` anchors are `service:<role>`. */
export type TownCenterServiceRole = 'captain' | 'deployment' | 'commander'
export const TOWN_CENTER_SERVICE_ROLES: readonly TownCenterServiceRole[] = ['captain', 'deployment', 'commander']
/** Body radius a mounted service officer needs on its anchor (mount collision radius plus margin). */
export const SERVICE_ANCHOR_CLEARANCE = 1.2
/** Free radius a mounted Town Center officer (Captain, Commander) needs to turn in place on its post. */
export const SERVICE_MOUNT_TURN_RADIUS = 2.4

/** Building-local (side = x, forward = z) → world, the same mapping as TownRules.townSitePoint. */
export function architectureLocalToWorld(site: { x: number; z: number; yaw: number }, x: number, z: number): { x: number; z: number } {
  return { x: site.x + Math.cos(site.yaw) * x + Math.sin(site.yaw) * z, z: site.z - Math.sin(site.yaw) * x + Math.cos(site.yaw) * z }
}
/** Seen by a player walking in through the front door: Captain on the left, Sergeant centre, Commander on the right. */
function serviceAnchors(points: Readonly<Record<TownCenterServiceRole, readonly [number, number]>>): ArchitectureAnchor[] {
  return TOWN_CENTER_SERVICE_ROLES.map(role => ({ id: `service:${role}`, x: points[role][0], z: points[role][1], yaw: 0, role: 'service' as const }))
}
/** Generic gathering anchors keep clear of the service officers. */
function apartFrom(service: readonly ArchitectureAnchor[], anchors: ArchitectureAnchor[], gap = 2.4): ArchitectureAnchor[] {
  return anchors.filter(anchor => service.every(s => Math.hypot(s.x - anchor.x, s.z - anchor.z) >= gap))
}
export interface ArchitectureAnchor { readonly id: string; readonly x: number; readonly z: number; readonly yaw: number; readonly role: AnchorRole }
export interface ArchitectureEntrance {
  /** Threshold centre on the floor edge, facing outward along `yaw` (0 = local +Z). */
  readonly x: number; readonly z: number; readonly yaw: number
  /** Clear walking width of the doorway/steps and the door's clear height above the floor. */
  readonly width: number; readonly doorWidth: number; readonly height: number
  /** Horizontal run of the steps/ramp outward from the threshold to the ground. */
  readonly approach: number
  /** Gentle ramp: placement shortens `approach` (the authored maximum run) to the
   * shortest run whose rise over the real terrain stays within this rise/run. */
  readonly gradient?: number
}
export interface BuildingSpec {
  readonly faction: ArchitectureFaction
  readonly kind: CivicBuildingKind
  readonly label: string
  /** Original Town occupancy (body, porch, attachments); the new building stays inside it. */
  readonly envelope: LocalRect
  /** Nominal floor top above the centre terrain; placement lifts it over higher ground. */
  readonly floorY: number
  /** Walkable floor slabs at floorY (interior, portico, stalls). */
  readonly floor: readonly LocalRect[]
  readonly entrance: ArchitectureEntrance
  readonly additionalEntrances?: readonly ArchitectureEntrance[]
  /** Public interior where NPCs may later gather; absent for closed residences. */
  readonly interior?: LocalRect
  /** Corridor from the doorway into the main room that must stay clear. */
  readonly aisle?: LocalRect
  readonly anchors: readonly ArchitectureAnchor[]
  readonly colliders: readonly ArchitectureCollider[]
  /** Structural top above the floor (used for airspace review and showcase). */
  readonly height: number
  readonly maxHp: number
}

const rect = (minX: number, maxX: number, minZ: number, maxZ: number): LocalRect => ({ minX, maxX, minZ, maxZ })
const solid = (minX: number, minZ: number, maxX: number, maxZ: number, top: number, role: ColliderRole = 'wall'): ArchitectureCollider =>
  ({ box: [minX, DEEP, minZ, maxX, top, maxZ], role })
const above = (minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, role: ColliderRole = 'overhead'): ArchitectureCollider =>
  ({ box: [minX, minY, minZ, maxX, maxY, maxZ], role })
const post = (x: number, z: number, half: number, top: number, role: ColliderRole = 'column'): ArchitectureCollider =>
  solid(x - half, z - half, x + half, z + half, top, role)
/**
 * Stepped collision under a pitched roof. Bands follow the slope (lowest point
 * of each band) so tall interiors keep their headroom for riders and the camera.
 */
function pitchedRoof(axis: 'x' | 'z', centre: number, from: number, to: number, halfSpan: number, eave: number, ridge: number, bands = 5): ArchitectureCollider[] {
  const result: ArchitectureCollider[] = []
  for (let k = 0; k < bands; k++) {
    const inner = halfSpan * k / bands, outer = halfSpan * (k + 1) / bands, y = ridge - (ridge - eave) * outer / halfSpan
    const ranges = k === 0 ? [[-outer, outer]] : [[-outer, -inner], [inner, outer]]
    for (const [lo, hi] of ranges) result.push(axis === 'x'
      ? above(from, y, centre + lo, to, ridge, centre + hi, 'roof') : above(centre + lo, y, from, centre + hi, ridge, to, 'roof'))
  }
  return result
}
const mirrored = <T>(make: (side: number) => T[]): T[] => [...make(-1), ...make(1)]

/* ───────────────────────────── Roman ───────────────────────────── */

/**
 * Principia/forum hall inside the shared 40 × 36m Town Center frame (local X ±20,
 * Z -22…14 incl. the ramp). One storey: a tall nave behind a central high arch
 * and four-column pedimented portico, lower red wings on both sides of the front,
 * a tower at the right rear and the council table at the far end of the nave.
 */
export const ROMAN_TOWN_CENTER = {
  F: .6,
  /** Nave: 18m wide, front wall face at z = 4. `eave` is the wall top above the floor. */
  hall: { halfX: 9, back: -20, front: 4, wall: .8, eave: 11.4 },
  door: { half: 3, height: 6.5 },
  portico: { front: 8, columnZ: 7.2, columnX: [4.3, 7.8], columnR: .6, columnTop: 10.6, entablature: 11.4 },
  roof: { eave: 11.4, ridge: 16, back: -20.4, front: 8.9, halfSpan: 9.4 },
  /** Tie beams of the open timber trusses; their underside is the nave's lowest clearance. */
  truss: { z: [-17, -12, -7, -2, 2], bottom: 10.2, depth: .35 },
  wing: { inner: 9, outer: 18.5, back: -14, front: 3.6, top: 7.3, rise: 2.4 },
  tower: { minX: 9, maxX: 15, minZ: -20, maxZ: -14, top: 17, rise: 2.6 },
  ramp: { half: 4.5, cheek: .7, cheekFront: 10.5, maxApproach: 6 },
  statues: { x: 10.6, z: 6.4, pedestal: 1.4, pedestalTop: .9, height: 2.8 },
  table: { half: 3.6, back: -17.4, front: -16.2, top: 1.05 },
  braziers: { x: 5.2, z: -16.8 },
} as const

export const ROMAN_HR_CENTER = {
  F: .5,
  body: { halfX: 8, back: -6.5, front: 4.5, wall: .6, top: 6.2 },
  door: { half: 2.2, height: 4.8 },
  // Short portico so the steps get a 2.4m run (mount-friendly) inside the same footprint.
  portico: { halfX: 3.8, front: 5.9, columnX: 3.1, columnZ: 5.35, columnR: .42, eave: 6.6, rise: 2.4 },
  wingRoof: { rise: 1.5 },
  alcoves: { x: 5.9, half: 1.3, height: 3.6 },
  steps: { half: 3.4, front: 8.3 },
  statues: { x: 5.9, z: 5.6, pedestal: 1.2, pedestalTop: 1.3 },
  desk: { half: 2.6, back: -4.6, front: -3.6, top: 1.05 },
} as const

export const ROMAN_WEAPONS = {
  F: .45,
  body: { halfX: 5.5, back: -5, front: 4.6, wall: .5, top: 4.6 },
  arch: { half: 3.2, spring: 2.6, rise: 1.6 },
  roof: { halfSpan: 6, rise: 2.4, back: -5.4, front: 5.2 },
  corner: { x: 4.9, z: 5.05, r: .38 },
  canopy: { front: 9, postX: 5.75, postZ: 8.9, halfX: 6, minY: 5.6, wallY: 6.1 },
  tables: { x: 3.8, z: 7.2, halfX: 1.3, halfZ: .7, top: 1.15 },
} as const

export const ROMAN_STABLE = {
  F: .5,
  rear: { z0: -5.5, z1: -5.0 },
  side: { inner: 6.7, outer: 7.2 },
  front: 5.5,
  columns: { z: 5.25, r: .13 },
  arcade: { spring: 3.0, top: 4.0, entablature: 4.6 },
  clerestory: { back: -2.5, front: 1.5, top: 6.2, rise: 1.2 },
  porch: { front: 9.7, postX: 7.25, postZ: 9.5, low: 3.6, high: 4.4 },
  dividers: { back: -4.9, front: 3.0, top: 1.6 },
  basin: { minX: 6.55, maxX: 7.2, minZ: 7.6, maxZ: 9.0, top: 1.0 },
} as const

export const ROMAN_HOMES = {
  F: .35,
  a: { halfX: 3.6, back: -3.6, front: 2.2, top: 3.4, porchHalf: 1.8, porchFront: 3.9, columnX: 1.5, columnZ: 3.6 },
  b: { main: { minX: -4.4, maxX: 1.6, back: -3.8, front: 3.8, top: 6.6 }, shop: { minX: 1.6, maxX: 4.4, back: -3.8, front: 1.6, top: 3.4 },
    loggiaFront: .4, awning: { front: 3.6, y: 2.8 } },
  c: { rear: { back: -3.9, front: -.9, top: 6.2 }, left: { minX: -4.4, maxX: -1.6, front: 3.9, top: 3.6 },
    wall: { top: 2.2, t: .3, front: 3.9 }, gate: { minX: .4, maxX: 2.4 }, fountain: { x: 1.4, z: 1.4, r: .75 } },
} as const

/* ───────────────────────────── Viking ───────────────────────────── */

/**
 * Lord's longhouse inside the shared 40 × 36m frame: a 36m hall under one long
 * transverse thatch ridge, with a barely projecting cross-gable porch at the
 * centre of the long front wall. One storey; the porch and the lowest beams are
 * raised together so the hall reads tall from the doorway.
 */
export const VIKING_TOWN_CENTER = {
  F: .5,
  hall: { halfX: 17.4, back: -20, front: 1.6, wall: .6, top: 6.2 },
  roof: { ridge: 16.6, overhang: 1.0, frontCut: 12.4 },
  porch: { halfX: 6.6, front: 5, top: 8, eave: 7.7, ridge: 13, overhang: .6 },
  door: { half: 3, height: 5.5 },
  doorPosts: { x: 3.35, r: .32, height: 6.1 },
  /** Lowest timber over the walkway: porch tie beam and the two post-row beams. */
  beams: { bottom: 7.8, depth: .35 },
  ramp: { half: 4.5, curb: .5, curbFront: 7.5, maxApproach: 9 },
  posts: { x: [-13.4, -9, -4.6, 4.6, 9, 13.4], z: [-14, -4.4], r: .34 },
  hearths: { inner: 9.6, outer: 12.6, back: -10.4, front: -8 },
  tables: { inner: 14.2, outer: 16.2, back: -17, front: -3 },
  seat: { half: 1.6, back: -19.4, front: -18, top: 2.2 },
  statues: { x: 10, z: 3, base: 1.0, height: 2.6 },
  braziers: { x: 5.5, z: 6.8 },
} as const

export const VIKING_HR_CENTER = {
  F: .45,
  body: { halfX: 5, back: -10.4, front: 9.6, wall: .45, top: 4.0 },
  gallery: { x: 6.1, z: [-9, -5.6, -2.2, 1.2, 4.6, 8], r: .26 },
  roof: { eaveX: 6.5, eaveY: 3.0, ridge: 8.6, back: -10.9, front: 10.0 },
  door: { half: 2.1, height: 3.8 },
  steps: { half: 3, front: 10.9 },
  table: { half: 2, back: -8.4, front: -7.4 },
  racks: { inner: 4.1, z0: -6, z1: -1 },
  longTables: { minX: 2.4, maxX: 3.4, back: -5, front: -1 },
  statues: { x: 3.7, z: 10.5, base: .9 },
} as const

export const VIKING_WEAPONS = {
  F: .45,
  house: { minX: -5.5, maxX: .6, back: -5, front: 3.6, top: 3.4, ridge: 8.0 },
  forge: { minX: .6, maxX: 5.5, back: -5, front: 3.0, ridge: 7.0 },
  chimney: { x: 3.2, z: -4.1, top: 8.4 },
  canopy: { back: 4.2, front: 9.2, postX: 5.75, postZ: [4.4, 8.9], minY: 5.6, ridge: 7.2 },
  tables: ROMAN_WEAPONS.tables,
} as const

export const VIKING_STABLE = {
  F: .5,
  rear: { z0: -5.5, z1: -5.05 },
  side: { inner: 6.75, outer: 7.2 },
  roof: { ridgeZ: -.6, ridge: 7.6, rearEaveZ: -6.0, rearEave: 2.6, frontEaveZ: 5.6, frontEave: 3.7 },
  posts: { z: 5.4, r: .16 },
  porch: { front: 9.7, postX: 7.25, postZ: 9.5, low: 3.3 },
  dividers: { back: -4.9, front: 3.0, top: 1.6 },
  trough: ROMAN_STABLE.basin,
  basket: { x: -6.9, z: 9.0 },
} as const

export const VIKING_HOMES = {
  F: .35,
  a: { halfX: 3.4, back: -4.6, front: 3.0, top: 2.8, ridge: 7.2, roofHalf: 4.2, porchHalf: 1.4, porchFront: 4.8 },
  b: { halfX: 3.9, back: -5.0, front: 3.4, top: 1.6, ridge: 5.6, roofHalf: 4.5 },
  c: { halfX: 3.6, back: -5.4, front: 1.6, top: 4.6, ridge: 10, annex: { minX: -3.0, maxX: 2.0, front: 4.4, top: 2.4 },
    sidePorch: { minZ: -2.0, maxZ: .4, outer: 4.5 }, garden: { minX: -4.4, maxX: -.4, back: 4.6, front: 6.0 } },
} as const

/* ───────────────────────────── Plans ───────────────────────────── */

/** Local Town Center frame shared by both factions: 40 × 36m including the entrance ramp. */
export const TOWN_CENTER_ENVELOPE: LocalRect = rect(-20, 20, -22, 14)

/**
 * Town Center anchors: the three service officers, the hall officer and gathering
 * NPCs. Gathering spots keep clear of the officers, of the mounted officers'
 * turning circles and of the main aisle.
 */
function townCenterAnchors(officer: readonly [number, number], service: readonly ArchitectureAnchor[], candidates: readonly (readonly [number, number])[],
  aisleHalf: number): ArchitectureAnchor[] {
  const mounted = service.filter(a => a.id !== 'service:deployment')
  const gathering: ArchitectureAnchor[] = []
  for (const [x, z] of candidates) for (const side of [-1, 1]) {
    const px = side * x
    if (Math.abs(px) - .45 < aisleHalf) continue
    if (mounted.some(m => Math.hypot(m.x - px, m.z - z) < SERVICE_MOUNT_TURN_RADIUS + .45)) continue
    gathering.push({ id: `hall-${side < 0 ? 'w' : 'e'}-${x}-${z}`, x: px, z, yaw: -side * Math.PI / 2, role: 'npc' })
  }
  return [{ id: 'hall-officer', x: officer[0], z: officer[1], yaw: 0, role: 'officer' }, ...service, ...apartFrom(service, gathering)]
}

function romanTownCenter(): BuildingSpec {
  const c = ROMAN_TOWN_CENTER, h = c.hall, top = c.F + h.eave, F = c.F
  const innerX = h.halfX - h.wall, innerBack = h.back + h.wall, wallBack = h.front - h.wall
  const colliders: ArchitectureCollider[] = [
    // Long front: nave wall either side of the arch, then the lower wings out to ±18.5m.
    ...mirrored(side => [solid(side < 0 ? -h.halfX : c.door.half, wallBack, side < 0 ? -c.door.half : h.halfX, h.front, top)]),
    above(-c.door.half, F + c.door.height, wallBack, c.door.half, top, h.front),
    ...mirrored(side => [solid(side < 0 ? -h.halfX : innerX, h.back, side < 0 ? -innerX : h.halfX, h.front, top)]),
    solid(-h.halfX, h.back, h.halfX, innerBack, top),
    ...mirrored(side => [solid(side < 0 ? -c.wing.outer : c.wing.inner, c.wing.back, side < 0 ? -c.wing.inner : c.wing.outer, c.wing.front, F + c.wing.top)]),
    solid(c.tower.minX, c.tower.minZ, c.tower.maxX, c.tower.maxZ, F + c.tower.top),
    ...mirrored(side => c.portico.columnX.map(x => post(side * x, c.portico.columnZ, c.portico.columnR, F + c.portico.columnTop))),
    above(-c.roof.halfSpan, F + c.portico.columnTop, c.portico.columnZ - .8, c.roof.halfSpan, F + c.portico.entablature, c.portico.front),
    ...c.truss.z.map(z => above(-innerX, F + c.truss.bottom, z - .2, innerX, F + c.truss.bottom + c.truss.depth, z + .2)),
    ...mirrored(side => [solid(side < 0 ? -c.ramp.half - c.ramp.cheek : c.ramp.half, c.portico.front, side < 0 ? -c.ramp.half : c.ramp.half + c.ramp.cheek, c.ramp.cheekFront, F + .5, 'prop')]),
    ...mirrored(side => [post(side * c.statues.x, c.statues.z, c.statues.pedestal / 2, F + c.statues.pedestalTop + c.statues.height, 'statue')]),
    solid(-c.table.half, c.table.back, c.table.half, c.table.front, F + c.table.top, 'prop'),
    ...mirrored(side => [post(side * c.braziers.x, c.braziers.z, .38, F + 1.4, 'prop')]),
    ...pitchedRoof('z', 0, c.roof.back, c.roof.front, c.roof.halfSpan, F + c.roof.eave, F + c.roof.ridge),
    ...mirrored(side => [above(side < 0 ? -c.wing.outer - .4 : c.wing.inner, F + c.wing.top, c.wing.back - .4,
      side < 0 ? -c.wing.inner : c.wing.outer + .4, F + c.wing.top + c.wing.rise, c.wing.front + .4, 'roof')]),
    above(c.tower.minX - .4, F + c.tower.top, c.tower.minZ - .4, c.tower.maxX + .4, F + c.tower.top + c.tower.rise, c.tower.maxZ + .4, 'roof'),
  ]
  // Walking in, Captain left, Sergeant just right of the door axis before the council table, Commander right.
  const service = serviceAnchors({ captain: [-5.4, -9.5], deployment: [1.8, -12.8], commander: [5.4, -9.5] })
  const sergeant = service.find(a => a.id === 'service:deployment')!
  const anchors = townCenterAnchors([0, -18.3], service, [4.4, 7.0].flatMap(x => [-14.6, -4.6, -1.4, 1.6].map(z => [x, z] as const)), c.door.half)
  return {
    faction: 'roman', kind: 'town-center', label: '羅馬城鎮中心 · Principia',
    envelope: TOWN_CENTER_ENVELOPE, floorY: F,
    floor: [rect(-h.halfX, h.halfX, h.back, c.portico.front)],
    entrance: { x: 0, z: c.portico.front, yaw: 0, width: c.ramp.half * 2, doorWidth: c.door.half * 2, height: c.door.height,
      approach: c.ramp.maxApproach, gradient: .1 },
    interior: rect(-innerX, innerX, innerBack, wallBack),
    // Continuous 6m walkway from the ramp foot through the arch to the Sergeant.
    aisle: rect(-c.door.half, c.door.half, sergeant.z + SERVICE_ANCHOR_CLEARANCE + .2, c.portico.front + c.ramp.maxApproach),
    anchors, colliders, height: c.tower.top + c.tower.rise + .4, maxHp: 900,
  }
}

function romanHrCenter(): BuildingSpec {
  const c = ROMAN_HR_CENTER, b = c.body, top = c.F + b.top
  const innerX = b.halfX - b.wall, innerBack = b.back + b.wall, innerFront = b.front - b.wall
  const colliders: ArchitectureCollider[] = [
    ...mirrored(side => [solid(side < 0 ? -b.halfX : c.door.half, innerFront, side < 0 ? -c.door.half : b.halfX, b.front, top)]),
    above(-c.door.half, c.F + c.door.height, innerFront, c.door.half, top, b.front),
    ...mirrored(side => [solid(side < 0 ? -b.halfX : innerX, b.back, side < 0 ? -innerX : b.halfX, b.front, top)]),
    solid(-b.halfX, b.back, b.halfX, innerBack, top),
    ...mirrored(side => [post(side * c.portico.columnX, c.portico.columnZ, c.portico.columnR, c.F + c.portico.eave)]),
    ...mirrored(side => [post(side * c.statues.x, c.statues.z, c.statues.pedestal / 2, c.statues.pedestalTop + 2.6, 'statue')]),
    solid(-c.desk.half, c.desk.back, c.desk.half, c.desk.front, c.F + c.desk.top, 'prop'),
    ...mirrored(side => [solid(side < 0 ? -innerX : innerX - .55, -4.2, side < 0 ? -innerX + .55 : innerX, 2.2, c.F + 2.2, 'prop')]),
    ...mirrored(side => [solid(side < 0 ? -6.4 : 3.6, 1.8, side < 0 ? -3.6 : 6.4, 2.3, c.F + .5, 'prop')]),
    above(-b.halfX - .4, top, b.back - .4, b.halfX + .4, c.F + c.portico.eave + c.portico.rise, c.portico.front, 'roof'),
  ]
  const anchors: ArchitectureAnchor[] = [{ id: 'hr-recruiter', x: 0, z: -5.2, yaw: 0, role: 'officer' }]
  for (const side of [-1, 1]) for (const x of [2.4, 4.0]) for (const z of [-2.2, -.6, 1.0])
    anchors.push({ id: `hr-recruit-${side < 0 ? 'w' : 'e'}-${x}-${z}`, x: side * x, z, yaw: Math.PI, role: 'recruit' })
  return {
    faction: 'roman', kind: 'hr-center', label: '羅馬徵募大廳 · HR',
    // HRLayout reserves width + 2.4m, so the eaves may reach ±8.6m.
    envelope: rect(-8.6, 8.6, -6.9, 8.6), floorY: c.F,
    floor: [rect(-b.halfX, b.halfX, b.back, b.front), rect(-c.portico.halfX, c.portico.halfX, b.front, c.portico.front)],
    entrance: { x: 0, z: c.portico.front, yaw: 0, width: c.steps.half * 2, doorWidth: c.door.half * 2, height: c.door.height, approach: c.steps.front - c.portico.front },
    interior: rect(-innerX, innerX, innerBack, innerFront), aisle: rect(-1.4, 1.4, c.desk.front, c.portico.front),
    anchors, colliders, height: c.portico.eave + c.portico.rise + .4, maxHp: 900,
  }
}

function romanWeapons(): BuildingSpec {
  const c = ROMAN_WEAPONS, b = c.body, top = c.F + b.top, inner = b.front - b.wall
  const colliders: ArchitectureCollider[] = [
    ...mirrored(side => [solid(side < 0 ? -b.halfX : c.arch.half, inner, side < 0 ? -c.arch.half : b.halfX, b.front, top)]),
    above(-c.arch.half, c.F + c.arch.spring + c.arch.rise, inner, c.arch.half, top, b.front),
    ...mirrored(side => [solid(side < 0 ? -b.halfX : b.halfX - b.wall, b.back, side < 0 ? -b.halfX + b.wall : b.halfX, b.front, top)]),
    solid(-b.halfX, b.back, b.halfX, b.back + b.wall, top),
    ...mirrored(side => [post(side * c.corner.x, c.corner.z, c.corner.r, top)]),
    solid(-5, b.back + b.wall, -2.6, -3.2, c.F + 1.2, 'prop'),
    post(-.6, -1.2, .45, c.F + .95, 'prop'), post(1.5, -1.4, .45, c.F + .7, 'prop'),
    solid(.9, -4.5 + .0, 3.7, -4.0, c.F + 2.2, 'prop'),
    solid(3.8, -2.2, 4.95, .6, c.F + 1.4, 'prop'),
    ...mirrored(side => [solid(side * c.tables.x - c.tables.halfX, c.tables.z - c.tables.halfZ, side * c.tables.x + c.tables.halfX, c.tables.z + c.tables.halfZ, c.F + c.tables.top, 'prop')]),
    ...mirrored(side => [post(side * c.canopy.postX, c.canopy.postZ, .14, c.F + c.canopy.minY)]),
    above(-c.roof.halfSpan, top, c.roof.back, c.roof.halfSpan, c.F + b.top + c.roof.rise, c.roof.front, 'roof'),
  ]
  return {
    faction: 'roman', kind: 'weapons', label: '羅馬軍械工坊', envelope: rect(-6, 6, -5.6, 9.2), floorY: c.F,
    floor: [rect(-b.halfX, b.halfX, b.back, b.front)],
    entrance: { x: 0, z: b.front, yaw: 0, width: c.arch.half * 2, doorWidth: c.arch.half * 2, height: c.arch.spring + c.arch.rise, approach: .8 },
    anchors: [{ id: 'merchant', x: 0, z: 7.5, yaw: 0, role: 'merchant' }], colliders, height: b.top + c.roof.rise + 3.4, maxHp: 300,
  }
}

const STABLE_STALLS = [0, 1, 2, 3, 4].map(i => -5.2 + i * 2.6)
function stableAnchors(): ArchitectureAnchor[] {
  return STABLE_STALLS.map((x, i) => ({ id: `stall-${i}`, x, z: 1, yaw: 0, role: 'horse' as const }))
}
function romanStable(): BuildingSpec {
  const c = ROMAN_STABLE
  const colliders: ArchitectureCollider[] = [
    solid(-c.side.outer, c.rear.z0, c.side.outer, c.rear.z1, c.F + c.clerestory.top),
    ...mirrored(side => [solid(side < 0 ? -c.side.outer : c.side.inner, c.rear.z0, side < 0 ? -c.side.inner : c.side.outer, c.front, c.F + c.clerestory.top)]),
    ...[1, 2, 3, 4].map(i => solid(-6.5 + i * 2.6 - .08, c.dividers.back, -6.5 + i * 2.6 + .08, c.dividers.front, c.F + c.dividers.top, 'prop')),
    ...[1, 2, 3, 4].map(i => post(-6.5 + i * 2.6, c.columns.z, c.columns.r, c.F + c.arcade.spring)),
    above(-c.side.outer, c.F + c.arcade.spring, c.columns.z - .3, c.side.outer, c.F + c.arcade.entablature, c.front),
    ...STABLE_STALLS.map(x => solid(x - .95, c.rear.z1, x + .95, c.rear.z1 + .55, c.F + 1.0, 'prop')),
    ...mirrored(side => [post(side * c.porch.postX, c.porch.postZ, .14, c.F + c.porch.low)]),
    solid(c.basin.minX, c.basin.minZ, c.basin.maxX, c.basin.maxZ, c.F + c.basin.top, 'prop'),
    above(-c.side.outer, c.F + c.arcade.entablature, c.rear.z0, c.side.outer, c.F + c.clerestory.top + c.clerestory.rise, c.front, 'roof'),
    above(-c.side.outer, c.F + c.porch.low, c.front, c.side.outer, c.F + c.porch.high + .3, c.porch.front, 'roof'),
  ]
  return {
    faction: 'roman', kind: 'stable', label: '羅馬馬廄', envelope: rect(-7.5, 7.5, -5.7, 9.8), floorY: c.F,
    floor: [rect(-c.side.inner, c.side.inner, c.rear.z1, c.front)],
    // The porch is a gentle ramp so horses can also walk back into their stalls.
    entrance: { x: 0, z: c.front, yaw: 0, width: 13, doorWidth: 2.34, height: c.arcade.spring, approach: c.porch.front - c.front - .2 },
    anchors: stableAnchors(), colliders, height: c.clerestory.top + c.clerestory.rise, maxHp: 300,
  }
}

function romanHome(kind: 'home-a' | 'home-b' | 'home-c'): BuildingSpec {
  const h = ROMAN_HOMES, F = h.F
  let colliders: ArchitectureCollider[], height: number, entrance: ArchitectureEntrance, floor: LocalRect
  if (kind === 'home-a') {
    const a = h.a
    colliders = [solid(-a.halfX, a.back, a.halfX, a.front, F + a.top),
      ...mirrored(side => [post(side * a.columnX, a.columnZ, .2, F + a.top)]),
      above(-a.halfX - .4, F + a.top, a.back - .4, a.halfX + .4, F + a.top + 1.9, a.front + .4, 'roof')]
    height = a.top + 1.9; floor = rect(-a.halfX, a.halfX, a.back, a.porchFront)
    entrance = { x: 0, z: a.porchFront, yaw: 0, width: 2.4, doorWidth: 1.4, height: 2.3, approach: .5 }
  } else if (kind === 'home-b') {
    const b = h.b
    colliders = [solid(b.main.minX, b.main.back, b.main.maxX, b.main.front, F + b.main.top),
      solid(b.shop.minX, b.shop.back, b.shop.maxX, b.shop.front, F + b.shop.top),
      solid(b.shop.minX, b.shop.back, b.shop.maxX, b.loggiaFront, F + b.main.top - .2),
      ...[2.0, 4.1].map(x => post(x, b.awning.front - .15, .08, F + b.awning.y)),
      solid(2.0, 2.0, 4.2, 3.2, F + 1.1, 'prop'),
      above(b.main.minX - .4, F + b.main.top, b.main.back - .4, b.main.maxX + .4, F + b.main.top + 1.7, b.main.front + .4, 'roof')]
    height = b.main.top + 1.7; floor = rect(b.main.minX, b.shop.maxX, b.main.back, b.main.front)
    entrance = { x: -1.4, z: b.main.front, yaw: 0, width: 2.2, doorWidth: 1.4, height: 2.5, approach: .5 }
  } else {
    const c = h.c
    colliders = [solid(-4.4, c.rear.back, 4.4, c.rear.front, F + c.rear.top),
      solid(c.left.minX, c.rear.front, c.left.maxX, c.left.front, F + c.left.top),
      solid(c.left.maxX, c.wall.front - c.wall.t, c.gate.minX, c.wall.front, F + c.wall.top),
      solid(c.gate.maxX, c.wall.front - c.wall.t, 4.4, c.wall.front, F + c.wall.top),
      solid(4.4 - c.wall.t, c.rear.front, 4.4, c.wall.front, F + c.wall.top),
      post(c.fountain.x, c.fountain.z, c.fountain.r, F + 1.3, 'prop'),
      ...[-1.0, 1.0, 3.0].map(x => post(x, -.55, .15, F + 3.2)),
      post(3.7, 3.1, .35, F + 4, 'prop'),
      above(-4.8, F + c.rear.top, c.rear.back - .4, 4.8, F + c.rear.top + 1.6, c.rear.front + .4, 'roof')]
    height = c.rear.top + 1.6; floor = rect(-4.4, 4.4, c.rear.back, c.wall.front)
    entrance = { x: (c.gate.minX + c.gate.maxX) / 2, z: c.wall.front, yaw: 0, width: 2.0, doorWidth: 2.0, height: 2.6, approach: .5 }
  }
  return { faction: 'roman', kind, label: { 'home-a': '羅馬平民住屋 A', 'home-b': '羅馬雙層街屋 B', 'home-c': '羅馬庭院宅 C' }[kind],
    // Body 9×8 plus the original eaves overhang.
    envelope: rect(-4.8, 4.8, -4.4, 4.4), floorY: F, floor: [floor], entrance, anchors: [], colliders, height, maxHp: 300 }
}

/** Front-slope cut of the longhouse roof over the porch, shared by the plan and the builder. */
export function vikingTownCenterRoofCut() {
  const c = VIKING_TOWN_CENTER, h = c.hall, p = c.porch
  const cz = (h.back + h.front) / 2, span = (h.front - h.back) / 2 + c.roof.overhang
  const ridgeY = c.F + c.roof.ridge, eaveY = c.F + h.top - .5, cutY = c.F + c.roof.frontCut
  /** Front-slope z at a given height. */
  const zAt = (y: number) => cz + (ridgeY - y) / (ridgeY - eaveY) * span
  // The porch roof runs back until its ridge is buried in the main slope, leaving no open valley.
  return { cz, span, ridgeY, eaveY, cutY, cutZ: zAt(cutY), porchBack: zAt(c.F + p.ridge + .6), px: p.halfX + p.overhang, zAt }
}

function vikingTownCenter(): BuildingSpec {
  const c = VIKING_TOWN_CENTER, h = c.hall, p = c.porch, F = c.F, top = F + h.top
  const innerX = h.halfX - h.wall, innerBack = h.back + h.wall, pIn = p.halfX - h.wall, pBack = p.front - h.wall
  const cut = vikingTownCenterRoofCut()
  const colliders: ArchitectureCollider[] = [
    solid(-h.halfX, h.back, h.halfX, innerBack, top),
    ...mirrored(side => [solid(side < 0 ? -h.halfX : innerX, h.back, side < 0 ? -innerX : h.halfX, h.front, top)]),
    // Long front wall either side of the porch.
    ...mirrored(side => [solid(side < 0 ? -h.halfX : p.halfX, h.front - h.wall, side < 0 ? -p.halfX : h.halfX, h.front, top)]),
    ...mirrored(side => [solid(side < 0 ? -p.halfX : pIn, h.front - h.wall, side < 0 ? -pIn : p.halfX, p.front, F + p.top)]),
    ...mirrored(side => [solid(side < 0 ? -p.halfX : c.door.half, pBack, side < 0 ? -c.door.half : p.halfX, p.front, F + p.top)]),
    above(-c.door.half, F + c.door.height, pBack, c.door.half, F + p.top, p.front),
    // Carved door posts stand in the wall face, just outside the 6m opening.
    ...mirrored(side => [post(side * c.doorPosts.x, p.front - .15, c.doorPosts.r, F + c.doorPosts.height)]),
    // Porch tie beam and the two post-row beams: the walkway's lowest timber.
    above(-pIn, F + c.beams.bottom, h.front + .9, pIn, F + c.beams.bottom + c.beams.depth, h.front + 1.3),
    ...c.posts.z.map(z => above(-innerX, F + c.beams.bottom, z - .18, innerX, F + c.beams.bottom + c.beams.depth, z + .18)),
    ...c.posts.x.flatMap(x => c.posts.z.map(z => post(x, z, c.posts.r, F + c.beams.bottom, 'post'))),
    ...mirrored(side => [solid(side < 0 ? -c.hearths.outer : c.hearths.inner, c.hearths.back, side < 0 ? -c.hearths.inner : c.hearths.outer, c.hearths.front, F + .55, 'prop')]),
    ...mirrored(side => [solid(side < 0 ? -c.tables.outer : c.tables.inner, c.tables.back, side < 0 ? -c.tables.inner : c.tables.outer, c.tables.front, F + .95, 'prop')]),
    solid(-c.seat.half, c.seat.back, c.seat.half, c.seat.front, F + c.seat.top, 'prop'),
    ...mirrored(side => [solid(side < 0 ? -c.ramp.half - c.ramp.curb : c.ramp.half, p.front, side < 0 ? -c.ramp.half : c.ramp.half + c.ramp.curb, c.ramp.curbFront, F + .45, 'prop')]),
    ...mirrored(side => [post(side * c.braziers.x, c.braziers.z, .45, F + 1.6, 'prop')]),
    ...mirrored(side => [post(side * c.statues.x, c.statues.z, c.statues.base / 2, F + .2 + c.statues.height, 'statue')]),
    ...longhouseRoof(),
    ...pitchedRoof('z', 0, cut.porchBack, p.front + p.overhang, cut.px, F + p.eave, F + p.ridge),
  ]
  /** Main roof bands; over the porch the front slope stops at the cut, matching the drawn roof. */
  function longhouseRoof(): ArchitectureCollider[] {
    return pitchedRoof('x', cut.cz, -h.halfX - .7, h.halfX + .7, cut.span, cut.eaveY, cut.ridgeY).flatMap(band => {
      const [x0, y0, z0, x1, y1, z1] = band.box
      if (z0 < cut.cz || y0 >= cut.cutY) return [band]
      return [above(x0, y0, z0, -cut.px, y1, z1, 'roof'), above(cut.px, y0, z0, x1, y1, z1, 'roof'), above(-cut.px, cut.cutY, z0, cut.px, y1, z1, 'roof')]
    })
  }
  // Captain and Commander stand in the bays between the post rows; the Sergeant just right of the door axis.
  const service = serviceAnchors({ captain: [-6.2, -9.2], deployment: [1.8, -12.4], commander: [6.2, -9.2] })
  const sergeant = service.find(a => a.id === 'service:deployment')!
  const anchors = townCenterAnchors([0, -17.2], service, [[7, -16.4], [11.2, -16.4], [7, -2.2], [11.2, -2.2], [11.2, -6.4], [11.2, -12.2]], c.door.half)
  return {
    faction: 'viking', kind: 'town-center', label: '維京領主長屋 · Longhouse', envelope: TOWN_CENTER_ENVELOPE, floorY: F,
    floor: [rect(-h.halfX, h.halfX, h.back, h.front), rect(-p.halfX, p.halfX, h.front, p.front)],
    entrance: { x: 0, z: p.front, yaw: 0, width: c.ramp.half * 2, doorWidth: c.door.half * 2, height: c.door.height,
      approach: c.ramp.maxApproach, gradient: .1 },
    interior: rect(-innerX, innerX, innerBack, h.front - h.wall),
    aisle: rect(-c.door.half, c.door.half, sergeant.z + SERVICE_ANCHOR_CLEARANCE + .2, p.front + c.ramp.maxApproach),
    anchors, colliders, height: c.roof.ridge + 1.8, maxHp: 900,
  }
}

function vikingHrCenter(): BuildingSpec {
  const c = VIKING_HR_CENTER, b = c.body, top = c.F + b.top
  const innerX = b.halfX - b.wall, innerBack = b.back + b.wall, innerFront = b.front - b.wall
  const colliders: ArchitectureCollider[] = [
    solid(-b.halfX, b.back, b.halfX, innerBack, top),
    ...mirrored(side => [solid(side < 0 ? -b.halfX : innerX, b.back, side < 0 ? -innerX : b.halfX, b.front, top)]),
    ...mirrored(side => [solid(side < 0 ? -b.halfX : c.door.half, innerFront, side < 0 ? -c.door.half : b.halfX, b.front, top)]),
    above(-c.door.half, c.F + c.door.height, innerFront, c.door.half, top, b.front),
    ...mirrored(side => c.gallery.z.map(z => post(side * c.gallery.x, z, c.gallery.r, c.F + c.roof.eaveY))),
    solid(-c.table.half, c.table.back, c.table.half, c.table.front, c.F + 1.0, 'prop'),
    ...mirrored(side => [solid(side < 0 ? -innerX : c.racks.inner, c.racks.z0, side < 0 ? -c.racks.inner : innerX, c.racks.z1, c.F + 2.2, 'prop')]),
    ...mirrored(side => [solid(side < 0 ? -c.longTables.maxX : c.longTables.minX, c.longTables.back, side < 0 ? -c.longTables.minX : c.longTables.maxX, c.longTables.front, c.F + .95, 'prop')]),
    ...mirrored(side => [solid(side < 0 ? -c.steps.half - .3 : c.steps.half, b.front, side < 0 ? -c.steps.half : c.steps.half + .3, c.steps.front, c.F + .5, 'prop')]),
    ...mirrored(side => [post(side * c.statues.x, c.statues.z, c.statues.base / 2, c.F + 2.9, 'statue')]),
    ...pitchedRoof('z', 0, c.roof.back, c.roof.front + .3, c.roof.eaveX + .3, c.F + c.roof.eaveY - .25, c.F + c.roof.ridge),
  ]
  const anchors: ArchitectureAnchor[] = [{ id: 'hr-recruiter', x: 0, z: -9.1, yaw: 0, role: 'officer' }]
  for (const side of [-1, 1]) for (const x of [2.4, 3.8]) for (const z of [1.2, 3.4, 5.6])
    anchors.push({ id: `hr-recruit-${side < 0 ? 'w' : 'e'}-${x}-${z}`, x: side * x, z, yaw: Math.PI, role: 'recruit' })
  return {
    faction: 'viking', kind: 'hr-center', label: '維京戰士徵募大廳 · HR', // HRLayout reserves width + 2.4m around the 13×22 body.
    envelope: rect(-6.9, 6.9, -11.2, 11.2), floorY: c.F,
    floor: [rect(-b.halfX, b.halfX, b.back, b.front)],
    entrance: { x: 0, z: b.front, yaw: 0, width: c.steps.half * 2, doorWidth: c.door.half * 2, height: c.door.height, approach: c.steps.front - b.front },
    interior: rect(-innerX, innerX, innerBack, innerFront), aisle: rect(-1.3, 1.3, c.table.front, b.front),
    anchors, colliders, height: c.roof.ridge + 1.6, maxHp: 900,
  }
}

function vikingWeapons(): BuildingSpec {
  const c = VIKING_WEAPONS, h = c.house, f = c.forge, top = c.F + h.top
  const colliders: ArchitectureCollider[] = [
    solid(h.minX, h.back, h.maxX, h.front, top),
    solid(f.minX, f.back, f.maxX, f.back + .5, c.F + 3.0),
    solid(f.maxX - .4, f.back, f.maxX, f.front, c.F + 3.0),
    post(f.maxX - .2, f.front - .2, .2, c.F + 3.0),
    solid(1.8, f.back + .5, 4.6, -3.4, c.F + 1.1, 'prop'),
    post(c.chimney.x, c.chimney.z, .65, c.F + c.chimney.top),
    post(3.0, -1.2, .45, c.F + .95, 'prop'), solid(4.4, -1.0, 5.1, -.2, c.F + .8, 'prop'),
    ...mirrored(side => [solid(side * c.tables.x - c.tables.halfX, c.tables.z - c.tables.halfZ, side * c.tables.x + c.tables.halfX, c.tables.z + c.tables.halfZ, c.F + c.tables.top, 'prop')]),
    ...mirrored(side => c.canopy.postZ.map(z => post(side * c.canopy.postX, z, .17, c.F + c.canopy.minY))),
    above(h.minX - .5, top, h.back - .4, f.maxX + .5, c.F + h.ridge, h.front + .4, 'roof'),
    above(-6, c.F + c.canopy.minY, c.canopy.back, 6, c.F + c.canopy.ridge, c.canopy.front, 'roof'),
  ]
  return {
    faction: 'viking', kind: 'weapons', label: '維京鐵匠鋪', envelope: rect(-6, 6, -5.6, 9.2), floorY: c.F,
    floor: [rect(h.minX, f.maxX, h.back, h.front)],
    entrance: { x: 2.85, z: h.front, yaw: 0, width: 4.2, doorWidth: 4.2, height: 3.0, approach: .8 },
    anchors: [{ id: 'merchant', x: 0, z: 7.5, yaw: 0, role: 'merchant' }], colliders, height: h.ridge + 1.6, maxHp: 300,
  }
}

function vikingStable(): BuildingSpec {
  const c = VIKING_STABLE, r = c.roof
  const colliders: ArchitectureCollider[] = [
    solid(-c.side.outer, c.rear.z0, c.side.outer, c.rear.z1, c.F + r.rearEave + .4),
    ...mirrored(side => [solid(side < 0 ? -c.side.outer : c.side.inner, c.rear.z0, side < 0 ? -c.side.inner : c.side.outer, r.frontEaveZ, c.F + r.ridge)]),
    ...[1, 2, 3, 4].map(i => solid(-6.5 + i * 2.6 - .1, c.dividers.back, -6.5 + i * 2.6 + .1, c.dividers.front, c.F + c.dividers.top, 'prop')),
    ...[1, 2, 3, 4].map(i => post(-6.5 + i * 2.6, c.posts.z, c.posts.r, c.F + r.frontEave)),
    ...STABLE_STALLS.map(x => solid(x - .95, c.rear.z1, x + .95, c.rear.z1 + .55, c.F + 1.0, 'prop')),
    ...mirrored(side => [post(side * c.porch.postX, c.porch.postZ, .16, c.F + c.porch.low)]),
    solid(c.trough.minX, c.trough.minZ, c.trough.maxX, c.trough.maxZ, c.F + .8, 'prop'),
    post(c.basket.x, c.basket.z, .32, c.F + 1.5, 'prop'),
    above(-c.side.outer, c.F + r.rearEave, r.rearEaveZ, c.side.outer, c.F + r.ridge, r.frontEaveZ, 'roof'),
    above(-c.side.outer, c.F + c.porch.low, r.frontEaveZ, c.side.outer, c.F + r.frontEave + .3, c.porch.front, 'roof'),
  ]
  return {
    faction: 'viking', kind: 'stable', label: '維京馬廄', envelope: rect(-7.5, 7.5, -6.1, 9.8), floorY: c.F,
    floor: [rect(-c.side.inner, c.side.inner, c.rear.z1, r.frontEaveZ)],
    entrance: { x: 0, z: r.frontEaveZ, yaw: 0, width: 13, doorWidth: 2.28, height: r.frontEave, approach: c.porch.front - r.frontEaveZ - .2 },
    anchors: stableAnchors(), colliders, height: r.ridge + 1.5, maxHp: 300,
  }
}

function vikingHome(kind: 'home-a' | 'home-b' | 'home-c'): BuildingSpec {
  const h = VIKING_HOMES, F = h.F
  let colliders: ArchitectureCollider[], height: number, entrance: ArchitectureEntrance, floor: LocalRect
  if (kind === 'home-a') {
    const a = h.a
    colliders = [solid(-a.halfX, a.back, a.halfX, a.front, F + a.top),
      ...mirrored(side => [post(side * (a.porchHalf - .15), a.porchFront - .2, .15, F + 2.4)]),
      post(2.4, -2.5, .6, F + a.ridge + .4),
      solid(-4.5, -2, -a.halfX, 1, F + 1.6, 'prop'),
      post(3.0, 4.4, .4, F + .8, 'prop'),
      ...mirrored(side => [solid(side < 0 ? -4.45 : 3.2, 5.6, side < 0 ? -3.2 : 4.45, 5.9, F + 1.1, 'prop')]),
      above(-a.roofHalf, F + a.top, a.back - .4, a.roofHalf, F + a.ridge, a.front + .4, 'roof')]
    height = a.ridge + 1.6; floor = rect(-a.halfX, a.halfX, a.back, a.front)
    entrance = { x: 0, z: a.front, yaw: 0, width: 2.4, doorWidth: 1.3, height: 2.1, approach: 1.8 }
  } else if (kind === 'home-b') {
    const b = h.b
    colliders = [solid(-b.halfX, b.back, b.halfX, b.front, F + b.top + .4),
      solid(2.4, 3.6, 4.4, 4.8, F + 1.4, 'prop'), solid(-4.4, 3.8, -2.4, 4.4, F + 2.0, 'prop'),
      above(-b.roofHalf, F + b.top, b.back - .6, b.roofHalf, F + b.ridge, b.front + .6, 'roof')]
    height = b.ridge + .6; floor = rect(-b.halfX, b.halfX, b.back, b.front)
    entrance = { x: 0, z: b.front, yaw: 0, width: 1.8, doorWidth: 1.4, height: 1.9, approach: .6 }
  } else {
    const c = h.c
    colliders = [solid(-c.halfX, c.back, c.halfX, c.front, F + c.top),
      solid(c.annex.minX, c.front, c.annex.maxX, c.annex.front, F + c.annex.top),
      ...[c.sidePorch.minZ, c.sidePorch.maxZ].map(z => post(c.sidePorch.outer - .15, z, .14, F + 2.6)),
      post(-2.6, -4.2, .55, F + c.ridge),
      solid(c.garden.minX, c.garden.back, c.garden.maxX, c.garden.front, F + .7, 'prop'),
      above(-4.4, F + c.top, c.back - .4, 4.4, F + c.ridge, c.front + .4, 'roof')]
    height = c.ridge + 1.6; floor = rect(-c.halfX, c.halfX, c.back, c.front)
    entrance = { x: c.halfX, z: (c.sidePorch.minZ + c.sidePorch.maxZ) / 2, yaw: Math.PI / 2, width: 2.0, doorWidth: 1.3, height: 2.2, approach: .6 }
  }
  return { faction: 'viking', kind, label: { 'home-a': '維京木造民宅 A', 'home-b': '維京茅草矮屋 B', 'home-c': '維京家庭高屋 C' }[kind],
    envelope: rect(-4.7, 4.7, -6.2, 6.2), floorY: F, floor: [floor], entrance, anchors: [], colliders, height, maxHp: 300 }
}

/** Formal HR encloses the unchanged deployment slots; previews keep the small plan. */
export interface HRHallLayout {
  readonly body: LocalRect
  readonly wall: number
  readonly eave: number
  readonly ridge: number
  readonly portals: readonly ArchitectureEntrance[]
  readonly muster: readonly { x: number; z: number }[]
  readonly desk: LocalRect
  readonly rack: { x: number; z: number; length: number; yaw: number }
  readonly extraRack: { x: number; z: number; length: number; yaw: number; footprint: LocalRect }
  readonly windows: readonly number[]
  readonly wallDisplays: readonly { x: number; z: number; yaw: number; width: number; shield: boolean; id: string }[]
  readonly furniture: readonly { rect: LocalRect; height: number; kind: 'bench' | 'table' }[]
  readonly statues: readonly { x: number; z: number; half: number }[]
}
/** Surviving raised-floor edges retain navigation guidance when walls collapse. */
export function hrFloorNavigationEdges(hall: Pick<HRHallLayout, 'body' | 'portals'>): LocalRect[] {
  const b = hall.body, edges = [rect(b.minX, b.minX, b.minZ, b.maxZ),
    rect(b.maxX, b.maxX, b.minZ, b.maxZ), rect(b.minX, b.maxX, b.minZ, b.minZ)]
  let from = b.minX
  for (const e of [...hall.portals].sort((a, b) => a.x - b.x)) {
    edges.push(rect(from, e.x - e.width / 2, b.maxZ, b.maxZ))
    from = e.x + e.width / 2
  }
  edges.push(rect(from, b.maxX, b.maxZ, b.maxZ))
  return edges.filter(edge => edge.minX <= edge.maxX)
}

/** Full doorway-to-interior corridors, including each real approach and rider clearance. */
export function architectureRuinCorridors(spec: BuildingSpec): LocalRect[] {
  return [spec.entrance, ...spec.additionalEntrances ?? []].map(e => {
    const forwardX = Math.sin(e.yaw), forwardZ = Math.cos(e.yaw), rightX = forwardZ, rightZ = -forwardX
    const inside = spec.interior
    const back = inside ? Math.min(...[inside.minX, inside.maxX].flatMap(x => [inside.minZ, inside.maxZ]
      .map(z => (x - e.x) * forwardX + (z - e.z) * forwardZ))) : -1.5
    const half = e.doorWidth / 2 + 1, front = e.approach + 1
    const corners = [-half, half].flatMap(side => [back, front].map(along => ({
      x: e.x + side * rightX + along * forwardX, z: e.z + side * rightZ + along * forwardZ })))
    return rect(Math.min(...corners.map(p => p.x)), Math.max(...corners.map(p => p.x)),
      Math.min(...corners.map(p => p.z)), Math.max(...corners.map(p => p.z)))
  })
}
export function expandedHrCenter(faction: ArchitectureFaction, muster: readonly { x: number; z: number }[]): { hall: HRHallLayout; spec: BuildingSpec } {
  const base = architectureSpec(faction, 'hr-center'), roman = faction === 'roman'
  const original = roman ? ROMAN_HR_CENTER.body : VIKING_HR_CENTER.body
  const xs = muster.map(p => p.x), zs = muster.map(p => p.z)
  const body = { minX: Math.min(-original.halfX, ...xs.map(x => x - 3)), maxX: Math.max(original.halfX, ...xs.map(x => x + 3)),
    minZ: Math.min(original.back, ...zs.map(z => z - 3)), maxZ: Math.max(original.front, ...zs.map(z => z + 3)) }
  const wall = original.wall, F = base.floorY, eave = 6.7, ridge = 11.4
  // Flush thresholds remove the raised porch's two projecting slab corners.
  // The approach now meets the doorway directly, without an exposed high side.
  const portals = [0, (Math.min(...xs) + Math.max(...xs)) / 2].map(x => ({ x, z: body.maxZ, yaw: 0,
    width: 8.4, doorWidth: 6.4, height: 6.2, approach: 3.5 }))
  const desk = rect(-2.6, 2.6, body.minZ + 2.3, body.minZ + 3.3)
  const serviceSide = portals[1].x > 0 ? -1 : 1
  const windows = [-6, 0, 6]
  // The low blade rack occupies the bay between two windows, away from tables.
  const rack = { x: serviceSide < 0 ? body.minX + wall + .7 : body.maxX - wall - .7,
    z: (windows[1] + windows[2]) / 2, length: windows[2] - windows[1] - 1.8, yaw: -serviceSide * Math.PI / 2 }
  const rackMinX = serviceSide < 0 ? desk.maxX + .8 : Math.max(...xs) + 2.8
  const rackMaxX = serviceSide < 0 ? Math.min(...xs) - 2.8 : desk.minX - .8
  const extraRack = { x: (rackMinX + rackMaxX) / 2, z: body.minZ + wall + .3,
    length: rackMaxX - rackMinX, yaw: 0, footprint: rect(rackMinX, rackMaxX, body.minZ + wall + .15, body.minZ + wall + 1.65) }
  const furniture = [-1, 1].map(side => roman
    ? { rect: rect(side * 4 - 1.2, side * 4 + 1.2, 7, 7.5), height: .5, kind: 'bench' as const }
    : { rect: rect(side * 2.9 - .5, side * 2.9 + .5, -5, -1), height: .9, kind: 'table' as const })
  const statues = [-1, 1].map(side => ({ x: side * (roman ? 5.9 : 4.8), z: body.maxZ + .7, half: roman ? .6 : .45 }))
  const wallDisplays: HRHallLayout['wallDisplays'][number][] = []
  const weapons = roman ? ['paladin_sword_t4', 'sword_t5', 'spear_t4', 'byzantine_standard_lance_t5', 'bow_t5']
    : ['paladin_mace_t4', 'axe_t5', 'spear_t4', 'spear_t5', 'bow_t5']
  const shields = roman ? ['centurion_aquila_shield_t4', 'byzantine_eagle_shield_t5']
    : ['viking_dragonward_shield_t4', 'viking_berserker_shield_t5']
  let weaponIndex = 0, shieldIndex = 0
  const addBays = (from: number, to: number, point: (t: number) => { x: number; z: number; yaw: number },
    excluded: readonly [number, number][]) => {
    const count = Math.floor((to - from) / 3.6)
    for (let i = 0; i < count; i++) {
      const width = Math.min(3, (to - from) / count - .5), t = from + (i + .5) * (to - from) / count
      if (excluded.some(([lo, hi]) => t + width / 2 > lo && t - width / 2 < hi)) continue
      const shield = wallDisplays.length % 3 === 2
      wallDisplays.push({ ...point(t), width, shield, id: shield ? shields[shieldIndex++ % shields.length] : weapons[weaponIndex++ % weapons.length] })
    }
  }
  // Long walls alternate blades, polearms, bows and shields. Rear flags keep
  // their own bays; front doorways and shield jambs retain full clearance.
  addBays(body.minX + wall + 1, body.maxX - wall - 1, x => ({ x, z: body.minZ + wall + .08, yaw: 0 }), portals.map(p => [p.x - 1.4, p.x + 1.4]))
  addBays(body.minX + wall + 1, body.maxX - wall - 1, x => ({ x, z: body.maxZ - wall - .08, yaw: Math.PI }), portals.map(p => [p.x - 4.5, p.x + 4.5]))
  // End-wall bays stay between the actual windows rather than covering them.
  for (const side of [-1, 1]) for (let i = 1; i < windows.length; i++) {
    const z = (windows[i - 1] + windows[i]) / 2, shield = side < 0
    wallDisplays.push({ x: side < 0 ? body.minX + wall + .08 : body.maxX - wall - .08, z,
      yaw: -side * Math.PI / 2, width: windows[i] - windows[i - 1] - 2, shield,
      id: shield ? shields[shieldIndex++ % shields.length] : weapons[weaponIndex++ % weapons.length] })
  }
  const hall: HRHallLayout = { body, wall, eave, ridge, portals, muster, desk, rack, extraRack, windows, wallDisplays, furniture, statues }
  const colliders: ArchitectureCollider[] = [
    solid(body.minX, body.minZ, body.minX + wall, body.maxZ, F + eave),
    solid(body.maxX - wall, body.minZ, body.maxX, body.maxZ, F + eave),
    solid(body.minX + wall, body.minZ, body.maxX - wall, body.minZ + wall, F + eave),
    solid(desk.minX, desk.minZ, desk.maxX, desk.maxZ, F + 1.05, 'prop'),
    solid(rack.x - .5, rack.z - rack.length / 2, rack.x + .5, rack.z + rack.length / 2, F + 2.2, 'prop'),
    solid(extraRack.footprint.minX, extraRack.footprint.minZ, extraRack.footprint.maxX, extraRack.footprint.maxZ, F + 3.6, 'prop'),
    ...furniture.map(p => solid(p.rect.minX, p.rect.minZ, p.rect.maxX, p.rect.maxZ, F + p.height, 'prop')),
    ...statues.map(p => post(p.x, p.z, p.half, F + 3.7, 'statue')),
  ]
  let edge = body.minX + wall
  for (const p of [...portals].sort((a, b) => a.x - b.x)) {
    const half = p.doorWidth / 2
    colliders.push(solid(edge, body.maxZ - wall, p.x - half, body.maxZ, F + eave))
    colliders.push(above(p.x - half, F + p.height, body.maxZ - wall, p.x + half, F + eave, body.maxZ))
    for (const side of [-1, 1]) colliders.push(post(p.x + side * 3.7, body.maxZ - wall / 2, .38, F + eave))
    colliders.push(above(p.x - 4.3, F + eave, body.maxZ - .2, p.x + 4.3, F + eave + 2.4, p.z + 2, 'roof'))
    edge = p.x + half
  }
  colliders.push(solid(edge, body.maxZ - wall, body.maxX - wall, body.maxZ, F + eave))
  // Bound the real sloped panels, rather than filling every eave up to the ridge.
  const cz = (body.minZ + body.maxZ) / 2, half = (body.maxZ - body.minZ) / 2 + .4
  for (let i = 0; i < 8; i++) for (const side of [-1, 1]) {
    const inner = half * i / 8, outer = half * (i + 1) / 8, z0 = cz + side * inner, z1 = cz + side * outer
    colliders.push(above(body.minX - .4, F + ridge - (ridge - eave) * outer / half, Math.min(z0, z1),
      body.maxX + .4, F + ridge - (ridge - eave) * inner / half + .45, Math.max(z0, z1), 'roof'))
    for (const x of [body.minX, body.maxX - wall]) colliders.push(above(x, F + eave, Math.min(z0, z1), x + wall,
      F + ridge - (ridge - eave) * inner / half + .3, Math.max(z0, z1), 'roof'))
  }
  if (!roman) for (let x = body.minX + 1; x < body.maxX; x += 4.5)
    colliders.push(above(x - .15, F + eave - .15, body.minZ, x + .15, F + eave + .15, body.maxZ, 'roof'))
  const floor = [body]
  return { hall, spec: { ...base, label: roman ? '羅馬大型徵募大廳 · HR' : '維京大型戰士徵募長屋 · HR',
    envelope: rect(body.minX - .9, body.maxX + .9, body.minZ - .9, portals[0].z + portals[0].approach),
    floor, entrance: portals[0], additionalEntrances: portals.slice(1),
    interior: rect(body.minX + wall, body.maxX - wall, body.minZ + wall, body.maxZ - wall),
    aisle: rect(-1.4, 1.4, body.minZ + 3.6, portals[0].z),
    anchors: base.anchors.map(a => a.role === 'officer' ? { ...a, z: body.minZ + wall + .8 } : a),
    colliders, height: ridge + 2 } }
}

/** Authored plan for one faction building kind. */
export function architectureSpec(faction: ArchitectureFaction, kind: CivicBuildingKind): BuildingSpec {
  if (faction === 'roman') {
    if (kind === 'town-center') return romanTownCenter()
    if (kind === 'hr-center') return romanHrCenter()
    if (kind === 'weapons') return romanWeapons()
    if (kind === 'stable') return romanStable()
    return romanHome(kind)
  }
  if (kind === 'town-center') return vikingTownCenter()
  if (kind === 'hr-center') return vikingHrCenter()
  if (kind === 'weapons') return vikingWeapons()
  if (kind === 'stable') return vikingStable()
  return vikingHome(kind)
}

/** Twelve Town houses mix three silhouettes, keeping every house ID and footprint. */
export function townHomeVariant(index: number): 'home-a' | 'home-b' | 'home-c' {
  return (['home-a', 'home-b', 'home-c'] as const)[(index * 7 + Math.floor(index / 3)) % 3]
}

/** Original Town body sizes the plans must stay compatible with (TownWorld/TownHRLayout/townHousing). */
export function originalTownFootprint(faction: ArchitectureFaction, kind: CivicBuildingKind): { width: number; depth: number } {
  if (kind === 'town-center') return { width: 24, depth: 20 }
  if (kind === 'weapons') return { width: 11, depth: 10 }
  if (kind === 'stable') return { width: 14, depth: 11 }
  if (kind === 'hr-center') return faction === 'roman' ? { width: 16, depth: 13 } : { width: 13, depth: 22 }
  return faction === 'roman' ? { width: 9, depth: 8 } : { width: 9, depth: 12 }
}

/* ───────────────────────────── Plaza ───────────────────────────── */

export type PlazaPropKind = 'monument' | 'bench' | 'planter' | 'brazier' | 'banner' | 'supplies' | 'runestone'
/** One plaza prop: world XZ centre, facing, and the collision radius it occupies. */
export interface PlazaProp { readonly kind: PlazaPropKind; readonly x: number; readonly z: number; readonly yaw: number; readonly radius: number }

/** Centre of the plaza decoration, in the open column between the authored training squads. */
export const TOWN_PLAZA_MONUMENT = { x: 59, z: 18.5, radius: 2.0 } as const

/**
 * Plaza furniture in world coordinates. The Town plaza is also the infantry
 * training ground, the player's entry point and the Captain's mounted approach,
 * so props only use the gaps between those (south-east corner, the column at
 * x≈59, the row gap east of x=62 and the west edge).
 */
export function townPlazaLayout(faction: ArchitectureFaction): PlazaProp[] {
  const m = TOWN_PLAZA_MONUMENT
  const common: PlazaProp[] = [
    { kind: 'monument', x: m.x, z: m.z, yaw: Math.PI, radius: m.radius },
    { kind: 'bench', x: 59, z: 11.5, yaw: 0, radius: 1.25 },
    { kind: 'bench', x: 59, z: 25.5, yaw: 0, radius: 1.25 },
    { kind: 'brazier', x: 66, z: -2.5, yaw: 0, radius: .5 },
    { kind: 'brazier', x: 35.5, z: 25, yaw: 0, radius: .5 },
    { kind: 'banner', x: 70, z: 1.5, yaw: 0, radius: .2 },
    { kind: 'banner', x: 35.5, z: 20.5, yaw: Math.PI / 2, radius: .2 },
  ]
  return faction === 'roman'
    ? [...common, { kind: 'planter', x: 67.5, z: 20.5, yaw: 0, radius: 1.0 }, { kind: 'planter', x: 72.5, z: 20.5, yaw: 0, radius: 1.0 },
      { kind: 'brazier', x: 72.5, z: -2.5, yaw: 0, radius: .5 }]
    : [...common, { kind: 'runestone', x: 68, z: 20.5, yaw: 0, radius: .8 }, { kind: 'supplies', x: 72.5, z: -1.5, yaw: 0, radius: 1.4 }]
}
