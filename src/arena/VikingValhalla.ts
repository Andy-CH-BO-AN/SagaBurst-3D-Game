import * as THREE from 'three'
import {
  ArenaResources, arenaRandom, bannerQuad, beamGeometry, boxBetween, brazierParts, createFlameMaterial, flameParts,
  mergedMesh, ownedMaterial, paintedTexture, speckle, tint,
} from './ArenaKit'
import {
  VALHALLA, valhallaAisleProps, valhallaBrazierPositions, valhallaHearthCenters, valhallaStairSurface,
} from './ValhallaLayout'
import { proceduralMaterial } from '../world/ProceduralMaterials'

/** Visual-only build of Valhöll. Collision lives in ValhallaLayout. */
export interface ValhallaVisuals {
  readonly root: THREE.Group
  update(dt: number): void
}

const v = VALHALLA
const V3 = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z)

// ── Textures ─────────────────────────────────────────────────────────────────

function planks(context: CanvasRenderingContext2D, width: number, height: number, seed: number, base: [number, number, number], rows: number, vertical = false): void {
  const random = arenaRandom(seed)
  const boards = rows
  for (let i = 0; i < boards; i++) {
    const shade = 0.82 + random() * 0.32
    const [r, g, b] = base.map(c => Math.round(c * shade))
    context.fillStyle = `rgb(${r}, ${g}, ${b})`
    if (vertical) context.fillRect(i / boards * width, 0, width / boards, height)
    else context.fillRect(0, i / boards * height, width, height / boards)
    // Grain.
    context.strokeStyle = `rgba(${Math.round(r * 0.55)}, ${Math.round(g * 0.5)}, ${Math.round(b * 0.45)}, 0.45)`
    for (let k = 0; k < 9; k++) {
      context.lineWidth = 0.6 + random() * 1.4
      context.beginPath()
      const offset = (i + random()) / boards
      for (let t = 0; t <= 1.0001; t += 0.05) {
        const wobble = Math.sin(t * 18 + k * 3 + i) * 2.4 + Math.sin(t * 47 + i) * 0.9
        if (vertical) {
          const x = offset * width + wobble
          if (t === 0) context.moveTo(x, t * height); else context.lineTo(x, t * height)
        } else {
          const y = offset * height + wobble
          if (t === 0) context.moveTo(t * width, y); else context.lineTo(t * width, y)
        }
      }
      context.stroke()
    }
    // Board ends and nails.
    context.fillStyle = 'rgba(10, 6, 3, 0.75)'
    if (vertical) context.fillRect((i + 1) / boards * width - 2, 0, 3, height)
    else {
      context.fillRect(0, (i + 1) / boards * height - 2, width, 3)
      const joint = random() * width
      context.fillRect(joint, i / boards * height, 3, height / boards)
      context.fillStyle = 'rgba(40, 34, 30, 0.9)'
      for (const x of [joint - 10, joint + 12]) context.fillRect(x, (i + 0.5) / boards * height - 2, 4, 4)
    }
  }
}

function knotwork(context: CanvasRenderingContext2D, width: number, height: number, background: string, groove: string, ridge: string): void {
  context.fillStyle = background
  context.fillRect(0, 0, width, height)
  // Interlaced strands: sinusoidal braids with over/under shading.
  const strands = 4
  for (let pass = 0; pass < 2; pass++) {
    for (let s = 0; s < strands; s++) {
      const phase = s / strands * Math.PI * 2
      context.strokeStyle = pass === 0 ? groove : ridge
      context.lineWidth = pass === 0 ? 26 : 14
      context.lineCap = 'round'
      context.beginPath()
      for (let y = -20; y <= height + 20; y += 4) {
        const x = width / 2 + Math.sin(y / height * Math.PI * 6 + phase) * width * 0.38
        if (y === -20) context.moveTo(x, y); else context.lineTo(x, y)
      }
      context.stroke()
    }
  }
  context.strokeStyle = groove
  context.lineWidth = 10
  for (const x of [8, width - 8]) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke() }
}

function drawValknut(context: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string, line: number): void {
  context.strokeStyle = color
  context.lineWidth = line
  context.lineJoin = 'miter'
  for (let i = 0; i < 3; i++) {
    const ox = Math.cos(-Math.PI / 2 + i * Math.PI * 2 / 3) * size * 0.32
    const oy = Math.sin(-Math.PI / 2 + i * Math.PI * 2 / 3) * size * 0.32
    context.beginPath()
    for (let k = 0; k <= 3; k++) {
      const a = -Math.PI / 2 + k * Math.PI * 2 / 3
      const x = cx + ox + Math.cos(a) * size * 0.55, y = cy + oy * 0.6 + Math.sin(a) * size * 0.55
      if (k === 0) context.moveTo(x, y); else context.lineTo(x, y)
    }
    context.stroke()
  }
}

const RUNES = ['ᚠ', 'ᚢ', 'ᚦ', 'ᚨ', 'ᚱ', 'ᚲ', 'ᚷ', 'ᚹ', 'ᚺ', 'ᚾ', 'ᛁ', 'ᛃ', 'ᛇ', 'ᛈ', 'ᛉ', 'ᛊ', 'ᛏ', 'ᛒ', 'ᛖ', 'ᛗ', 'ᛚ', 'ᛜ', 'ᛞ', 'ᛟ']

interface ValhallaTextures {
  floor: THREE.Texture
  wall: THREE.Texture
  roof: THREE.Texture
  pillar: THREE.Texture
  rune: THREE.Texture
  banner: THREE.Texture
  shields: THREE.Texture
  mountains: THREE.Texture
  stone: THREE.Texture
  carpet: THREE.Texture
  carved: THREE.Texture
}

