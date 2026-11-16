import * as THREE from 'three'
import type { ObstacleData, WalkRampSurface } from '../world/Terrain'

/**
 * Shared plan of the Roman Colosseum duel arena. Collision, walk surfaces,
 * spawns and visuals all derive from these numbers, so the rendered stone and
 * the physical stands cannot drift apart.
 *
 * Plan: an ellipse with the major axis on world X. Offsets `d` are measured
 * outward along the arena ellipse normal (d = 0 is the arena wall face).
 * The Imperial box (pulvinar) faces the arena from +Z, the main gate is at -Z.
 */
export const COLOSSEUM = Object.freeze({
  arenaA: 30,
  arenaB: 20,
  groundY: 0,
  podiumHeight: 2.6,
  podiumWallThickness: 0.45,
  balustradeHeight: 1,
  terraceDepth: 3.2,
  rowRise: 0.45,
  rowRun: 0.8,
  tiers: Object.freeze([
    Object.freeze({ rows: 12, walkway: 2 }),
    Object.freeze({ rows: 12, walkway: 2 }),
    Object.freeze({ rows: 10, walkway: 3 }),
  ]),
  parapetThickness: 0.6,
  parapetHeight: 1.1,
  /** Visible paved ground kept outside the outer wall; the gameplay ground boundary. */
  apron: 10,
  sectors: 64,
  podiumPieceLength: 0.5,
  facadePieceLength: 0.75,
  stairWidth: 2.6,
  stairSlope: 0.6,
})

export interface ColosseumTier {
  /** Offset where the first row starts. */
  readonly startD: number
  readonly startY: number
  readonly rows: number
  /** Offset where the rows end and the flat walkway starts. */
  readonly endD: number
  readonly endY: number
  readonly walkwayEndD: number
}

export interface ColosseumSection {
  readonly terraceStartD: number
  readonly terraceEndD: number
  readonly tiers: readonly ColosseumTier[]
  /** Inner face of the outer parapet, end of the top gallery. */
  readonly galleryEndD: number
  readonly galleryY: number
  /** Outer face of the facade. */
  readonly outerD: number
  readonly parapetTopY: number
  readonly apronD: number
}

function buildSection(): ColosseumSection {
  let d: number = COLOSSEUM.terraceDepth
  let y: number = COLOSSEUM.podiumHeight
  const tiers: ColosseumTier[] = []
  for (const tier of COLOSSEUM.tiers) {
    const endD = d + tier.rows * COLOSSEUM.rowRun
    const endY = y + tier.rows * COLOSSEUM.rowRise
    tiers.push({ startD: d, startY: y, rows: tier.rows, endD, endY, walkwayEndD: endD + tier.walkway })
    d = endD + tier.walkway
    y = endY
  }
  return {
    terraceStartD: 0,
    terraceEndD: COLOSSEUM.terraceDepth,
    tiers,
    galleryEndD: d,
    galleryY: y,
    outerD: d + COLOSSEUM.parapetThickness,
    parapetTopY: y + COLOSSEUM.parapetHeight,
    apronD: d + COLOSSEUM.parapetThickness + COLOSSEUM.apron,
  }
}

export const COLOSSEUM_SECTION: ColosseumSection = buildSection()

/** Point at ellipse parameter `theta`, offset `d` along the outward normal. */
export function colosseumPoint(theta: number, d: number, target = new THREE.Vector3()): THREE.Vector3 {
  const c = Math.cos(theta), s = Math.sin(theta)
  const nx = c / COLOSSEUM.arenaA, nz = s / COLOSSEUM.arenaB
  const length = Math.hypot(nx, nz)
  return target.set(COLOSSEUM.arenaA * c + nx / length * d, COLOSSEUM.groundY, COLOSSEUM.arenaB * s + nz / length * d)
}

