import * as THREE from 'three'
import { ArenaResources, arenaRandom, bannerQuad, brazierParts, createFlameMaterial, flameParts, mergedMesh, paintedTexture, speckle, tint } from '../../arena/ArenaKit'
import type { ArchitectureFaction } from './ArchitectureSpecs'

/**
 * Shared GPU resources and part vocabulary for one faction's Town architecture.
 *
 * Interface contract:
 * - One kit per faction scene. Every building, wall dressing and plaza built
 *   from it shares its materials/textures; geometry merged by a Sketch is
 *   also owned by the kit, so dispose() releases all of it exactly once.
 * - Statue geometry is loaded separately (ArchitectureStatues) and only
 *   referenced here, never disposed by the kit.
 * - update(dt) advances the shared flame shader; call it once per frame.
 */
export type PartSlot = 'stone' | 'roof' | 'wood' | 'metal' | 'cloth' | 'banner' | 'glow' | 'flame' | 'snow' | 'foliage' | 'water' | 'turf'
const SHADOWLESS: ReadonlySet<PartSlot> = new Set(['metal', 'cloth', 'banner', 'glow', 'flame', 'water'])

export const PALETTE = {
  marble: 0xf1ebdf, ashlar: 0xd8ccb4, travertine: 0xc9b99a, redPlaster: 0xa63a2e, darkRed: 0x7d2620, footing: 0x958d7e,
  gold: 0xe0b450, bronze: 0xa8743a, iron: 0x3b3a3a, timber: 0xb89068, darkTimber: 0x6d5038, carved: 0xc9a274, weathered: 0x8d7c69,
  red: 0x9e2a24, cream: 0xe7dcc2, canvas: 0xd9ccaa, stripe: 0xb43a2e, fur: 0xcbb79a, hay: 0xd8b968, glow: 0xffc066, leaf: 0x5d7a3c,
  cypress: 0x3f5a35, water: 0x5f97a8, terracotta: 0xc07048, rope: 0xb59a6a,
} as const

export interface ArchitectureMaterials {
  readonly slots: Readonly<Record<PartSlot, THREE.Material>>
  /** Plain (non vertex-coloured) materials for existing Town builders that expect them. */
  readonly plain: { stone: THREE.MeshStandardMaterial; wood: THREE.MeshStandardMaterial; dark: THREE.MeshStandardMaterial; plaster: THREE.MeshStandardMaterial; snow: THREE.MeshStandardMaterial; accent: THREE.MeshStandardMaterial }
  readonly statue: THREE.MeshStandardMaterial
}

/** What a building builder receives; coordinates are building-local (front = +Z). */
export interface BuildContext {
  readonly kit: ArchitectureKit
  /** Permanent structure (walls, columns, interior, props). */
  readonly body: Sketch
  /** Damageable roof; Town damage tilts/hides this group. */
  readonly roof: Sketch
  readonly root: THREE.Group
  readonly snow: boolean
  /** Local terrain height at a building-local point (outdoor props sit on it). */
  ground(x: number, z: number): number
  /** Static carved statue (stone/timber LOD) standing on (x, y, z), facing yaw. No-op until statues load. */
  statue(x: number, y: number, z: number, yaw: number, height: number): void
  /** Real equipment display piece from the shared weapon factory. */
  display(id: string, kind: 'melee' | 'ranged' | 'shield', x: number, y: number, z: number, tilt?: number, yaw?: number): void
  /** Lowest allowed weapons-canopy underside, above the floor origin (rider headroom over the merchant). */
  readonly canopyY: number
}

export class ArchitectureKit {
  readonly resources = new ArenaResources()
  readonly materials: ArchitectureMaterials
  private readonly time = { value: 0 }
  private readonly decals = new Map<string, THREE.Material>()
  constructor(readonly faction: ArchitectureFaction) {
    const roman = faction === 'roman'
    const own = <T extends THREE.Material>(m: T): T => this.resources.track(m)
    const stoneMap = this.stoneTexture()
    const woodMap = this.woodTexture()
    const roofMap = roman ? this.tileTexture() : this.thatchTexture()
    const standard = (options: THREE.MeshStandardMaterialParameters, name: string) => {
      const material = own(new THREE.MeshStandardMaterial(options)); material.name = `architecture-${faction}-${name}`; return material
    }
    const slots: Record<PartSlot, THREE.Material> = {
      stone: standard({ map: stoneMap, bumpMap: stoneMap, bumpScale: .035, vertexColors: true, roughness: .86 }, 'stone'),
      roof: standard({ map: roofMap, bumpMap: roofMap, bumpScale: roman ? .05 : .09, vertexColors: true, roughness: .9, side: THREE.DoubleSide }, 'roof'),
      wood: standard({ map: woodMap, bumpMap: woodMap, bumpScale: .04, vertexColors: true, roughness: .88 }, 'wood'),
      metal: standard({ vertexColors: true, metalness: .72, roughness: .38 }, 'metal'),
      cloth: standard({ vertexColors: true, roughness: .95, side: THREE.DoubleSide }, 'cloth'),
      banner: standard({ map: this.bannerTexture(), alphaTest: .5, roughness: .92, side: THREE.DoubleSide }, 'banner'),
      glow: own(new THREE.MeshBasicMaterial({ vertexColors: true })),
      flame: createFlameMaterial(this.resources, this.time),
      snow: standard({ color: 0xe8eef2, roughness: .96 }, 'snow'),
      foliage: standard({ vertexColors: true, roughness: .95, flatShading: true }, 'foliage'),
      water: standard({ color: PALETTE.water, roughness: .12, metalness: .1, transparent: true, opacity: .82 }, 'water'),
      turf: standard({ map: this.turfTexture(), bumpMap: this.turfTexture(), bumpScale: .08, vertexColors: true, roughness: .97, side: THREE.DoubleSide }, 'turf'),
    }
    slots.glow.name = `architecture-${faction}-glow`
    const plainStone = standard({ map: stoneMap, color: roman ? PALETTE.ashlar : PALETTE.footing, roughness: .88 }, 'plain-stone')
    const plainWood = standard({ map: woodMap, color: PALETTE.timber, roughness: .9 }, 'plain-wood')
    const plainDark = standard({ map: woodMap, color: PALETTE.darkTimber, roughness: .9 }, 'plain-dark')
    const plaster = standard({ map: stoneMap, color: roman ? PALETTE.redPlaster : PALETTE.darkTimber, roughness: .9 }, 'plain-plaster')
    const accent = standard({ color: PALETTE.red, roughness: .9, side: THREE.DoubleSide }, 'plain-accent')
    this.materials = {
      slots,
      plain: { stone: plainStone, wood: plainWood, dark: plainDark, plaster, snow: slots.snow as THREE.MeshStandardMaterial, accent },
      statue: standard({ color: roman ? 0xe6dccb : 0xa47f58, map: roman ? stoneMap : woodMap, roughness: roman ? .78 : .86 }, 'statue'),
    }
  }