function createTextures(resources: ArenaResources): ValhallaTextures {
  const floor = paintedTexture(resources, 1024, 1024, (context, { width, height }) => {
    planks(context, width, height, 3, [92, 62, 40], 10)
    speckle(context, width, height, 4, 18000, ['#2a1a10', '#6f4c33', '#1b120b'], 3)
  }, { repeat: [7, 16], anisotropy: 8 })
  const wall = paintedTexture(resources, 512, 512, (context, { width, height }) => {
    planks(context, width, height, 8, [70, 46, 30], 8, true)
  }, { repeat: [1, 1] })
  const roof = paintedTexture(resources, 512, 512, (context, { width, height }) => {
    planks(context, width, height, 12, [48, 34, 25], 12)
  })
  const pillar = paintedTexture(resources, 256, 512, (context, { width, height }) => {
    knotwork(context, width, height, '#6b4529', 'rgba(20, 11, 5, 0.85)', '#9b6c43')
    speckle(context, width, height, 15, 3000, ['#2a170b', '#a8784d'], 2)
  })
  const rune = paintedTexture(resources, 1024, 1024, (context, { width, height }) => {
    context.clearRect(0, 0, width, height)
    const cx = width / 2, cy = height / 2
    const ink = 'rgba(206, 168, 110, 0.82)'
    context.strokeStyle = ink
    for (const [radius, line] of [[0.48, 10], [0.455, 4], [0.36, 6], [0.335, 3], [0.17, 8]] as const) {
      context.lineWidth = line
      context.beginPath(); context.arc(cx, cy, radius * width, 0, Math.PI * 2); context.stroke()
    }
    // Interlaced knot band between the outer rings.
    context.lineWidth = 5
    for (let s = 0; s < 2; s++) {
      context.beginPath()
      for (let i = 0; i <= 720; i++) {
        const a = i / 720 * Math.PI * 2
        const r = (0.41 + Math.sin(a * 24 + s * Math.PI) * 0.03) * width
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r
        if (i === 0) context.moveTo(x, y); else context.lineTo(x, y)
      }
      context.stroke()
    }
    context.fillStyle = ink
    context.font = `bold ${Math.round(width * 0.052)}px serif`
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    for (let i = 0; i < RUNES.length; i++) {
      const a = i / RUNES.length * Math.PI * 2
      context.save()
      context.translate(cx + Math.cos(a) * width * 0.265, cy + Math.sin(a) * width * 0.265)
      context.rotate(a + Math.PI / 2)
      context.fillText(RUNES[i], 0, 0)
      context.restore()
    }
    drawValknut(context, cx, cy, width * 0.24, ink, 10)
    // Wear: lighter scratches.
    speckle(context, width, height, 31, 7000, ['rgba(0,0,0,0.6)'], 4)
  }, { anisotropy: 8 })
  const banner = paintedTexture(resources, 256, 512, (context, { width, height }) => {
    const gradient = context.createLinearGradient(0, 0, width, 0)
    gradient.addColorStop(0, '#4d0f0b'); gradient.addColorStop(0.5, '#86201a'); gradient.addColorStop(1, '#4d0f0b')
    context.fillStyle = gradient; context.fillRect(0, 0, width, height)
    context.strokeStyle = '#d9c6a2'; context.lineWidth = 6
    context.strokeRect(14, 14, width - 28, height - 70)
    drawValknut(context, width / 2, height * 0.42, width * 0.62, '#e6d8bd', 9)
    context.fillStyle = '#4d0f0b'
    for (let x = 0; x < width; x += 32) {
      context.beginPath(); context.moveTo(x, height - 50); context.lineTo(x + 16, height); context.lineTo(x + 32, height - 50); context.fill()
    }
    context.clearRect(0, height - 48, width, 48)
    context.fillStyle = gradient
    for (let x = 0; x < width; x += 32) {
      context.beginPath(); context.moveTo(x, height - 50); context.lineTo(x + 16, height - 4); context.lineTo(x + 32, height - 50); context.fill()
    }
  })
  const shields = paintedTexture(resources, 512, 512, (context) => {
    const designs: ((cx: number, cy: number, r: number) => void)[] = [
      (cx, cy, r) => { // quartered red / cream
        for (let q = 0; q < 4; q++) {
          context.fillStyle = q % 2 ? '#e2d4b6' : '#8c241b'
          context.beginPath(); context.moveTo(cx, cy); context.arc(cx, cy, r, q * Math.PI / 2, (q + 1) * Math.PI / 2); context.fill()
        }
      },
      (cx, cy, r) => { // spiral arms
        context.fillStyle = '#d8c7a5'; context.beginPath(); context.arc(cx, cy, r, 0, Math.PI * 2); context.fill()
        context.fillStyle = '#7c1f17'
        for (let k = 0; k < 3; k++) {
          context.beginPath(); context.moveTo(cx, cy)
          for (let t = 0; t <= 1; t += 0.05) {
            const a = k * Math.PI * 2 / 3 + t * 2.4
            context.lineTo(cx + Math.cos(a) * r * t, cy + Math.sin(a) * r * t)
          }
          context.arc(cx, cy, r, k * Math.PI * 2 / 3 + 2.4, k * Math.PI * 2 / 3 + 3.2)
          context.fill()
        }
      },
      (cx, cy, r) => { // cross of blue and white
        context.fillStyle = '#2f4762'; context.beginPath(); context.arc(cx, cy, r, 0, Math.PI * 2); context.fill()
        context.fillStyle = '#e6dcc6'
        context.fillRect(cx - r, cy - r * 0.16, r * 2, r * 0.32); context.fillRect(cx - r * 0.16, cy - r, r * 0.32, r * 2)
      },
      (cx, cy, r) => { // red with white rim and valknut
        context.fillStyle = '#9a2a1f'; context.beginPath(); context.arc(cx, cy, r, 0, Math.PI * 2); context.fill()
        drawValknut(context, cx, cy + r * 0.05, r * 1.1, '#efe3c9', 7)
      },
    ]
    designs.forEach((draw, index) => {
      const cx = (index % 2) * 256 + 128, cy = Math.floor(index / 2) * 256 + 128
      context.fillStyle = '#3a2618'; context.fillRect(cx - 128, cy - 128, 256, 256)
      draw(cx, cy, 118)
      context.strokeStyle = '#4a3a2c'; context.lineWidth = 10
      context.beginPath(); context.arc(cx, cy, 118, 0, Math.PI * 2); context.stroke()
      context.strokeStyle = 'rgba(30, 18, 10, 0.35)'; context.lineWidth = 2
      for (let p = 0; p < 10; p++) { context.beginPath(); context.moveTo(cx - 118, cy - 100 + p * 22); context.lineTo(cx + 118, cy - 100 + p * 22); context.stroke() }
      const boss = context.createRadialGradient(cx - 6, cy - 6, 2, cx, cy, 26)
      boss.addColorStop(0, '#d0d0c8'); boss.addColorStop(1, '#4b4b48')
      context.fillStyle = boss; context.beginPath(); context.arc(cx, cy, 24, 0, Math.PI * 2); context.fill()
    })
  })
  const mountains = paintedTexture(resources, 512, 256, (context, { width, height }) => {
    const sky = context.createLinearGradient(0, 0, 0, height)
    sky.addColorStop(0, '#5c7591'); sky.addColorStop(0.6, '#a9bacb'); sky.addColorStop(1, '#d2dce5')
    context.fillStyle = sky; context.fillRect(0, 0, width, height)
    const random = arenaRandom(55)
    for (const [base, color, snow] of [[0.75, '#6f8094', '#e9eff5'], [0.9, '#4d5b6b', '#cfd9e3']] as const) {
      context.fillStyle = color
      context.beginPath(); context.moveTo(0, height)
      const peaks: [number, number][] = []
      for (let x = 0; x <= width; x += width / 7) {
        const y = height * (base - 0.25 - random() * 0.35)
        peaks.push([x, y]); context.lineTo(x, y); context.lineTo(x + width / 14, height * (base - 0.05))
      }
      context.lineTo(width, height); context.fill()
      context.fillStyle = snow
      for (const [x, y] of peaks) { context.beginPath(); context.moveTo(x, y); context.lineTo(x - 18, y + 26); context.lineTo(x + 20, y + 24); context.fill() }
    }
  })
  const stone = paintedTexture(resources, 512, 512, (context, { width, height }) => {
    context.fillStyle = '#5c5953'; context.fillRect(0, 0, width, height)
    const random = arenaRandom(61)
    for (let r = 0; r < 6; r++) for (let c = 0; c < 5; c++) {
      const s = 70 + Math.floor(random() * 40)
      context.fillStyle = `rgb(${s + 8}, ${s + 4}, ${s})`
      context.fillRect(c * 104 + (r % 2) * 50 + 3, r * 86 + 3, 98, 80)
    }
    speckle(context, width, height, 62, 9000, ['#2f2c28', '#8a857c'], 2.5)
  })
  const carpet = paintedTexture(resources, 256, 1024, (context, { width, height }) => {
    context.fillStyle = '#701812'; context.fillRect(0, 0, width, height)
    context.fillStyle = '#c69a4a'; context.fillRect(12, 0, 14, height); context.fillRect(width - 26, 0, 14, height)
    context.strokeStyle = '#c69a4a'; context.lineWidth = 4
    for (let y = 40; y < height; y += 120) {
      context.beginPath(); context.moveTo(width / 2, y); context.lineTo(width * 0.78, y + 50); context.lineTo(width / 2, y + 100); context.lineTo(width * 0.22, y + 50); context.closePath(); context.stroke()
    }
    speckle(context, width, height, 71, 4000, ['#4a0d09', '#8f2a20'], 2)
  })
  const carved = paintedTexture(resources, 512, 512, (context, { width, height }) => {
    context.fillStyle = '#7d5a3c'; context.fillRect(0, 0, width, height)
    speckle(context, width, height, 81, 16000, ['#4b3220', '#a37a52', '#5e412a'], 3)
    context.strokeStyle = 'rgba(40, 24, 12, 0.4)'
    const random = arenaRandom(82)
    for (let i = 0; i < 60; i++) {
      context.lineWidth = 1 + random() * 2
      context.beginPath(); const x = random() * width
      context.moveTo(x, 0); context.bezierCurveTo(x + 20, height * 0.3, x - 20, height * 0.6, x + 10, height); context.stroke()
    }
  })
  return { floor, wall, roof, pillar, rune, banner, shields, mountains, stone, carpet, carved }
}

