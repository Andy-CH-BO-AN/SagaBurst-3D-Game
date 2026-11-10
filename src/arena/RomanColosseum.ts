import * as THREE from 'three'
import {
  ArenaResources, arenaRandom, bannerQuad, beamGeometry, boxBetween, brazierParts, createFlameMaterial, mergedMesh,
  ownedMaterial, paintedTexture, speckle, tint,
} from './ArenaKit'
import {
  COLOSSEUM, COLOSSEUM_PORTICO, COLOSSEUM_PULVINAR, COLOSSEUM_SECTION, COLOSSEUM_STAIRS, COLOSSEUM_STATUES, COLOSSEUM_STATUE_DIMENSIONS,
  colosseumApronStatues, colosseumArcParameters, colosseumBrazierPositions, colosseumNormal, colosseumPoint, colosseumStairPlan,
} from './ColosseumLayout'

/** Visual-only build of the Colosseum. Collision lives in ColosseumLayout. */
export interface ColosseumVisuals {
  readonly root: THREE.Group
  update(dt: number): void
}

const SEGMENTS = 96
const STOREY = COLOSSEUM_SECTION.parapetTopY / 3

// ── Profile sweep ────────────────────────────────────────────────────────────

interface StripOptions {
  segments?: number
  /** Metres of arc per texture repeat. */
  uLength?: number
  /** Metres of profile per texture repeat. */
  vLength?: number
  vOffset?: number
  color?: THREE.ColorRepresentation
  /** Skip quads whose centre fails this test (gaps for stairs). */
  keep?: (x: number, z: number) => boolean
  /** Vertical walls: texture V follows world height so art is never upside down. */
  vFromY?: boolean
}

/**
 * One flat-shaded band swept around the ellipse between two cross-section
 * points (d, y). The visible face is on the left of a→b (rotate a→b by +90°
 * in the (d, y) plane), so treads run outward and inner risers run upward.
 */
