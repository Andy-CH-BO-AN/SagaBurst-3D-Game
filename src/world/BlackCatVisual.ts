import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { MarchingCubes } from 'three/examples/jsm/objects/MarchingCubes.js'
import type { HorseAnimationState } from './HorseAssetRegistry'

type V3 = [number, number, number]
const v = (p: V3) => new THREE.Vector3(...p)
export const BLACK_CAT_DIMENSIONS = { shoulder: 1.6, bodyLength: 2.4, tailLength: 1.3, saddleHeight: 1.65 } as const

/** Authored in metres, facing +Z. Resources are shared; articulated transforms are per instance. */
let template: THREE.Group | undefined
function buildTemplate(): THREE.Group {
  let seed = 271828
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
  const root = new THREE.Group()
  const material = (color: number, roughness = 0.75, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness })
  const fur = material(0x141519, 0.88)
  const soft = material(0x202127, 0.91)
  const leather = material(0x211e24, 0.65)
  const edge = material(0x4d3829, 0.76)
  const gold = material(0xb99751, 0.33, 0.72)
  const black = material(0x08090b, 0.37)
  const inner = material(0x493735, 0.93)
  const iris = material(0xd6a537, 0.3, 0.18)
  const glint = new THREE.MeshBasicMaterial({ color: 0xfff4cf })
  const whiskers = material(0x857f76, 0.7)
  // Fine directional surface grain, supplemented by opaque geometric fur tufts at the silhouette.
  const texData = new Uint8Array(128 * 128 * 4)
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const n = 100 + 80 * random() + 45 * Math.sin(x * 2.4 + Math.sin(y * 0.14))
    const i = (y * 128 + x) * 4
    texData[i] = texData[i + 1] = texData[i + 2] = n; texData[i + 3] = 255
  }
  const grain = new THREE.DataTexture(texData, 128, 128)
  grain.wrapS = grain.wrapT = THREE.RepeatWrapping; grain.repeat.set(7, 4)
  grain.magFilter = THREE.LinearFilter; grain.needsUpdate = true
  fur.bumpMap = soft.bumpMap = grain; fur.bumpScale = soft.bumpScale = 0.012
  leather.bumpMap = grain; leather.bumpScale = 0.003
  const mesh = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, p: V3 = [0, 0, 0]) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(...p); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m
  }
  const ellipsoid = (parent: THREE.Object3D, p: V3, scale: V3, mat: THREE.Material = fur) => {
    const g = new THREE.SphereGeometry(1, 28, 20); g.scale(...scale); return mesh(parent, g, mat, p)
  }
  const tube = (parent: THREE.Object3D, points: V3[], radius: number, mat = gold) => mesh(parent,
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(v)), Math.max(12, points.length * 6), radius, 6, false), mat)
  const tufted = (parent: THREE.Object3D, p: V3, scale: V3, count: number, length: number, mat = fur, skin = true) => {
    if (skin) ellipsoid(parent, p, scale, mat)
    const positions: number[] = []
    for (let i = 0; i < count * 2; i++) {
      const a = random() * Math.PI * 2, h = random() * 2 - 1, r = Math.sqrt(1 - h * h)
      const n = new THREE.Vector3(r * Math.cos(a), h, r * Math.sin(a))
      const base = new THREE.Vector3(n.x * scale[0] + p[0], n.y * scale[1] + p[1], n.z * scale[2] + p[2])
      const tangent = new THREE.Vector3(-n.z, 0.15, n.x).normalize().multiplyScalar(length * (0.035 + random() * 0.055))
      const tip = base.clone().addScaledVector(n, length * 0.22).add(new THREE.Vector3(n.x * length * 0.26, -length * 0.7, -length * 0.3))
      const ridge = base.clone().addScaledVector(n, length * 0.12)
      const left = base.clone().add(tangent), right = base.clone().sub(tangent)
      positions.push(...left.toArray(), ...tip.toArray(), ...ridge.toArray(), ...ridge.toArray(), ...tip.toArray(), ...right.toArray())
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); g.computeVertexNormals()
    const strands = mesh(parent, g, mat); strands.userData.catFurStrands = true
  }
  const star = (parent: THREE.Object3D, p: V3, radius: number, rotation: V3 = [0, 0, 0]) => {
    const shape = new THREE.Shape()
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4, r = i % 2 ? radius * 0.3 : radius
      if (i === 0) shape.moveTo(Math.sin(a) * r, Math.cos(a) * r)
      else shape.lineTo(Math.sin(a) * r, Math.cos(a) * r)
    }
    shape.closePath()
    const m = mesh(parent, new THREE.ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 1, steps: 1 }), gold, p)
    m.rotation.set(...rotation)
  }
  const torso = new THREE.Group(); torso.name = 'cat_torso'; root.add(torso)
  // Smoothly join the throat, sternum and belly instead of intersecting furred spheres.
  const bodyVolumes: [V3, V3][] = [
    [[0, 1.26, -0.10], [0.385, 0.34, 0.84]],
    [[0, 1.50, -0.10], [0.30, 0.13, 0.72]],
    [[0, 1.235, 0.48], [0.335, 0.365, 0.36]],
    [[0, 1.16, 0.57], [0.23, 0.285, 0.25]],
    [[0, 1.245, -0.73], [0.32, 0.305, 0.31]],
    ...[-1, 1].map(side => [[side * 0.245, 1.22, 0.45], [0.16, 0.31, 0.24]] as [V3, V3]),
  ]
  const bodyDistance = (x: number, y: number, z: number) => {
    let distance = 10
    const blend = 0.09 - 0.075 * THREE.MathUtils.smoothstep(y, 1.30, 1.50) * (1 - THREE.MathUtils.smoothstep(z, 0.30, 0.65))
    const join = (d: number) => {
      const h = Math.max(blend - Math.abs(distance - d), 0) / blend
      distance = Math.min(distance, d) - h * h * blend * 0.25
    }
    for (const [c, r] of bodyVolumes) join((Math.hypot((x - c[0]) / r[0], (y - c[1]) / r[1], (z - c[2]) / r[2]) - 1) * Math.min(...r))
    const ny = (y - 1.435) * Math.cos(0.80) + (z - 0.815) * Math.sin(0.80)
    const nz = -(y - 1.435) * Math.sin(0.80) + (z - 0.815) * Math.cos(0.80)
    join((Math.hypot(x / 0.215, ny / 0.355, nz / 0.215) - 1) * 0.215)
    return distance
  }
  const bodySculpt = new MarchingCubes(64, fur, false, false, 50000)
  bodySculpt.isolation = 0
  for (let z = 0; z < 64; z++) for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    bodySculpt.field[z * 64 * 64 + y * 64 + x] = -bodyDistance((x / 64 * 2 - 1) * 0.53, 1.36 + (y / 64 * 2 - 1) * 0.65, (z / 64 * 2 - 1) * 1.25)
  }
  bodySculpt.update()
  const bodyGeometry = new THREE.BufferGeometry()
  bodyGeometry.setAttribute('position', new THREE.Float32BufferAttribute(bodySculpt.geometry.getAttribute('position').array.slice(0, bodySculpt.count * 3), 3))
  bodyGeometry.scale(0.53, 0.65, 1.25); bodyGeometry.translate(0, 1.36, 0); bodyGeometry.computeVertexNormals()
  // Use the field gradient across triangles to keep the joined silhouette smoothly lit.
  const bodySurface = bodyGeometry.getAttribute('position'), smoothNormals: number[] = []
  for (let i = 0; i < bodySurface.count; i++) {
    const x = bodySurface.getX(i), y = bodySurface.getY(i), z = bodySurface.getZ(i), e = 0.0005
    const n = new THREE.Vector3(bodyDistance(x + e, y, z) - bodyDistance(x - e, y, z), bodyDistance(x, y + e, z) - bodyDistance(x, y - e, z), bodyDistance(x, y, z + e) - bodyDistance(x, y, z - e)).normalize()
    smoothNormals.push(n.x, n.y, n.z)
  }
  bodyGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(smoothNormals, 3))
  mesh(torso, bodyGeometry, fur); bodySculpt.geometry.dispose()
  // Sample fur on the joined surface, so no internal sphere seam shows through the coat.
  const bodyPositions = bodyGeometry.getAttribute('position'), bodyNormals = bodyGeometry.getAttribute('normal')
  const bodyAreas: number[] = []; let bodyArea = 0
  const bp = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
  for (let i = 0; i < bodyPositions.count; i += 3) {
    bp.forEach((p, j) => p.fromBufferAttribute(bodyPositions, i + j))
    bodyArea += bp[1].clone().sub(bp[0]).cross(bp[2].clone().sub(bp[0])).length() * 0.5
    bodyAreas.push(bodyArea)
  }
  const bodyHair: number[] = []
  for (let i = 0; i < 28000; i++) {
    const sample = random() * bodyArea
    let low = 0, high = bodyAreas.length - 1
    while (low < high) { const mid = (low + high) >>> 1; if (bodyAreas[mid] < sample) low = mid + 1; else high = mid }
    const r = Math.sqrt(random()), t = random(), weights = [1 - r, r * (1 - t), r * t]
    const base = new THREE.Vector3(), n = new THREE.Vector3()
    for (let j = 0; j < 3; j++) {
      base.addScaledVector(new THREE.Vector3().fromBufferAttribute(bodyPositions, low * 3 + j), weights[j])
      n.addScaledVector(new THREE.Vector3().fromBufferAttribute(bodyNormals, low * 3 + j), weights[j])
    }
    n.normalize()
    const length = base.z > 0.35 ? 0.055 : 0.07
    const tangent = new THREE.Vector3(-n.z, 0.15, n.x).normalize().multiplyScalar(length * (0.035 + random() * 0.055))
    const tip = base.clone().addScaledVector(n, length * 0.22).add(new THREE.Vector3(n.x * length * 0.26, -length * 0.7, -length * 0.3))
    const ridge = base.clone().addScaledVector(n, length * 0.12)
    bodyHair.push(...base.clone().add(tangent).toArray(), ...tip.toArray(), ...ridge.toArray(), ...ridge.toArray(), ...tip.toArray(), ...base.clone().sub(tangent).toArray())
  }
  const bodyFurGeometry = new THREE.BufferGeometry(); bodyFurGeometry.setAttribute('position', new THREE.Float32BufferAttribute(bodyHair, 3)); bodyFurGeometry.computeVertexNormals()
  mesh(torso, bodyFurGeometry, fur).userData.catFurStrands = true

  const head = new THREE.Group(); head.name = 'cat_head'; head.position.set(0, 1.635, 1.065); head.scale.set(0.84, 1, 0.86); torso.add(head)
  // Smooth-union sculpt: skull, cheekbones, muzzle and chin form one continuous surface.
  // This avoids the separate sphere seams that make a feline muzzle look like a toy.
  const sculpt = new MarchingCubes(48, fur, false, false, 22000)
  sculpt.isolation = 0
  const volumes: [V3, V3][] = [
    [[0, -0.022, -0.008], [0.255, 0.18, 0.245]],
    [[-0.173, -0.073, 0.024], [0.108, 0.108, 0.14]],
    [[0.173, -0.073, 0.024], [0.108, 0.108, 0.14]],
    [[-0.056, -0.097, 0.225], [0.075, 0.054, 0.080]],
    [[0.056, -0.097, 0.225], [0.075, 0.054, 0.080]],
    [[0, -0.146, 0.190], [0.075, 0.038, 0.084]],
    [[0, -0.004, 0.188], [0.051, 0.089, 0.086]],
  ]
  for (let z = 0; z < 48; z++) for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) {
    const point = [(x / 48 * 2 - 1) * 0.45, (y / 48 * 2 - 1) * 0.45, (z / 48 * 2 - 1) * 0.45]
    let distance = 10
    for (const [center, radii] of volumes) {
      const dx = (point[0] - center[0]) / radii[0], dy = (point[1] - center[1]) / radii[1], dz = (point[2] - center[2]) / radii[2]
      const d = (Math.sqrt(dx * dx + dy * dy + dz * dz) - 1) * Math.min(...radii)
      const h = Math.max(0.032 - Math.abs(distance - d), 0) / 0.032
      distance = Math.min(distance, d) - h * h * 0.008
    }
    // A shallow convex crown sits between the former dome and flat cut-off.
    const crown = point[1] - (0.150 - 0.70 * point[0] ** 2 - Math.max(0, point[2]) * 0.14)
    const blend = Math.max(0.008 - Math.abs(distance - crown), 0) / 0.008
    distance = Math.max(distance, crown) + blend * blend * 0.002
    // Carve actual sockets into the face so eyes can sit inside the skull.
    for (const side of [-1, 1]) {
      const dx = (point[0] - side * 0.142) / 0.075
      const dy = (point[1] - 0.035) / 0.048
      const dz = (point[2] - 0.193) / 0.050
      const socketDistance = (Math.sqrt(dx * dx + dy * dy + dz * dz) - 1) * 0.048
      distance = Math.max(distance, -socketDistance)
    }
    sculpt.field[z * 48 * 48 + y * 48 + x] = -distance
  }
  sculpt.update()
  const sculptGeometry = new THREE.BufferGeometry()
  for (const name of ['position', 'normal']) {
    const attr = sculpt.geometry.getAttribute(name)
    sculptGeometry.setAttribute(name, new THREE.Float32BufferAttribute(attr.array.slice(0, sculpt.count * 3), 3))
  }
  sculptGeometry.scale(0.45, 0.45, 0.45)
  mesh(head, sculptGeometry, fur); sculpt.geometry.dispose()
  // Grow short fur directly on the sculpt rather than on a second spherical cap.
  // Area-weighted sampling follows the flattened brow, muzzle and tapered jaw.
  const crownHair: number[] = []
  const scalp = sculptGeometry.getAttribute('position'), scalpNormals = sculptGeometry.getAttribute('normal')
  const areas: number[] = []; let totalArea = 0
  const vertices = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
  for (let i = 0; i < scalp.count; i += 3) {
    vertices.forEach((p, j) => p.fromBufferAttribute(scalp, i + j))
    totalArea += vertices[1].clone().sub(vertices[0]).cross(vertices[2].clone().sub(vertices[0])).length() * 0.5
    areas.push(totalArea)
  }
  for (let i = 0; i < 18000; i++) {
    const sample = random() * totalArea
    let low = 0, high = areas.length - 1
    while (low < high) { const mid = (low + high) >>> 1; if (areas[mid] < sample) low = mid + 1; else high = mid }
    const triangle = low * 3, r = Math.sqrt(random()), t = random(), weights = [1 - r, r * (1 - t), r * t]
    const base = new THREE.Vector3(), n = new THREE.Vector3()
    for (let j = 0; j < 3; j++) {
      base.addScaledVector(new THREE.Vector3().fromBufferAttribute(scalp, triangle + j), weights[j])
      n.addScaledVector(new THREE.Vector3().fromBufferAttribute(scalpNormals, triangle + j), weights[j])
    }
    n.normalize()
    if (base.z > 0.14 && Math.abs(base.y - 0.035) < 0.047 && Math.abs(Math.abs(base.x) - 0.142) < 0.070) continue
    const direction = new THREE.Vector3(base.x * 1.4, base.y > 0.03 ? 0.1 : -0.55, -1)
    const groom = direction.addScaledVector(n, -n.dot(direction)).normalize()
    // Keep muzzle fur fine; lift the forehead and temple fibres just enough to catch light.
    const length = base.z > 0.20 ? 0.012 : 0.031
    const loft = base.z > 0.20 ? 0.004 : 0.009
    const width = new THREE.Vector3().crossVectors(n, groom).normalize().multiplyScalar(0.001 + random() * 0.001)
    base.addScaledVector(n, 0.001)
    const middle = base.clone().addScaledVector(groom, length * 0.5).addScaledVector(n, loft * 0.65)
    const tip = base.clone().addScaledVector(groom, length * (0.75 + random() * 0.5)).addScaledVector(n, loft)
    crownHair.push(...base.clone().sub(width).toArray(), ...middle.toArray(), ...base.clone().add(width).toArray(), ...base.clone().sub(width).toArray(), ...tip.toArray(), ...middle.toArray())
  }
  const crownGeometry = new THREE.BufferGeometry(); crownGeometry.setAttribute('position', new THREE.Float32BufferAttribute(crownHair, 3)); crownGeometry.computeVertexNormals(); mesh(head, crownGeometry, fur)
  for (const side of [-1, 1]) {
    tufted(head, [side * 0.173, -0.073, 0.024], [0.108, 0.108, 0.14], 1100, 0.057, fur, false)
    // Cupped pinnae: curved front/back shells with a fleshy, furred base.
    // Side views retain ear volume instead of collapsing to a flat vertical strip.
    const ear = new THREE.Group(); ear.name = `cat_ear_${side}`
    ear.position.set(side * 0.178, 0.048, 0.002)
    // Forward is +Z: the tip leads the root slightly in side profile.
    ear.rotation.set(0.28, side * 0.30, -side * 0.30); head.add(ear)
    // The lower pinna is buried inside the temple; its short fur bridges the join.
    tufted(ear, [0, -0.012, 0.006], [0.083, 0.052, 0.082], 500, 0.026)
    const earPoint = (u: number, t: number, back = false): V3 => {
      const across = u * 2 - 1
      const rootBlend = Math.max(0, 1 - t / 0.32)
      const width = (0.106 - 0.025 * rootBlend) * Math.pow(1 - t, 0.9) + 0.002
      return [across * width, t * 0.235 - 0.035 * rootBlend * rootBlend, 0.047 - Math.sin(t * Math.PI) * (1 - across * across) * 0.09 - t * 0.025 - (back ? 0.034 * (1 - t) + 0.007 : 0)]
    }
    for (const back of [false, true]) {
      const positions: number[] = [], indices: number[] = []
      for (let j = 0; j <= 18; j++) for (let i = 0; i <= 16; i++) {
        positions.push(...earPoint(i / 16, j / 18, back))
        if (j < 18 && i < 16) { const k = j * 17 + i; if (back) indices.push(k, k + 17, k + 1, k + 1, k + 17, k + 18); else indices.push(k, k + 1, k + 17, k + 1, k + 18, k + 17) }
      }
      const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setIndex(indices); geometry.computeVertexNormals(); mesh(ear, geometry, fur)
    }
    const innerPositions: number[] = [], innerIndices: number[] = []
    for (let j = 0; j <= 14; j++) for (let i = 0; i <= 12; i++) {
      const p = earPoint(0.15 + i / 12 * 0.7, 0.15 + j / 14 * 0.66); p[2] += 0.002; innerPositions.push(...p)
      if (j < 14 && i < 12) { const k = j * 13 + i; innerIndices.push(k, k + 1, k + 13, k + 1, k + 14, k + 13) }
    }
    const inside = new THREE.BufferGeometry(); inside.setAttribute('position', new THREE.Float32BufferAttribute(innerPositions, 3)); inside.setIndex(innerIndices); inside.computeVertexNormals(); mesh(ear, inside, inner)
    for (const edgeU of [0, 1]) {
      const points: V3[] = []; for (let i = 0; i <= 18; i++) points.push(earPoint(edgeU, i / 18))
      tube(ear, points, 0.009, fur)
    }

    const eye = new THREE.Group(); eye.position.set(side * 0.142, 0.035, 0.177); eye.scale.setScalar(0.70); eye.rotation.y = side * 0.38; eye.rotation.z = side * 0.14; head.add(eye)
    ellipsoid(eye, [0, 0, 0], [0.083, 0.043, 0.021], black)
    ellipsoid(eye, [0, 0, 0.008], [0.070, 0.031, 0.015], iris)
    ellipsoid(eye, [0, 0, 0.023], [0.007, 0.028, 0.003], black)
    ellipsoid(eye, [-0.019, 0.014, 0.024], [0.008, 0.008, 0.004], glint)
    tube(eye, [[-0.078, 0.003, 0.013], [0, 0.028, 0.021], [0.078, 0.014, 0.013]], 0.009, fur)

    for (let i = 0; i < 7; i++) {
      tube(head, [[side * 0.09, -0.09 - i * 0.006, 0.292], [side * 0.25, -0.08 + (i - 3) * 0.020, 0.31], [side * (0.46 + random() * 0.065), -0.10 + (i - 3) * 0.043, 0.22 - i * 0.009]], 0.0015, whiskers)
    }
  }
  const nose = new THREE.Shape(); nose.moveTo(-0.040, 0); nose.quadraticCurveTo(0, 0.014, 0.040, 0); nose.lineTo(0, -0.034); nose.closePath()
  mesh(head, new THREE.ExtrudeGeometry(nose, { depth: 0.010, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 2 }), black, [0, -0.074, 0.298])
  tube(head, [[0, -0.108, 0.310], [0, -0.130, 0.294], [-0.04, -0.136, 0.285]], 0.004, black)
  tube(head, [[0, -0.130, 0.294], [0.04, -0.136, 0.285]], 0.004, black)

  // Four articulated digitigrade legs; uncovered white-sock paws move with each lower leg.
  for (const front of [true, false]) for (const side of [-1, 1]) {
    const leg = new THREE.Group(); leg.name = `cat_leg_${front ? 'front' : 'rear'}_${side}`
    leg.position.set(side * (front ? 0.255 : 0.26), front ? 1.22 : 1.18, front ? 0.57 : -0.72); torso.add(leg)
    tufted(leg, [0, front ? -0.25 : -0.19, front ? 0 : 0.085], [front ? 0.14 : 0.18, front ? 0.46 : 0.37, front ? 0.14 : 0.225], 1500, 0.065)
    const lower = new THREE.Group(); lower.name = `${leg.name}_lower`; lower.position.set(0, front ? -0.60 : -0.54, front ? 0 : 0.13); leg.add(lower)
    if (front) tufted(lower, [0, -0.17, 0], [0.105, 0.34, 0.112], 1100, 0.05)
    else {
      const shin = new THREE.Group(); shin.position.set(0, -0.14, -0.13); shin.rotation.x = 0.70; lower.add(shin)
      tufted(shin, [0, 0, 0], [0.095, 0.265, 0.10], 1000, 0.05)
      tufted(lower, [0, -0.385, -0.28], [0.101, 0.22, 0.10], 650, 0.045)
    }
    // The rear hock retreats behind the stifle; ankle/foot retain the existing animation node.
    const foot = new THREE.Group(); foot.name = `${leg.name}_foot`; foot.position.z = front ? 0 : -0.28; lower.add(foot)
    const pawY = front ? -0.52 : -0.54
    tufted(foot, [0, pawY, 0.08], [0.134, 0.10, 0.18], 450, 0.033)
    for (let toe = 0; toe < 4; toe++) ellipsoid(foot, [(toe - 1.5) * 0.058, pawY - 0.015, 0.20], [0.039, 0.067, 0.077])

  }

  const tail = new THREE.Group(); tail.name = 'cat_tail'; tail.position.set(0, 1.30, -0.90); torso.add(tail)
  // Bury the rotating root inside the pelvis and cap it so tail sway never opens a seam.
  tufted(tail, [0, 0, 0], [0.128, 0.128, 0.17], 650, 0.035)
  const tailCurve = new THREE.CatmullRomCurve3([[0, 0, 0], [0.03, -0.15, -0.28], [0.06, -0.50, -0.52], [0.12, -0.86, -0.77], [0.18, -0.9, -1.06], [0.20, -0.78, -1.23]].map(p => v(p as V3)))
  const tailFrames = tailCurve.computeFrenetFrames(64, false)
  const tailPos: number[] = [], tailIdx: number[] = [], hairPos: number[] = []
  for (let i = 0; i <= 64; i++) {
    const t = i / 64, center = tailCurve.getPointAt(t), radius = 0.135 * Math.pow(1 - t, 0.26) + 0.008
    for (let j = 0; j <= 16; j++) {
      const a = j / 16 * Math.PI * 2
      const n = tailFrames.normals[i].clone().multiplyScalar(Math.cos(a)).addScaledVector(tailFrames.binormals[i], Math.sin(a))
      tailPos.push(...center.clone().addScaledVector(n, radius).toArray())
      if (i < 64 && j < 16) { const k = i * 17 + j; tailIdx.push(k, k + 1, k + 17, k + 1, k + 18, k + 17) }
    }
  }
  const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.Float32BufferAttribute(tailPos, 3)); tg.setIndex(tailIdx); tg.computeVertexNormals(); mesh(tail, tg, fur)
  for (let i = 0; i < 8000; i++) {
    const t = random() * 0.985, k = Math.floor(t * 64), a = random() * Math.PI * 2
    const n = tailFrames.normals[k].clone().multiplyScalar(Math.cos(a)).addScaledVector(tailFrames.binormals[k], Math.sin(a))
    const base = tailCurve.getPointAt(t).addScaledVector(n, 0.135 * Math.pow(1 - t, 0.26) + 0.007)
    const width = tailFrames.tangents[k].clone().cross(n).multiplyScalar(0.0025)
    const tip = base.clone().addScaledVector(tailFrames.tangents[k], 0.06 + random() * 0.035).addScaledVector(n, 0.025)
    hairPos.push(...base.clone().sub(width).toArray(), ...tip.toArray(), ...base.clone().add(width).toArray())
  }
  const hg = new THREE.BufferGeometry(); hg.setAttribute('position', new THREE.Float32BufferAttribute(hairPos, 3)); hg.computeVertexNormals(); mesh(tail, hg, fur)

  // Low-profile war saddle: thin draped pad, narrow waist and modest pommel/cantle.
  // Keep the thigh corridor clear instead of surrounding the rider with raised rails.
  const saddle = new THREE.Group(); saddle.name = 'cat_saddle'; torso.add(saddle)
  const doubleLeather = leather.clone(); doubleLeather.side = THREE.DoubleSide
  const surface = (rows: number, cols: number, point: (u: number, t: number) => V3, mat = doubleLeather) => {
    const positions: number[] = [], indices: number[] = []
    for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
      positions.push(...point(i / cols, j / rows))
      if (i < cols && j < rows) { const n = j * (cols + 1) + i; indices.push(n, n + cols + 1, n + 1, n + 1, n + cols + 1, n + cols + 2) }
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setIndex(indices); geometry.computeVertexNormals()
    return mesh(saddle, geometry, mat)
  }
  // Fit the saddle pad to the same continuous surface used by the chest and back.
  const backTop = (x: number, z: number) => {
    let low = 1.26, high = 1.75
    for (let i = 0; i < 16; i++) { const mid = (low + high) / 2; if (bodyDistance(x, mid, z) < 0) low = mid; else high = mid }
    return high
  }
  const padPoint = (u: number, t: number): V3 => {
    const a = (u - 0.5) * Math.PI
    const z = 0.26 - t * 0.84
    const width = 0.385 * Math.sqrt(1 - ((z + 0.10) / 0.84) ** 2)
    const x = Math.sin(a) * width
    return [x + Math.sin(a) * 0.012, backTop(x, z) + Math.cos(a) * 0.015, z]
  }
  surface(14, 32, padPoint)
  // Binding follows the curved blanket, with no rigid box beneath the knees.
  for (const side of [0, 1]) {
    const points: V3[] = []
    for (let i = 0; i <= 24; i++) points.push(padPoint(side, i / 24))
    tube(saddle, points, 0.008)
  }
  for (const end of [0, 1]) {
    const points: V3[] = []
    for (let i = 0; i <= 32; i++) points.push(padPoint(i / 32, end))
    tube(saddle, points, 0.008)
  }
  const seatPoint = (u: number, t: number): V3 => {
    const end = Math.pow(Math.abs(t * 2 - 1), 4)
    const width = 0.18 + end * 0.05
    const x = (u * 2 - 1) * width
    return [x, BLACK_CAT_DIMENSIONS.saddleHeight + end * (t > 0.5 ? 0.09 : 0.055) + x * x * 0.18, 0.22 - t * 0.74]
  }
  surface(24, 16, seatPoint)
  // The saddle tree extends down to the fitted pad instead of floating above it.
  for (const side of [0, 1]) {
    surface(24, 1, (u, t) => { const p = seatPoint(side, t); return [p[0], THREE.MathUtils.lerp(p[1], backTop(p[0], p[2]) + 0.012, u), p[2]] })
    const points: V3[] = []
    for (let i = 0; i <= 24; i++) points.push(seatPoint(side, i / 24))
    tube(saddle, points, 0.005)
  }
  for (const end of [0, 1]) {
    surface(1, 16, (u, t) => { const p = seatPoint(u, end); return [p[0], THREE.MathUtils.lerp(p[1], backTop(p[0], p[2]) + 0.012, t), p[2]] })
    const points: V3[] = []
    for (let i = 0; i <= 16; i++) points.push(seatPoint(i / 16, end))
    tube(saddle, points, 0.008, edge)
  }
  for (const side of [-1, 1]) {
    // Short flaps follow the fitted blanket; leave the thigh/boot envelope clear.
    surface(12, 12, (u, t) => {
      const p = padPoint(side < 0 ? 0.24 * (1 - t) : 0.76 + 0.24 * t, 0.18 + u * 0.48)
      return [p[0] + side * 0.009, p[1] + 0.006, p[2]]
    })
    tube(saddle, [[side * 0.21, 1.64, 0.10], [side * 0.41, 1.40, 0.05], [side * 0.51, 1.06, 0.02]], 0.014, edge)
    tube(saddle, [[side * 0.51, 1.11, 0.02], [side * 0.61, 0.98, 0.02], [side * 0.42, 0.98, 0.02], [side * 0.51, 1.11, 0.02]], 0.011)
    star(saddle, [side * 0.345, 1.34, -0.40], 0.035, [0, side * Math.PI / 2, 0])
  }
  // Flexible leather barding: open neck and legs, with articulated shoulder/hip coverage.
  const armour = material(0x573925, 0.84); armour.side = THREE.DoubleSide
  armour.bumpMap = grain; armour.bumpScale = 0.006
  const binding = material(0x281a13, 0.82)
  const stitch = material(0xae8b59, 0.92)
  const rivet = material(0x866846, 0.5, 0.55)
  const barding = new THREE.Group(); barding.name = 'cat_leather_armour'; torso.add(barding)
  const armourCoverage: { parent: THREE.Group; geometry: THREE.BufferGeometry }[] = []
  const bodySide = (y: number, z: number) => {
    let width = 0
    if (bodyDistance(0, y, z) < 0) {
      let low = 0, high = 0.55
      for (let i = 0; i < 15; i++) { const mid = (low + high) / 2; if (bodyDistance(mid, y, z) < 0) low = mid; else high = mid }
      width = high
    }
    // Articulated upper limbs retain their independent rest-pose envelope.
    for (const [cx, cy, cz, rx, ry, rz] of [[0.255, 0.97, 0.57, 0.14, 0.46, 0.14], [0.26, 0.99, -0.635, 0.18, 0.37, 0.225]]) {
      const section = 1 - ((y - cy) / ry) ** 2 - ((z - cz) / rz) ** 2
      if (section > 0) width = Math.max(width, cx + rx * Math.sqrt(section))
    }
    return width
  }
  const fitSide = (point: V3, side: number, clearance = 0.020): V3 =>
    [side * Math.max(Math.abs(point[0]), bodySide(point[1], point[2]) + clearance), point[1], point[2]]
  const leatherPanel = (parent: THREE.Group, pointAt: (u: number, t: number) => V3) => {
    const rows = 16, cols = 20, positions: number[] = [], indices: number[] = []
    for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
      positions.push(...pointAt(i / cols, j / rows))
      if (j < rows && i < cols) { const k = j * (cols + 1) + i; indices.push(k, k + 1, k + cols + 1, k + 1, k + cols + 2, k + cols + 1) }
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setIndex(indices); geometry.computeVertexNormals()
    geometry.computeBoundingBox()
    armourCoverage.push({ parent, geometry })
    mesh(parent, geometry, armour)
    for (const vertical of [false, true]) for (const edge of [0, 1]) {
      const rim: V3[] = []
      for (let i = 0; i <= 24; i++) rim.push(vertical ? pointAt(edge, i / 24) : pointAt(i / 24, edge))
      tube(parent, rim, 0.006, binding)
      // Discrete saddle stitches sit just inside the rolled leather binding.
      const inset = edge === 0 ? 0.045 : 0.955
      for (let i = 0; i < 15; i++) {
        const start = 0.07 + i * 0.058, end = start + 0.024
        tube(parent, vertical ? [pointAt(inset, start), pointAt(inset, end)] : [pointAt(start, inset), pointAt(end, inset)], 0.0017, stitch)
      }
    }
    for (const u of [0.09, 0.91]) for (const t of [0.10, 0.90]) ellipsoid(parent, pointAt(u, t), [0.008, 0.008, 0.008], rivet)
  }
  for (const side of [-1, 1]) {
    // Two overlapping shoulder lames stay above the moving foreleg and ahead of the knee.
    for (let layer = 0; layer < 2; layer++) leatherPanel(barding, (u, t) => {
      const azimuth = 0.40 + u * 1.98
      const elevation = 0.18 + layer * 0.27 + t * 0.34 + 0.07 * Math.sin(u * Math.PI)
      return fitSide([side * (0.428 + layer * 0.009) * Math.sin(azimuth) * Math.cos(elevation), 1.235 + 0.405 * Math.sin(elevation), 0.48 + 0.397 * Math.cos(azimuth) * Math.cos(elevation)], side, 0.020 + layer * 0.009)
    })
    // Split rear-quarter panels leave the saddle seat, rider boot and tail root clear.
    for (let layer = 0; layer < 2; layer++) leatherPanel(barding, (u, t) => {
      const azimuth = 0.70 + u * 1.73
      const elevation = 0.13 + layer * 0.27 + t * 0.34
      return fitSide([side * (0.36 + layer * 0.008) * Math.sin(azimuth) * Math.cos(elevation), 1.245 + 0.33 * Math.sin(elevation), -0.73 + 0.34 * Math.cos(azimuth) * Math.cos(elevation)], side, 0.020 + layer * 0.009)
    })
    // A narrow attachment tab joins shoulder armour to the front of the saddle.
    leatherPanel(barding, (u, t) => fitSide([side * (0.30 + u * 0.038), 1.51 - t * 0.012, 0.47 - t * 0.22], side, 0.025))
  }
  // Open-sided shoulder/thigh guards follow the upper limbs instead of bridging a moving joint.
  for (const front of [true, false]) for (const side of [-1, 1]) {
    const limb = root.getObjectByName(`cat_leg_${front ? 'front' : 'rear'}_${side}`) as THREE.Group
    leatherPanel(limb, (u, t) => {
      const azimuth = 0.38 + u * (Math.PI - 0.76)
      const elevation = -0.60 + t * 1.5
      const y = -0.14 + (front ? 0.28 : 0.32) * Math.sin(elevation)
      const z = (front ? 0 : 0.085) + (front ? 0.18 : 0.25) * Math.cos(azimuth) * Math.cos(elevation)
      const section = Math.max(0, 1 - ((y + (front ? 0.25 : 0.19)) / (front ? 0.46 : 0.37)) ** 2 - ((z - (front ? 0 : 0.085)) / (front ? 0.14 : 0.225)) ** 2)
      const width = Math.max((front ? 0.17 : 0.205) * Math.sin(azimuth) * Math.cos(elevation), (front ? 0.14 : 0.18) * Math.sqrt(section) + 0.025,
        bodySide(y + limb.position.y, z + limb.position.z) - Math.abs(limb.position.x) + 0.020)
      return [side * width, y, z]
    })
  }
  // Shaped breast guard covers the lower chest without recreating a collar around the neck.
  leatherPanel(barding, (u, t) => {
    const y = 1.39 - t * 0.36
    const x = (u * 2 - 1) * (0.15 + 0.07 * Math.sin(t * Math.PI) - 0.05 * t)
    let low = 0.48, high = 1.15
    for (let i = 0; i < 16; i++) { const mid = (low + high) / 2; if (bodyDistance(x, y, mid) < 0) low = mid; else high = mid }
    return [x, y, high + 0.034]
  })

  // Clip fur hidden beneath leather instead of pushing all armour away from the animal.
  // Each six-vertex tuft is removed as a unit, preserving clean edges and intact skin.
  root.updateMatrixWorld(true)
  const coverageWorld = armourCoverage.map(({ parent, geometry }) => {
    const bounds = geometry.boundingBox!.clone().applyMatrix4(parent.matrixWorld).expandByScalar(0.045)
    const size = bounds.getSize(new THREE.Vector3())
    // Project onto the panel's broad plane so exposed fur between plates is preserved.
    const axis = size.x < size.y && size.x < size.z ? 0 : size.y < size.z ? 1 : 2
    const a = (axis + 1) % 3, b = (axis + 2) % 3
    const positions = geometry.getAttribute('position'), indices = geometry.index!
    const triangles: { p: number[][]; determinant: number }[] = []
    for (let i = 0; i < indices.count; i += 3) {
      const p = [0, 1, 2].map(j => new THREE.Vector3().fromBufferAttribute(positions, indices.getX(i + j)).applyMatrix4(parent.matrixWorld).toArray())
      const determinant = (p[1][b] - p[2][b]) * (p[0][a] - p[2][a]) + (p[2][a] - p[1][a]) * (p[0][b] - p[2][b])
      if (Math.abs(determinant) > 1e-10) triangles.push({ p, determinant })
    }
    return { bounds, axis, a, b, triangles }
  })
  const beneathLeather = (point: THREE.Vector3) => coverageWorld.some(({ bounds, axis, a, b, triangles }) => {
    if (!bounds.containsPoint(point)) return false
    const u = point.getComponent(a), v = point.getComponent(b), depth = point.getComponent(axis)
    return triangles.some(({ p, determinant }) => {
      if (u < Math.min(p[0][a], p[1][a], p[2][a]) || u > Math.max(p[0][a], p[1][a], p[2][a]) || v < Math.min(p[0][b], p[1][b], p[2][b]) || v > Math.max(p[0][b], p[1][b], p[2][b])) return false
      const w0 = ((p[1][b] - p[2][b]) * (u - p[2][a]) + (p[2][a] - p[1][a]) * (v - p[2][b])) / determinant
      const w1 = ((p[2][b] - p[0][b]) * (u - p[2][a]) + (p[0][a] - p[2][a]) * (v - p[2][b])) / determinant
      const w2 = 1 - w0 - w1
      return w0 >= -0.025 && w1 >= -0.025 && w2 >= -0.025 && Math.abs(depth - (w0 * p[0][axis] + w1 * p[1][axis] + w2 * p[2][axis])) < 0.075
    })
  })
  const furPoint = new THREE.Vector3()
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh) || !object.userData.catFurStrands) return
    const positions = object.geometry.getAttribute('position'), keep: number[] = []
    for (let i = 0; i < positions.count; i += 6) {
      let covered = false
      for (let j = 0; j < 6 && !covered; j++) {
        furPoint.fromBufferAttribute(positions, i + j).applyMatrix4(object.matrixWorld)
        covered = beneathLeather(furPoint)
          || (object.parent === torso && Math.abs(furPoint.x) < 0.41 && furPoint.y > 1.16 && furPoint.z > -0.61 && furPoint.z < 0.29)
      }
      if (!covered) for (let j = 0; j < 6; j++) keep.push(i + j)
    }
    object.geometry.setIndex(keep)
  })

  // Colour the existing fur surface and strands together, without extra overlay shells.
  const coat = fur.clone(); coat.color.set(0xffffff); coat.vertexColors = true
  const whiteFur = new THREE.Color(0xe5e2dc)
  root.updateMatrixWorld(true)
  const point = new THREE.Vector3(), restPoint = new THREE.Vector3(), tint = new THREE.Color()
  const smooth = THREE.MathUtils.smoothstep
  const colourCoat = (group: THREE.Group, leg = false) => {
    leg ||= group.name.startsWith('cat_leg_')
    for (const child of group.children) {
      if (child instanceof THREE.Group) { colourCoat(child, leg); continue }
      if (!(child instanceof THREE.Mesh) || child.material !== fur) continue
      child.updateMatrix()
      const positions = child.geometry.getAttribute('position'), colours: number[] = []
      for (let i = 0; i < positions.count; i++) {
        point.fromBufferAttribute(positions, i).applyMatrix4(child.matrix)
        const { x, y, z } = point
        // Socks are bounded by rest-pose height, consistently across every leg joint.
        restPoint.fromBufferAttribute(positions, i).applyMatrix4(child.matrixWorld)
        let white = leg ? 1 - smooth(restPoint.y, 0.42, 0.48) : 0
        if (group === torso) {
          const belly = (1 - smooth(y, 1.055, 1.115)) * (1 - smooth(z, 0.38, 0.58)) * smooth(z, -0.98, -0.80)
          // A central white bib joins the throat to the belly, leaving the shoulders black.
          const bib = (1 - smooth(Math.abs(x), 0.17, 0.245)) * smooth(z, 0.26, 0.46) * (1 - smooth(y, 1.43, 1.53))
          const throatDepth = -(y - 1.435) * Math.sin(0.80) + (z - 0.815) * Math.cos(0.80)
          const throat = smooth(z, 0.64, 0.78) * smooth(throatDepth, -0.015, 0.055) * (1 - smooth(Math.abs(x), 0.13, 0.195))
          white = Math.max(belly, bib, throat)

        } else if (group === head) {
          // The reference has black fur around the nose, framed by white whisker-pad edges.
          // Keep the upper muzzle black; the white border follows its sides and lower arc.
          const muzzleRadius = Math.hypot(x / 0.132, (y + 0.067) / 0.075)
          const muzzleBorder = smooth(muzzleRadius, 0.82, 0.98) * (1 - smooth(muzzleRadius, 1.15, 1.34))
            * (1 - smooth(y, -0.084, -0.055)) * smooth(z, 0.11, 0.18)
          const chin = (1 - smooth(y, -0.148, -0.133)) * smooth(z, 0.09, 0.16)
          // Preserve black fur all the way from the nose tip through the philtrum.
          const philtrum = (1 - smooth(Math.abs(x), 0.025, 0.037)) * smooth(y, -0.154, -0.143) * (1 - smooth(y, -0.078, -0.069)) * smooth(z, 0.225, 0.255)
          white = Math.max(muzzleBorder, chin) * (1 - philtrum)
        }
        tint.copy(fur.color).lerp(whiteFur, white)
        colours.push(tint.r, tint.g, tint.b)
      }
      child.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3))
      child.material = coat
    }
  }
  colourCoat(root)

  // Bake static pieces by material under each articulated node (no hundreds of draw calls).
  const consolidate = (group: THREE.Group) => {
    for (const child of [...group.children]) if (child instanceof THREE.Group) consolidate(child)
    const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>()
    for (const child of [...group.children]) if (child instanceof THREE.Mesh) {
      child.updateMatrix()
      let geo = child.geometry.clone().applyMatrix4(child.matrix)
      if (geo.index) { const unindexed = geo.toNonIndexed(); geo.dispose(); geo = unindexed }
      geo.deleteAttribute('uv')
      const mat = child.material as THREE.Material
      if (!buckets.has(mat)) buckets.set(mat, [])
      buckets.get(mat)!.push(geo); child.geometry.dispose(); group.remove(child)
    }
    for (const [mat, geos] of buckets) {
      const combined = mergeGeometries(geos)!
      // Cylindrical UVs preserve directional grain after merging.
      const pos = combined.getAttribute('position'), uv: number[] = []
      for (let i = 0; i < pos.count; i++) uv.push(Math.atan2(pos.getX(i), pos.getZ(i)) / (2 * Math.PI) + 0.5, pos.getY(i))
      combined.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
      mesh(group, combined, mat); geos.forEach(g => g.dispose())
    }
  }
  consolidate(root)
  root.name = 'black_cat_reference_mount'
  return root
}