// ── Builders ─────────────────────────────────────────────────────────────────

function planeWithUv(width: number, height: number, uScale: number, vScale: number): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(width, height)
  const uv = geometry.getAttribute('uv')
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * width / uScale, uv.getY(i) * height / vScale)
  return geometry
}

function shellGeometries(prisonExit = false): { walls: THREE.BufferGeometry[]; roof: THREE.BufferGeometry[] } {
  const length = v.backZ - v.frontZ, midZ = (v.backZ + v.frontZ) / 2
  const walls: THREE.BufferGeometry[] = []
  // Side walls (inner faces), front and back walls with gables.
  walls.push(planeWithUv(length, v.eaveY + 0.6, 5, 5).rotateY(Math.PI / 2).translate(-v.halfWidth, (v.eaveY + 0.6) / 2, midZ))
  walls.push(planeWithUv(length, v.eaveY + 0.6, 5, 5).rotateY(-Math.PI / 2).translate(v.halfWidth, (v.eaveY + 0.6) / 2, midZ))
  const gable = (z: number, facing: 1 | -1): THREE.BufferGeometry => {
    const shape = new THREE.Shape()
    shape.moveTo(-v.halfWidth, 0)
    if (prisonExit && facing === 1) {
      shape.lineTo(-1.5, 0); shape.lineTo(-1.5, 3.2); shape.lineTo(1.5, 3.2); shape.lineTo(1.5, 0)
    }
    shape.lineTo(v.halfWidth, 0); shape.lineTo(v.halfWidth, v.eaveY)
    shape.lineTo(0, v.ridgeY + 0.3); shape.lineTo(-v.halfWidth, v.eaveY); shape.closePath()
    const geometry = new THREE.ShapeGeometry(shape)
    const position = geometry.getAttribute('position'), uv = geometry.getAttribute('uv')
    for (let i = 0; i < position.count; i++) uv.setXY(i, position.getX(i) / 5, position.getY(i) / 5)
    if (facing < 0) geometry.rotateY(Math.PI)
    return geometry.translate(0, 0, z)
  }
  walls.push(gable(v.frontZ, 1), gable(v.backZ, -1))
  // Roof underside: two slopes from the eaves to the ridge, facing down/in.
  const roof: THREE.BufferGeometry[] = []
  const z0 = v.frontZ - 0.2, z1 = v.backZ + 0.2
  for (const side of [-1, 1]) {
    const ex = side * (v.halfWidth + 0.3), ey = v.eaveY + 0.4
    const geometry = new THREE.BufferGeometry()
    const slope = Math.hypot(ex, v.ridgeY - ey)
    const verts = side < 0
      ? [ex, ey, z0, 0, v.ridgeY, z0, ex, ey, z1, ex, ey, z1, 0, v.ridgeY, z0, 0, v.ridgeY, z1]
      : [ex, ey, z0, ex, ey, z1, 0, v.ridgeY, z0, ex, ey, z1, 0, v.ridgeY, z1, 0, v.ridgeY, z0]
    const uvs = side < 0
      ? [0, 0, slope / 5, 0, 0, (z1 - z0) / 5, 0, (z1 - z0) / 5, slope / 5, 0, slope / 5, (z1 - z0) / 5]
      : [0, 0, 0, (z1 - z0) / 5, slope / 5, 0, 0, (z1 - z0) / 5, slope / 5, (z1 - z0) / 5, slope / 5, 0]
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    geometry.computeVertexNormals()
    roof.push(geometry)
  }
  return { walls, roof }
}

function trussGeometries(): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = []
  const tie = v.eaveY + 0.4
  const trusses = [v.frontZ + 1, ...v.pillarZ, v.backZ - 1]
  for (const z of trusses) {
    // The end truss over the throne keeps only its rafters so Odin's relief stays in view.
    const open = z === v.backZ - 1
    if (!open) {
      parts.push(beamGeometry(V3(-v.halfWidth, tie, z), V3(v.halfWidth, tie, z), 0.55, 0.75))
      parts.push(beamGeometry(V3(0, tie, z), V3(0, v.ridgeY, z), 0.5, 0.5))
    }
    for (const side of [-1, 1]) {
      parts.push(beamGeometry(V3(side * (v.halfWidth + 0.3), tie, z), V3(0, v.ridgeY + 0.1, z), 0.5, 0.6))
      if (open) continue
      parts.push(beamGeometry(V3(side * v.pillarX, tie, z), V3(side * 2.2, v.ridgeY - 4.2, z), 0.36, 0.42))
      parts.push(beamGeometry(V3(side * 5.5, 18.6, z), V3(side * 0.3, 18.6, z), 0.36, 0.4))
    }
  }
  // Longitudinal plates, purlins, ridge beam and cross bracing.
  for (const side of [-1, 1]) {
    parts.push(beamGeometry(V3(side * v.pillarX, v.eaveY, v.frontZ), V3(side * v.pillarX, v.eaveY, v.backZ), 0.7, 0.7))
    parts.push(beamGeometry(V3(side * v.halfWidth, v.eaveY - 0.2, v.frontZ), V3(side * v.halfWidth, v.eaveY - 0.2, v.backZ), 0.6, 0.6))
    for (const t of [0.33, 0.66]) {
      const x = side * v.halfWidth * (1 - t), y = v.eaveY + 0.4 + (v.ridgeY - v.eaveY - 0.4) * t
      parts.push(beamGeometry(V3(x, y - 0.35, v.frontZ), V3(x, y - 0.35, v.backZ), 0.4, 0.4))
    }
  }
  parts.push(beamGeometry(V3(0, v.ridgeY - 0.4, v.frontZ), V3(0, v.ridgeY - 0.4, v.backZ), 0.6, 0.6))
  for (let i = 0; i + 1 < trusses.length; i++) {
    const z0 = trusses[i], z1 = trusses[i + 1]
    parts.push(beamGeometry(V3(0, v.ridgeY - 0.8, z0), V3(0, v.ridgeY - 5.5, z1), 0.28, 0.32))
    parts.push(beamGeometry(V3(0, v.ridgeY - 5.5, z0), V3(0, v.ridgeY - 0.8, z1), 0.28, 0.32))
  }
  return parts
}