function sweepStrip(a: [number, number], b: [number, number], options: StripOptions = {}): THREE.BufferGeometry {
  const segments = options.segments ?? SEGMENTS
  const positions: number[] = []
  const uvs: number[] = []
  const pa = new THREE.Vector3(), pb = new THREE.Vector3(), pc = new THREE.Vector3(), pd = new THREE.Vector3()
  const midD = (a[0] + b[0]) / 2
  const profileLength = Math.hypot(b[0] - a[0], b[1] - a[1])
  const uLength = options.uLength ?? 4
  const vLength = options.vLength ?? 4
  const v0 = options.vFromY ? a[1] / vLength : (options.vOffset ?? 0) / vLength
  const v1 = options.vFromY ? b[1] / vLength : (options.vOffset ?? 0) / vLength + profileLength / vLength
  let arc = 0
  const previousMid = colosseumPoint(0, midD)
  const mid = new THREE.Vector3()
  for (let i = 0; i < segments; i++) {
    const t0 = i / segments * Math.PI * 2, t1 = (i + 1) / segments * Math.PI * 2
    colosseumPoint(t1, midD, mid)
    const step = mid.distanceTo(previousMid)
    previousMid.copy(mid)
    const u0 = arc / uLength, u1 = (arc + step) / uLength
    arc += step
    colosseumPoint(t0, a[0], pa).y = a[1]
    colosseumPoint(t1, a[0], pb).y = a[1]
    colosseumPoint(t0, b[0], pc).y = b[1]
    colosseumPoint(t1, b[0], pd).y = b[1]
    if (options.keep && !options.keep((pa.x + pd.x) / 2, (pa.z + pd.z) / 2)) continue
    positions.push(pa.x, pa.y, pa.z, pb.x, pb.y, pb.z, pc.x, pc.y, pc.z)
    uvs.push(u0, v0, u1, v0, u0, v1)
    positions.push(pc.x, pc.y, pc.z, pb.x, pb.y, pb.z, pd.x, pd.y, pd.z)
    uvs.push(u0, v1, u1, v0, u1, v1)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.computeVertexNormals()
  if (options.color !== undefined) tint(geometry, options.color)
  return geometry
}

function perimeter(d: number, samples = 512): number {
  let total = 0
  const previous = colosseumPoint(0, d), current = new THREE.Vector3()
  for (let i = 1; i <= samples; i++) {
    colosseumPoint(i / samples * Math.PI * 2, d, current)
    total += current.distanceTo(previous)
    previous.copy(current)
  }
  return total
}

/** Places a geometry authored with local +Z facing outward at (theta, d). */
function placeOnRing(geometry: THREE.BufferGeometry, theta: number, d: number, y: number, inward = false): THREE.BufferGeometry {
  const p = colosseumPoint(theta, d)
  const n = colosseumNormal(theta)
  geometry.rotateY(Math.atan2(n.x, n.z) + (inward ? Math.PI : 0))
  return geometry.translate(p.x, y, p.z)
}

// ── Textures ─────────────────────────────────────────────────────────────────

function travertine(context: CanvasRenderingContext2D, width: number, height: number, seed: number, base = '#d9c7a4'): void {
  context.fillStyle = base
  context.fillRect(0, 0, width, height)
  speckle(context, width, height, seed, width * height / 40, ['#bfa881', '#efe1c2', '#a8936f', '#cbb894'], 3)
  const random = arenaRandom(seed + 7)
  context.strokeStyle = 'rgba(120, 98, 66, 0.35)'
  for (let i = 0; i < 40; i++) {
    context.lineWidth = 0.6 + random() * 0.8
    context.beginPath()
    const y = random() * height
    context.moveTo(0, y)
    for (let x = 0; x <= width; x += width / 8) context.lineTo(x, y + (random() - 0.5) * 6)
    context.stroke()
  }
}

function blockCourses(context: CanvasRenderingContext2D, width: number, height: number, rows: number, cols: number, alpha = 0.35): void {
  context.strokeStyle = `rgba(92, 72, 48, ${alpha})`
  context.lineWidth = 2
  for (let r = 0; r <= rows; r++) {
    const y = r / rows * height
    context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke()
    for (let c = 0; c < cols; c++) {
      const x = (c + (r % 2) * 0.5) / cols * width
      context.beginPath(); context.moveTo(x, y); context.lineTo(x, y + height / rows); context.stroke()
    }
  }
}

function drawLaurel(context: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, color: string, leafScale = 1): void {
  context.save()
  context.fillStyle = color
  context.strokeStyle = color
  context.lineWidth = Math.max(1.5, 2.5 * leafScale)
  for (const side of [-1, 1]) {
    context.beginPath()
    for (let i = 0; i <= 30; i++) {
      const a = Math.PI / 2 + side * (0.25 + i / 30 * 2.45)
      const x = cx + Math.cos(a) * rx, y = cy + Math.sin(a) * ry
      if (i === 0) context.moveTo(x, y); else context.lineTo(x, y)
    }
    context.stroke()
    for (let i = 0; i < 11; i++) {
      const a = Math.PI / 2 + side * (0.35 + i / 11 * 2.3)
      const x = cx + Math.cos(a) * rx, y = cy + Math.sin(a) * ry
      for (const flip of [-1, 1]) {
        context.save()
        context.translate(x, y)
        context.rotate(a + side * Math.PI / 2 + flip * 0.55)
        context.beginPath()
        context.ellipse(0, -9 * leafScale, 3.6 * leafScale, 9 * leafScale, 0, 0, Math.PI * 2)
        context.fill()
        context.restore()
      }
    }
  }
  context.restore()
}

interface ColosseumTextures {
  seats: THREE.Texture
  facade: THREE.Texture
  podium: THREE.Texture
  balustrade: THREE.Texture
  sand: THREE.Texture
  pavers: THREE.Texture
  ground: THREE.Texture
  banner: THREE.Texture
  marble: THREE.Texture
  roof: THREE.Texture
  pediment: THREE.Texture
}

function createTextures(resources: ArenaResources): ColosseumTextures {
  const seats = paintedTexture(resources, 512, 512, (context, { width, height }) => {
    travertine(context, width, height, 11)
    blockCourses(context, width, height, 4, 3, 0.28)
  })
  const facade = paintedTexture(resources, 512, 512, (context, { width, height }) => {
    travertine(context, width, height, 23, '#d6c29b')
    blockCourses(context, width, height, 12, 4, 0.22)
    // Arch opening with depth shading, voussoirs and keystone.
    const cx = width / 2, archW = width * 0.56, springY = height * 0.42, bottom = height * 0.97
    const gradient = context.createLinearGradient(0, springY - archW / 2, 0, bottom)
    gradient.addColorStop(0, '#1d140d'); gradient.addColorStop(0.55, '#2c2016'); gradient.addColorStop(1, '#4a3825')
    context.fillStyle = gradient
    context.beginPath()
    context.moveTo(cx - archW / 2, bottom)
    context.lineTo(cx - archW / 2, springY)
    context.arc(cx, springY, archW / 2, Math.PI, 0)
    context.lineTo(cx + archW / 2, bottom)
    context.closePath()
    context.fill()
    // Inner vault light from the far side.
    context.fillStyle = 'rgba(214, 170, 110, 0.22)'
    context.beginPath()
    context.moveTo(cx - archW * 0.18, bottom)
    context.lineTo(cx - archW * 0.18, springY + archW * 0.1)
    context.arc(cx, springY + archW * 0.1, archW * 0.18, Math.PI, 0)
    context.lineTo(cx + archW * 0.18, bottom)
    context.fill()
    context.strokeStyle = '#a58e68'
    context.lineWidth = 10
    context.beginPath(); context.arc(cx, springY, archW / 2 + 6, Math.PI, 0); context.stroke()
    context.strokeStyle = 'rgba(80, 60, 40, 0.6)'
    context.lineWidth = 2
    for (let i = 0; i <= 12; i++) {
      const a = Math.PI + i / 12 * Math.PI
      context.beginPath()
      context.moveTo(cx + Math.cos(a) * archW / 2, springY + Math.sin(a) * archW / 2)
      context.lineTo(cx + Math.cos(a) * (archW / 2 + 14), springY + Math.sin(a) * (archW / 2 + 14))
      context.stroke()
    }
    context.fillStyle = '#e6d6b4'
    context.fillRect(cx - 9, springY - archW / 2 - 16, 18, 22)
    // Impost blocks.
    context.fillStyle = '#c5b089'
    context.fillRect(cx - archW / 2 - 8, springY - 6, 16, 10)
    context.fillRect(cx + archW / 2 - 8, springY - 6, 16, 10)
  })
  const podium = paintedTexture(resources, 512, 256, (context, { width, height }) => {
    context.fillStyle = '#e2d6bd'
    context.fillRect(0, 0, width, height)
    speckle(context, width, height, 41, 4000, ['#c9b998', '#f4ead5'], 2)
    // Painted red panels with marble frames, a small arched service door.
    context.fillStyle = '#8f2a1e'
    context.fillRect(width * 0.06, height * 0.18, width * 0.36, height * 0.62)
    context.fillStyle = '#7a2016'
    context.fillRect(width * 0.08, height * 0.22, width * 0.32, height * 0.54)
    context.strokeStyle = '#c9a24a'; context.lineWidth = 3
    context.strokeRect(width * 0.1, height * 0.26, width * 0.28, height * 0.46)
    drawLaurel(context, width * 0.24, height * 0.5, 22, 18, '#d4af4f', 0.55)
    const doorX = width * 0.71, doorW = width * 0.16, doorTop = height * 0.3
    context.fillStyle = '#1e1610'
    context.beginPath()
    context.moveTo(doorX - doorW / 2, height)
    context.lineTo(doorX - doorW / 2, doorTop + doorW / 2)
    context.arc(doorX, doorTop + doorW / 2, doorW / 2, Math.PI, 0)
    context.lineTo(doorX + doorW / 2, height)
    context.fill()
    context.strokeStyle = '#b39c73'; context.lineWidth = 6
    context.beginPath(); context.arc(doorX, doorTop + doorW / 2, doorW / 2 + 3, Math.PI, 0); context.stroke()
    context.fillStyle = '#bfae8b'
    context.fillRect(0, 0, width, height * 0.08)
    context.fillRect(0, height * 0.92, width, height * 0.08)
  })
  const balustrade = paintedTexture(resources, 256, 128, (context, { width, height }) => {
    context.fillStyle = '#e8dcc3'; context.fillRect(0, 0, width, height)
    context.fillStyle = '#d2c19f'; context.fillRect(0, 0, width, height * 0.18)
    context.fillRect(0, height * 0.86, width, height * 0.14)
    for (let i = 0; i < 6; i++) {
      const x = (i + 0.5) / 6 * width
      const gradient = context.createLinearGradient(x - 12, 0, x + 12, 0)
      gradient.addColorStop(0, '#9f8c6a'); gradient.addColorStop(0.5, '#f3e9d4'); gradient.addColorStop(1, '#9f8c6a')
      context.fillStyle = gradient
      context.beginPath()
      context.ellipse(x, height * 0.52, 11, height * 0.3, 0, 0, Math.PI * 2)
      context.fill()
    }
    context.fillStyle = 'rgba(60, 46, 30, 0.35)'
    for (let i = 0; i < 6; i++) context.fillRect((i + 1) / 6 * width - 6, height * 0.2, 4, height * 0.64)
  })
  const sandWidth = 1024, sandHeight = 1024
  const sand = paintedTexture(resources, sandWidth, sandHeight, (context, { width, height }) => {
    context.fillStyle = '#d8b276'; context.fillRect(0, 0, width, height)
    speckle(context, width, height, 5, 26000, ['#c49a5d', '#e8c78f', '#b88c52', '#f0d6a4', '#a67a45'], 3.5)
    // Raking marks and footprints.
    const random = arenaRandom(77)
    context.strokeStyle = 'rgba(150, 110, 60, 0.12)'
    for (let i = 0; i < 160; i++) {
      context.lineWidth = 1 + random() * 2
      context.beginPath()
      const x = random() * width, y = random() * height, a = random() * Math.PI
      context.moveTo(x, y); context.lineTo(x + Math.cos(a) * 60, y + Math.sin(a) * 60)
      context.stroke()
    }
    // Floor uv: u = (x + A) / 2A, v = (z + B) / 2B. Circles in metres become ellipses on canvas.
    const pxX = width / (2 * COLOSSEUM.arenaA), pxZ = height / (2 * COLOSSEUM.arenaB)
    const cx = width / 2, cy = height / 2
    context.strokeStyle = 'rgba(122, 52, 34, 0.75)'
    context.lineWidth = 7
    context.beginPath(); context.ellipse(cx, cy, 16 * pxX, 16 * pxZ, 0, 0, Math.PI * 2); context.stroke()
    context.lineWidth = 3
    context.beginPath(); context.ellipse(cx, cy, 17 * pxX, 17 * pxZ, 0, 0, Math.PI * 2); context.stroke()
    context.fillStyle = 'rgba(122, 52, 34, 0.75)'
    for (const [dx, dz] of [[17.8, 0], [-17.8, 0], [0, 17.2], [0, -17.2]] as const) {
      const x = cx + dx * pxX, y = cy + dz * pxZ
      context.beginPath()
      context.moveTo(x, y - 0.9 * pxZ); context.lineTo(x + 0.9 * pxX, y); context.lineTo(x, y + 0.9 * pxZ); context.lineTo(x - 0.9 * pxX, y)
      context.closePath(); context.fill()
    }
    context.save()
    context.scale(1, pxZ / pxX)
    drawLaurel(context, cx, cy * pxX / pxZ, 4.6 * pxX, 4.2 * pxX, 'rgba(126, 58, 34, 0.78)', 1.35)
    context.restore()
  }, { anisotropy: 8 })
  const pavers = paintedTexture(resources, 512, 512, (context, { width, height }) => {
    context.fillStyle = '#b9ab92'; context.fillRect(0, 0, width, height)
    const random = arenaRandom(91)
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const shade = 150 + Math.floor(random() * 50)
      context.fillStyle = `rgb(${shade + 20}, ${shade + 10}, ${shade - 10})`
      context.fillRect(c * 64 + 2 + (r % 2) * 16, r * 64 + 2, 60, 60)
    }
    speckle(context, width, height, 92, 9000, ['#8d8070', '#d8ccb6'], 2)
  })
  const ground = paintedTexture(resources, 512, 512, (context, { width, height }) => {
    context.fillStyle = '#8c8456'; context.fillRect(0, 0, width, height)
    speckle(context, width, height, 101, 26000, ['#6f6a3e', '#a39a66', '#b5a576', '#5d5a34', '#9b8a5c'], 4)
  })
  const banner = paintedTexture(resources, 256, 512, (context, { width, height }) => {
    const gradient = context.createLinearGradient(0, 0, width, 0)
    gradient.addColorStop(0, '#5e130e'); gradient.addColorStop(0.5, '#9c2418'); gradient.addColorStop(1, '#5e130e')
    context.fillStyle = gradient; context.fillRect(0, 0, width, height)
    context.fillStyle = '#c9a03f'
    context.fillRect(0, 0, width, 14); context.fillRect(0, height - 40, width, 10)
    for (let x = 0; x < width; x += 16) {
      context.beginPath(); context.moveTo(x, height - 30); context.lineTo(x + 8, height); context.lineTo(x + 16, height - 30); context.fill()
    }
    drawLaurel(context, width / 2, height * 0.42, width * 0.28, width * 0.3, '#e0b955', 1.2)
  })
  const marble = paintedTexture(resources, 256, 256, (context, { width, height }) => {
    context.fillStyle = '#ece6dc'; context.fillRect(0, 0, width, height)
    speckle(context, width, height, 121, 3000, ['#d6cec2', '#ffffff', '#c9c0b2'], 3)
    const random = arenaRandom(122)
    context.strokeStyle = 'rgba(150, 140, 128, 0.35)'
    for (let i = 0; i < 9; i++) {
      context.lineWidth = 0.6 + random()
      context.beginPath(); context.moveTo(random() * width, 0)
      context.bezierCurveTo(random() * width, height * 0.3, random() * width, height * 0.6, random() * width, height)
      context.stroke()
    }
  })
  const roof = paintedTexture(resources, 256, 256, (context, { width, height }) => {
    context.fillStyle = '#a4502e'; context.fillRect(0, 0, width, height)
    for (let r = 0; r < 8; r++) {
      context.fillStyle = r % 2 ? '#8e3f22' : '#b45b33'
      context.fillRect(0, r * 32, width, 4)
      for (let c = 0; c < 8; c++) {
        context.fillStyle = 'rgba(70, 25, 12, 0.35)'
        context.fillRect(c * 32 + (r % 2) * 16, r * 32, 3, 32)
      }
    }
  })
  const pediment = paintedTexture(resources, 512, 256, (context, { width, height }) => {
    context.fillStyle = '#e6dcc8'; context.fillRect(0, 0, width, height)
    speckle(context, width, height, 141, 3000, ['#cfc3aa', '#fbf5e8'], 2)
    drawLaurel(context, width / 2, height * 0.58, 52, 46, '#c9a03f', 1.3)
  })
  return { seats, facade, podium, balustrade, sand, pavers, ground, banner, marble, roof, pediment }
}