export class BlackCatVisual {
  readonly root: THREE.Group
  readonly saddleSeat = new THREE.Object3D()
  private torso: THREE.Object3D
  private head: THREE.Object3D
  private tail: THREE.Object3D
  private legs: { upper: THREE.Object3D; lower: THREE.Object3D; phase: number }[] = []
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
    this.torso = this.root.getObjectByName('cat_torso')!
    this.head = this.root.getObjectByName('cat_head')!
    this.tail = this.root.getObjectByName('cat_tail')!
    for (const front of [true, false]) for (const side of [-1, 1]) {
      const upper = this.root.getObjectByName(`cat_leg_${front ? 'front' : 'rear'}_${side}`)!
      this.legs.push({ upper, lower: upper.getObjectByName(`${upper.name}_lower`)!, phase: (side === 1 ? Math.PI : 0) + (front ? 0 : Math.PI) })
    }
    this.saddleSeat.position.set(0, BLACK_CAT_DIMENSIONS.saddleHeight, -0.15)
    this.torso.add(this.saddleSeat)
  }
  setLocomotion(speed: number): void { this.speed = speed; this.studio = null }
  playOnce(clip: HorseAnimationState): void { this.oneShot = clip; this.oneShotTime = 0 }
  playStudioClip(clip: HorseAnimationState): void { this.studio = clip; this.oneShot = null; this.time = 0; this.phase = 0; this.paused = false }
  togglePaused(): boolean { this.paused = !this.paused; return this.paused }
  debugState() { return { clip: this.studio ?? this.oneShot ?? (this.speed > 7 ? 'gallop' : this.speed > 0.1 ? 'walk' : 'idle'), time: this.time, paused: this.paused } }
  update(dt: number): void {
    if (this.paused) return
    this.time += dt; this.oneShotTime += dt
    if (this.oneShot && this.oneShot !== 'death' && this.oneShot !== 'jump' && this.oneShotTime > 0.75) this.oneShot = null
    const state = this.studio ?? this.oneShot
    const speed = this.studio ? ({ walk: 2, trot: 4, canter: 7, gallop: 12 } as Partial<Record<HorseAnimationState, number>>)[this.studio] ?? 0 : this.speed
    const moving = speed > 0.1, gallop = speed > 6
    this.phase += dt * (gallop ? 10 : 3.5 + speed * 0.8)
    this.torso.position.y = moving ? Math.sin(this.phase * 2) * (gallop ? 0.045 : 0.014) + 0.025 : Math.sin(this.time * 1.8) * 0.008
    this.torso.position.x = 0
    this.torso.rotation.set(moving && gallop ? Math.sin(this.phase) * 0.035 : 0, 0, 0)
    this.head.rotation.y = Math.sin(this.time * 0.55) * 0.045
    this.head.rotation.x = Math.sin(this.time * 1.7) * 0.018
    this.tail.rotation.y = Math.sin(this.time * 1.3) * (moving ? 0.17 : 0.11)
    this.tail.rotation.x = moving ? -0.14 : 0
    for (let i = 0; i < this.legs.length; i++) {
      const leg = this.legs[i], p = this.phase + (gallop ? (i < 2 ? 0 : 2.1) + i % 2 * 0.5 : leg.phase)
      leg.upper.rotation.x = moving ? Math.sin(p) * Math.min(0.6, 0.23 + speed * 0.032) : 0
      leg.lower.rotation.x = moving ? -Math.max(0, Math.cos(p)) * (gallop ? 0.85 : 0.48) : 0
    }
    const t = this.studio ? this.time : this.oneShotTime
    if (state === 'jump') { this.torso.rotation.x = -Math.sin(Math.min(t / 0.75, 1) * Math.PI) * 0.16; this.legs.forEach(l => { l.upper.rotation.x = -0.5; l.lower.rotation.x = 0.8 }) }
    if (state === 'land') this.torso.position.y = -Math.sin(Math.min(t / 0.6, 1) * Math.PI) * 0.16
    if (state === 'hit') this.head.rotation.x = Math.sin(Math.min(t / 0.6, 1) * Math.PI) * -0.2
    if (state === 'death') { const f = Math.min(t / 0.9, 1); this.torso.rotation.z = f * Math.PI / 2; this.torso.position.y = f * 0.5; this.torso.position.x = f * 1.0 }
  }
  dispose(): void { this.root.removeFromParent() /* shared immutable geometry/materials belong to the template */ }
}