/** Stylised carved dragon head authored facing local +Z, mounted on the pillar's inner face. */
function dragonHead(): THREE.BufferGeometry[] {
  const wood = 0xc29a6c, dark = 0x2c1a0e, light = 0xe3c08a
  const parts: THREE.BufferGeometry[] = []
  const add = (geometry: THREE.BufferGeometry, color: number): void => { parts.push(tint(geometry, color)) }
  // Curled neck rising from the pillar.
  add(new THREE.TorusGeometry(0.55, 0.26, 5, 7, Math.PI * 1.1).rotateY(Math.PI / 2).translate(0, -0.4, 0.55), wood)
  add(new THREE.CylinderGeometry(0.3, 0.38, 1.2, 6, 1, true).rotateX(0.55).translate(0, 0.25, 0.75), wood)
  // Skull, snout and open jaws.
  add(new THREE.SphereGeometry(0.42, 8, 6).scale(1, 0.9, 1.2).translate(0, 0.75, 1.15), wood)
  add(new THREE.CylinderGeometry(0.2, 0.33, 1.1, 6).rotateX(Math.PI / 2 + 0.15).translate(0, 0.78, 1.85), wood)
  add(new THREE.CylinderGeometry(0.12, 0.24, 0.95, 5).rotateX(Math.PI / 2 - 0.45).translate(0, 0.42, 1.75), wood)
  add(new THREE.ConeGeometry(0.1, 0.25, 6).rotateX(Math.PI / 2).translate(0, 0.86, 2.45), light)
  for (const side of [-1, 1]) {
    add(new THREE.SphereGeometry(0.09, 5, 4).translate(side * 0.27, 0.95, 1.3), dark)
    add(new THREE.ConeGeometry(0.11, 0.85, 6).rotateX(-1.15).rotateZ(side * 0.35).translate(side * 0.22, 1.25, 0.75), wood)
    add(new THREE.ConeGeometry(0.07, 0.5, 5).rotateX(-1.4).translate(side * 0.12, 1.08, 0.5), light)
    for (let k = 0; k < 2; k++) add(new THREE.ConeGeometry(0.04, 0.18, 3).rotateX(Math.PI).translate(side * 0.13, 0.66, 1.55 + k * 0.17), light)
    // Mane fins.
    add(boxBetween(-0.03 + side * 0.18, 0.3, 0.2, 0.03 + side * 0.18, 1.05, 0.65).rotateX(-0.3), wood)
  }
  return parts
}

function pillarGeometries(): { pillars: THREE.BufferGeometry[]; bands: THREE.BufferGeometry[]; carving: THREE.BufferGeometry[] } {
  const pillars: THREE.BufferGeometry[] = [], bands: THREE.BufferGeometry[] = [], carving: THREE.BufferGeometry[] = []
  const head = dragonHead()
  for (const z of v.pillarZ) for (const side of [-1, 1]) {
    const x = side * v.pillarX
    const pillar = new THREE.CylinderGeometry(0.78, 0.84, v.eaveY, 16, 1, true).translate(x, v.eaveY / 2, z)
    const uv = pillar.getAttribute('uv')
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * 3)
    pillars.push(pillar)
    for (const y of [0.25, 2.6, 9.9]) bands.push(new THREE.CylinderGeometry(0.88, 0.88, y < 1 ? 0.5 : 0.22, 12, 1, true).translate(x, y, z))
    carving.push(tint(boxBetween(x - 1, v.eaveY - 0.5, z - 1, x + 1, v.eaveY, z + 1), 0x8a6644))
    for (const part of head) {
      carving.push(part.clone().rotateY(side < 0 ? Math.PI / 2 : -Math.PI / 2).translate(x - side * 0.62, 7.9, z))
    }
  }
  for (const part of head) part.dispose()
  return { pillars, bands, carving }
}

function hearthGeometries(): { stone: THREE.BufferGeometry[]; wood: THREE.BufferGeometry[]; embers: THREE.BufferGeometry[]; flame: THREE.BufferGeometry[] } {
  const stone: THREE.BufferGeometry[] = [], wood: THREE.BufferGeometry[] = [], embers: THREE.BufferGeometry[] = [], flame: THREE.BufferGeometry[] = []
  const random = arenaRandom(9)
  for (const z of valhallaHearthCenters()) for (const side of [-1, 1]) {
    const x = side * v.pillarX
    const hl = v.hearthHalfLength, hw = v.hearthHalfWidth, h = v.hearthHeight
    stone.push(boxBetween(x - hw, 0, z - hl, x - hw + 0.22, h, z + hl), boxBetween(x + hw - 0.22, 0, z - hl, x + hw, h, z + hl))
    stone.push(boxBetween(x - hw, 0, z - hl, x + hw, h, z - hl + 0.22), boxBetween(x - hw, 0, z + hl - 0.22, x + hw, h, z + hl))
    stone.push(boxBetween(x - hw, 0, z - hl, x + hw, 0.18, z + hl))
    embers.push(new THREE.PlaneGeometry(hw * 2 - 0.44, hl * 2 - 0.44).rotateX(-Math.PI / 2).translate(x, 0.3, z))
    for (let k = 0; k < 6; k++) {
      const lz = z - hl + 0.5 + k / 5 * (hl * 2 - 1)
      wood.push(new THREE.CylinderGeometry(0.1, 0.12, 1, 6).rotateZ(Math.PI / 2).rotateY((random() - 0.5) * 0.8).translate(x, 0.36, lz))
    }
    for (let k = 0; k < 3; k++) flame.push(...flameParts(x, 0.32, z - hl + 0.9 + k / 2 * (hl * 2 - 1.8), 1.3, 200 + Math.round(z) * 7 + k + side * 50, 5))
  }
  return { stone, wood, embers, flame }
}

function daisGeometries(): { stone: THREE.BufferGeometry[]; carpet: THREE.BufferGeometry[]; wood: THREE.BufferGeometry[] } {
  const stone: THREE.BufferGeometry[] = [], carpet: THREE.BufferGeometry[] = [], wood: THREE.BufferGeometry[] = []
  const d = v.dais, s = v.stair
  stone.push(boxBetween(-d.halfWidth, 0, d.frontZ, -s.halfWidth, d.topY, v.backZ))
  stone.push(boxBetween(s.halfWidth, 0, d.frontZ, d.halfWidth, d.topY, v.backZ))
  stone.push(boxBetween(-s.halfWidth, 0, s.landingZ, s.halfWidth, d.topY, v.backZ))
  // Wooden deck and front trim.
  wood.push(boxBetween(-d.halfWidth - 0.1, d.topY - 0.12, d.frontZ - 0.1, d.halfWidth + 0.1, d.topY + 0.02, v.backZ))
  const surface = valhallaStairSurface()
  const steps = 8
  const run = surface.length / steps, rise = d.topY / steps
  for (let i = 0; i < steps; i++) {
    const z0 = s.lowZ + i * run, z1 = s.lowZ + (i + 1) * run
    const top = (i + 0.5) * rise
    stone.push(boxBetween(-s.halfWidth, 0, z0, s.halfWidth, top, z1))
    carpet.push(boxBetween(-1.4, top, z0, 1.4, top + 0.03, z1))
    carpet.push(boxBetween(-1.4, top - rise, z0 - 0.02, 1.4, top + 0.03, z0 + 0.01))
  }
  stone.push(boxBetween(-s.halfWidth, 0, d.frontZ, s.halfWidth, d.topY, s.landingZ))
  carpet.push(boxBetween(-1.4, d.topY + 0.02, d.frontZ, 1.4, d.topY + 0.05, v.throne.minZ))
  // Carpet runner on the hall floor toward the rune circle.
  carpet.push(boxBetween(-1.4, 0.005, s.lowZ - 9, 1.4, 0.03, s.lowZ))
  // Stair cheeks (flush with the side blocks).
  for (const side of [-1, 1]) wood.push(boxBetween(side * s.halfWidth - 0.15, 0, s.lowZ, side * s.halfWidth + 0.15, 0.3, d.frontZ))
  return { stone, carpet, wood }
}