  update(dt: number): void { this.time.value += dt }
  dispose(): void { this.resources.dispose(); this.decals.clear() }

  /** Owned decal material (paving, pad markings), painted once per key. */
  decal(key: string, size: number, paint: (ctx: CanvasRenderingContext2D, size: number) => void, transparent = false): THREE.Material {
    const existing = this.decals.get(key)
    if (existing) return existing
    const map = paintedTexture(this.resources, size, size, ctx => paint(ctx, size), { anisotropy: 8 })
    map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping
    const material = this.resources.track(new THREE.MeshStandardMaterial({ map, transparent, roughness: .9,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: !transparent }))
    material.name = `architecture-${this.faction}-${key}`
    this.decals.set(key, material)
    return material
  }

  /* ─────────── textures ─────────── */
  private stoneTexture(): THREE.CanvasTexture {
    return paintedTexture(this.resources, 512, 512, (ctx, { width, height }) => {
      ctx.fillStyle = '#d9d2c4'; ctx.fillRect(0, 0, width, height)
      const random = arenaRandom(this.faction === 'roman' ? 11 : 23)
      const rows = 8
      for (let row = 0; row < rows; row++) {
        const y = row * height / rows, offset = row % 2 ? width / 8 : 0
        for (let col = -1; col < 4; col++) {
          const x = offset + col * width / 4
          const shade = 205 + Math.floor(random() * 38)
          ctx.fillStyle = `rgb(${shade},${shade - 4},${shade - 12})`
          ctx.fillRect(x + 3, y + 3, width / 4 - 6, height / rows - 6)
        }
        ctx.fillStyle = '#a69d8c'; ctx.fillRect(0, y, width, 3)
      }
      for (let row = 0; row < rows; row++) {
        const offset = row % 2 ? width / 8 : 0
        for (let col = 0; col < 5; col++) { ctx.fillStyle = '#a69d8c'; ctx.fillRect(offset + col * width / 4 - 1.5, row * height / rows, 3, height / rows) }
      }
      speckle(ctx, width, height, 7, 9000, ['#7d7466', '#f5efe2', '#9b8f7c'], 2.4)
    }, { repeat: [1, 1] })
  }
  private woodTexture(): THREE.CanvasTexture {
    return paintedTexture(this.resources, 256, 512, (ctx, { width, height }) => {
      ctx.fillStyle = '#d6c4a8'; ctx.fillRect(0, 0, width, height)
      const random = arenaRandom(31)
      for (let plank = 0; plank < 4; plank++) {
        const x = plank * width / 4, shade = 190 + Math.floor(random() * 50)
        ctx.fillStyle = `rgb(${shade},${shade - 16},${shade - 38})`; ctx.fillRect(x + 1, 0, width / 4 - 2, height)
        ctx.strokeStyle = 'rgba(80,58,36,.35)'; ctx.lineWidth = 1.2
        for (let g = 0; g < 9; g++) {
          const gx = x + 4 + random() * (width / 4 - 8)
          ctx.beginPath(); ctx.moveTo(gx, 0)
          for (let y = 0; y <= height; y += 32) ctx.lineTo(gx + Math.sin(y * .03 + g) * 2.2, y)
          ctx.stroke()
        }
        ctx.fillStyle = '#5b4632'; ctx.fillRect(x, 0, 2, height)
      }
      speckle(ctx, width, height, 9, 2500, ['#5a4430', '#f2e2c4'], 2)
    })
  }
  private tileTexture(): THREE.CanvasTexture {
    return paintedTexture(this.resources, 512, 512, (ctx, { width, height }) => {
      ctx.fillStyle = '#7a3a24'; ctx.fillRect(0, 0, width, height)
      const random = arenaRandom(5)
      const cols = 8, rows = 8, w = width / cols, h = height / rows
      for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
        const x = col * w, y = row * h
        const base = 150 + random() * 40
        const grad = ctx.createLinearGradient(x, 0, x + w, 0)
        grad.addColorStop(0, `rgb(${base * .62},${base * .3},${base * .2})`)
        grad.addColorStop(.5, `rgb(${base + 40},${base * .58},${base * .36})`)
        grad.addColorStop(1, `rgb(${base * .62},${base * .3},${base * .2})`)
        ctx.fillStyle = grad; ctx.beginPath(); ctx.roundRect(x + 2, y + 1, w - 4, h - 2, w * .4); ctx.fill()
        ctx.fillStyle = 'rgba(40,16,8,.45)'; ctx.fillRect(x + 2, y + h - 6, w - 4, 5)
      }
      speckle(ctx, width, height, 3, 3000, ['#3d1f13', '#e7a07a'], 2)
    })
  }
  private thatchTexture(): THREE.CanvasTexture {
    return paintedTexture(this.resources, 512, 512, (ctx, { width, height }) => {
      ctx.fillStyle = '#7b6640'; ctx.fillRect(0, 0, width, height)
      const random = arenaRandom(17)
      for (let i = 0; i < 9000; i++) {
        const x = random() * width, y = random() * height, len = 14 + random() * 26
        const shade = 120 + random() * 90
        ctx.strokeStyle = `rgba(${shade},${shade * .82},${shade * .52},.7)`; ctx.lineWidth = .8 + random() * 1.2
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (random() - .5) * 3, y + len); ctx.stroke()
      }
      for (let row = 0; row < 6; row++) { ctx.fillStyle = 'rgba(52,38,20,.35)'; ctx.fillRect(0, row * height / 6 + height / 6 - 7, width, 7) }
    })
  }
  private turfTexture(): THREE.CanvasTexture {
    return paintedTexture(this.resources, 256, 256, (ctx, { width, height }) => {
      ctx.fillStyle = '#5f7442'; ctx.fillRect(0, 0, width, height)
      speckle(ctx, width, height, 41, 6000, ['#3d5228', '#8ea25c', '#6f5a3a', '#c9d6c7'], 3)
    })
  }
  private bannerTexture(): THREE.CanvasTexture {
    const roman = this.faction === 'roman'
    const texture = paintedTexture(this.resources, 256, 512, (ctx, { width, height }) => {
      ctx.clearRect(0, 0, width, height)
      ctx.fillStyle = roman ? '#9c1f1b' : '#7c2019'
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(width, 0); ctx.lineTo(width, height * .84)
      if (roman) { ctx.lineTo(width / 2, height); ctx.lineTo(0, height * .84) }
      else for (let i = 6; i >= 0; i--) ctx.lineTo(width * i / 6, height * (i % 2 ? .9 : .97))
      ctx.closePath(); ctx.fill()
      const trim = roman ? '#e2b548' : '#e9dcc0'
      ctx.strokeStyle = trim; ctx.lineWidth = 9
      ctx.strokeRect(14, 14, width - 28, height * .76)
      ctx.lineWidth = 7; ctx.lineCap = 'round'
      const cx = width / 2, cy = height * .4
      if (roman) {
        // Laurel wreath: two leaf arcs and a small eagle above.
        for (const side of [-1, 1]) for (let i = 0; i < 9; i++) {
          const a = Math.PI / 2 + side * (.35 + i * .27), x = cx + Math.cos(a) * 62, y = cy + Math.sin(a) * 62
          ctx.fillStyle = trim; ctx.beginPath(); ctx.ellipse(x, y, 13, 6, a + side * .9, 0, Math.PI * 2); ctx.fill()
        }
        ctx.beginPath(); ctx.moveTo(cx - 52, cy - 90); ctx.quadraticCurveTo(cx - 20, cy - 70, cx, cy - 80); ctx.quadraticCurveTo(cx + 20, cy - 70, cx + 52, cy - 90)
        ctx.lineTo(cx + 18, cy - 54); ctx.lineTo(cx, cy - 40); ctx.lineTo(cx - 18, cy - 54); ctx.closePath(); ctx.fill()
      } else {
        // Three interlaced triangles and a knot band.
        for (let k = 0; k < 3; k++) {
          const ox = cx + (k - 1) * 24, oy = cy + (k === 1 ? -26 : 8), r = 52
          ctx.beginPath()
          for (let i = 0; i < 3; i++) { const a = -Math.PI / 2 + i * Math.PI * 2 / 3; ctx[i ? 'lineTo' : 'moveTo'](ox + Math.cos(a) * r, oy + Math.sin(a) * r) }
          ctx.closePath(); ctx.stroke()
        }
        ctx.lineWidth = 5
        for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(28 + i * 40, height * .7, 16, 0, Math.PI); ctx.stroke() }
      }
    }, { color: true })
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping
    return texture
  }
}