/** Unit outward normal (x, z) of the arena ellipse at parameter `theta`. */
export function colosseumNormal(theta: number): { x: number; z: number } {
  const nx = Math.cos(theta) / COLOSSEUM.arenaA, nz = Math.sin(theta) / COLOSSEUM.arenaB
  const length = Math.hypot(nx, nz)
  return { x: nx / length, z: nz / length }
}

/** Ellipse with the given offset, used for cheap containment questions (not for collision). */
export function insideOffsetEllipse(x: number, z: number, d: number): boolean {
  const a = COLOSSEUM.arenaA + d, b = COLOSSEUM.arenaB + d
  return (x / a) ** 2 + (z / b) ** 2 <= 1
}

/** Walk-surface height of the stands cross-section at offset `d` (null outside the stands). */
export function colosseumStandHeight(d: number): number | null {
  const section = COLOSSEUM_SECTION
  if (d < section.terraceStartD || d > section.galleryEndD) return null
  if (d <= section.terraceEndD) return COLOSSEUM.podiumHeight
  for (const tier of section.tiers) {
    if (d <= tier.endD) return tier.startY + (d - tier.startD) * COLOSSEUM.rowRise / COLOSSEUM.rowRun
    if (d <= tier.walkwayEndD) return tier.endY
  }
  return section.galleryY
}

/** Parameter values whose arc lengths along an offset curve are approximately equal. */
export function colosseumArcParameters(d: number, pieceLength: number): number[] {
  const samples = 2048
  const lengths = [0]
  const previous = colosseumPoint(0, d)
  const current = new THREE.Vector3()
  for (let i = 1; i <= samples; i++) {
    colosseumPoint(i / samples * Math.PI * 2, d, current)
    lengths.push(lengths[i - 1] + current.distanceTo(previous))
    previous.copy(current)
  }
  const total = lengths[samples]
  const count = Math.max(8, Math.ceil(total / pieceLength))
  const result: number[] = []
  let cursor = 0
  for (let i = 0; i <= count; i++) {
    const target = total * i / count
    while (cursor < samples && lengths[cursor + 1] < target) cursor++
    const span = lengths[cursor + 1] - lengths[cursor]
    const t = span > 0 ? (target - lengths[cursor]) / span : 0
    result.push((cursor + Math.min(1, Math.max(0, t))) / samples * Math.PI * 2)
  }
  result[count] = Math.PI * 2
  return result
}

export interface ColosseumStair {
  readonly x: number
  /** -1: stairs climb toward the -Z wall; +1 toward the +Z wall. */
  readonly side: -1 | 1
}

/** Four axis-aligned arena stairs: two beside the main gate, two flanking the Imperial box. */
export const COLOSSEUM_STAIRS: readonly ColosseumStair[] = Object.freeze([
  { x: -7.5, side: -1 }, { x: 7.5, side: -1 }, { x: -9.5, side: 1 }, { x: 9.5, side: 1 },
])

export const COLOSSEUM_PULVINAR = Object.freeze({
  halfWidth: 5,
  /** Front (arena side) and back Z of the Imperial balcony at +Z. */
  frontZ: COLOSSEUM.arenaB + COLOSSEUM.podiumWallThickness + 0.05,
  backZ: COLOSSEUM.arenaB + COLOSSEUM.terraceDepth + 5 * COLOSSEUM.rowRun,
  floorY: 4.6,
  railHeight: 1,
  wallDepth: 4,
  wallHeight: 10.5,
})

function arenaWallZ(x: number): number {
  return COLOSSEUM.arenaB * Math.sqrt(Math.max(0, 1 - (x / COLOSSEUM.arenaA) ** 2))
}

export interface ColosseumStairPlan {
  readonly stair: ColosseumStair
  readonly surface: WalkRampSurface
  readonly box: THREE.Box3
  /** Arena-side Z where the flight starts at ground level. */
  readonly lowZ: number
  /** Z where the slope reaches terrace height. */
  readonly topZ: number
  /** Z where the landing ends on the terrace. */
  readonly endZ: number
}