function throneGeometries(): { wood: THREE.BufferGeometry[]; gold: THREE.BufferGeometry[]; fur: THREE.BufferGeometry[]; black: THREE.BufferGeometry[] } {
  const wood: THREE.BufferGeometry[] = [], gold: THREE.BufferGeometry[] = [], fur: THREE.BufferGeometry[] = [], black: THREE.BufferGeometry[] = []
  const t = v.throne, y = v.dais.topY
  wood.push(boxBetween(-t.halfWidth, y, t.minZ, t.halfWidth, y + 0.75, t.maxZ))
  wood.push(boxBetween(-t.halfWidth, y + 0.75, t.maxZ - 0.45, t.halfWidth, y + t.height, t.maxZ))
  for (const side of [-1, 1]) {
    wood.push(boxBetween(side * t.halfWidth - 0.3, y + 0.75, t.minZ, side * t.halfWidth, y + 1.45, t.maxZ - 0.45))
    gold.push(new THREE.SphereGeometry(0.16, 8, 6).translate(side * (t.halfWidth - 0.15), y + 1.55, t.minZ + 0.1))
    gold.push(new THREE.ConeGeometry(0.16, 0.7, 6).translate(side * (t.halfWidth - 0.15), y + t.height + 0.35, t.maxZ - 0.22))
  }
  gold.push(boxBetween(-t.halfWidth - 0.05, y + t.height - 0.25, t.maxZ - 0.5, t.halfWidth + 0.05, y + t.height - 0.1, t.maxZ + 0.05))
  gold.push(new THREE.TorusGeometry(0.45, 0.06, 6, 18).translate(0, y + 2.6, t.maxZ - 0.48))
  fur.push(boxBetween(-t.halfWidth + 0.2, y + 0.75, t.minZ - 0.05, t.halfWidth - 0.2, y + 0.9, t.maxZ - 0.45))
  fur.push(boxBetween(-t.halfWidth + 0.25, y + 0.9, t.maxZ - 0.52, t.halfWidth - 0.25, y + 2.2, t.maxZ - 0.44))
  // Ravens on perches either side.
  for (const side of [-1, 1]) {
    const x = side * 2.6, base = y
    wood.push(new THREE.CylinderGeometry(0.12, 0.16, 1.9, 8).translate(x, base + 0.95, 31.45))
    wood.push(boxBetween(x - 0.35, base + 1.85, 31.2, x + 0.35, base + 1.98, 31.7))
    const ry = base + 2.2
    black.push(new THREE.SphereGeometry(0.2, 10, 8).scale(1, 1.15, 1.6).rotateX(-0.5).translate(x, ry, 31.45))
    black.push(new THREE.SphereGeometry(0.13, 10, 8).translate(x, ry + 0.3, 31.25))
    black.push(new THREE.ConeGeometry(0.045, 0.24, 6).rotateX(-Math.PI / 2 - 0.3).translate(x, ry + 0.27, 31.05))
    black.push(new THREE.ConeGeometry(0.12, 0.45, 4).rotateX(Math.PI / 2 + 0.6).translate(x, ry - 0.1, 31.8))
    for (const wing of [-1, 1]) black.push(new THREE.SphereGeometry(0.16, 8, 6).scale(0.35, 0.9, 1.7).translate(x + wing * 0.16, ry, 31.5))
  }
  // Antler candelabra stands behind the perches.
  for (const side of [-1, 1]) {
    const x = side * 4.6, base = y
    gold.push(new THREE.CylinderGeometry(0.16, 0.24, 2.4, 8).translate(x, base + 1.2, 32.8))
    for (let k = 0; k < 5; k++) {
      const a = (k / 4 - 0.5) * 2.1
      const from = V3(x, base + 1.6 + k * 0.25, 32.8)
      const to = V3(x + Math.sin(a) * 1.35 * side, base + 3.4 + Math.cos(a) * 0.9, 32.8 + (k % 2 ? 0.25 : -0.25))
      gold.push(beamGeometry(from, to, 0.1, 0.12))
      gold.push(beamGeometry(to, to.clone().add(V3(0, 0.55, 0)), 0.07, 0.07))
    }
  }
  return { wood, gold, fur, black }
}

/** Odin's carved head relief on the back wall above the throne. */
function odinRelief(): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = []
  const r = v.relief
  const wallZ = v.backZ
  const cz = wallZ - 0.4
  const wood = 0xb48a5e, deep = 0x3a2616, light = 0xdab384
  const add = (geometry: THREE.BufferGeometry, color: number): void => { parts.push(tint(geometry, color)) }
  // Back panel and frame.
  add(boxBetween(-r.halfWidth, 3, wallZ - 0.35, r.halfWidth, r.topY, wallZ), 0x5c4128)
  // Face.
  add(new THREE.SphereGeometry(1, 14, 10).scale(3.3, 4.2, 1.6).translate(0, 13.2, cz - 0.4), wood)
  // Helmet dome, rim and nasal guard.
  const helmet = 0x8a8580
  add(new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(3.9, 3.6, 2.1).translate(0, 16.2, cz - 0.5), helmet)
  add(new THREE.TorusGeometry(3.85, 0.32, 6, 24, Math.PI).scale(1, 0.35, 1).translate(0, 16.2, cz - 1.25), 0xb8954f)
  add(boxBetween(-0.45, 12.3, cz - 2.0, 0.45, 16.6, cz - 1.3), helmet)
  add(boxBetween(-0.14, 16.6, cz - 2.55, 0.14, 19.6, cz - 1.9), 0xb8954f)
  // Helmet wings.
  for (const side of [-1, 1]) {
    for (let k = 0; k < 4; k++) add(boxBetween(-0.12, 0, -0.1, 0.12, 2.2 - k * 0.35, 0.1).rotateZ(side * (0.6 + k * 0.22)).translate(side * (4.1 + k * 0.15), 15.8 + k * 0.15, cz - 0.6), wood)
  }
  // Brow, eyes (one closed under a patch), nose.
  add(boxBetween(-2.8, 14.55, cz - 2.05, 2.8, 15.1, cz - 1.55).rotateX(0.1), deep)
  add(new THREE.SphereGeometry(0.42, 10, 8).scale(1.3, 0.75, 0.6).translate(-1.35, 13.95, cz - 1.75), deep)
  add(new THREE.SphereGeometry(0.2, 8, 6).translate(-1.35, 13.95, cz - 1.95), 0xdfd2b2)
  add(boxBetween(0.6, 13.6, cz - 2.0, 2.2, 14.35, cz - 1.75), 0x22150b)
  add(beamGeometry(V3(2.4, 15.2, cz - 1.7), V3(-2.6, 12.5, cz - 1.7), 0.12, 0.12), 0x22150b)
  const nose = new THREE.ConeGeometry(0.55, 2.6, 4).rotateY(Math.PI / 4).scale(1, 1, 0.8).translate(0, 12.4, cz - 1.95)
  add(nose, wood)
  // Moustache and long braided beard.
  for (const side of [-1, 1]) {
    add(new THREE.ConeGeometry(0.35, 3.2, 7).rotateZ(side * 2.1).translate(side * 1.3, 10.6, cz - 1.75), light)
  }
  const random = arenaRandom(301)
  for (let i = 0; i < 15; i++) {
    const t = i / 14 - 0.5
    const x = t * 5.6
    const length = 5.5 + (1 - Math.abs(t) * 2) * 3.4 + random() * 0.6
    const top = 10.7 - Math.abs(t) * 0.8
    const strand = new THREE.ConeGeometry(0.42 + random() * 0.12, length, 7).rotateX(Math.PI).rotateZ(-t * 0.35)
    add(strand.translate(x, top - length / 2, cz - 1.2 - (1 - Math.abs(t)) * 0.5), i % 2 ? wood : light)
  }
  // Braid rings.
  for (const x of [-0.8, 0.8]) add(new THREE.TorusGeometry(0.4, 0.1, 6, 12).rotateX(Math.PI / 2).translate(x, 4.6, cz - 1.6), 0xcaa04b)
  return parts
}

