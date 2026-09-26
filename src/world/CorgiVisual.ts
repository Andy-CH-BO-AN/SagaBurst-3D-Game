import * as THREE from 'three'
import { MarchingCubes } from 'three/examples/jsm/objects/MarchingCubes.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { HorseAnimationState } from './HorseAssetRegistry'

type V3 = [number, number, number]
export const CORGI_DIMENSIONS = { shoulder: 1.5, bodyLength: 2.7, saddleHeight: 1.63 } as const
// The imported mounted rider's hip joint is 17cm above its seated contact surface.
export const CORGI_RIDER_PELVIS_CLEARANCE = 0.17
let template: THREE.Group | undefined

/** Reference-authored metre geometry, +Z forward; static resources shared between instances. */
function buildTemplate(): THREE.Group {
  const root = new THREE.Group()
  root.name = 'armored_corgi_reference_mount'
  const mat = (color: number, roughness = 0.7, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness })
  const coat = mat(0xffffff, 0.92); coat.vertexColors = true
  const orange = new THREE.Color(0xb87330), cream = new THREE.Color(0xf2e6d0)
  const steel = mat(0xa4aaad, 0.5, 0.5), rim = mat(0x454d50, 0.43, 0.72)
  const leather = mat(0x49291a, 0.78), piping = mat(0x94623b), brass = mat(0xb89553, 0.42, 0.7)
  const cloth = mat(0x8c2428, 0.95), black = mat(0x17100e, 0.42), pink = mat(0xbb7770, 0.86)
  const iris = mat(0x693b1c, 0.27), white = mat(0xfff2d9, 0.6)
  const glint = new THREE.MeshBasicMaterial({ color: 0xfff6df })
  let seed = 719
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
  const grainData = new Uint8Array(64 * 64 * 4)
  for (let i = 0; i < grainData.length; i += 4) {
    const c = 100 + random() * 100
    grainData[i] = grainData[i + 1] = grainData[i + 2] = c; grainData[i + 3] = 255
  }
  const grain = new THREE.DataTexture(grainData, 64, 64)
  grain.wrapS = grain.wrapT = THREE.RepeatWrapping; grain.repeat.set(10, 8); grain.needsUpdate = true
  coat.bumpMap = leather.bumpMap = cloth.bumpMap = grain
  coat.bumpScale = 0.008; leather.bumpScale = 0.004; cloth.bumpScale = 0.002
  const mesh = (parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, p: V3 = [0, 0, 0]) => {
    const m = new THREE.Mesh(geometry, material); m.position.set(...p); m.castShadow = m.receiveShadow = true; parent.add(m); return m
  }
  const ellipsoid = (parent: THREE.Object3D, p: V3, scale: V3, material: THREE.Material) => {
    const g = new THREE.SphereGeometry(1, 24, 16); g.scale(...scale); return mesh(parent, g, material, p)
  }
  const tube = (parent: THREE.Object3D, points: V3[], radius: number, material: THREE.Material) => mesh(parent,
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p))), Math.max(12, points.length * 5), radius, 6, false), material)
  const group = (parent: THREE.Object3D, name: string, p: V3 = [0, 0, 0]) => {
    const g = new THREE.Group(); g.name = name; g.position.set(...p); parent.add(g); return g
  }
  const torso = group(root, 'corgi_torso')
  const equipment = group(torso, 'corgi_equipment')
  equipment.userData.corgiEquipment = true
  const tintGeometry = (g: THREE.BufferGeometry, colorAt: (p: THREE.Vector3) => number) => {
    const pos = g.getAttribute('position'), colors: number[] = [], p = new THREE.Vector3(), c = new THREE.Color()
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i); c.copy(orange).lerp(cream, colorAt(p)); colors.push(c.r, c.g, c.b)
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  }
  const furBall = (parent: THREE.Object3D, p: V3, scale: V3, whiteAmount: number) => {
    const g = new THREE.SphereGeometry(1, 24, 16); g.scale(...scale); tintGeometry(g, () => whiteAmount); return mesh(parent, g, coat, p)
  }
  // Smooth unions define the actual skin, so neither the coat nor the armor hides sphere seams.
  const sculpt = (parent: THREE.Object3D, volumes: [V3, V3][], center: V3, extent: V3, colorAt: (p: THREE.Vector3) => number, hairs: number) => {
    const distance = (x: number, y: number, z: number) => {
      let d = 100
      for (const [c, r] of volumes) {
        const b = (Math.hypot((x - c[0]) / r[0], (y - c[1]) / r[1], (z - c[2]) / r[2]) - 1) * Math.min(...r)
        const h = Math.max(0.09 - Math.abs(d - b), 0) / 0.09
        d = Math.min(d, b) - h * h * 0.0225
      }
      return d
    }
    const n = 56, mc = new MarchingCubes(n, coat, false, false, 50000); mc.isolation = 0
    for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      mc.field[z * n * n + y * n + x] = -distance(center[0] + (x / n * 2 - 1) * extent[0], center[1] + (y / n * 2 - 1) * extent[1], center[2] + (z / n * 2 - 1) * extent[2])
    }
    mc.update()
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(mc.geometry.getAttribute('position').array.slice(0, mc.count * 3), 3))
    g.scale(...extent); g.translate(...center)
    const pos = g.getAttribute('position'), normals: number[] = [], uv: number[] = [], p = new THREE.Vector3()
    const normal = (p: THREE.Vector3) => {
      const { x, y, z } = p, e = 0.001
      return new THREE.Vector3(distance(x + e, y, z) - distance(x - e, y, z), distance(x, y + e, z) - distance(x, y - e, z), distance(x, y, z + e) - distance(x, y, z - e)).normalize()
    }
    for (let i = 0; i < pos.count; i++) { p.fromBufferAttribute(pos, i); normals.push(...normal(p).toArray()); uv.push(p.z, p.y) }
    g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    tintGeometry(g, colorAt); mesh(parent, g, coat); mc.geometry.dispose()
    // Short fibers stay inside the fitted plate clearance, including during articulation.
    const hp: number[] = [], hc: number[] = [], c = new THREE.Color()
    for (let i = 0; i < hairs; i++) {
      const index = Math.floor(random() * pos.count / 3) * 3
      const a = Math.sqrt(random()), b = random()
      p.set(0, 0, 0)
      for (let j = 0; j < 3; j++) p.addScaledVector(new THREE.Vector3().fromBufferAttribute(pos, index + j), [1 - a, a * (1 - b), a * b][j])
      const norm = normal(p), t = new THREE.Vector3(norm.z, 0.1, -norm.x).normalize().multiplyScalar(0.0014)
      const tip = p.clone().addScaledVector(norm, 0.004).add(new THREE.Vector3(0, -0.012, -0.006))
      hp.push(...p.clone().add(t).toArray(), ...tip.toArray(), ...p.clone().sub(t).toArray())
      c.copy(orange).lerp(cream, colorAt(p)).multiplyScalar(0.98 + random() * 0.04)
      for (let j = 0; j < 3; j++) hc.push(c.r, c.g, c.b)
    }
    const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.Float32BufferAttribute(hp, 3)); fg.setAttribute('color', new THREE.Float32BufferAttribute(hc, 3)); fg.computeVertexNormals()
    mesh(parent, fg, coat)
  }
  const smooth = THREE.MathUtils.smoothstep
  const bodyVolumes: [V3, V3][] = [
    [[0, 1.00, -0.17], [0.48, 0.49, 1.25]],
    [[0, 1.07, 0.73], [0.45, 0.50, 0.47]],
    [[0, 1.45, 0.99], [0.36, 0.53, 0.38]],
    [[0, 0.97, -1.00], [0.43, 0.46, 0.43]],
  ]
  sculpt(torso, bodyVolumes, [0, 1.15, 0.03], [0.59, 1.00, 1.65], p => Math.max(1 - smooth(p.y, 0.77, 0.89), smooth(p.z, 0.94, 1.19) * (1 - smooth(Math.abs(p.x), 0.22, 0.33))), 13000)

  const head = group(torso, 'corgi_head', [0, 1.77, 1.16])
  sculpt(head, [
    [[0, 0.07, 0], [0.38, 0.36, 0.38]],
    [[0, -0.09, 0.29], [0.28, 0.21, 0.36]],
    [[0, -0.10, 0.49], [0.205, 0.135, 0.24]],
    ...[-1, 1].map(s => [[s * 0.255, -0.11, 0.04], [0.14, 0.205, 0.23]] as [V3, V3]),
  ], [0, 0.025, 0.19], [0.48, 0.49, 0.69], p => Math.max(smooth(p.z, 0.22, 0.36) * (1 - smooth(p.y, -0.01, 0.075)), (1 - smooth(Math.abs(p.x), 0.046 + Math.max(0, -p.y) * 0.25, 0.092 + Math.max(0, -p.y) * 0.25)) * smooth(p.z, 0.18, 0.26), 1 - smooth(p.y, -0.24, -0.15)), 7000)
  // The tongue starts inside the mouth, clears the lower lip, then curls down.
  ellipsoid(head, [0, -0.235, 0.37], [0.235, 0.085, 0.31], black)
  furBall(head, [0, -0.295, 0.30], [0.245, 0.08, 0.29], 1)
  const tongueCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -0.235, 0.45), new THREE.Vector3(0, -0.235, 0.57),
    new THREE.Vector3(0, -0.265, 0.665), new THREE.Vector3(0, -0.33, 0.713),
    new THREE.Vector3(0, -0.40, 0.71),
  ])
  const tonguePositions: number[] = [], tongueIndices: number[] = [], groove: V3[] = []
  const tongueRings = 32, tongueSides = 12
  for (let j = 0; j <= tongueRings; j++) {
    const t = j / tongueRings, center = tongueCurve.getPoint(t), tangent = tongueCurve.getTangent(t)
    const normal = new THREE.Vector3(0, tangent.z, -tangent.y).normalize()
    const taper = Math.sqrt(Math.max(0.0001, 1 - Math.max(0, (t - 0.72) / 0.28) ** 2))
    const width = (0.067 + 0.015 * Math.sin(t * Math.PI)) * taper
    for (let i = 0; i < tongueSides; i++) {
      const a = i / tongueSides * Math.PI * 2
      tonguePositions.push(...center.clone().add(new THREE.Vector3(Math.cos(a) * width, 0, 0)).addScaledVector(normal, Math.sin(a) * 0.013 * taper).toArray())
      if (j < tongueRings) {
        const k = j * tongueSides + i, next = j * tongueSides + (i + 1) % tongueSides
        tongueIndices.push(k, next, k + tongueSides, next, next + tongueSides, k + tongueSides)
      }
    }
    if (t >= 0.38 && t <= 0.90) groove.push(center.clone().addScaledVector(normal, 0.014 * taper).toArray() as V3)
  }
  for (const ring of [0, tongueRings]) {
    const center = tonguePositions.length / 3
    tonguePositions.push(...tongueCurve.getPoint(ring / tongueRings).toArray())
    for (let i = 0; i < tongueSides; i++) tongueIndices.push(center, ring * tongueSides + i, ring * tongueSides + (i + 1) % tongueSides)
  }
  const tongueGeometry = new THREE.BufferGeometry()
  tongueGeometry.setAttribute('position', new THREE.Float32BufferAttribute(tonguePositions, 3))
  tongueGeometry.setIndex(tongueIndices); tongueGeometry.computeVertexNormals()
  mesh(head, tongueGeometry, pink)
  tube(head, groove, 0.002, mat(0x8f4a49, 0.85))
  ellipsoid(head, [0, -0.068, 0.71], [0.113, 0.079, 0.056], black)
  for (const side of [-1, 1]) {
    ellipsoid(head, [side * 0.064, -0.053, 0.75], [0.025, 0.017, 0.01], rim)
    // Almond lids embed the eyes in the skull instead of projecting round eyeballs.
    const eye = group(head, `corgi_eye_${side}`, [side * 0.255, 0.13, 0.295]); eye.rotation.y = side * 0.38
    ellipsoid(eye, [0, 0, 0], [0.096, 0.079, 0.026], leather)
    ellipsoid(eye, [0, 0, 0.026], [0.065, 0.060, 0.017], iris)
    ellipsoid(eye, [0, 0, 0.04], [0.039, 0.048, 0.010], black)
    ellipsoid(eye, [-0.02, 0.026, 0.054], [0.012, 0.014, 0.007], glint)
    tube(eye, [[-0.083, 0.006, 0.012], [-0.047, 0.067, 0.021], [0.028, 0.074, 0.024], [0.085, 0.015, 0.01]], 0.018, leather)
    for (let i = 0; i < 4; i++) ellipsoid(head, [side * (0.10 + i * 0.025), -0.174, 0.59 - i * 0.055], [0.016, 0.022, 0.019], white)
    for (let i = 0; i < 8; i++) ellipsoid(head, [side * (0.12 + random() * 0.073), -0.09 - random() * 0.05, 0.625 - random() * 0.055], [0.004, 0.004, 0.004], leather)
    // Thick, curved ear shell with a rounded taper; open concha faces forward.
    const ear = group(head, `corgi_ear_${side}`, [side * 0.25, 0.235, -0.025]); ear.rotation.z = -side * 0.19
    const earSurface = (u: number, t: number, inset: boolean): V3 => {
      const w = (0.205 * Math.pow(Math.max(0, Math.sin(Math.PI * (t * 0.86 + 0.14))), 0.85)) * (inset ? 0.72 : 1)
      return [u * w, t * (inset ? 0.46 : 0.57), 0.045 + Math.abs(u) * 0.066 - Math.sin(t * Math.PI) * 0.06 + (inset ? 0.009 : 0)]
    }
    const earPatch = (inset: boolean) => {
      const positions: number[] = [], indices: number[] = []
      for (let j = 0; j <= 16; j++) for (let i = 0; i <= 8; i++) positions.push(...earSurface(i / 4 - 1, j / 16, inset))
      for (let j = 0; j < 16; j++) for (let i = 0; i < 8; i++) { const k = j * 9 + i; indices.push(k, k + 1, k + 9, k + 1, k + 10, k + 9) }
      if (!inset) {
        const count = positions.length / 3, frontIndices = [...indices]
        for (let i = 0; i < count; i++) positions.push(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2] - 0.032)
        for (let i = 0; i < frontIndices.length; i += 3) indices.push(frontIndices[i] + count, frontIndices[i + 2] + count, frontIndices[i + 1] + count)
        const border = [...Array.from({ length: 9 }, (_, i) => i), ...Array.from({ length: 16 }, (_, i) => (i + 1) * 9 + 8), ...Array.from({ length: 8 }, (_, i) => 16 * 9 + 7 - i), ...Array.from({ length: 15 }, (_, i) => (15 - i) * 9)]
        for (let i = 0; i < border.length; i++) {
          const a = border[i], b = border[(i + 1) % border.length]
          indices.push(a, b, a + count, b, b + count, a + count)
        }
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); g.setIndex(indices); g.computeVertexNormals()
      if (!inset) tintGeometry(g, p => 0.15 + smooth(p.y, 0.45, 0.65) * 0.2)
      const m = inset ? pink : coat; m.side = THREE.DoubleSide; mesh(ear, g, m, inset ? [0, 0.052, 0.015] : [0, 0, 0])
    }
    earPatch(false); earPatch(true)
    furBall(ear, [0, 0.005, -0.015], [0.115, 0.095, 0.065], 0.15)
  }

  // Parameterized patches keep plate edges and rivets on the same fitted surface.
  const patch = (parent: THREE.Object3D, surface: (u: number, v: number) => V3, material: THREE.Material, edgeMaterial?: THREE.Material, rivets = false) => {
    const p: number[] = [], indices: number[] = [], n = 10
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) p.push(...surface(i / n, j / n))
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const k = j * (n + 1) + i; indices.push(k, k + 1, k + n + 1, k + 1, k + n + 2, k + n + 1) }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setIndex(indices); g.computeVertexNormals(); material.side = THREE.DoubleSide; mesh(parent, g, material)
    if (edgeMaterial) {
      const points: V3[] = []
      for (let i = 0; i <= 10; i++) points.push(surface(i / 10, 0))
      for (let i = 1; i <= 10; i++) points.push(surface(1, i / 10))
      for (let i = 9; i >= 0; i--) points.push(surface(i / 10, 1))
      for (let i = 9; i >= 0; i--) points.push(surface(0, i / 10))
      tube(parent, points, material === cloth ? 0.012 : 0.008, edgeMaterial)
    }
    if (rivets) for (const u of [0.1, 0.9]) for (const v of [0.12, 0.88]) ellipsoid(parent, surface(u, v), [0.014, 0.014, 0.014], brass)
  }
  const skinDistance = (x: number, y: number, z: number) => {
    let d = 100
    for (const [c, r] of bodyVolumes) {
      const b = (Math.hypot((x - c[0]) / r[0], (y - c[1]) / r[1], (z - c[2]) / r[2]) - 1) * Math.min(...r)
      const h = Math.max(0.09 - Math.abs(d - b), 0) / 0.09
      d = Math.min(d, b) - h * h * 0.0225
    }
    return d
  }
  const surfaceRadius = (point: (radius: number) => V3) => {
    let lo = 0, hi = 3
    for (let i = 0; i < 16; i++) {
      const mid = (lo + hi) / 2
      if (skinDistance(...point(mid)) < 0) lo = mid; else hi = mid
    }
    return (lo + hi) / 2
  }
  // Back/side coverage follows the torso ellipsoid; shoulder plates get their own section.
  const bodySurface = (angle: number, z: number, offset = 0): V3 => {
    const radius = surfaceRadius(r => [Math.sin(angle) * 0.48 * r, 1 + Math.cos(angle) * 0.49 * r, z])
    return [Math.sin(angle) * (0.48 * radius + offset), 1 + Math.cos(angle) * (0.49 * radius + offset), z]
  }
  for (const side of [-1, 1]) {
    patch(equipment, (u, v) => {
      const z = -1.13 + u * 2.06, a = side * (0.32 + v * 1.35), p = bodySurface(a, z, 0.053)
      p[1] -= v * v * (0.15 + 0.04 * Math.cos(u * Math.PI * 10)); return p
    }, cloth, brass)
    for (let i = 0; i < 5; i++) {
      const z = -1.22 + i * 0.42
      patch(equipment, (u, v) => bodySurface(side * (0.25 + v * 1.13), z + u * 0.395, 0.085), steel, rim, true)
    }
    // Front shoulder lames wrap the chest and leave the elbows free.
    for (let i = 0; i < 3; i++) patch(equipment, (u, v) => {
      const a = side * (0.32 + u * 1.21), y = 1.47 - i * 0.19 - v * 0.215
      const r = surfaceRadius(r => [Math.sin(a) * r, y, 0.73 + Math.cos(a) * r]) + 0.05
      return [Math.sin(a) * r, y, 0.73 + Math.cos(a) * r]
    }, steel, rim, true)
    // Girth and rear harness run over the plates, not through the fur.
    for (const z of [-0.82, 0.43]) patch(equipment, (u, v) => bodySurface(side * (0.25 + v * 2.42), z + (u - 0.5) * 0.08, 0.11), leather, piping)
  }
  // Three overlapping pointed breast plates, with a visible red cloth skirt.
  patch(equipment, (u, v) => { const x = (u - 0.5) * 0.78; return [x, 1.20 - v * 0.65 + Math.abs(x) * v * 0.45, 1.11 + 0.12 * (1 - (x / 0.5) ** 2)] }, cloth, brass)
  for (let i = 0; i < 3; i++) patch(equipment, (u, v) => {
    const x = (u - 0.5) * (0.71 + i * 0.04)
    return [x, 1.59 - i * 0.21 - v * 0.27 + Math.abs(x) * 0.31, 1.21 + 0.19 * (1 - (x / 0.49) ** 2) - i * 0.015]
  }, steel, rim, true)
  // Neck lames protect the rear and sides while leaving the white throat visible.
  for (let i = 0; i < 3; i++) patch(equipment, (u, v) => {
    const a = 0.78 + u * (Math.PI * 2 - 1.56), y = 1.67 - i * 0.13 - v * 0.17
    const z = 0.93 - i * 0.035
    const r = surfaceRadius(r => [Math.sin(a) * r, y, z + Math.cos(a) * r]) + 0.048
    return [Math.sin(a) * r, y, z + Math.cos(a) * r]
  }, steel, rim, true)
  const helmet = group(head, 'corgi_helmet'); helmet.userData.corgiEquipment = true
  // Narrow the crown between the ear roots, then flare over the forehead.
  // The brow stops above the eyes; raising the whole helmet would leave it floating.
  const helmetSurface = (u: number, v: number): V3 => {
    const z = -0.25 + v * 0.485
    const halfWidth = 0.065 + 0.25 * smooth(z, 0.085, 0.205)
    const x = (u * 2 - 1) * halfWidth
    return [x, 0.07 + Math.sqrt(Math.max(0.035, 1 - (x / 0.405) ** 2 - (z / 0.405) ** 2)) * 0.385, z]
  }
  patch(helmet, helmetSurface, steel, rim, true)
  tube(helmet, Array.from({ length: 13 }, (_, i) => {
    const p = helmetSurface(0.5, i / 12); p[1] += 0.006; return p
  }), 0.009, brass)
  for (const side of [-1, 1]) {
    tube(helmet, [[side * 0.30, 0.30, 0.20], [side * 0.365, 0.11, 0.095], [side * 0.345, -0.10, 0.1], [side * 0.28, -0.31, 0.12], [0, -0.38, 0.13]], 0.022, leather)
    ellipsoid(helmet, [side * 0.36, 0.13, 0.10], [0.026, 0.03, 0.023], brass)
  }
  ellipsoid(equipment, [0, 1.53, -0.16], [0.30, 0.095, 0.49], leather)
  // Saddle pan and surface socket share their centre. The rider's bone is above it.
  patch(equipment, (u, v) => {
    const x = (u - 0.5) * 0.67, z = -0.68 + v * 1.04
    return [x, 1.515 - x * x * 0.45 + Math.pow((z + 0.16) / 0.52, 4) * 0.035, z]
  }, cloth, brass)
  patch(equipment, (u, v) => {
    const z = -0.62 + v * 0.92, along = (z + 0.16) / 0.46
    const x = (u * 2 - 1) * (0.19 + 0.085 * along * along)
    // A narrow, downturned waist lets the thighs leave the seat without crossing its rim.
    return [x, CORGI_DIMENSIONS.saddleHeight - Math.max(0, Math.abs(x) - 0.12) ** 2 * 1.5 + Math.pow(along, 4) * (z < -0.16 ? 0.23 : 0.15), z]
  }, leather, piping)
  for (const side of [-1, 1]) {
    patch(equipment, (u, v) => bodySurface(side * (0.60 + v * 0.92), -0.48 + u * 0.70, 0.125), leather, piping)
    tube(equipment, [[side * 0.32, 1.61, -0.05], [side * 0.60, 1.49, -0.01], [side * 0.74, 1.45, -0.04]], 0.026, leather)
    tube(equipment, [[side * 0.74, 1.48, -0.04], [side * 0.82, 1.36, -0.04], [side * 0.82, 1.27, -0.04], [side * 0.64, 1.27, -0.04], [side * 0.66, 1.40, -0.04], [side * 0.74, 1.48, -0.04]], 0.018, steel)
    for (const z of [-0.37, 0.15]) ellipsoid(equipment, [side * 0.47, 1.36, z], [0.025, 0.025, 0.025], brass)
  }

  for (const front of [true, false]) for (const side of [-1, 1]) {
    const name = `corgi_leg_${front ? 'front' : 'rear'}_${side}`
    const upper = group(torso, name, [side * 0.32, 0.80, front ? 0.78 : -1.01])
    sculpt(upper, [[[0, -0.07, 0], [0.205, 0.33, 0.24]], [[0, -0.30, front ? 0.015 : -0.045], [0.135, 0.22, 0.14]]], [0, -0.11, 0], [0.29, 0.52, 0.33], p => 1 - smooth(p.y, -0.46, -0.34), 1300)
    const lower = group(upper, `${name}_lower`, [0, -0.38, front ? 0.015 : -0.045])
    furBall(lower, [0, -0.10, 0.015], [0.123, 0.22, 0.13], 0.85)
    const foot = group(lower, `${name}_foot`, [0, -0.30, 0.085])
    furBall(foot, [0, 0, 0], [0.165, 0.12, 0.225], 1)
    for (let i = -1; i <= 1; i++) {
      tube(foot, [[i * 0.077, -0.018, 0.21], [i * 0.077, 0.054, 0.17]], 0.005, leather)
      ellipsoid(foot, [i * 0.077, -0.025, 0.206], [0.016, 0.023, 0.032], piping)
    }
    const greave = group(lower, `${name}_armor`); greave.userData.corgiEquipment = true
    patch(greave, (u, v) => { const a = (u - 0.5) * 3.9; return [Math.sin(a) * 0.149, 0.035 - v * 0.25, 0.015 + Math.cos(a) * 0.15] }, steel, rim, true)
    for (const y of [-0.02, -0.18]) tube(greave, [[-0.13, y, 0.0], [-0.12, y, -0.11], [0, y, -0.145], [0.12, y, -0.11], [0.13, y, 0]], 0.021, leather)
  }
  const tail = group(torso, 'corgi_tail', [0, 1.03, -1.29]); tail.rotation.x = -0.2
  furBall(tail, [0, 0.035, -0.11], [0.16, 0.18, 0.23], 0.35)

  // Batch within articulation/equipment nodes; visibility and joints remain independent.
  const consolidate = (g: THREE.Group) => {
    for (const child of [...g.children]) if (child instanceof THREE.Group) consolidate(child)
    const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>()
    for (const child of [...g.children]) if (child instanceof THREE.Mesh) {
      child.updateMatrix(); let geo = child.geometry.clone().applyMatrix4(child.matrix)
      if (geo.index) { const old = geo; geo = geo.toNonIndexed(); old.dispose() }
      geo.deleteAttribute('uv')
      const p = geo.getAttribute('position'), uv: number[] = []
      for (let i = 0; i < p.count; i++) uv.push(p.getZ(i) + p.getX(i), p.getY(i))
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
      const material = child.material as THREE.Material
      if (!buckets.has(material)) buckets.set(material, [])
      buckets.get(material)!.push(geo); child.geometry.dispose(); g.remove(child)
    }
    for (const [material, geos] of buckets) { mesh(g, mergeGeometries(geos)!, material); geos.forEach(g => g.dispose()) }
  }
  consolidate(root)
  return root
}