export function colosseumStairPlan(stair: ColosseumStair): ColosseumStairPlan {
  const half = COLOSSEUM.stairWidth / 2
  const near = Math.min(arenaWallZ(Math.abs(stair.x) - half), arenaWallZ(Math.abs(stair.x) + half))
  const far = Math.max(arenaWallZ(Math.abs(stair.x) - half), arenaWallZ(Math.abs(stair.x) + half))
  const rise = COLOSSEUM.podiumHeight
  const run = rise / COLOSSEUM.stairSlope
  // Reach full terrace height 1m before the wall so the body clears the wall cap.
  const topAbs = near - 1
  const lowAbs = topAbs - run
  const endAbs = far + COLOSSEUM.podiumWallThickness + 0.9
  const s = stair.side
  const surface: WalkRampSurface = {
    startX: stair.x, startZ: s * lowAbs, dirX: 0, dirZ: s, halfWidth: half,
    length: run, landing: endAbs - topAbs, startY: COLOSSEUM.groundY, topY: COLOSSEUM.groundY + rise, mounted: true,
  }
  const box = new THREE.Box3(
    new THREE.Vector3(stair.x - half, COLOSSEUM.groundY, Math.min(s * lowAbs, s * endAbs)),
    new THREE.Vector3(stair.x + half, COLOSSEUM.groundY + rise, Math.max(s * lowAbs, s * endAbs)),
  )
  return { stair, surface, box, lowZ: s * lowAbs, topZ: s * topAbs, endZ: s * endAbs }
}

export interface ColosseumSpawn { readonly x: number; readonly y: number; readonly z: number; readonly yaw: number }

export const COLOSSEUM_SPAWNS = Object.freeze({
  player: Object.freeze({ x: 0, y: COLOSSEUM.groundY, z: -9, yaw: 0 }),
  opponent: Object.freeze({ x: 0, y: COLOSSEUM.groundY, z: 9, yaw: Math.PI }),
})

/** Square safety bound for actors in flight; never reached by a jump from the outer wall. */
export const COLOSSEUM_SAFETY_BOUND = Math.ceil(COLOSSEUM.arenaA + COLOSSEUM_SECTION.apronD + 30)

export interface ColosseumBraziers { readonly positions: readonly { x: number; y: number; z: number }[] }

/** Terrace braziers (avoid stairs, gates and the Imperial box) plus two on the balcony. */
export function colosseumBrazierPositions(): { x: number; y: number; z: number }[] {
  const result: { x: number; y: number; z: number }[] = []
  for (const degrees of [30, 60, 120, 150, 210, 240, 300, 330]) {
    const p = colosseumPoint(THREE.MathUtils.degToRad(degrees), COLOSSEUM.podiumWallThickness + 0.9)
    result.push({ x: p.x, y: COLOSSEUM.podiumHeight, z: p.z })
  }
  const pulvinar = COLOSSEUM_PULVINAR
  for (const side of [-1, 1]) result.push({ x: side * (pulvinar.halfWidth - 1), y: pulvinar.floorY, z: pulvinar.frontZ + 0.9 })
  return result
}

/** Outer main entrance portico on the -Z facade: two free columns carrying a pediment. */
export const COLOSSEUM_PORTICO = Object.freeze({
  columnX: 3.4,
  columnRadius: 0.55,
  depth: 1.7,
  columnTop: 10.2,
  entablatureTop: 11.1,
  pedimentTop: 13.7,
  halfWidth: 4.6,
})

export function colosseumPorticoColumnBoxes(): THREE.Box3[] {
  const face = -(COLOSSEUM.arenaB + COLOSSEUM_SECTION.outerD)
  const p = COLOSSEUM_PORTICO
  return [-1, 1].map(side => new THREE.Box3(
    new THREE.Vector3(side * p.columnX - p.columnRadius - 0.1, COLOSSEUM.groundY, face - p.depth),
    new THREE.Vector3(side * p.columnX + p.columnRadius + 0.1, p.entablatureTop, face),
  ))
}