// ── Builders ─────────────────────────────────────────────────────────────────

/** Stepped cavea profile: terrace, three tiers with walkways, top gallery, parapet. */
function standGeometries(): THREE.BufferGeometry[] {
  const section = COLOSSEUM_SECTION
  const parts: THREE.BufferGeometry[] = []
  const tread = 0xf4ead6, riser = 0xb9a888, walk = 0xe2cfa9
  const half = COLOSSEUM.rowRise / 2
  parts.push(sweepStrip([COLOSSEUM.podiumWallThickness, COLOSSEUM.podiumHeight], [section.terraceEndD, COLOSSEUM.podiumHeight], { color: walk, vLength: 3 }))
  for (const tier of section.tiers) {
    let y = tier.startY
    for (let row = 0; row < tier.rows; row++) {
      const d = tier.startD + row * COLOSSEUM.rowRun
      const top = tier.startY + (row + 0.5) * COLOSSEUM.rowRise
      parts.push(sweepStrip([d, y], [d, top], { color: riser, vLength: 1.5 }))
      parts.push(sweepStrip([d, top], [d + COLOSSEUM.rowRun, top], { color: tread, vLength: 1.6 }))
      y = top
    }
    parts.push(sweepStrip([tier.endD, y], [tier.endD, y + half], { color: riser, vLength: 1.5 }))
    parts.push(sweepStrip([tier.endD, tier.endY], [tier.walkwayEndD, tier.endY], { color: walk, vLength: 2 }))
  }
  // Parapet inner face and coping above the top gallery.
  parts.push(sweepStrip([section.galleryEndD, section.galleryY], [section.galleryEndD, section.parapetTopY], { color: riser, vLength: 1.2 }))
  parts.push(sweepStrip([section.galleryEndD, section.parapetTopY], [section.outerD + 0.15, section.parapetTopY], { color: walk, vLength: 1 }))
  return parts
}

/** Radial aisles (scalaria): lighter half-steps every few sectors. */
function aisleGeometries(): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = []
  const aisles = 16
  const rise = COLOSSEUM.rowRise / 2
  for (let i = 0; i < aisles; i++) {
    const theta = (i + 0.5) / aisles * Math.PI * 2
    // Keep aisles away from the Imperial box.
    if (Math.abs(Math.sin(theta) - 1) < 0.08) continue
    for (const tier of COLOSSEUM_SECTION.tiers) {
      for (let row = 0; row < tier.rows; row++) {
        const d = tier.startD + row * COLOSSEUM.rowRun
        const top = tier.startY + (row + 0.5) * COLOSSEUM.rowRise
        // Each row gets an intermediate half-step 2cm proud of the tread.
        // Half-step: a riser and a tread quad (the row tread below is the lower step).
        const riserQuad = new THREE.PlaneGeometry(1.1, rise).translate(0, top + rise / 2 + 0.02, COLOSSEUM.rowRun * 0.5).rotateY(Math.PI)
        const treadQuad = new THREE.PlaneGeometry(1.1, COLOSSEUM.rowRun * 0.5).rotateX(-Math.PI / 2).translate(0, top + rise + 0.02, COLOSSEUM.rowRun * 0.75)
        for (const geometry of [riserQuad, treadQuad]) parts.push(tint(placeOnRing(geometry, theta, d, 0), 0xfdf6e6))
      }
    }
  }
  return parts
}