/* ─────────────────────────── geometry helpers ─────────────────────────── */

/** World-scale box UVs so masonry, planks and thatch keep one texel density on every part. */
export function projectUV(geometry: THREE.BufferGeometry, scale = .25): THREE.BufferGeometry {
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals()
  const p = geometry.getAttribute('position'), n = geometry.getAttribute('normal')
  const uv = new Float32Array(p.count * 2)
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i))
    const [u, v] = ay >= ax && ay >= az ? [p.getX(i), p.getZ(i)] : ax >= az ? [p.getZ(i), p.getY(i)] : [p.getX(i), p.getY(i)]
    uv[i * 2] = u * scale; uv[i * 2 + 1] = v * scale
  }
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  return geometry
}

export interface ArchHole { x: number; y: number; w: number; h: number; arch?: number }

/**
 * Collects building parts per material slot, then merges them into a few owned
 * meshes. Coordinates are building-local metres (front = +Z).
 */
export class Sketch {
  private readonly parts = new Map<PartSlot, THREE.BufferGeometry[]>()
  constructor(readonly kit: ArchitectureKit) {}

  add(slot: PartSlot, geometry: THREE.BufferGeometry, color?: THREE.ColorRepresentation, uvScale: number | null = .25): THREE.BufferGeometry {
    if (uvScale !== null && slot !== 'banner' && slot !== 'roof' && slot !== 'flame') projectUV(geometry, uvScale)
    if (slot !== 'flame') tint(geometry, color ?? 0xffffff)
    let list = this.parts.get(slot); if (!list) this.parts.set(slot, list = []); list.push(geometry)
    return geometry
  }
  get empty(): boolean { return this.parts.size === 0 }

  /** Merges into one mesh per slot and adds them to `parent`. */
  build(parent: THREE.Object3D, name: string): THREE.Mesh[] {
    const meshes: THREE.Mesh[] = []
    for (const [slot, parts] of this.parts) {
      if (!parts.length) continue
      const mesh = mergedMesh(this.kit.resources, parts, this.kit.materials.slots[slot], {
        name: `${name}-${slot}`, castShadow: !SHADOWLESS.has(slot), receiveShadow: slot !== 'flame' && slot !== 'glow' })
      if (slot === 'flame') mesh.renderOrder = 5
      parent.add(mesh); meshes.push(mesh)
    }
    this.parts.clear()
    return meshes
  }