export const COLOSSEUM_STATUES = Object.freeze([
  Object.freeze({ x: -6.6, z: COLOSSEUM.arenaB + 1.9, y: COLOSSEUM.podiumHeight, scale: 1, faces: 0 }),
  Object.freeze({ x: 6.6, z: COLOSSEUM.arenaB + 1.9, y: COLOSSEUM.podiumHeight, scale: 1, faces: 0 }),
])

/** Outer main entrance statues on the apron at -Z. */
export function colosseumApronStatues(): { x: number; z: number; y: number; scale: number }[] {
  const z = -(COLOSSEUM.arenaB + COLOSSEUM_SECTION.outerD + 2.6)
  return [{ x: -5.4, z, y: COLOSSEUM.groundY, scale: 1.45 }, { x: 5.4, z, y: COLOSSEUM.groundY, scale: 1.45 }]
}

const STATUE_PEDESTAL = { half: 0.6, height: 1.2, figure: 2.4 }
export function colosseumStatueBox(x: number, y: number, z: number, scale: number): THREE.Box3 {
  const half = STATUE_PEDESTAL.half * scale
  return new THREE.Box3(new THREE.Vector3(x - half, y, z - half),
    new THREE.Vector3(x + half, y + (STATUE_PEDESTAL.height + STATUE_PEDESTAL.figure) * scale, z + half))
}
export const COLOSSEUM_STATUE_DIMENSIONS = STATUE_PEDESTAL

function chainBox(theta0: number, theta1: number, d0: number, d1: number, y0: number, y1: number): THREE.Box3 {
  const box = new THREE.Box3()
  const p = new THREE.Vector3()
  for (const theta of [theta0, theta1]) for (const d of [d0, d1]) box.expandByPoint(colosseumPoint(theta, d, p))
  box.min.y = y0
  box.max.y = y1
  return box
}

/** World-to-sector-local transform: local +Z is the sector's outward normal, origin at the arena edge. */
function sectorFrame(theta: number): { origin: THREE.Vector3; normal: { x: number; z: number }; worldToLocal: THREE.Matrix4 } {
  const origin = colosseumPoint(theta, 0)
  const normal = colosseumNormal(theta)
  const yaw = Math.atan2(normal.x, normal.z)
  const localToWorld = new THREE.Matrix4().makeRotationY(yaw).setPosition(origin)
  return { origin, normal, worldToLocal: localToWorld.clone().invert() }
}

interface SectorRampSpec {
  startD: number
  endD: number
  landingEndD: number
  startY: number
  topY: number
  /** Stepped projectile/camera blocks in sector-local coordinates. */
  blocks: { d0: number; d1: number; top: number }[]
}

function sectorRampSpecs(): SectorRampSpec[] {
  const section = COLOSSEUM_SECTION
  const specs: SectorRampSpec[] = [{
    startD: -0.05, endD: section.terraceEndD, landingEndD: section.terraceEndD,
    startY: COLOSSEUM.podiumHeight, topY: COLOSSEUM.podiumHeight,
    blocks: [{ d0: 0, d1: section.terraceEndD, top: COLOSSEUM.podiumHeight }],
  }]
  for (const tier of section.tiers) {
    const blocks: SectorRampSpec['blocks'] = []
    for (let row = 0; row < tier.rows; row++) {
      // Treads sit on the walk plane at mid-row, so feet stay within half a riser.
      blocks.push({ d0: tier.startD + row * COLOSSEUM.rowRun, d1: tier.startD + (row + 1) * COLOSSEUM.rowRun,
        top: tier.startY + (row + 0.5) * COLOSSEUM.rowRise })
    }
    blocks.push({ d0: tier.endD, d1: tier.walkwayEndD, top: tier.endY })
    specs.push({ startD: tier.startD, endD: tier.endD, landingEndD: tier.walkwayEndD, startY: tier.startY, topY: tier.endY, blocks })
  }
  return specs
}

