import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/**
 * Owns every GPU resource an arena creates itself. Shared resources (cached
 * procedural materials, character/mount assets) are never registered here,
 * so releasing an arena cannot destroy something another scene still uses.
 */
export class ArenaResources {
  private readonly owned = new Set<{ dispose(): void }>()
  private disposed = false

  track<T extends { dispose(): void }>(resource: T): T {
    if (this.disposed) throw new Error('Arena resources already released')
    this.owned.add(resource)
    return resource
  }

  get size(): number { return this.owned.size }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const resource of this.owned) resource.dispose()
    this.owned.clear()
  }
}

export type CanvasPainter = (context: CanvasRenderingContext2D, size: { width: number; height: number }) => void

/** Owned sRGB canvas texture (512–1024 px), repeat-wrapped. */
export function paintedTexture(resources: ArenaResources, width: number, height: number, paint: CanvasPainter,
  options: { repeat?: [number, number]; color?: boolean; anisotropy?: number } = {}): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('2D canvas is unavailable for arena textures')
  paint(context, { width, height })
  const texture = resources.track(new THREE.CanvasTexture(canvas))
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  if (options.repeat) texture.repeat.set(options.repeat[0], options.repeat[1])
  if (options.color !== false) texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = options.anisotropy ?? 4
  texture.needsUpdate = true
  return texture
}

/** Seeded pseudo-random stream so arena reloads look identical. */
export function arenaRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0
    return state / 4294967296
  }
}

/** Speckle/noise pass shared by stone, sand and wood textures. */
export function speckle(context: CanvasRenderingContext2D, width: number, height: number, seed: number,
  count: number, colors: readonly string[], maxSize = 3): void {
  const random = arenaRandom(seed)
  for (let i = 0; i < count; i++) {
    context.fillStyle = colors[Math.floor(random() * colors.length)]
    const size = 0.6 + random() * maxSize
    context.globalAlpha = 0.08 + random() * 0.22
    context.fillRect(random() * width, random() * height, size, size)
  }
  context.globalAlpha = 1
}

export function ownedMaterial<T extends THREE.Material>(resources: ArenaResources, material: T): T {
  return resources.track(material)
}

/** Merges parts into one owned static mesh. Input parts are released after merging. */
export function mergedMesh(resources: ArenaResources, parts: THREE.BufferGeometry[], material: THREE.Material,
  options: { castShadow?: boolean; receiveShadow?: boolean; name?: string } = {}): THREE.Mesh {
  const normalized = parts.map(part => part.index ? part.toNonIndexed() : part)
  for (const part of normalized) {
    if (!part.getAttribute('uv')) {
      part.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(part.getAttribute('position').count * 2), 2))
    }
    if (!part.getAttribute('normal')) part.computeVertexNormals()
  }
  const wantsColor = normalized.some(part => part.getAttribute('color'))
  if (wantsColor) {
    for (const part of normalized) {
      if (part.getAttribute('color')) continue
      const colors = new Float32Array(part.getAttribute('position').count * 3).fill(1)
      part.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    }
  }
  for (const part of normalized) {
    for (const name of Object.keys(part.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv' && name !== 'color') part.deleteAttribute(name)
    }
  }
  const merged = mergeGeometries(normalized, false)
  for (const part of parts) part.dispose()
  for (const part of normalized) part.dispose()
  if (!merged) throw new Error(`Arena geometry merge failed: ${options.name ?? material.name}`)
  merged.computeBoundingSphere()
  const mesh = new THREE.Mesh(resources.track(merged), material)
  mesh.name = options.name ?? material.name
  mesh.castShadow = options.castShadow ?? true
  mesh.receiveShadow = options.receiveShadow ?? true
  mesh.matrixAutoUpdate = false
  mesh.updateMatrix()
  return mesh
}

/** Paints a constant vertex colour onto a geometry (used to tint merged parts). */
export function tint<T extends THREE.BufferGeometry>(geometry: T, color: THREE.ColorRepresentation): T {
  const c = new THREE.Color(color)
  const count = geometry.getAttribute('position').count
  const colors = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) { colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  return geometry
}