function facadeGeometries(): { wall: THREE.BufferGeometry[]; trim: THREE.BufferGeometry[]; bays: number } {
  const section = COLOSSEUM_SECTION
  const outer = section.outerD
  const total = perimeter(outer)
  const bays = Math.round(total / 5.2)
  const bayLength = total / bays
  const wall = [sweepStrip([outer, section.parapetTopY], [outer, 0], { uLength: bayLength, vLength: STOREY, segments: bays * 2, vFromY: true })]
  const trim: THREE.BufferGeometry[] = []
  // Cornices at each storey and a heavier coping at the top.
  for (const [index, y] of [STOREY, STOREY * 2, section.parapetTopY].entries()) {
    const depth = index === 2 ? 0.45 : 0.32
    trim.push(sweepStrip([outer + depth, y - 0.42], [outer, y - 0.42], { color: 0xb8a37c, segments: bays }))
    trim.push(sweepStrip([outer + depth, y], [outer + depth, y - 0.42], { color: 0xd8c7a1, segments: bays, vLength: 1 }))
    trim.push(sweepStrip([outer, y], [outer + depth, y], { color: 0xe0d0ad, segments: bays }))
  }
  // Plinth.
  trim.push(sweepStrip([outer + 0.4, 0.7], [outer + 0.4, 0], { color: 0xb3a07d, segments: bays * 2 }))
  trim.push(sweepStrip([outer, 0.7], [outer + 0.4, 0.7], { color: 0xc9b690, segments: bays * 2 }))
  const params = colosseumArcParameters(outer, bayLength * 1.00001)
  for (let i = 0; i + 1 < params.length; i++) {
    for (let storey = 0; storey < 3; storey++) {
      const y0 = storey * STOREY + (storey === 0 ? 0.7 : 0), y1 = (storey + 1) * STOREY - 0.42
      // Engaged half-column with base and capital.
      // Engaged pilaster with a capital block (boxes keep the facade cheap).
      const column = boxBetween(-0.36, y0, -0.02, 0.36, y1 - 0.25, 0.34)
      const capital = boxBetween(-0.5, y1 - 0.25, -0.02, 0.5, y1, 0.46)
      for (const geometry of [column, capital]) trim.push(tint(placeOnRing(geometry, params[i], outer, 0), storey === 2 ? 0xe2d3b2 : 0xd6c49e))
    }
  }
  return { wall, trim, bays }
}

function podiumGeometries(stairBoxes: THREE.Box3[]): { face: THREE.BufferGeometry[]; rail: THREE.BufferGeometry[] } {
  const clear = (x: number, z: number): boolean => !stairBoxes.some(box => x > box.min.x - 0.2 && x < box.max.x + 0.2 && z > box.min.z && z < box.max.z)
  const t = COLOSSEUM.podiumWallThickness, h = COLOSSEUM.podiumHeight, r = h + COLOSSEUM.balustradeHeight
  const face = [sweepStrip([0, 0], [0, h], { uLength: 6.5, vLength: h, segments: 160, vFromY: true })]
  const rail = [
    sweepStrip([0, h], [0, r], { uLength: 2.4, vLength: COLOSSEUM.balustradeHeight, segments: 160, keep: clear, vFromY: true }),
    sweepStrip([0, r], [t, r], { uLength: 2.4, vLength: 4, segments: 160, keep: clear, color: 0xd9ccb0 }),
    sweepStrip([t, r], [t, h], { uLength: 2.4, vLength: COLOSSEUM.balustradeHeight, segments: 160, keep: clear, vFromY: true }),
  ]
  return { face, rail }
}

function stairGeometries(): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = []
  for (const stair of COLOSSEUM_STAIRS) {
    const plan = colosseumStairPlan(stair)
    const s = stair.side
    const half = COLOSSEUM.stairWidth / 2
    const steps = 6
    const run = Math.abs(plan.topZ - plan.lowZ) / steps
    const rise = COLOSSEUM.podiumHeight / steps
    for (let i = 0; i < steps; i++) {
      // Each tread sits on the walk plane at mid-step, matching the physical ramp.
      const z0 = plan.lowZ + s * i * run, z1 = plan.lowZ + s * (i + 1) * run
      parts.push(tint(boxBetween(stair.x - half, 0, Math.min(z0, z1), stair.x + half, (i + 0.5) * rise, Math.max(z0, z1)), i % 2 ? 0xe7dcc5 : 0xd8cbb0))
    }
    parts.push(tint(boxBetween(stair.x - half, 0, Math.min(plan.topZ, plan.endZ), stair.x + half, COLOSSEUM.podiumHeight, Math.max(plan.topZ, plan.endZ)), 0xeee4cf))
  }
  return parts
}

function gateGeometries(): { frame: THREE.BufferGeometry[]; iron: THREE.BufferGeometry[]; dark: THREE.BufferGeometry[] } {
  const frame: THREE.BufferGeometry[] = [], iron: THREE.BufferGeometry[] = [], dark: THREE.BufferGeometry[] = []
  const gate = (theta: number, width: number, height: number, d: number, inward: boolean): void => {
    const w = width / 2
    const opening = new THREE.Shape()
    opening.moveTo(-w, 0); opening.lineTo(-w, height - w); opening.absarc(0, height - w, w, Math.PI, 0, true); opening.lineTo(w, 0); opening.closePath()
    const recess = new THREE.ShapeGeometry(opening, 10).translate(0, 0, 0.03)
    dark.push(placeOnRing(recess, theta, d, 0, inward))
    for (const side of [-1, 1]) frame.push(tint(placeOnRing(boxBetween(side * w - 0.32, 0, 0, side * w + 0.32, height - w + 0.1, 0.32), theta, d, 0, inward), 0xe1d3b4))
    const arch = new THREE.TorusGeometry(w + 0.16, 0.2, 5, 14, Math.PI).scale(1, 1, 0.9).translate(0, height - w, 0.16)
    frame.push(tint(placeOnRing(arch, theta, d, 0, inward), 0xe8dcc0))
    frame.push(tint(placeOnRing(boxBetween(-0.22, height + 0.02, 0.05, 0.22, height + 0.48, 0.42), theta, d, 0, inward), 0xf0e4c6))
    for (let i = -3; i <= 3; i++) {
      const x = i / 3.5 * w
      const barTop = height - w + Math.sqrt(Math.max(0, w * w - x * x)) - 0.05
      iron.push(placeOnRing(boxBetween(x - 0.035, 0, 0.12, x + 0.035, barTop, 0.19), theta, d, 0, inward))
    }
    for (let j = 1; j * 0.55 < height - 0.3; j++) {
      const y = j * 0.55
      const span = y <= height - w ? w : Math.sqrt(Math.max(0, w * w - (y - (height - w)) ** 2))
      if (span < 0.2) continue
      iron.push(placeOnRing(boxBetween(-span + 0.05, y - 0.03, 0.1, span - 0.05, y + 0.03, 0.2), theta, d, 0, inward))
    }
  }
  // Arena gates in the podium (major axis ends and under the Imperial box / main gate).
  for (const degrees of [0, 180, 90, 270]) gate(THREE.MathUtils.degToRad(degrees), degrees % 180 === 0 ? 3.2 : 2.8, 2.35, 0, true)
  // Outer main entrance (taller) at -Z and three other compass entrances.
  for (const degrees of [270, 0, 90, 180]) gate(THREE.MathUtils.degToRad(degrees), 4.2, 7.4, COLOSSEUM_SECTION.outerD + 0.02, false)
  return { frame, iron, dark }
}