/** Seating sectors only (exact oriented walk planes, stepped projectile/camera blocks). */
export function createColosseumStandObstacles(): ObstacleData[] {
  const obstacles: ObstacleData[] = []
  const specs = sectorRampSpecs()
  const sectors = COLOSSEUM.sectors
  const corner = new THREE.Vector3()
  for (let index = 0; index < sectors; index++) {
    const theta0 = index / sectors * Math.PI * 2
    const theta1 = (index + 1) / sectors * Math.PI * 2
    const mid = (theta0 + theta1) / 2
    const frame = sectorFrame(mid)
    const perpX = frame.normal.z, perpZ = -frame.normal.x
    for (const spec of specs) {
      // Cover the true sector wedge between both boundary normals with a margin.
      let halfWidth = 0
      for (const theta of [theta0, theta1]) for (const d of [Math.max(0, spec.startD), spec.landingEndD]) {
        colosseumPoint(theta, d, corner)
        halfWidth = Math.max(halfWidth, Math.abs((corner.x - frame.origin.x) * perpX + (corner.z - frame.origin.z) * perpZ))
      }
      halfWidth += 0.2
      const surface: WalkRampSurface = {
        startX: frame.origin.x + frame.normal.x * spec.startD,
        startZ: frame.origin.z + frame.normal.z * spec.startD,
        dirX: frame.normal.x,
        dirZ: frame.normal.z,
        halfWidth,
        length: spec.endD - spec.startD,
        landing: spec.landingEndD - spec.endD,
        startY: spec.startY,
        topY: spec.topY,
        mounted: true,
      }
      const box = new THREE.Box3()
      for (const side of [-1, 1]) for (const d of [spec.startD, spec.landingEndD]) {
        box.expandByPoint(corner.set(
          frame.origin.x + frame.normal.x * d + perpX * side * halfWidth,
          0,
          frame.origin.z + frame.normal.z * d + perpZ * side * halfWidth,
        ))
      }
      box.min.y = COLOSSEUM.groundY
      box.max.y = Math.max(spec.startY, spec.topY)
      const projectileBoxes = spec.blocks.map(block => new THREE.Box3(
        new THREE.Vector3(-halfWidth, COLOSSEUM.groundY, block.d0),
        new THREE.Vector3(halfWidth, block.top, block.d1),
      ))
      obstacles.push({
        box,
        isBarricade: false,
        walkSurface: surface,
        navigationPassable: true,
        projectileBoxes,
        projectileWorldToLocal: frame.worldToLocal,
        projectileBounds: box.clone(),
      })
    }
  }
  return obstacles
}

export interface ColosseumCollisionOptions {
  /** Exclude visual-only decorations (statues, braziers) when callers only need the shell. */
  props?: boolean
}