function galleryGeometries(): { wood: THREE.BufferGeometry[]; shields: THREE.BufferGeometry[]; fur: THREE.BufferGeometry[]; warriors: THREE.BufferGeometry[] } {
  const wood: THREE.BufferGeometry[] = [], shields: THREE.BufferGeometry[] = [], fur: THREE.BufferGeometry[] = [], warriors: THREE.BufferGeometry[] = []
  const g = v.gallery
  const random = arenaRandom(17)
  for (const side of [-1, 1]) {
    const inner = side * g.innerX, outer = side * v.halfWidth
    wood.push(boxBetween(Math.min(inner, outer), g.floorY - 0.35, g.minZ, Math.max(inner, outer), g.floorY, g.maxZ))
    wood.push(boxBetween(inner - 0.15, g.floorY + g.railHeight - 0.12, g.minZ, inner + 0.15, g.floorY + g.railHeight, g.maxZ))
    wood.push(boxBetween(inner - 0.12, g.floorY + 0.2, g.minZ, inner + 0.12, g.floorY + 0.32, g.maxZ))
    for (let z = g.minZ + 2; z <= g.maxZ - 1; z += 5) {
      wood.push(boxBetween(inner - 0.2, 0, z - 0.2, inner + 0.2, g.floorY + g.railHeight + 0.4, z + 0.2))
      wood.push(beamGeometry(V3(inner, g.floorY - 1.4, z), V3(inner + side * 1.6, g.floorY - 0.2, z), 0.2, 0.2))
    }
    // Shields hang on the rail facing the hall.
    let index = 0
    for (let z = g.minZ + 1; z <= g.maxZ - 0.5; z += 1.55, index++) {
      // Front face only (the back is against the rail); atlas cell picks the design.
      const disc = new THREE.CircleGeometry(0.62, 14)
      const cell = index % 4
      const uv = disc.getAttribute('uv')
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (cell % 2) * 0.5 + uv.getX(i) * 0.5, (1 - Math.floor(cell / 2) * 0.5) - (1 - uv.getY(i)) * 0.5)
      shields.push(disc.rotateY(side < 0 ? Math.PI / 2 : -Math.PI / 2).translate(inner - side * 0.17, g.floorY + 0.55, z))
      if (index % 3 === 1) {
        const pelt = new THREE.PlaneGeometry(1.1, 1.6, 3, 3)
        const pp = pelt.getAttribute('position')
        for (let i = 0; i < pp.count; i++) pp.setZ(i, Math.sin(pp.getX(i) * 2.4) * 0.08 + Math.abs(pp.getY(i)) * 0.05)
        pelt.computeVertexNormals()
        fur.push(pelt.rotateY(side < 0 ? Math.PI / 2 : -Math.PI / 2).translate(inner - side * 0.2, g.floorY + g.railHeight - 0.65, z + 0.78))
      }
    }
    // Einherjar gathered on the gallery.
    for (let z = g.minZ + 2.5; z <= g.maxZ - 1.5; z += 6.4) {
      const x = side * (g.innerX + 1.1 + random() * 1.4)
      const zz = z + (random() - 0.5) * 1.2
      const y = g.floorY
      const facing = side < 0 ? Math.PI / 2 : -Math.PI / 2
      const place = (geometry: THREE.BufferGeometry, color: number): void => {
        warriors.push(tint(geometry.rotateY(facing).translate(x, y, zz), color))
      }
      place(new THREE.CylinderGeometry(0.28, 0.36, 1.05, 6).translate(0, 0.95, 0), 0x3d3024)
      place(new THREE.CylinderGeometry(0.2, 0.42, 1.05, 6, 1, true).translate(0, 0.52, -0.05), 0x2a221b)
      place(new THREE.SphereGeometry(0.17, 6, 5).translate(0, 1.6, 0), 0xc9a183)
      place(new THREE.SphereGeometry(0.19, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 1.64, 0), 0x6a6d70)
      place(boxBetween(-0.025, 1.45, 0.15, 0.025, 1.7, 0.2), 0x6a6d70)
      place(new THREE.ConeGeometry(0.2, 0.42, 7).rotateX(Math.PI).translate(0, 1.38, 0.1), 0x7a5232)
      place(new THREE.CylinderGeometry(0.025, 0.025, 2.6, 5).translate(0.32, 1.3, 0.12), 0x5a4330)
      place(new THREE.ConeGeometry(0.06, 0.3, 4).translate(0.32, 2.75, 0.12), 0x9a9da0)
    }
  }
  return { wood, shields, fur, warriors }
}

function windowGeometries(): { frames: THREE.BufferGeometry[]; views: THREE.BufferGeometry[]; glow: THREE.BufferGeometry[] } {
  const frames: THREE.BufferGeometry[] = [], views: THREE.BufferGeometry[] = [], glow: THREE.BufferGeometry[] = []
  const zs = v.pillarZ.slice(0, -1).map((z, i) => (z + v.pillarZ[i + 1]) / 2)
  for (const side of [-1, 1]) for (const z of zs) {
    const x = side * (v.halfWidth - 0.03)
    const view = planeWithUv(3.2, 2.6, 3.2, 2.6).rotateY(side < 0 ? Math.PI / 2 : -Math.PI / 2).translate(x, 8, z)
    views.push(view)
    for (const dz of [-1.75, 1.75]) frames.push(boxBetween(x - 0.18, 6.6, z + dz - 0.15, x + 0.18, 9.45, z + dz + 0.15))
    frames.push(boxBetween(x - 0.2, 9.3, z - 1.9, x + 0.2, 9.6, z + 1.9), boxBetween(x - 0.2, 6.55, z - 1.9, x + 0.2, 6.75, z + 1.9))
    frames.push(boxBetween(x - 0.12, 6.7, z - 0.07, x + 0.12, 9.35, z + 0.07))
  }
  // Tall window in the back gable above Odin.
  const back = new THREE.Shape()
  back.moveTo(-1.6, 0); back.lineTo(1.6, 0); back.lineTo(1.6, 3.6); back.lineTo(0, 5.4); back.lineTo(-1.6, 3.6); back.closePath()
  glow.push(new THREE.ShapeGeometry(back).rotateY(Math.PI).translate(0, 17.6, v.backZ - 0.05))
  glow.push(new THREE.ShapeGeometry(back).scale(0.55, 0.6, 1).translate(0, 18.5, v.frontZ + 0.05))
  return { frames, views, glow }
}