function statueGeometries(x: number, y: number, z: number, scale: number, yaw: number): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = []
  const { half, height: pedestal, figure } = COLOSSEUM_STATUE_DIMENSIONS
  const add = (geometry: THREE.BufferGeometry): void => {
    parts.push(geometry.scale(scale, scale, scale).rotateY(yaw).translate(x, y, z))
  }
  add(boxBetween(-half, 0, -half, half, pedestal * 0.15, half))
  add(boxBetween(-half * 0.85, pedestal * 0.15, -half * 0.85, half * 0.85, pedestal * 0.88, half * 0.85))
  add(boxBetween(-half, pedestal * 0.88, -half, half, pedestal, half))
  const base = pedestal
  const legLength = figure * 0.42
  for (const side of [-1, 1]) {
    add(new THREE.CylinderGeometry(0.075, 0.09, legLength, 7).translate(side * 0.12, base + legLength / 2, side * 0.04))
  }
  // Tunic skirt, cuirass, shoulders, arms.
  add(new THREE.CylinderGeometry(0.2, 0.3, figure * 0.16, 10).translate(0, base + legLength + figure * 0.05, 0))
  add(new THREE.CylinderGeometry(0.22, 0.19, figure * 0.27, 10).scale(1, 1, 0.75).translate(0, base + legLength + figure * 0.25, 0))
  add(new THREE.SphereGeometry(0.15, 8, 5).scale(1.6, 0.6, 1).translate(0, base + figure * 0.84, 0))
  add(new THREE.CylinderGeometry(0.06, 0.055, figure * 0.3, 6).rotateZ(0.15).translate(-0.29, base + figure * 0.68, 0.05))
  add(new THREE.CylinderGeometry(0.06, 0.055, figure * 0.3, 6).rotateX(-0.9).translate(0.28, base + figure * 0.74, 0.14))
  add(new THREE.SphereGeometry(0.12, 8, 6).translate(0, base + figure * 0.92, 0))
  add(new THREE.SphereGeometry(0.135, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, base + figure * 0.94, 0))
  add(boxBetween(-0.02, base + figure * 0.96, -0.16, 0.02, base + figure * 1.07, 0.14))
  // Spear and round shield.
  add(new THREE.CylinderGeometry(0.025, 0.025, figure * 1.1, 6).translate(0.32, base + figure * 0.55, 0.32))
  add(new THREE.CylinderGeometry(0.34, 0.34, 0.05, 10).rotateX(Math.PI / 2).translate(-0.38, base + figure * 0.6, 0.12))
  return parts
}

function velariumGeometries(): { masts: THREE.BufferGeometry[]; cloth: THREE.BufferGeometry[] } {
  const section = COLOSSEUM_SECTION
  const masts: THREE.BufferGeometry[] = [], cloth: THREE.BufferGeometry[] = []
  const params = colosseumArcParameters(section.outerD, 6.4)
  const top = section.parapetTopY + 3.6
  for (let i = 0; i + 1 < params.length; i++) {
    const p = colosseumPoint(params[i], section.outerD + 0.15)
    masts.push(new THREE.CylinderGeometry(0.08, 0.12, 4.6, 5, 1, true).translate(p.x, section.parapetTopY + 2.2, p.z))
    masts.push(new THREE.ConeGeometry(0.14, 0.4, 5).translate(p.x, top + 0.7, p.z))
    if (i % 3 !== 0) continue
    // Awning: quad sloping inward between two masts, with a scalloped drop.
    const t0 = params[i], t1 = params[i + 1]
    const a0 = colosseumPoint(t0, section.outerD + 0.1), a1 = colosseumPoint(t1, section.outerD + 0.1)
    const b0 = colosseumPoint(t0, section.galleryEndD - 3.4), b1 = colosseumPoint(t1, section.galleryEndD - 3.4)
    const innerY = section.galleryY + 3
    const geometry = new THREE.BufferGeometry()
    const verts = [
      a0.x, top, a0.z, b0.x, innerY, b0.z, a1.x, top, a1.z,
      a1.x, top, a1.z, b0.x, innerY, b0.z, b1.x, innerY, b1.z,
    ]
    const uvs = [0, 1, 0, 0, 1, 1, 1, 1, 0, 0, 1, 0]
    // Scalloped valance along the inner edge.
    for (let k = 0; k < 4; k++) {
      const s0 = k / 4, s1 = (k + 1) / 4, sm = (s0 + s1) / 2
      const p0 = b0.clone().lerp(b1, s0), p1 = b0.clone().lerp(b1, s1), pm = b0.clone().lerp(b1, sm)
      verts.push(p0.x, innerY, p0.z, pm.x, innerY - 0.45, pm.z, p1.x, innerY, p1.z)
      uvs.push(s0, 0.05, sm, 0, s1, 0.05)
    }
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    geometry.computeVertexNormals()
    cloth.push(geometry)
  }
  return { masts, cloth }
}

function bannerGeometries(): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = []
  const section = COLOSSEUM_SECTION
  // Arena-side banners hung from the balustrade, skipping gates and stairs.
  for (let i = 0; i < 20; i++) {
    const theta = (i + 0.5) / 20 * Math.PI * 2
    const p = colosseumPoint(theta, -0.02)
    if (Math.abs(p.x) < 11 || Math.abs(p.z) < 4) continue
    const n = colosseumNormal(theta)
    parts.push(bannerQuad(p.x, COLOSSEUM.podiumHeight + COLOSSEUM.balustradeHeight - 0.05, p.z, Math.atan2(-n.x, -n.z), 1.05, 2.6, 0.02))
  }
  // Outer facade banners on the first storey piers.
  const params = colosseumArcParameters(section.outerD, 5.2 * 4)
  for (let i = 0; i + 1 < params.length; i++) {
    const theta = params[i]
    const p = colosseumPoint(theta, section.outerD + 0.4)
    const n = colosseumNormal(theta)
    parts.push(bannerQuad(p.x, STOREY * 2 - 0.6, p.z, Math.atan2(n.x, n.z), 1.4, 4.3, 0.05))
  }
  // Pulvinar side banners.
  const pulvinar = COLOSSEUM_PULVINAR
  for (const side of [-1, 1]) parts.push(bannerQuad(side * (pulvinar.halfWidth + 0.02), pulvinar.wallHeight - 0.8, pulvinar.frontZ + 2, side * Math.PI / 2, 1.3, 4.2, 0.02))
  return parts
}