  /* primitives */
  box(slot: PartSlot, cx: number, cy: number, cz: number, w: number, h: number, d: number, color?: THREE.ColorRepresentation, yaw = 0): THREE.BufferGeometry {
    const g = new THREE.BoxGeometry(w, h, d); if (yaw) g.rotateY(yaw); g.translate(cx, cy, cz); return this.add(slot, g, color)
  }
  span(slot: PartSlot, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color?: THREE.ColorRepresentation): THREE.BufferGeometry {
    return this.box(slot, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), color)
  }
  cylinder(slot: PartSlot, x: number, y0: number, z: number, rTop: number, rBottom: number, h: number, color?: THREE.ColorRepresentation, segments = 12): THREE.BufferGeometry {
    return this.add(slot, new THREE.CylinderGeometry(rTop, rBottom, h, segments).translate(x, y0 + h / 2, z), color)
  }
  /** Straight beam/log between two points. */
  beam(slot: PartSlot, a: THREE.Vector3, b: THREE.Vector3, w: number, h: number, color?: THREE.ColorRepresentation, round = false): THREE.BufferGeometry {
    const dir = b.clone().sub(a), length = dir.length()
    const g = round ? new THREE.CylinderGeometry(w / 2, w / 2, length, 8).rotateX(Math.PI / 2) : new THREE.BoxGeometry(w, h, length)
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.normalize()))
    g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2)
    return this.add(slot, g, color)
  }

  /**
   * Flat wall in the XY plane with door/window holes, thickness along Z, then
   * rotated by yaw and moved so its centre-bottom sits at (x, y, z).
   * `arch` is the elliptical rise of an arched top included in `h`.
   */
  wall(slot: PartSlot, x: number, y: number, z: number, width: number, height: number, thickness: number, holes: ArchHole[] = [], color?: THREE.ColorRepresentation, yaw = 0): THREE.BufferGeometry {
    const shape = new THREE.Shape()
    shape.moveTo(-width / 2, 0)
    // Doorways reaching the base are notches in the outline (earcut rejects holes touching it).
    for (const hole of holes.filter(h => h.y <= 0).sort((a, b) => a.x - b.x)) {
      const x0 = hole.x - hole.w / 2, x1 = hole.x + hole.w / 2, rise = hole.arch ?? 0, spring = hole.h - rise
      shape.lineTo(x0, 0); shape.lineTo(x0, spring)
      if (rise > 0) shape.absellipse(hole.x, spring, hole.w / 2, rise, Math.PI, 0, true, 0)
      else shape.lineTo(x1, spring)
      shape.lineTo(x1, 0)
    }
    shape.lineTo(width / 2, 0); shape.lineTo(width / 2, height); shape.lineTo(-width / 2, height); shape.closePath()
    for (const hole of holes.filter(h => h.y > 0)) shape.holes.push(holePath(hole))
    const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 10 })
    g.translate(0, 0, -thickness / 2); if (yaw) g.rotateY(yaw); g.translate(x, y, z)
    return this.add(slot, g, color)
  }
  /** Wall extruded from a (z, y) outline at local x, `thickness` thick toward -x→+x centred. */
  profile(slot: PartSlot, x: number, points: readonly (readonly [number, number])[], thickness: number, color?: THREE.ColorRepresentation): THREE.BufferGeometry {
    const shape = new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(z, y)))
    const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false })
    // Shape x → local z, extrusion → local x.
    const p = g.getAttribute('position')
    for (let i = 0; i < p.count; i++) { const sx = p.getX(i), sz = p.getZ(i); p.setXYZ(i, x - thickness / 2 + sz, p.getY(i), sx) }
    // Swapping two axes mirrors the mesh; reverse each triangle so faces stay outward.
    for (let t = 0; t + 2 < p.count; t += 3) {
      const a = [p.getX(t + 1), p.getY(t + 1), p.getZ(t + 1)]
      p.setXYZ(t + 1, p.getX(t + 2), p.getY(t + 2), p.getZ(t + 2)); p.setXYZ(t + 2, a[0], a[1], a[2])
    }
    g.computeVertexNormals()
    return this.add(slot, g, color)
  }
  /** Gable-end triangle filling (wall slot) with optional holes, centre-bottom at (x, y, z). */
  gable(slot: PartSlot, x: number, y: number, z: number, width: number, rise: number, thickness: number, color?: THREE.ColorRepresentation, yaw = 0, holes: ArchHole[] = []): THREE.BufferGeometry {
    const shape = new THREE.Shape(); shape.moveTo(-width / 2, 0); shape.lineTo(width / 2, 0); shape.lineTo(0, rise); shape.closePath()
    for (const hole of holes) shape.holes.push(holePath(hole))
    const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 8 })
    g.translate(0, 0, -thickness / 2); if (yaw) g.rotateY(yaw); g.translate(x, y, z)
    return this.add(slot, g, color)
  }
  /** Arch ring (archivolt) in the XY plane, centred on the springing line. */
  archRing(slot: PartSlot, x: number, y: number, z: number, halfSpan: number, rise: number, band: number, depth: number, color?: THREE.ColorRepresentation, yaw = 0): THREE.BufferGeometry {
    const shape = new THREE.Shape()
    shape.moveTo(halfSpan + band, 0); shape.absellipse(0, 0, halfSpan + band, rise + band, 0, Math.PI, false, 0)
    shape.lineTo(-halfSpan, 0); shape.absellipse(0, 0, halfSpan, rise, Math.PI, 0, true, 0); shape.closePath()
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 14 })
    g.translate(0, 0, -depth / 2); if (yaw) g.rotateY(yaw); g.translate(x, y, z)
    return this.add(slot, g, color)
  }

  /**
   * Gable roof as two thick sloped panels. Ridge along local X (axis 'x') or Z.
   * The panels start at eave height `eave` at ±halfSpan and meet at `ridge`.
   */
  gableRoof(slot: PartSlot, options: { cx?: number; cz?: number; axis: 'x' | 'z'; halfSpan: number; from: number; to: number; eave: number; ridge: number; thickness?: number; color?: THREE.ColorRepresentation; tileScale?: number }): void {
    const { axis, halfSpan, from, to, eave, ridge } = options, cx = options.cx ?? 0, cz = options.cz ?? 0
    const thickness = options.thickness ?? .25, scale = options.tileScale ?? .35
    for (const side of [-1, 1]) {
      const a = new THREE.Vector2(side * halfSpan, eave), b = new THREE.Vector2(0, ridge)
      this.add(slot, slopedPanel(a, b, from, to, thickness, axis, cx, cz, scale), options.color)
    }
  }
  /** Single-pitch (lean-to) roof from a low eave to a high edge, both lines parallel to the ridge axis. */
  shedRoof(slot: PartSlot, options: { axis: 'x' | 'z'; low: [number, number]; high: [number, number]; from: number; to: number; thickness?: number; color?: THREE.ColorRepresentation; tileScale?: number }): void {
    this.add(slot, slopedPanel(new THREE.Vector2(...options.low), new THREE.Vector2(...options.high), options.from, options.to,
      options.thickness ?? .22, options.axis, 0, 0, options.tileScale ?? .35), options.color)
  }
  /** Hip roof over [x0,x1]×[z0,z1] (pyramid when the ridge length is zero). */
  hipRoof(slot: PartSlot, x0: number, x1: number, z0: number, z1: number, eave: number, rise: number, color?: THREE.ColorRepresentation, scale = .35): void {
    const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2
    const alongX = w >= d, half = Math.abs(w - d) / 2
    const r0 = new THREE.Vector3(alongX ? cx - half : cx, eave + rise, alongX ? cz : cz - half)
    const r1 = new THREE.Vector3(alongX ? cx + half : cx, eave + rise, alongX ? cz : cz + half)
    const c = [new THREE.Vector3(x0, eave, z0), new THREE.Vector3(x1, eave, z0), new THREE.Vector3(x1, eave, z1), new THREE.Vector3(x0, eave, z1)]
    const faces: THREE.Vector3[][] = alongX
      ? [[c[0], r0, r1, c[1]], [c[2], r1, r0, c[3]], [c[1], r1, c[2]], [c[3], r0, c[0]]]
      : [[c[1], r0, r1, c[2]], [c[3], r1, r0, c[0]], [c[0], r0, c[1]], [c[2], r1, c[3]]]
    this.add(slot, polyFaces(faces, scale), color)
  }
  /** Classical pediment prism facing +Z (rotated by yaw), base centre at (x, y, z). */
  pediment(slot: PartSlot, x: number, y: number, z: number, width: number, rise: number, depth: number, color?: THREE.ColorRepresentation, yaw = 0): void {
    this.gable(slot, x, y, z, width, rise, depth, color, yaw)
  }

  /** Classical column with base and gold (or stone) capital. */
  column(x: number, y0: number, z: number, height: number, radius: number, options: { capital?: 'gold' | 'stone'; color?: number; flutes?: boolean } = {}): void {
    const color = options.color ?? PALETTE.marble
    this.cylinder('stone', x, y0, z, radius * 1.35, radius * 1.45, .22, color, 14)
    this.box('stone', x, y0 + .05, z, radius * 3, .1, radius * 3, color)
    this.cylinder('stone', x, y0 + .22, z, radius * .9, radius, height - .62, color, options.flutes === false ? 10 : 16)
    const capitalSlot = options.capital === 'stone' ? 'stone' : 'metal'
    this.cylinder(capitalSlot, x, y0 + height - .4, z, radius * 1.45, radius * .95, .28, options.capital === 'stone' ? color : PALETTE.gold, 12)
    this.box(capitalSlot, x, y0 + height - .06, z, radius * 3.1, .12, radius * 3.1, options.capital === 'stone' ? color : PALETTE.gold)
  }
  /** Carved timber post: shaft with interlace rings and a capital block. */
  carvedPost(x: number, y0: number, z: number, height: number, radius: number, color: number = PALETTE.carved): void {
    this.cylinder('wood', x, y0, z, radius * .92, radius, height, color, 10)
    for (let y = y0 + height * .55; y < y0 + height - .3; y += .34) {
      this.add('wood', new THREE.TorusGeometry(radius * 1.02, radius * .14, 4, 10).rotateX(Math.PI / 2).translate(x, y, z), PALETTE.darkTimber)
    }
    this.box('wood', x, y0 + height - .12, z, radius * 2.6, .24, radius * 2.6, PALETTE.darkTimber)
    this.box('stone', x, y0 - .15, z, radius * 2.6, .3, radius * 2.6, PALETTE.footing)
  }

  /** Carved beast head on a curled neck; local +Z of the head faces `yaw`. */
  dragonHead(x: number, y: number, z: number, yaw: number, scale = 1, color: number = PALETTE.carved): void {
    const s = scale
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, -.1 * s), new THREE.Vector3(0, .55 * s, .05 * s), new THREE.Vector3(0, 1.0 * s, .32 * s), new THREE.Vector3(0, 1.18 * s, .7 * s),
    ])
    const parts: THREE.BufferGeometry[] = [new THREE.TubeGeometry(curve, 10, .17 * s, 7, false)]
    const head = new THREE.BoxGeometry(.3 * s, .3 * s, .62 * s).translate(0, 1.22 * s, .98 * s)
    const snout = new THREE.ConeGeometry(.15 * s, .42 * s, 6).rotateX(Math.PI / 2).translate(0, 1.2 * s, 1.45 * s)
    const jaw = new THREE.BoxGeometry(.24 * s, .09 * s, .62 * s).rotateX(.35).translate(0, 1.0 * s, 1.18 * s)
    const crest = new THREE.ConeGeometry(.08 * s, .36 * s, 5).rotateX(-.7).translate(0, 1.45 * s, .72 * s)
    for (const side of [-1, 1]) parts.push(new THREE.ConeGeometry(.06 * s, .28 * s, 5).rotateX(-1.1).translate(side * .1 * s, 1.4 * s, .78 * s))
    parts.push(head, snout, jaw, crest)
    for (const p of parts) { p.rotateY(yaw); p.translate(x, y, z); this.add('wood', p, color) }
    for (const side of [-1, 1]) this.add('metal', new THREE.SphereGeometry(.035 * s, 6, 4).translate(side * .16 * s, 1.27 * s, 1.1 * s).rotateY(yaw).translate(x, y, z), 0xd8a040)
  }
  /** Crossed Viking bargeboards meeting at a gable apex, ending in two dragon heads. */
  crossedGable(x: number, apexY: number, z: number, halfSpan: number, rise: number, alongYaw: number, scale = 1): void {
    // alongYaw: direction the gable faces (0 = +Z). Boards lie in the gable plane.
    const right = new THREE.Vector3(Math.cos(alongYaw), 0, -Math.sin(alongYaw))
    const face = new THREE.Vector3(Math.sin(alongYaw), 0, Math.cos(alongYaw))
    const apex = new THREE.Vector3(x, apexY, z).addScaledVector(face, .12)
    for (const side of [-1, 1]) {
      const eave = apex.clone().addScaledVector(right, side * halfSpan).add(new THREE.Vector3(0, -rise, 0))
      const over = apex.clone().addScaledVector(right, -side * .55 * scale).add(new THREE.Vector3(0, .55 * scale * rise / halfSpan, 0))
      this.beam('wood', eave, over, .32, .14, PALETTE.carved)
      // Interlace relief along the board.
      for (let t = .15; t < .9; t += .12) {
        const p = eave.clone().lerp(over, t).addScaledVector(face, .08)
        this.add('wood', new THREE.TorusGeometry(.1, .025, 4, 8).rotateY(alongYaw).translate(p.x, p.y, p.z), PALETTE.darkTimber)
      }
      this.dragonHead(over.x, over.y - .25 * scale, over.z, alongYaw + (side < 0 ? -.35 : .35) + Math.PI * 0, .8 * scale)
    }
  }

  /** Round shield (painted quadrants, iron rim and boss) facing yaw, centre at (x, y, z). */
  shield(x: number, y: number, z: number, yaw: number, radius = .45, colors: readonly number[] = [PALETTE.red, PALETTE.cream], tilt = 0): void {
    const sectors = 8
    for (let i = 0; i < sectors; i++) {
      const g = new THREE.CylinderGeometry(radius, radius, .06, 3, 1, false, i / sectors * Math.PI * 2, Math.PI * 2 / sectors)
      g.rotateX(Math.PI / 2).rotateX(tilt).rotateY(yaw).translate(x, y, z)
      this.add('wood', g, colors[Math.floor(i / 2) % colors.length], .9)
    }
    this.add('metal', new THREE.TorusGeometry(radius, .03, 4, 16).rotateX(tilt).rotateY(yaw).translate(x, y, z), PALETTE.iron)
    this.add('metal', new THREE.SphereGeometry(radius * .22, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2).rotateX(tilt).rotateY(yaw).translate(x, y, z), PALETTE.iron)
  }
  /** Roman curved scutum (tall rectangle) leaning at the given yaw. */
  scutum(x: number, y: number, z: number, yaw: number, lean = .18): void {
    const g = new THREE.CylinderGeometry(1.1, 1.1, 1.15, 10, 1, true, -.38, .76)
    g.translate(0, 0, -1.05).rotateX(lean).rotateY(yaw).translate(x, y, z)
    this.add('cloth', g, PALETTE.red)
    this.add('metal', new THREE.SphereGeometry(.09, 8, 5).translate(0, 0, .06).rotateX(lean).rotateY(yaw).translate(x, y, z), PALETTE.gold)
  }
  /** Hanging banner from a rod: top centre at (x, top, z), facing yaw. */
  banner(x: number, top: number, z: number, yaw: number, width: number, height: number, rod: 'gold' | 'wood' = 'gold'): void {
    this.add('banner', bannerQuad(x, top, z, yaw, width, height, .06), undefined, null)
    const half = width / 2 + .12, dir = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw))
    const a = new THREE.Vector3(x, top + .03, z).addScaledVector(dir, -half), b = new THREE.Vector3(x, top + .03, z).addScaledVector(dir, half)
    const face = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(.06)
    this.beam(rod === 'gold' ? 'metal' : 'wood', a.add(face), b.add(face), .07, .07, rod === 'gold' ? PALETTE.gold : PALETTE.darkTimber, true)
  }
  /** Free-standing banner pole with crossbar and banner. */
  bannerPole(x: number, y0: number, z: number, yaw: number, height = 6, slot: 'metal' | 'wood' = 'wood'): void {
    this.cylinder(slot, x, y0, z, .07, .09, height, slot === 'metal' ? PALETTE.gold : PALETTE.darkTimber, 8)
    this.banner(x, y0 + height - .45, z, yaw, 1.15, 2.4, slot === 'metal' ? 'gold' : 'wood')
    if (slot === 'metal') this.add('metal', new THREE.ConeGeometry(.12, .4, 8).translate(x, y0 + height + .2, z), PALETTE.gold)
  }
  /** Gold Roman eagle with spread wings on a plaque plane facing yaw. */
  eagle(x: number, y: number, z: number, yaw: number, size = 1): void {
    const s = new THREE.Shape()
    const pts: [number, number][] = [[0, .55], [.12, .42], [.18, .2], [.45, .42], [.95, .55], [.7, .25], [.92, .2], [.55, 0], [.32, -.05], [.2, -.35],
      [.3, -.62], [0, -.48], [-.3, -.62], [-.2, -.35], [-.32, -.05], [-.55, 0], [-.92, .2], [-.7, .25], [-.95, .55], [-.45, .42], [-.18, .2], [-.12, .42]]
    pts.forEach(([px, py], i) => i ? s.lineTo(px * size, py * size) : s.moveTo(px * size, py * size))
    s.closePath()
    const g = new THREE.ExtrudeGeometry(s, { depth: .1 * size, bevelEnabled: true, bevelSize: .03 * size, bevelThickness: .03 * size, bevelSegments: 1 })
    g.rotateY(yaw).translate(x, y, z)
    this.add('metal', g, PALETTE.gold)
  }
  /** Gold laurel wreath (two leaf arcs) facing yaw. */
  laurel(x: number, y: number, z: number, yaw: number, radius = .5): void {
    for (const side of [-1, 1]) for (let i = 0; i < 7; i++) {
      const a = -Math.PI / 2 + side * (.45 + i * .33)
      const leaf = new THREE.SphereGeometry(radius * .16, 6, 4).scale(1, .45, .3).rotateZ(a + side * 1.1)
      leaf.translate(Math.cos(a) * radius, Math.sin(a) * radius, 0).rotateY(yaw).translate(x, y, z)
      this.add('metal', leaf, PALETTE.gold)
    }
  }
  /** Warm-lit window: glow pane, lattice and frame on a wall facing yaw. */
  window(x: number, y: number, z: number, yaw: number, w: number, h: number, frame: PartSlot = 'wood', arch = false): void {
    const pane = arch ? new THREE.ShapeGeometry(new THREE.Shape(holePath({ x: 0, y: -h / 2, w, h, arch: w / 2 }).getPoints())) : new THREE.PlaneGeometry(w, h)
    this.add('glow', pane.rotateY(yaw).translate(x, y, z), PALETTE.glow, null)
    const face = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(.03)
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw))
    for (const t of [-.25, .25]) {
      const c = new THREE.Vector3(x, y, z).add(face).addScaledVector(right, t * w)
      this.beam(frame, c.clone().add(new THREE.Vector3(0, -h / 2, 0)), c.clone().add(new THREE.Vector3(0, h / 2 - (arch ? w * .2 : 0), 0)), .05, .05, PALETTE.darkTimber)
    }
    const mid = new THREE.Vector3(x, y, z).add(face)
    this.beam(frame, mid.clone().addScaledVector(right, -w / 2), mid.clone().addScaledVector(right, w / 2), .05, .05, PALETTE.darkTimber)
    if (!arch) this.box(frame, x, y - h / 2 - .06, z, w + .2, .1, .14, frame === 'stone' ? PALETTE.marble : PALETTE.darkTimber, yaw)
  }
  /** Open door leaf (planks with iron bands) hinged at (x, z), swung to angle yaw. */
  doorLeaf(hingeX: number, y0: number, hingeZ: number, width: number, height: number, yaw: number, ring = true): void {
    const dir = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw))
    const c = new THREE.Vector3(hingeX, y0 + height / 2, hingeZ).addScaledVector(dir, width / 2)
    this.box('wood', c.x, c.y, c.z, width, height, .14, PALETTE.darkTimber, yaw)
    for (const t of [.2, .5, .8]) this.box('metal', c.x, y0 + height * t, c.z, width * .96, .08, .18, PALETTE.iron, yaw)
    if (ring) {
      const r = c.clone().addScaledVector(dir, width * .3)
      this.add('metal', new THREE.TorusGeometry(.13, .025, 5, 12).rotateY(yaw).translate(r.x, y0 + height * .48, r.z + .0), PALETTE.gold)
    }
  }
  /** Fire basket/brazier with animated flame. */
  brazier(x: number, y0: number, z: number, scale = 1, color: number = PALETTE.iron): void {
    const { iron, flame } = brazierParts(x, y0, z, scale)
    for (const g of iron) this.add('metal', g, color)
    for (const g of flame) this.add('flame', g)
  }
  /** Bronze/stone bowl brazier on a pedestal top at y. */
  bowlFire(x: number, y: number, z: number, scale = 1): void {
    this.add('metal', new THREE.CylinderGeometry(.42 * scale, .2 * scale, .3 * scale, 12, 1, true).translate(x, y + .15 * scale, z), PALETTE.gold)
    this.add('metal', new THREE.CylinderGeometry(.12 * scale, .16 * scale, .1 * scale, 8).translate(x, y + .05, z), PALETTE.bronze)
    for (const g of flameParts(x, y + .2 * scale, z, .9 * scale, Math.round(Math.abs(x * 31 + z * 17)) + 3)) this.add('flame', g)
  }
  lantern(x: number, y: number, z: number): void {
    this.box('metal', x, y, z, .28, .4, .28, PALETTE.iron)
    this.box('glow', x, y, z, .22, .3, .3, PALETTE.glow)
    this.box('glow', x, y, z, .3, .3, .22, PALETTE.glow)
    this.add('metal', new THREE.ConeGeometry(.22, .18, 4).rotateY(Math.PI / 4).translate(x, y + .29, z), PALETTE.iron)
  }
  barrel(x: number, y0: number, z: number, scale = 1): void {
    const g = new THREE.CylinderGeometry(.34 * scale, .34 * scale, .9 * scale, 12, 4)
    const p = g.getAttribute('position')
    for (let i = 0; i < p.count; i++) { const k = 1 + .14 * Math.cos(p.getY(i) / (.45 * scale) * Math.PI / 2); p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k) }
    g.computeVertexNormals(); g.translate(x, y0 + .45 * scale, z)
    this.add('wood', g, PALETTE.timber)
    for (const t of [.18, .82]) this.add('metal', new THREE.TorusGeometry(.37 * scale, .02, 4, 14).rotateX(Math.PI / 2).translate(x, y0 + t * .9 * scale, z), PALETTE.iron)
  }
  crate(x: number, y0: number, z: number, size = .7, yaw = 0): void {
    this.box('wood', x, y0 + size / 2, z, size, size, size, PALETTE.timber, yaw)
    for (const t of [-1, 1]) this.box('wood', x, y0 + size / 2 + t * size * .38, z, size + .02, .08, size + .02, PALETTE.darkTimber, yaw)
  }
  amphora(x: number, y0: number, z: number, scale = 1): void {
    const pts = [[0, 0], [.1, .02], [.2, .25], [.24, .55], [.18, .8], [.08, .92], [.09, 1.05], [0, 1.06]].map(([r, y]) => new THREE.Vector2(r * scale, y * scale))
    this.add('stone', new THREE.LatheGeometry(pts, 10).translate(x, y0, z), PALETTE.terracotta)
  }
  bench(x: number, y0: number, z: number, length: number, yaw: number, stone = false): void {
    const slot: PartSlot = stone ? 'stone' : 'wood', color = stone ? PALETTE.marble : PALETTE.timber
    this.box(slot, x, y0 + .45, z, length, .12, .45, color, yaw)
    const dir = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw))
    for (const t of [-1, 1]) { const p = new THREE.Vector3(x, 0, z).addScaledVector(dir, t * (length / 2 - .25)); this.box(slot, p.x, y0 + .2, p.z, .2, .4, .4, color, yaw) }
  }
  table(x: number, y0: number, z: number, w: number, d: number, top = 1.0): void {
    this.box('wood', x, y0 + top - .05, z, w, .1, d, PALETTE.timber)
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.box('wood', x + sx * (w / 2 - .12), y0 + (top - .1) / 2, z + sz * (d / 2 - .12), .12, top - .1, .12, PALETTE.darkTimber)
  }
  /** Spear/sword rack along local axis at yaw. */
  weaponRack(x: number, y0: number, z: number, length: number, yaw: number, kind: 'spear' | 'sword' | 'axe' = 'spear'): void {
    const dir = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw))
    const a = new THREE.Vector3(x, y0, z).addScaledVector(dir, -length / 2), b = new THREE.Vector3(x, y0, z).addScaledVector(dir, length / 2)
    for (const y of [.35, 1.25]) this.beam('wood', a.clone().setY(y0 + y), b.clone().setY(y0 + y), .1, .1, PALETTE.darkTimber)
    for (const p of [a, b]) this.box('wood', p.x, y0 + .8, p.z, .12, 1.6, .12, PALETTE.darkTimber)
    const count = Math.max(2, Math.floor(length / .32))
    for (let i = 1; i < count; i++) {
      const p = a.clone().lerp(b, i / count)
      if (kind === 'spear') {
        this.cylinder('wood', p.x, y0 + .1, p.z, .025, .03, 2.3, PALETTE.timber, 5)
        this.add('metal', new THREE.ConeGeometry(.05, .3, 4).translate(p.x, y0 + 2.55, p.z), 0xb8bcc0)
      } else if (kind === 'sword') {
        this.box('metal', p.x, y0 + .95, p.z, .06, 1.0, .012, 0xc4c8cc, yaw)
        this.box('metal', p.x, y0 + 1.48, p.z, .26, .05, .05, PALETTE.gold, yaw)
        this.box('wood', p.x, y0 + 1.64, p.z, .05, .26, .05, PALETTE.darkTimber, yaw)
      } else {
        this.cylinder('wood', p.x, y0 + .2, p.z, .025, .03, 1.5, PALETTE.timber, 5)
        this.box('metal', p.x, y0 + 1.6, p.z, .03, .32, .26, 0xb0b4b8, yaw + Math.PI / 2)
      }
    }
  }
  anvil(x: number, y0: number, z: number, yaw = 0): void {
    this.cylinder('wood', x, y0, z, .38, .44, .55, PALETTE.darkTimber, 10)
    this.box('metal', x, y0 + .63, z, .24, .16, .5, PALETTE.iron, yaw)
    this.box('metal', x, y0 + .8, z, .34, .18, .78, PALETTE.iron, yaw)
    this.add('metal', new THREE.ConeGeometry(.12, .4, 4).rotateX(Math.PI / 2).rotateY(yaw).translate(x + Math.sin(yaw) * .55, y0 + .82, z + Math.cos(yaw) * .55), PALETTE.iron)
  }
  hay(x: number, y0: number, z: number, w = 1.1, d = .7, h = .55): void {
    this.box('cloth', x, y0 + h / 2, z, w, h, d, PALETTE.hay)
    for (const t of [-.25, .25]) this.box('cloth', x + t * w, y0 + h / 2, z, .04, h + .02, d + .02, PALETTE.rope)
  }
  /** Stylised tree: cypress (column) or broad crown. */
  tree(x: number, y0: number, z: number, kind: 'cypress' | 'olive', scale = 1): void {
    this.cylinder('wood', x, y0, z, .09 * scale, .14 * scale, kind === 'cypress' ? .6 * scale : 1.4 * scale, PALETTE.darkTimber, 6)
    if (kind === 'cypress') this.add('foliage', new THREE.SphereGeometry(.55 * scale, 8, 7).scale(1, 3.4, 1).translate(x, y0 + 2.2 * scale, z), PALETTE.cypress)
    else for (const [dx, dy, dz, r] of [[0, 1.9, 0, .9], [.5, 1.6, .2, .6], [-.45, 1.7, -.25, .65], [.1, 2.3, -.3, .55]] as const)
      this.add('foliage', new THREE.IcosahedronGeometry(r * scale, 0).translate(x + dx * scale, y0 + dy * scale, z + dz * scale), PALETTE.leaf)
  }
  /** Bordered planter with flowers. */
  planter(x: number, y0: number, z: number, w: number, d: number): void {
    this.box('stone', x, y0 + .3, z, w, .6, d, PALETTE.marble)
    this.box('foliage', x, y0 + .66, z, w - .2, .18, d - .2, PALETTE.leaf)
    const random = arenaRandom(Math.round(Math.abs(x * 7 + z * 13)) + 1)
    for (let i = 0; i < 10; i++) this.add('cloth', new THREE.IcosahedronGeometry(.09, 0).translate(x + (random() - .5) * (w - .3), y0 + .8, z + (random() - .5) * (d - .3)), 0xc0302a)
  }
  /** Low split-rail or wattle fence between two points. */
  fence(a: THREE.Vector3, b: THREE.Vector3, height = 1.0, wattle = false): void {
    const length = a.distanceTo(b), count = Math.max(1, Math.round(length / 1.6))
    for (let i = 0; i <= count; i++) { const p = a.clone().lerp(b, i / count); this.cylinder('wood', p.x, p.y, p.z, .07, .08, height + .1, PALETTE.weathered, 6) }
    if (wattle) for (let y = .15; y < height; y += .12) this.beam('wood', a.clone().setY(a.y + y), b.clone().setY(b.y + y), .05, .05, PALETTE.weathered, true)
    else for (const y of [height * .45, height * .9]) this.beam('wood', a.clone().setY(a.y + y), b.clone().setY(b.y + y), .09, .09, PALETTE.weathered, true)
  }
  /** Snow cap slab hugging the upper part of a sloped roof panel (Viking winter dressing). */
  snowOnGable(options: { cx?: number; cz?: number; axis: 'x' | 'z'; halfSpan: number; from: number; to: number; eave: number; ridge: number; coverage?: number; thickness?: number }): void {
    const coverage = options.coverage ?? .55, thickness = options.thickness ?? .25
    // Sit on the roof's outer face: a vertical lift of t·√(1+slope²) clears a panel t thick.
    const lift = (thickness + .04) * Math.hypot(1, (options.ridge - options.eave) / options.halfSpan)
    const eave = options.ridge - (options.ridge - options.eave) * coverage
    this.gableRoof('snow', { ...options, halfSpan: options.halfSpan * coverage, eave: eave + lift, ridge: options.ridge + lift, thickness: .1 })
  }
}