export class CorgiVisual {
  readonly root: THREE.Group
  readonly saddleSeat = new THREE.Object3D()
  readonly riderPelvisSeat = new THREE.Object3D()
  private readonly torso: THREE.Object3D
  private readonly head: THREE.Object3D
  private readonly tail: THREE.Object3D
  private readonly legs: { upper: THREE.Object3D; lower: THREE.Object3D }[] = []
  private time = 0
  private phase = 0
  private speed = 0
  private paused = false
  private studio: HorseAnimationState | null = null
  private oneShot: HorseAnimationState | null = null
  private oneShotTime = 0

  constructor() {
    template ??= buildTemplate()
    this.root = template.clone(true)
    this.torso = this.root.getObjectByName('corgi_torso')!
    this.head = this.root.getObjectByName('corgi_head')!
    this.tail = this.root.getObjectByName('corgi_tail')!
    for (const end of ['front', 'rear']) for (const side of [-1, 1]) {
      const upper = this.root.getObjectByName(`corgi_leg_${end}_${side}`)!
      this.legs.push({ upper, lower: upper.getObjectByName(`${upper.name}_lower`)! })
    }
    this.saddleSeat.name = 'corgi_saddle_seat'
    this.saddleSeat.position.set(0, CORGI_DIMENSIONS.saddleHeight, -0.16); this.torso.add(this.saddleSeat)
    this.riderPelvisSeat.name = 'corgi_rider_pelvis_seat'
    this.riderPelvisSeat.position.y = CORGI_RIDER_PELVIS_CLEARANCE
    this.saddleSeat.add(this.riderPelvisSeat)
  }
  setEquipmentVisible(visible: boolean): void { this.root.traverse(o => { if (o.userData.corgiEquipment) o.visible = visible }) }
  setLocomotion(speed: number): void { this.speed = speed; this.studio = null }
  playOnce(clip: HorseAnimationState): void { this.oneShot = clip; this.oneShotTime = 0 }
  playStudioClip(clip: HorseAnimationState): void { this.studio = clip; this.oneShot = null; this.time = this.phase = 0; this.paused = false }
  togglePaused(): boolean { this.paused = !this.paused; return this.paused }
  debugState() { return { clip: this.studio ?? this.oneShot ?? (this.speed > 6 ? 'gallop' : this.speed > 0.1 ? 'walk' : 'idle'), time: this.time, paused: this.paused } }
  update(dt: number): void {
    if (this.paused) return
    this.time += dt; this.oneShotTime += dt
    if (this.oneShot && !['death', 'jump'].includes(this.oneShot) && this.oneShotTime > 0.7) this.oneShot = null
    const state = this.studio ?? this.oneShot
    const speed = this.studio ? ({ walk: 2, trot: 4, canter: 7, gallop: 12 } as Partial<Record<HorseAnimationState, number>>)[this.studio] ?? 0 : this.speed
    const moving = speed > 0.1, gallop = speed > 6
    this.phase += dt * (gallop ? 13 : 4 + speed)
    this.torso.position.set(0, moving ? 0.018 + Math.sin(this.phase * 2) * 0.018 : Math.sin(this.time * 1.5) * 0.004, 0)
    this.torso.rotation.set(moving && gallop ? Math.sin(this.phase) * 0.025 : 0, 0, 0)
    this.head.rotation.set(Math.sin(this.time * 1.5) * 0.01, Math.sin(this.time * 0.7) * 0.025, 0)
    this.tail.rotation.y = Math.sin(this.time * 5) * 0.18
    this.legs.forEach((leg, i) => {
      const phase = this.phase + (gallop ? (i < 2 ? 0 : 2.2) + i % 2 * 0.45 : [0, Math.PI, Math.PI, 0][i])
      leg.upper.rotation.x = moving ? Math.sin(phase) * (gallop ? 0.62 : 0.36) : 0
      leg.lower.rotation.x = moving ? -Math.max(0, Math.cos(phase)) * (gallop ? 0.72 : 0.4) : 0
    })
    const t = this.studio ? this.time : this.oneShotTime
    if (state === 'jump') { this.torso.rotation.x = -Math.sin(Math.min(t / 0.7, 1) * Math.PI) * 0.12; this.legs.forEach(l => { l.upper.rotation.x = -0.55; l.lower.rotation.x = 0.75 }) }
    if (state === 'land') this.torso.position.y = -Math.sin(Math.min(t / 0.6, 1) * Math.PI) * 0.08
    if (state === 'hit') this.head.rotation.x = -Math.sin(Math.min(t / 0.6, 1) * Math.PI) * 0.18
    if (state === 'death') { const f = Math.min(t / 0.9, 1); this.torso.rotation.z = f * Math.PI / 2; this.torso.position.set(f * 0.9, f * 0.49, 0) }
  }
  dispose(): void { this.root.removeFromParent() }
}