function pulvinarGeometries(): { marble: THREE.BufferGeometry[]; gold: THREE.BufferGeometry[]; drape: THREE.BufferGeometry[]; pediment: THREE.BufferGeometry[]; roof: THREE.BufferGeometry[] } {
  const p = COLOSSEUM_PULVINAR
  const marble: THREE.BufferGeometry[] = [], gold: THREE.BufferGeometry[] = [], drape: THREE.BufferGeometry[] = [], pediment: THREE.BufferGeometry[] = [], roof: THREE.BufferGeometry[] = []
  const w = p.halfWidth
  const front = p.frontZ, back = front + p.wallDepth
  // Platform face and floor slab (seats continue behind it).
  marble.push(boxBetween(-w, COLOSSEUM.podiumHeight, front, w, p.floorY, p.backZ))
  marble.push(tint(boxBetween(-w - 0.15, p.floorY - 0.25, front - 0.15, w + 0.15, p.floorY, front + 0.3), 0xd8cbb0))
  marble.push(boxBetween(-w, p.floorY, front, w, p.floorY + 0.12, front + 0.35))
  for (let i = 0; i < 14; i++) {
    const x = -w + 0.35 + i / 13 * (2 * w - 0.7)
    marble.push(new THREE.CylinderGeometry(0.08, 0.1, p.railHeight - 0.2, 7).translate(x, p.floorY + 0.12 + (p.railHeight - 0.2) / 2, front + 0.18))
  }
  marble.push(boxBetween(-w, p.floorY + p.railHeight - 0.1, front, w, p.floorY + p.railHeight, front + 0.35))
  // Side walls.
  for (const side of [-1, 1]) marble.push(boxBetween(side < 0 ? -w : w - 0.5, COLOSSEUM.podiumHeight, front, side < 0 ? -w + 0.5 : w, p.wallHeight, back))
  // Columns.
  const columnTop = p.wallHeight - 0.7
  for (const x of [-w + 0.25, -1.9, 1.9, w - 0.25]) {
    marble.push(new THREE.CylinderGeometry(0.26, 0.3, columnTop - p.floorY - 0.5, 14).translate(x, (p.floorY + columnTop) / 2, front + 0.55))
    gold.push(boxBetween(x - 0.38, columnTop - 0.32, front + 0.17, x + 0.38, columnTop, front + 0.93))
    marble.push(boxBetween(x - 0.38, p.floorY, front + 0.17, x + 0.38, p.floorY + 0.28, front + 0.93))
  }
  // Entablature, roof slab, pediment.
  marble.push(boxBetween(-w - 0.2, columnTop, front - 0.05, w + 0.2, p.wallHeight, back))
  gold.push(boxBetween(-w - 0.2, columnTop + 0.2, front - 0.08, w + 0.2, columnTop + 0.32, front - 0.02))
  const triangle = new THREE.Shape()
  triangle.moveTo(-w - 0.3, 0); triangle.lineTo(w + 0.3, 0); triangle.lineTo(0, 2.6); triangle.closePath()
  const tympanum = new THREE.ShapeGeometry(triangle).translate(0, p.wallHeight, front - 0.06)
  const pos = tympanum.getAttribute('position'), uv = tympanum.getAttribute('uv')
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + w + 0.3) / (2 * w + 0.6), (pos.getY(i) - p.wallHeight) / 2.6)
  pediment.push(tympanum)
  const ridge = new THREE.BufferGeometry()
  const top = p.wallHeight + 2.6
  ridge.setAttribute('position', new THREE.Float32BufferAttribute([
    -w - 0.4, p.wallHeight, front - 0.1, -w - 0.4, p.wallHeight, back, 0, top + 0.1, back,
    -w - 0.4, p.wallHeight, front - 0.1, 0, top + 0.1, back, 0, top + 0.1, front - 0.1,
    0, top + 0.1, front - 0.1, 0, top + 0.1, back, w + 0.4, p.wallHeight, back,
    0, top + 0.1, front - 0.1, w + 0.4, p.wallHeight, back, w + 0.4, p.wallHeight, front - 0.1,
  ], 3))
  ridge.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 2, 1.5, 0, 0, 2, 1.5, 0, 1.5, 0, 1.5, 2, 1.5, 2, 0, 0, 1.5, 2, 0, 0, 0], 2))
  ridge.computeVertexNormals()
  roof.push(ridge)
  // Cornice under the pediment.
  marble.push(boxBetween(-w - 0.4, p.wallHeight - 0.05, front - 0.25, w + 0.4, p.wallHeight + 0.15, front + 0.2))
  gold.push(new THREE.SphereGeometry(0.28, 10, 8).translate(0, top + 0.35, front - 0.05))
  // Red drapes between columns and on the back wall.
  for (const [x0, x1] of [[-w + 0.5, -2.15], [2.15, w - 0.5]]) {
    const curtain = new THREE.PlaneGeometry(x1 - x0, columnTop - p.floorY - 0.6, 6, 1)
    const cp = curtain.getAttribute('position')
    for (let i = 0; i < cp.count; i++) cp.setZ(i, Math.sin((cp.getX(i) / (x1 - x0) + 0.5) * Math.PI * 5) * 0.08)
    curtain.computeVertexNormals()
    drape.push(curtain.translate((x0 + x1) / 2, (p.floorY + columnTop) / 2 + 0.25, front + 1.2))
  }
  drape.push(new THREE.PlaneGeometry(2 * w - 1, columnTop - p.floorY - 0.3).translate(0, (p.floorY + columnTop) / 2, back - 0.02).rotateY(0))
  // Throne.
  const throneZ = front + 3.65
  gold.push(boxBetween(-0.7, p.floorY, throneZ - 0.45, 0.7, p.floorY + 0.55, throneZ + 0.45))
  gold.push(boxBetween(-0.62, p.floorY + 0.55, throneZ + 0.25, 0.62, p.floorY + 2.2, throneZ + 0.45))
  for (const side of [-1, 1]) gold.push(boxBetween(side * 0.7 - 0.12, p.floorY + 0.55, throneZ - 0.4, side * 0.7 + 0.12, p.floorY + 1.05, throneZ + 0.3))
  drape.push(boxBetween(-0.55, p.floorY + 0.56, throneZ - 0.35, 0.55, p.floorY + 0.68, throneZ + 0.25))
  drape.push(boxBetween(-0.5, p.floorY + 0.7, throneZ + 0.2, 0.5, p.floorY + 1.95, throneZ + 0.26))
  return { marble, gold, drape, pediment, roof }
}

function porticoGeometries(): { marble: THREE.BufferGeometry[]; trim: THREE.BufferGeometry[]; pediment: THREE.BufferGeometry[]; gold: THREE.BufferGeometry[] } {
  const marble: THREE.BufferGeometry[] = [], trim: THREE.BufferGeometry[] = [], pediment: THREE.BufferGeometry[] = [], gold: THREE.BufferGeometry[] = []
  const p = COLOSSEUM_PORTICO
  const face = -(COLOSSEUM.arenaB + COLOSSEUM_SECTION.outerD)
  const front = face - p.depth
  const midZ = face - p.depth / 2 - 0.1
  for (const side of [-1, 1]) {
    const x = side * p.columnX
    marble.push(tint(boxBetween(x - 0.75, 0, midZ - 0.75, x + 0.75, 0.6, midZ + 0.75), 0xd9cfbf))
    marble.push(tint(new THREE.CylinderGeometry(p.columnRadius * 0.88, p.columnRadius, p.columnTop - 1.2, 16).translate(x, 0.6 + (p.columnTop - 1.2) / 2, midZ), 0xf2ece2))
    gold.push(boxBetween(x - 0.72, p.columnTop - 0.6, midZ - 0.72, x + 0.72, p.columnTop, midZ + 0.72))
    // Engaged pilaster behind each column.
    trim.push(tint(boxBetween(x - 0.6, 0, face - 0.25, x + 0.6, p.columnTop, face + 0.05), 0xd6c49e))
  }
  trim.push(tint(boxBetween(-p.halfWidth, p.columnTop, front - 0.15, p.halfWidth, p.entablatureTop, face + 0.05), 0xe6d8b8))
  gold.push(boxBetween(-p.halfWidth, p.columnTop + 0.35, front - 0.18, p.halfWidth, p.columnTop + 0.5, front - 0.14))
  const triangle = new THREE.Shape()
  triangle.moveTo(-p.halfWidth, 0); triangle.lineTo(p.halfWidth, 0); triangle.lineTo(0, p.pedimentTop - p.entablatureTop); triangle.closePath()
  const tympanum = new THREE.ShapeGeometry(triangle)
  const position = tympanum.getAttribute('position'), uv = tympanum.getAttribute('uv')
  const height = p.pedimentTop - p.entablatureTop
  for (let i = 0; i < position.count; i++) uv.setXY(i, (position.getX(i) + p.halfWidth) / (2 * p.halfWidth), position.getY(i) / height)
  pediment.push(tympanum.rotateY(Math.PI).translate(0, p.entablatureTop, front - 0.05))
  // Raking cornices and a solid back block so the pediment reads from every side.
  for (const side of [-1, 1]) {
    trim.push(tint(beamGeometry(new THREE.Vector3(side * (p.halfWidth + 0.25), p.entablatureTop - 0.05, front - 0.3),
      new THREE.Vector3(0, p.pedimentTop + 0.2, front - 0.3), 0.35, 0.4), 0xeee2c4))
  }
  const back = new THREE.ExtrudeGeometry(triangle, { depth: p.depth, bevelEnabled: false }).translate(0, 0, -p.depth)
  trim.push(tint(back.rotateY(Math.PI).translate(0, p.entablatureTop, front), 0xd8c8a4))
  gold.push(new THREE.SphereGeometry(0.3, 10, 8).translate(0, p.pedimentTop + 0.45, front - 0.3))
  return { marble, trim, pediment, gold }
}