function holePath(hole: ArchHole): THREE.Path {
  const path = new THREE.Path(), x0 = hole.x - hole.w / 2, x1 = hole.x + hole.w / 2
  const rise = hole.arch ?? 0, spring = hole.y + hole.h - rise
  path.moveTo(x0, hole.y); path.lineTo(x1, hole.y); path.lineTo(x1, spring)
  if (rise > 0) path.absellipse(hole.x, spring, hole.w / 2, rise, 0, Math.PI, false, 0)
  else path.lineTo(x0, spring)
  path.lineTo(x0, hole.y)
  return path
}

/** Thick panel from eave edge a (lateral, y) to ridge b, extruded from..to along the ridge axis. */
function slopedPanel(a: THREE.Vector2, b: THREE.Vector2, from: number, to: number, thickness: number, axis: 'x' | 'z', cx: number, cz: number, scale: number): THREE.BufferGeometry {
  // The quarter turn for a ridge along X maps lateral → -z; pre-negate so lateral stays +z.
  if (axis === 'x') { a = new THREE.Vector2(-a.x, a.y); b = new THREE.Vector2(-b.x, b.y) }
  const slope = b.clone().sub(a), length = slope.length()
  const normal = new THREE.Vector2(-slope.y, slope.x).normalize()
  if (normal.y < 0) normal.multiplyScalar(-1)
  const g = new THREE.BoxGeometry(length, thickness, to - from)
  const uv = g.getAttribute('uv'), p = g.getAttribute('position')
  for (let i = 0; i < p.count; i++) {
    // u along the ridge, v down the slope: tiles/thatch rows stay horizontal.
    uv.setXY(i, (p.getZ(i) + (to - from) / 2) * scale, (p.getX(i) + length / 2) * scale)
  }
  g.rotateZ(Math.atan2(slope.y, slope.x))
  const mid = a.clone().add(b).multiplyScalar(.5).addScaledVector(normal, thickness / 2)
  g.translate(mid.x, mid.y, (from + to) / 2)
  // Built with the lateral axis on X; a ridge along X turns the panel a quarter turn.
  if (axis === 'x') g.rotateY(Math.PI / 2)
  // from/to are absolute along the ridge; cx/cz shift only the lateral centre.
  g.translate(axis === 'z' ? cx : 0, 0, axis === 'x' ? cz : 0)
  return g
}

/** Planar polygon faces (fan-triangulated) with world-scale UVs along each face. */
function polyFaces(faces: THREE.Vector3[][], scale: number): THREE.BufferGeometry {
  const positions: number[] = [], uvs: number[] = []
  for (const face of faces) {
    const origin = face[0], e1 = face[face.length - 1].clone().sub(origin).normalize()
    const normal = face[1].clone().sub(origin).cross(face[2].clone().sub(origin)).normalize()
    const e2 = normal.clone().cross(e1).normalize()
    for (let i = 1; i < face.length - 1; i++) for (const v of [face[0], face[i], face[i + 1]]) {
      positions.push(v.x, v.y, v.z)
      const d = v.clone().sub(origin); uvs.push(d.dot(e1) * scale, d.dot(e2) * scale)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  g.computeVertexNormals()
  return g
}