function lightShaftGeometries(): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = []
  const random = arenaRandom(77)
  for (let i = 0; i < 5; i++) {
    const topX = (random() - 0.5) * 2.6, topZ = v.backZ - 0.6
    const bottomX = topX * 2.2 + (random() - 0.5) * 3, bottomZ = 22 - i * 2.2
    const width = 0.5 + random() * 0.6
    const geometry = new THREE.BufferGeometry()
    const top = 21 - random() * 2
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      topX - width * 0.35, top, topZ, topX + width * 0.35, top, topZ, bottomX - width, 0.1, bottomZ,
      topX + width * 0.35, top, topZ, bottomX + width, 0.1, bottomZ, bottomX - width, 0.1, bottomZ,
    ], 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 0, 0, 1, 1, 1, 0, 0, 0], 2))
    geometry.computeVertexNormals()
    parts.push(geometry)
  }
  return parts
}

function bannerGeometries(): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = []
  const zs = v.pillarZ
  for (const side of [-1, 1]) {
    for (const z of zs) parts.push(bannerQuad(side * (v.halfWidth - 0.05), v.eaveY - 0.3, z, side < 0 ? Math.PI / 2 : -Math.PI / 2, 1.5, 3.6, 0.02))
    // Pillar-face banners toward the central floor, below the dragon heads.
    for (const z of [zs[1], zs[3]]) parts.push(bannerQuad(side * (v.pillarX - 0.86), 6.9, z, side < 0 ? Math.PI / 2 : -Math.PI / 2, 1.2, 3.2, 0.02))
  }
  for (const x of [-10.5, 10.5]) parts.push(bannerQuad(x, 15.5, v.backZ - 0.05, Math.PI, 2.6, 8.5, 0.02))
  return parts
}

function doorGeometries(): { wood: THREE.BufferGeometry[]; iron: THREE.BufferGeometry[] } {
  const wood: THREE.BufferGeometry[] = [], iron: THREE.BufferGeometry[] = []
  const z = v.frontZ + 0.08
  for (const side of [-1, 1]) {
    wood.push(boxBetween(side < 0 ? -3.2 : 0.04, 0, z, side < 0 ? -0.04 : 3.2, 8.2, z + 0.16))
    for (const y of [1.4, 4.1, 6.8]) iron.push(boxBetween(side < 0 ? -3.1 : 0.1, y, z + 0.16, side < 0 ? -0.1 : 3.1, y + 0.2, z + 0.24))
    iron.push(new THREE.TorusGeometry(0.28, 0.05, 6, 14).translate(side * 0.6, 3.6, z + 0.3))
  }
  wood.push(boxBetween(-4, 0, z - 0.05, -3.2, 9.4, z + 0.5), boxBetween(3.2, 0, z - 0.05, 4, 9.4, z + 0.5), boxBetween(-4.3, 8.2, z - 0.05, 4.3, 9.4, z + 0.55))
  iron.push(boxBetween(-0.3, 3.2, z + 0.24, 0.3, 4.4, z + 0.3))
  return { wood, iron }
}

function aisleGeometries(): { wood: THREE.BufferGeometry[]; iron: THREE.BufferGeometry[] } {
  const wood: THREE.BufferGeometry[] = [], iron: THREE.BufferGeometry[] = []
  for (const prop of valhallaAisleProps()) {
    if (prop.kind === 'barrel') {
      wood.push(new THREE.CylinderGeometry(0.48, 0.52, 1.1, 12).translate(prop.x, 0.55, prop.z))
      for (const y of [0.2, 0.9]) iron.push(new THREE.TorusGeometry(0.51, 0.025, 4, 16).rotateX(Math.PI / 2).translate(prop.x, y, prop.z))
    } else {
      wood.push(boxBetween(prop.x - 0.3, 0, prop.z - 1.25, prop.x + 0.3, 0.12, prop.z + 1.25))
      wood.push(boxBetween(prop.x - 0.08, 1.4, prop.z - 1.25, prop.x + 0.08, 1.55, prop.z + 1.25))
      for (const dz of [-1.2, 1.2]) wood.push(boxBetween(prop.x - 0.08, 0, prop.z + dz - 0.06, prop.x + 0.08, 1.6, prop.z + dz + 0.06))
      for (let k = 0; k < 6; k++) {
        const zz = prop.z - 1 + k * 0.4
        wood.push(new THREE.CylinderGeometry(0.03, 0.03, 2.3, 5).rotateX(0.08).translate(prop.x, 1.15, zz))
        iron.push(new THREE.ConeGeometry(0.06, 0.32, 4).translate(prop.x, 2.45, zz + 0.09))
      }
    }
  }
  return { wood, iron }
}

// ── Assembly ─────────────────────────────────────────────────────────────────