function eagleStandardGeometries(x: number, z: number): { gold: THREE.BufferGeometry[]; banner: THREE.BufferGeometry[]; wood: THREE.BufferGeometry[] } {
  const gold: THREE.BufferGeometry[] = [], banner: THREE.BufferGeometry[] = [], wood: THREE.BufferGeometry[] = []
  wood.push(new THREE.CylinderGeometry(0.07, 0.09, 6.4, 7).translate(x, 3.2, z))
  gold.push(boxBetween(x - 0.75, 5.1, z - 0.04, x + 0.75, 5.2, z + 0.04))
  gold.push(new THREE.SphereGeometry(0.2, 8, 6).scale(1, 1.2, 1.6).translate(x, 6.65, z))
  for (const side of [-1, 1]) {
    const wing = new THREE.BufferGeometry()
    wing.setAttribute('position', new THREE.Float32BufferAttribute([x, 6.7, z, x + side * 0.85, 7.25, z - 0.05, x + side * 0.6, 6.55, z], 3))
    wing.computeVertexNormals()
    gold.push(wing)
  }
  banner.push(bannerQuad(x, 5.12, z, Math.PI, 1.4, 2.6, 0.06))
  return { gold, banner, wood }
}

function cityGeometries(): { walls: THREE.BufferGeometry[]; roofs: THREE.BufferGeometry[]; trees: THREE.BufferGeometry[]; aqueduct: THREE.BufferGeometry[] } {
  const random = arenaRandom(2024)
  const walls: THREE.BufferGeometry[] = [], roofs: THREE.BufferGeometry[] = [], trees: THREE.BufferGeometry[] = [], aqueduct: THREE.BufferGeometry[] = []
  const wallColors = [0xe7dcc6, 0xdcc9a6, 0xd9b98f, 0xece4d2, 0xcfae84]
  for (let i = 0; i < 85; i++) {
    const a = random() * Math.PI * 2
    const r = 128 + random() * 120
    const x = Math.cos(a) * r * 1.08, z = Math.sin(a) * r
    const w = 6 + random() * 9, d = 6 + random() * 8, h = 4 + random() * 7
    const yaw = a + (random() - 0.5) * 0.4
    walls.push(tint(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0).rotateY(yaw).translate(x, 0, z), wallColors[i % wallColors.length]))
    const roof = new THREE.CylinderGeometry(0.01, 1, 1, 4, 1).rotateY(Math.PI / 4).scale(w * 0.78, 2 + random() * 1.4, d * 0.78)
    roofs.push(roof.translate(0, h + 0.8, 0).rotateY(yaw).translate(x, 0, z))
  }
  for (let i = 0; i < 50; i++) {
    const a = random() * Math.PI * 2
    const r = 92 + random() * 150
    const x = Math.cos(a) * r * 1.1, z = Math.sin(a) * r
    if (Math.abs(x) < 112 && Math.abs(z) < 112) continue
    const h = 7 + random() * 6
    trees.push(tint(new THREE.ConeGeometry(1.1 + random() * 0.5, h, 5).translate(x, h / 2 + 0.6, z), random() > 0.5 ? 0x2f4a2a : 0x3a5531))
    trees.push(tint(new THREE.CylinderGeometry(0.18, 0.22, 1.2, 5).translate(x, 0.6, z), 0x5a4330))
  }
  // Aqueduct on the far north-east ridge.
  for (let i = 0; i < 14; i++) {
    const x = 140 + i * 9, z = -170 + i * 4.5
    aqueduct.push(boxBetween(x - 1.3, 0, z - 1.2, x + 1.3, 18, z + 1.2).rotateY(0))
    aqueduct.push(boxBetween(x, 18, z - 1.3, x + 9, 21, z + 1.3))
  }
  // Temple to the west.
  for (let i = 0; i < 8; i++) {
    for (const zz of [-6, 6]) aqueduct.push(new THREE.CylinderGeometry(0.7, 0.8, 12, 10).translate(-185 + i * 3.4, 13, 40 + zz))
  }
  aqueduct.push(boxBetween(-189, 0, 30, -158, 7, 50))
  aqueduct.push(boxBetween(-189, 19, 31, -158, 21, 49))
  return { walls, roofs, trees, aqueduct }
}

// ── Assembly ─────────────────────────────────────────────────────────────────