/** Complete static collision for the Colosseum: walls, stands, stairs, Imperial box and props. */
export function createColosseumObstacles(options: ColosseumCollisionOptions = {}): ObstacleData[] {
  const obstacles = createColosseumStandObstacles()
  const section = COLOSSEUM_SECTION
  const stairs = COLOSSEUM_STAIRS.map(colosseumStairPlan)

  // Arena wall + balustrade. The cap is lowered where a stair arrives.
  const podiumTop = COLOSSEUM.podiumHeight
  const railTop = podiumTop + COLOSSEUM.balustradeHeight
  const podium = colosseumArcParameters(0, COLOSSEUM.podiumPieceLength)
  for (let i = 0; i + 1 < podium.length; i++) {
    const box = chainBox(podium[i], podium[i + 1], 0, COLOSSEUM.podiumWallThickness, COLOSSEUM.groundY, railTop)
    const atStair = stairs.some(plan => box.max.x > plan.box.min.x + 0.05 && box.min.x < plan.box.max.x - 0.05
      && box.max.z > plan.box.min.z && box.min.z < plan.box.max.z)
    if (atStair) box.max.y = podiumTop
    obstacles.push({ box, isBarricade: false })
  }

  // Outer facade and top parapet share one wall; the parapet is low enough to jump.
  const facade = colosseumArcParameters(section.galleryEndD, COLOSSEUM.facadePieceLength)
  for (let i = 0; i + 1 < facade.length; i++) {
    obstacles.push({ box: chainBox(facade[i], facade[i + 1], section.galleryEndD, section.outerD, COLOSSEUM.groundY, section.parapetTopY), isBarricade: false })
  }

  for (const plan of stairs) {
    // Ground navigation may route onto a flight; the walk plane and solid base still own physics.
    obstacles.push({ box: plan.box.clone(), isBarricade: false, walkSurface: plan.surface, solidBelow: COLOSSEUM.groundY, navigationPassable: true })
  }

  const pulvinar = COLOSSEUM_PULVINAR
  const halfWidth = pulvinar.halfWidth
  obstacles.push({
    box: new THREE.Box3(new THREE.Vector3(-halfWidth, COLOSSEUM.groundY, pulvinar.frontZ), new THREE.Vector3(halfWidth, pulvinar.floorY, pulvinar.backZ)),
    isBarricade: false,
  })
  obstacles.push({
    box: new THREE.Box3(new THREE.Vector3(-halfWidth, COLOSSEUM.groundY, pulvinar.frontZ), new THREE.Vector3(halfWidth, pulvinar.floorY + pulvinar.railHeight, pulvinar.frontZ + 0.35)),
    isBarricade: false,
  })
  for (const side of [-1, 1]) {
    obstacles.push({
      box: new THREE.Box3(
        new THREE.Vector3(side < 0 ? -halfWidth : halfWidth - 0.5, COLOSSEUM.groundY, pulvinar.frontZ),
        new THREE.Vector3(side < 0 ? -halfWidth + 0.5 : halfWidth, pulvinar.wallHeight, pulvinar.frontZ + pulvinar.wallDepth),
      ),
      isBarricade: false,
    })
  }
  // Throne.
  obstacles.push({
    box: new THREE.Box3(new THREE.Vector3(-0.7, pulvinar.floorY, pulvinar.frontZ + 3.2), new THREE.Vector3(0.7, pulvinar.floorY + 2.2, pulvinar.frontZ + 4.1)),
    isBarricade: false,
  })

  for (const box of colosseumPorticoColumnBoxes()) obstacles.push({ box, isBarricade: false })

  if (options.props !== false) {
    for (const statue of [...COLOSSEUM_STATUES, ...colosseumApronStatues()]) {
      obstacles.push({ box: colosseumStatueBox(statue.x, statue.y, statue.z, statue.scale), isBarricade: false })
    }
    for (const brazier of colosseumBrazierPositions()) {
      obstacles.push({
        box: new THREE.Box3(new THREE.Vector3(brazier.x - 0.32, brazier.y, brazier.z - 0.32), new THREE.Vector3(brazier.x + 0.32, brazier.y + 1.35, brazier.z + 0.32)),
        isBarricade: false,
      })
    }
  }
  return obstacles
}

/**
 * Grounded gameplay boundary: the paved apron ends `COLOSSEUM.apron` metres
 * outside the outer wall. Airborne bodies are never clamped here, so a jump
 * from the wall always completes its fall. Returns true when the body moved.
 */
export function constrainToColosseumApron(position: THREE.Vector3): boolean {
  const a = COLOSSEUM.arenaA + COLOSSEUM_SECTION.apronD
  const b = COLOSSEUM.arenaB + COLOSSEUM_SECTION.apronD
  const r = Math.hypot(position.x / a, position.z / b)
  if (r <= 1) return false
  position.x /= r
  position.z /= r
  return true
}