export function buildValhallaVisuals(resources: ArenaResources, prisonExit = false): ValhallaVisuals {
  const root = new THREE.Group()
  root.name = 'viking-valhalla'
  const textures = createTextures(resources)
  const material = (parameters: THREE.MeshStandardMaterialParameters, name: string): THREE.MeshStandardMaterial => {
    const result = ownedMaterial(resources, new THREE.MeshStandardMaterial(parameters))
    result.name = name
    return result
  }
  const floorMaterial = material({ map: textures.floor, roughness: 0.55, metalness: 0.02, color: 0xd9c8b6 }, 'valhalla-floor')
  const wallMaterial = material({ map: textures.wall, roughness: 0.9, side: THREE.DoubleSide }, 'valhalla-walls')
  const roofMaterial = material({ map: textures.roof, roughness: 0.95, side: THREE.DoubleSide }, 'valhalla-roof')
  const beamMaterial = material({ map: textures.carved, roughness: 0.85, color: 0x9b7a5c }, 'valhalla-beams')
  const pillarMaterial = material({ map: textures.pillar, roughness: 0.8 }, 'valhalla-pillars')
  const carvedMaterial = material({ map: textures.carved, vertexColors: true, roughness: 0.82 }, 'valhalla-carving')
  const bronzeMaterial = material({ color: 0xb08a45, metalness: 0.7, roughness: 0.4 }, 'valhalla-bronze')
  const stoneMaterial = material({ map: textures.stone, roughness: 0.95 }, 'valhalla-stone')
  const ironMaterial = material({ color: 0x2a2725, metalness: 0.6, roughness: 0.5 }, 'valhalla-iron')
  const carpetMaterial = material({ map: textures.carpet, roughness: 0.9 }, 'valhalla-carpet')
  const bannerMaterial = material({ map: textures.banner, roughness: 0.85, side: THREE.DoubleSide, alphaTest: 0.5, transparent: false }, 'valhalla-banner')
  const shieldMaterial = material({ map: textures.shields, roughness: 0.7 }, 'valhalla-shields')
  const warriorMaterial = material({ vertexColors: true, roughness: 0.85 }, 'valhalla-einherjar')
  const blackMaterial = material({ color: 0x0c0c10, roughness: 0.35, metalness: 0.2 }, 'valhalla-ravens')
  const runeMaterial = ownedMaterial(resources, new THREE.MeshStandardMaterial({ map: textures.rune, transparent: true, roughness: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }))
  runeMaterial.name = 'valhalla-runes'
  const emberMaterial = material({ color: 0x3a1206, emissive: 0xff5a14, emissiveIntensity: 1.4, roughness: 1 }, 'valhalla-embers')
  const viewMaterial = ownedMaterial(resources, new THREE.MeshBasicMaterial({ map: textures.mountains, fog: false }))
  viewMaterial.name = 'valhalla-window-view'
  const glowMaterial = ownedMaterial(resources, new THREE.MeshBasicMaterial({ color: 0xc9dcf2, fog: false, side: THREE.DoubleSide }))
  glowMaterial.name = 'valhalla-gable-glow'
  const shaftMaterial = ownedMaterial(resources, new THREE.MeshBasicMaterial({ color: 0x9fbde6, transparent: true, opacity: 0.045, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }))
  shaftMaterial.name = 'valhalla-light-shafts'
  // Shared, cached fur material: never disposed by the arena.
  const furMaterial = proceduralMaterial({ kind: 'fur', color: 0x8a6d50, repeat: [2, 2] })
  const flameTime = { value: 0 }
  const flameMaterial = createFlameMaterial(resources, flameTime)

  const floor = planeWithUv(2 * v.halfWidth + 0.4, v.backZ - v.frontZ + 0.4, 4.2, 4.2).rotateX(-Math.PI / 2).translate(0, v.groundY, (v.backZ + v.frontZ) / 2)
  root.add(mergedMesh(resources, [floor], floorMaterial, { castShadow: false, name: 'valhalla-floor' }))
  const runes = new THREE.PlaneGeometry(17, 17).rotateX(-Math.PI / 2).translate(0, v.groundY + 0.012, -4)
  const runeMesh = mergedMesh(resources, [runes], runeMaterial, { castShadow: false, name: 'valhalla-rune-circle' })
  runeMesh.renderOrder = 1
  root.add(runeMesh)

  const shell = shellGeometries(prisonExit)
  root.add(mergedMesh(resources, shell.walls, wallMaterial, { castShadow: false, name: 'valhalla-walls' }))
  root.add(mergedMesh(resources, shell.roof, roofMaterial, { castShadow: false, name: 'valhalla-roof' }))

  const door = prisonExit ? { wood: [], iron: [] } : doorGeometries()
  const gallery = galleryGeometries()
  const aisle = aisleGeometries()
  const windows = windowGeometries()
  root.add(mergedMesh(resources, [...trussGeometries(), ...door.wood, ...gallery.wood, ...aisle.wood, ...windows.frames], beamMaterial, { castShadow: false, name: 'valhalla-timber' }))
  const pillars = pillarGeometries()
  root.add(mergedMesh(resources, pillars.pillars, pillarMaterial, { name: 'valhalla-pillars' }))
  const throne = throneGeometries()
  const dais = daisGeometries()
  const hearths = hearthGeometries()
  root.add(mergedMesh(resources, [...pillars.carving, ...odinRelief(), ...throne.wood.map(part => tint(part, 0x7d5638)), ...dais.wood.map(part => tint(part, 0x6b4a30)), ...hearths.wood.map(part => tint(part, 0x2b1b10))], carvedMaterial, { name: 'valhalla-carving' }))
  root.add(mergedMesh(resources, [...pillars.bands, ...throne.gold], bronzeMaterial, { name: 'valhalla-bronze' }))

  root.add(mergedMesh(resources, [...hearths.stone, ...dais.stone], stoneMaterial, { name: 'valhalla-stone' }))
  root.add(mergedMesh(resources, hearths.embers, emberMaterial, { castShadow: false, name: 'valhalla-embers' }))
  const ironParts: THREE.BufferGeometry[] = [...door.iron, ...aisle.iron]
  const flames: THREE.BufferGeometry[] = [...hearths.flame]
  for (const brazier of valhallaBrazierPositions()) {
    const parts = brazierParts(brazier.x, brazier.y, brazier.z, 1.15)
    ironParts.push(...parts.iron)
    flames.push(...parts.flame)
  }
  root.add(mergedMesh(resources, ironParts, ironMaterial, { name: 'valhalla-iron' }))
  root.add(mergedMesh(resources, flames, flameMaterial, { castShadow: false, receiveShadow: false, name: 'valhalla-flames' }))
  root.add(mergedMesh(resources, dais.carpet, carpetMaterial, { castShadow: false, name: 'valhalla-carpet' }))
  root.add(mergedMesh(resources, throne.black, blackMaterial, { name: 'valhalla-ravens' }))
  root.add(mergedMesh(resources, [...throne.fur, ...gallery.fur], furMaterial, { castShadow: false, name: 'valhalla-fur' }))
  root.add(mergedMesh(resources, bannerGeometries(), bannerMaterial, { castShadow: false, name: 'valhalla-banners' }))
  root.add(mergedMesh(resources, gallery.shields, shieldMaterial, { name: 'valhalla-shields' }))
  root.add(mergedMesh(resources, gallery.warriors, warriorMaterial, { castShadow: false, name: 'valhalla-einherjar' }))
  root.add(mergedMesh(resources, windows.views, viewMaterial, { castShadow: false, receiveShadow: false, name: 'valhalla-window-views' }))
  root.add(mergedMesh(resources, windows.glow, glowMaterial, { castShadow: false, receiveShadow: false, name: 'valhalla-gable-glow' }))
  const shafts = mergedMesh(resources, lightShaftGeometries(), shaftMaterial, { castShadow: false, receiveShadow: false, name: 'valhalla-light-shafts' })
  shafts.renderOrder = 2
  root.add(shafts)

  // Lighting: cold sky light from the gable, warm fire light from hearths and braziers.
  const sky = new THREE.DirectionalLight(0xb6cdf0, 1.1)
  sky.position.set(10, 70, 60)
  sky.target.position.set(0, 0, -4)
  sky.castShadow = true
  sky.shadow.mapSize.set(1024, 1024)
  sky.shadow.camera.near = 10
  sky.shadow.camera.far = 160
  sky.shadow.camera.left = -40
  sky.shadow.camera.right = 40
  sky.shadow.camera.top = 45
  sky.shadow.camera.bottom = -45
  sky.shadow.bias = -0.0005
  sky.shadow.normalBias = 0.04
  resources.track({ dispose: () => sky.shadow.map?.dispose() })
  root.add(sky, sky.target)
  root.add(new THREE.HemisphereLight(0x8fa8cc, 0x4a3322, 1.0))
  root.add(new THREE.AmbientLight(0x4c4540, 0.5))
  // Cool fill on Odin's carved face so the relief reads from the hall floor.
  const odinLight = new THREE.PointLight(0xc8d8f0, 70, 30, 1.4)
  odinLight.position.set(0, 13, 25)
  root.add(odinLight)
  const fireLights: THREE.PointLight[] = []
  for (const [x, y, z, intensity] of [
    [-v.pillarX, 2.6, -20, 55], [v.pillarX, 2.6, -20, 55], [-v.pillarX, 2.6, 5, 55], [v.pillarX, 2.6, 5, 55],
    [-6.6, v.dais.topY + 2.2, v.dais.frontZ + 1.2, 45], [6.6, v.dais.topY + 2.2, v.dais.frontZ + 1.2, 45],
  ] as const) {
    const light = new THREE.PointLight(0xffa25a, intensity, 30, 1.6)
    light.position.set(x, y, z)
    fireLights.push(light)
    root.add(light)
  }

  root.traverse(node => { if (node !== root && !(node instanceof THREE.PointLight)) { node.matrixAutoUpdate = false; node.updateMatrix() } })
  let elapsed = 0
  return {
    root,
    update(dt: number): void {
      flameTime.value += dt
      elapsed += dt
      // Gentle fire flicker without allocations.
      for (let i = 0; i < fireLights.length; i++) {
        const base = i < 4 ? 55 : 45
        fireLights[i].intensity = base * (0.86 + Math.sin(elapsed * 9.1 + i * 1.7) * 0.07 + Math.sin(elapsed * 23.3 + i) * 0.05)
      }
    },
  }
}