export function buildColosseumVisuals(resources: ArenaResources): ColosseumVisuals {
  const root = new THREE.Group()
  root.name = 'roman-colosseum'
  const textures = createTextures(resources)
  const section = COLOSSEUM_SECTION
  const stairPlans = COLOSSEUM_STAIRS.map(colosseumStairPlan)

  const material = (parameters: THREE.MeshStandardMaterialParameters, name: string): THREE.MeshStandardMaterial => {
    const result = ownedMaterial(resources, new THREE.MeshStandardMaterial(parameters))
    result.name = name
    return result
  }
  const seatMaterial = material({ map: textures.seats, vertexColors: true, roughness: 0.92 }, 'colosseum-seats')
  const trimMaterial = material({ map: textures.seats, vertexColors: true, roughness: 0.86 }, 'colosseum-trim')
  const facadeMaterial = material({ map: textures.facade, roughness: 0.9 }, 'colosseum-facade')
  const podiumMaterial = material({ map: textures.podium, roughness: 0.8 }, 'colosseum-podium')
  const balustradeMaterial = material({ map: textures.balustrade, vertexColors: true, roughness: 0.82 }, 'colosseum-balustrade')
  const sandMaterial = material({ map: textures.sand, roughness: 1 }, 'colosseum-sand')
  const paverMaterial = material({ map: textures.pavers, roughness: 0.95 }, 'colosseum-pavers')
  const groundMaterial = material({ map: textures.ground, roughness: 1 }, 'colosseum-ground')
  const bannerMaterial = material({ map: textures.banner, roughness: 0.75, side: THREE.DoubleSide }, 'colosseum-banner')
  const marbleMaterial = material({ map: textures.marble, vertexColors: true, roughness: 0.55 }, 'colosseum-marble')
  const goldMaterial = material({ color: 0xc8a046, metalness: 0.75, roughness: 0.35, side: THREE.DoubleSide }, 'colosseum-gold')
  const ironMaterial = material({ color: 0x2b2826, metalness: 0.6, roughness: 0.55 }, 'colosseum-iron')
  const darkMaterial = material({ color: 0x140e09, roughness: 1 }, 'colosseum-dark')
  const clothMaterial = material({ color: 0xc23a26, emissive: 0x3a0a05, roughness: 0.8, side: THREE.DoubleSide }, 'colosseum-velarium')
  const woodMaterial = material({ color: 0x6b4a2f, roughness: 0.9 }, 'colosseum-wood')
  const roofMaterial = material({ map: textures.roof, roughness: 0.9, vertexColors: false, side: THREE.DoubleSide }, 'colosseum-roof')
  const pedimentMaterial = material({ map: textures.pediment, roughness: 0.7 }, 'colosseum-pediment')
  const cityWallMaterial = material({ vertexColors: true, roughness: 0.95 }, 'colosseum-city')
  const foliageMaterial = material({ vertexColors: true, roughness: 1 }, 'colosseum-foliage')
  const flameTime = { value: 0 }
  const flameMaterial = createFlameMaterial(resources, flameTime)

  // Ground: wide plain, paved apron ring, sand arena.
  const groundGeometry = new THREE.PlaneGeometry(1600, 1600, 1, 1).rotateX(-Math.PI / 2)
  const groundUv = groundGeometry.getAttribute('uv')
  for (let i = 0; i < groundUv.count; i++) groundUv.setXY(i, groundUv.getX(i) * 160, groundUv.getY(i) * 160)
  const ground = new THREE.Mesh(resources.track(groundGeometry), groundMaterial)
  ground.position.y = COLOSSEUM.groundY - 0.02
  ground.receiveShadow = true
  root.add(ground)
  root.add(mergedMesh(resources, [sweepStrip([section.outerD - 0.1, 0.005], [section.apronD + 1.5, 0.005], { uLength: 6, vLength: 6, segments: 160 })], paverMaterial, { castShadow: false, name: 'colosseum-apron' }))
  const sandShape = new THREE.Shape()
  sandShape.absellipse(0, 0, COLOSSEUM.arenaA + 0.1, COLOSSEUM.arenaB + 0.1, 0, Math.PI * 2, false, 0)
  // ShapeGeometry is authored in XY facing +Z; -90° about X makes it face up.
  const sandGeometry = new THREE.ShapeGeometry(sandShape, 96).rotateX(-Math.PI / 2).translate(0, COLOSSEUM.groundY + 0.01, 0)
  const sandPosition = sandGeometry.getAttribute('position'), sandUv = sandGeometry.getAttribute('uv')
  for (let i = 0; i < sandPosition.count; i++) {
    sandUv.setXY(i, (sandPosition.getX(i) + COLOSSEUM.arenaA) / (2 * COLOSSEUM.arenaA), 1 - (sandPosition.getZ(i) + COLOSSEUM.arenaB) / (2 * COLOSSEUM.arenaB))
  }
  root.add(mergedMesh(resources, [sandGeometry], sandMaterial, { castShadow: false, name: 'colosseum-sand' }))

  const stairBoxes = stairPlans.map(plan => plan.box)
  root.add(mergedMesh(resources, [...standGeometries(), ...aisleGeometries(), ...stairGeometries()], seatMaterial, { name: 'colosseum-stands' }))
  const facade = facadeGeometries()
  root.add(mergedMesh(resources, facade.wall, facadeMaterial, { name: 'colosseum-facade' }))
  const gates = gateGeometries()
  const pulvinar = pulvinarGeometries()
  const portico = porticoGeometries()
  root.add(mergedMesh(resources, [...facade.trim, ...gates.frame, ...portico.trim], trimMaterial, { name: 'colosseum-trim' }))
  const podium = podiumGeometries(stairBoxes)
  root.add(mergedMesh(resources, podium.face, podiumMaterial, { name: 'colosseum-podium' }))
  root.add(mergedMesh(resources, podium.rail, balustradeMaterial, { name: 'colosseum-balustrade' }))
  root.add(mergedMesh(resources, gates.dark, darkMaterial, { castShadow: false, name: 'colosseum-openings' }))

  const statues: THREE.BufferGeometry[] = []
  for (const statue of COLOSSEUM_STATUES) statues.push(...statueGeometries(statue.x, statue.y, statue.z, statue.scale, Math.PI))
  for (const statue of colosseumApronStatues()) statues.push(...statueGeometries(statue.x, statue.y, statue.z, statue.scale, Math.PI))
  root.add(mergedMesh(resources, [...statues, ...pulvinar.marble, ...portico.marble], marbleMaterial, { name: 'colosseum-marble' }))

  const ironParts: THREE.BufferGeometry[] = [...gates.iron]
  const flames: THREE.BufferGeometry[] = []
  for (const brazier of colosseumBrazierPositions()) {
    const parts = brazierParts(brazier.x, brazier.y, brazier.z)
    ironParts.push(...parts.iron)
    flames.push(...parts.flame)
  }
  // Two tall bronze fire bowls by the main outer gate.
  for (const x of [-9.5, 9.5]) {
    const parts = brazierParts(x, 0, -(COLOSSEUM.arenaB + section.outerD + 4.5))
    ironParts.push(...parts.iron)
    flames.push(...parts.flame)
  }
  root.add(mergedMesh(resources, ironParts, ironMaterial, { name: 'colosseum-iron' }))
  const flameMesh = mergedMesh(resources, flames, flameMaterial, { castShadow: false, receiveShadow: false, name: 'colosseum-flames' })
  root.add(flameMesh)

  const goldParts: THREE.BufferGeometry[] = [...pulvinar.gold, ...portico.gold]
  const bannerParts = bannerGeometries()
  const woodParts: THREE.BufferGeometry[] = []
  for (const x of [-11, 11]) {
    const standard = eagleStandardGeometries(x, -(COLOSSEUM.arenaB + section.outerD + 5.5))
    goldParts.push(...standard.gold); bannerParts.push(...standard.banner); woodParts.push(...standard.wood)
  }
  const velarium = velariumGeometries()
  woodParts.push(...velarium.masts)
  root.add(mergedMesh(resources, goldParts, goldMaterial, { name: 'colosseum-gold' }))
  root.add(mergedMesh(resources, bannerParts, bannerMaterial, { castShadow: false, name: 'colosseum-banners' }))
  root.add(mergedMesh(resources, [...velarium.cloth, ...pulvinar.drape], clothMaterial, { castShadow: false, receiveShadow: false, name: 'colosseum-velarium' }))
  root.add(mergedMesh(resources, woodParts, woodMaterial, { name: 'colosseum-masts' }))
  root.add(mergedMesh(resources, [...pulvinar.pediment, ...portico.pediment], pedimentMaterial, { castShadow: false, name: 'colosseum-pediment' }))

  const city = cityGeometries()
  root.add(mergedMesh(resources, [...city.walls, ...city.aqueduct.map(part => tint(part, 0xd7c6a3))], cityWallMaterial, { castShadow: false, name: 'colosseum-city' }))
  root.add(mergedMesh(resources, [...city.roofs, ...pulvinar.roof], roofMaterial, { castShadow: false, name: 'colosseum-roofs' }))
  root.add(mergedMesh(resources, city.trees, foliageMaterial, { castShadow: false, name: 'colosseum-cypress' }))

  // Lighting: warm afternoon sun with one shadow map, cool sky fill.
  const sun = new THREE.DirectionalLight(0xffe2b0, 2.35)
  sun.position.set(-70, 95, -55)
  sun.target.position.set(0, 0, 4)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.camera.near = 10
  sun.shadow.camera.far = 320
  sun.shadow.camera.left = -88
  sun.shadow.camera.right = 88
  sun.shadow.camera.top = 82
  sun.shadow.camera.bottom = -82
  sun.shadow.bias = -0.0004
  sun.shadow.normalBias = 0.04
  resources.track({ dispose: () => sun.shadow.map?.dispose() })
  root.add(sun, sun.target)
  root.add(new THREE.HemisphereLight(0xbfdcf2, 0x9a7d55, 0.95))
  root.add(new THREE.AmbientLight(0xfff0d8, 0.18))

  root.traverse(node => { if (node !== root) { node.matrixAutoUpdate = false; node.updateMatrix() } })
  return {
    root,
    update(dt: number): void { flameTime.value += dt },
  }
}