/** Box placed by its min/max corners. */
export function boxBetween(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(maxX - minX, maxY - minY, maxZ - minZ)
    .translate((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2)
}

/**
 * GPU-animated flame tongues (no per-frame allocation). `time` is advanced by
 * the owning arena's update(), so a hidden or disposed arena stops animating.
 */
export function createFlameMaterial(resources: ArenaResources, time: { value: number }): THREE.MeshBasicMaterial {
  const material = ownedMaterial(resources, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.92, depthWrite: false }))
  material.onBeforeCompile = shader => {
    shader.uniforms.arenaTime = time
    shader.vertexShader = 'uniform float arenaTime;\n' + shader.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\n float flameLift = max(0.0, uv.y);\n transformed.x += sin(arenaTime * 7.0 + position.y * 9.0 + position.z * 3.0) * 0.07 * flameLift;\n transformed.z += cos(arenaTime * 6.0 + position.x * 7.0) * 0.05 * flameLift;\n transformed.y += sin(arenaTime * 9.0 + position.x * 13.0 + position.z * 5.0) * 0.09 * flameLift;')
  }
  material.name = 'arena-flame'
  return material
}

/** A flame cluster centred on (x, y, z): tapered cones with a hot core, uv.y = height ratio. */
export function flameParts(x: number, y: number, z: number, scale: number, seed: number, tongues = 6): THREE.BufferGeometry[] {
  const random = arenaRandom(seed)
  const parts: THREE.BufferGeometry[] = []
  for (let i = 0; i < tongues; i++) {
    const height = (0.5 + random() * 0.55) * scale
    const radius = (0.1 + random() * 0.08) * scale
    const geometry = new THREE.ConeGeometry(radius, height, 5, 2, true)
    const position = geometry.getAttribute('position')
    const uv = geometry.getAttribute('uv')
    const colors: number[] = []
    for (let v = 0; v < position.count; v++) {
      const t = (position.getY(v) + height / 2) / height
      uv.setXY(v, uv.getX(v), t)
      colors.push(1, 0.2 + (1 - t) * 0.45, 0.02 + (1 - t) * 0.08)
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    const angle = i * 2.4 + random()
    const spread = (0.08 + random() * 0.14) * scale
    // Shader sway uses local Y as height; translate after the colour/uv pass.
    geometry.translate(0, height / 2, 0).rotateY(angle).translate(x + Math.cos(angle) * spread, y, z + Math.sin(angle) * spread)
    parts.push(geometry)
  }
  return parts
}

/** Thin flat banner quad hanging down from (x, top, z) facing `yaw` (+Z forward). */
export function bannerQuad(x: number, top: number, z: number, yaw: number, width: number, height: number, offset = 0.04): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(width, height, 1, 4)
  const position = geometry.getAttribute('position')
  for (let i = 0; i < position.count; i++) {
    const t = (height / 2 - position.getY(i)) / height
    position.setZ(i, Math.sin(t * Math.PI) * 0.06)
  }
  geometry.computeVertexNormals()
  geometry.translate(0, -height / 2, offset).rotateY(yaw).translate(x, top, z)
  return geometry
}

/** Distance-based sort helps big transparent decals; arenas are static so this runs once. */
export function freezeStatic(root: THREE.Object3D): void {
  root.traverse(node => {
    node.matrixAutoUpdate = false
    node.updateMatrix()
  })
  root.updateMatrixWorld(true)
}

/** Iron tripod fire bowl with animated flames; base at (x, y, z). */
export function brazierParts(x: number, y: number, z: number, scale = 1): { iron: THREE.BufferGeometry[]; flame: THREE.BufferGeometry[] } {
  const iron: THREE.BufferGeometry[] = []
  for (let i = 0; i < 3; i++) {
    const a = i / 3 * Math.PI * 2
    iron.push(new THREE.CylinderGeometry(0.03 * scale, 0.035 * scale, 1.25 * scale, 5).rotateZ(0.22)
      .rotateY(-a).translate(x + Math.cos(a) * 0.2 * scale, y + 0.6 * scale, z + Math.sin(a) * 0.2 * scale))
  }
  iron.push(new THREE.CylinderGeometry(0.34 * scale, 0.16 * scale, 0.26 * scale, 10, 1, true).translate(x, y + 1.28 * scale, z))
  iron.push(new THREE.TorusGeometry(0.34 * scale, 0.035 * scale, 4, 10).rotateX(Math.PI / 2).translate(x, y + 1.41 * scale, z))
  return { iron, flame: flameParts(x, y + 1.32 * scale, z, 0.95 * scale, Math.round(Math.abs(x * 13 + z * 7)) + 1) }
}

/** Straight beam with a w x h rectangular section between two points. */
export function beamGeometry(a: THREE.Vector3, b: THREE.Vector3, width: number, height: number): THREE.BufferGeometry {
  const direction = b.clone().sub(a)
  const length = direction.length()
  const geometry = new THREE.BoxGeometry(width, height, length)
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction.normalize())
  return geometry.applyQuaternion(quaternion).translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2)
}
