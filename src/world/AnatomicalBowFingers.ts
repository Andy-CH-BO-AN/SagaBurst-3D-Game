import * as THREE from 'three'
import { DEFAULT_BOW_GRIP_PROFILE, type HandGripFrame } from './BowAttachmentContract'

type Sample = { index: number; point: THREE.Vector3; f: number; n: number; t: number }
type CurvePoint = { f: number; n: number; s: number }
export interface BowDigitDiagnostic {
  across: number
  base: number[]
  tip: number[]
  length: number
  thickness: number
  initialClearance: number
}

/**
 * A source-space, virtual-finger deformation. Connected distal mesh regions
 * identify the four digits; their measured centre lines remove source cupping
 * before each digit follows a tangent and an arc around the common handle.
 * This does not rotate the hand, change the palm frame, or move the weapon.
 */
export function buildAnatomicalBowFingerShape(
  object: THREE.SkinnedMesh,
  hand: THREE.Bone,
  frame: HandGripFrame,
  gripRadius = DEFAULT_BOW_GRIP_PROFILE.gripRadius,
): { offsets: Float32Array; digitMask: Uint8Array; digits: BowDigitDiagnostic[] } {
  const geometry = object.geometry, a = geometry.attributes
  const handIndex = object.skeleton.bones.indexOf(hand)
  const offsets = new Float32Array(a.position.count * 3)
  const digitMask = new Uint8Array(a.position.count)
  if (handIndex < 0 || !geometry.index) return { offsets, digitMask, digits: [] }
  const toHand = new THREE.Matrix4().multiplyMatrices(object.skeleton.boneInverses[handIndex], object.bindMatrix)
  const fromHand = toHand.clone().invert()
  const finger = frame.fingerDirection!.clone().normalize()
  const normal = frame.palmNormal.clone().normalize()
  const thumb = frame.thumbDirection!.clone().normalize()
  const samples: Sample[] = [], weld = new Map<string, number>(), vertexWeld: number[] = []
  const unique: Sample[] = []
  for (let i = 0; i < a.position.count; i++) {
    let weight = 0
    for (let k = 0; k < 4; k++) if (a.skinIndex.getComponent(i, k) === handIndex) weight += a.skinWeight.getComponent(i, k)
    if (weight < .7) { vertexWeld[i] = -1; continue }
    const point = new THREE.Vector3().fromBufferAttribute(a.position, i).applyMatrix4(toHand)
    const sample = { index: i, point, f: point.dot(finger), n: point.dot(normal), t: point.dot(thumb) }
    samples.push(sample)
    const key = point.toArray().map(v => v.toFixed(5)).join(',')
    if (!weld.has(key)) { weld.set(key, unique.length); unique.push(sample) }
    vertexWeld[i] = weld.get(key)!
  }
  if (!samples.length) return { offsets, digitMask, digits: [] }
  const maxF = Math.max(...samples.map(p => p.f)), base = frame.fingerBase!
  const thumbLimit = frame.thumbBaseCenter!.dot(thumb)
  let components: Sample[][] = [], split = base
  for (let cut = base; cut < maxF * .86; cut += .001) {
    const adjacency = new Map<number, Set<number>>()
    unique.forEach((p, i) => { if (p.f > cut) adjacency.set(i, new Set()) })
    for (let i = 0; i < geometry.index.count; i += 3) {
      const triangle = [0, 1, 2].map(k => vertexWeld[geometry.index!.getX(i + k)])
      for (const x of triangle) for (const y of triangle) if (adjacency.has(x) && adjacency.has(y)) adjacency.get(x)!.add(y)
    }
    const seen = new Set<number>(), found: Sample[][] = []
    for (const first of adjacency.keys()) {
      if (seen.has(first)) continue
      const todo = [first], component: Sample[] = []; seen.add(first)
      while (todo.length) {
        const index = todo.pop()!; component.push(unique[index])
        for (const next of adjacency.get(index)!) if (!seen.has(next)) { seen.add(next); todo.push(next) }
      }
      // Thumb has a lower distal extent and lies beyond the first MCP.
      if (component.length >= 8 && Math.max(...component.map(p => p.f)) > base + (maxF - base) / 3 && component.reduce((s, p) => s + p.t, 0) / component.length < thumbLimit) found.push(component)
    }
    if (found.length === 4) { components = found.sort((a, b) => a[0].t - b[0].t); split = cut; break }
  }
  if (components.length !== 4) return { offsets, digitMask, digits: [] }
  const centers = components.map(points => points.reduce((sum, p) => sum + p.t, 0) / points.length)
  const digitByWeld = new Map<number, number>()
  components.forEach((points, digit) => points.forEach(p => digitByWeld.set(vertexWeld[p.index], digit)))
  const rootF = base - (maxF - base) * .18
  // Extend the distal labels towards the knuckles along the actual surface.
  // A cupped thumb can sit beside an index knuckle in space while belonging to
  // another branch of the mesh. Euclidean nearest-root assignment curled that
  // thumb web as an index finger and tore it away from the stationary thumb.
  // Unclassified distal branches are seeds too: their label stays non-finger.
  const links = unique.map(() => new Set<number>())
  for (let i = 0; i < geometry.index.count; i += 3) {
    const triangle = [0, 1, 2].map(k => vertexWeld[geometry.index!.getX(i + k)])
    for (const x of triangle) for (const y of triangle) {
      if (x >= 0 && y >= 0 && x !== y && unique[x].f > rootF && unique[y].f > rootF) links[x].add(y)
    }
  }
  const distances = unique.map(p => p.f > split ? 0 : Infinity)
  const labels = unique.map((p, i) => p.f > split ? digitByWeld.get(i) ?? -1 : -1)
  const pending = unique.flatMap((p, i) => p.f > rootF ? [i] : [])
  while (pending.length) {
    let nearest = 0
    for (let i = 1; i < pending.length; i++) if (distances[pending[i]] < distances[pending[nearest]]) nearest = i
    const vertex = pending[nearest]
    pending[nearest] = pending[pending.length - 1]; pending.pop()
    if (!Number.isFinite(distances[vertex])) break
    for (const next of links[vertex]) {
      const distance = distances[vertex] + unique[vertex].point.distanceTo(unique[next].point)
      if (distance < distances[next]) { distances[next] = distance; labels[next] = labels[vertex] }
    }
  }
  const digitOf = (p: Sample): number => labels[vertexWeld[p.index]] ?? -1
  const grip = frame.palmContactCenter.clone().addScaledVector(normal, gripRadius)
  const centerF = grip.dot(finger), centerN = grip.dot(normal)
  const diagnostics: BowDigitDiagnostic[] = []
  const models = components.map((points, index) => {
    const across = centers[index], tipF = Math.max(...points.map(p => p.f))
    const region = samples.filter(p => p.f >= rootF && digitOf(p) === index)
    const span = tipF - rootF, curve: CurvePoint[] = []
    for (let i = 0; i <= 8; i++) {
      const f = rootF + span * i / 8
      const nearest = region.slice().sort((a, b) => Math.abs(a.f - f) - Math.abs(b.f - f)).slice(0, Math.max(5, Math.floor(region.length / 10)))
      const ns = nearest.map(p => p.n)
      curve.push({ f, n: (Math.min(...ns) + Math.max(...ns)) / 2, s: 0 })
    }
    for (let i = 1; i < curve.length; i++) curve[i].s = curve[i - 1].s + Math.hypot(curve[i].f - curve[i - 1].f, curve[i].n - curve[i - 1].n)
    function source(f: number) {
      const i = Math.max(0, Math.min(curve.length - 2, Math.floor((f - rootF) / span * 8)))
      const p = curve[i], q = curve[i + 1], t = THREE.MathUtils.clamp((f - p.f) / (q.f - p.f), 0, 1)
      const previous = curve[Math.max(0, i - 1)], next = curve[Math.min(curve.length - 1, i + 2)]
      const m0 = (q.n - previous.n) / (q.f - previous.f)
      const m1 = (next.n - p.n) / (next.f - p.f)
      const width = q.f - p.f, t2 = t * t, t3 = t2 * t
      const n = (2 * t3 - 3 * t2 + 1) * p.n + (t3 - 2 * t2 + t) * width * m0
        + (-2 * t3 + 3 * t2) * q.n + (t3 - t2) * width * m1
      const slope = ((6 * t2 - 6 * t) * p.n + (3 * t2 - 4 * t + 1) * width * m0
        + (-6 * t2 + 6 * t) * q.n + (3 * t2 - 2 * t) * width * m1) / width
      return { n, s: THREE.MathUtils.lerp(p.s, q.s, t), slope }
    }
    const thickness = Math.max(...region.map(p => Math.abs(p.n - source(p.f).n)))
    const radius = gripRadius + thickness + .002
    const origin = curve[0], dx = origin.f - centerF, dy = origin.n - centerN, distance = Math.hypot(dx, dy)
    const initialAngle = Math.atan2(dy, dx)
    const contactAngle = initialAngle + Math.acos(Math.min(1, radius / distance))
    const tangentLength = Math.sqrt(Math.max(0, distance * distance - radius * radius))
    const tangentF = centerF + radius * Math.cos(contactAngle), tangentN = centerN + radius * Math.sin(contactAngle)
    const initialClearance = distance - thickness - gripRadius
    diagnostics.push({ across, base: [origin.f, origin.n], tip: [curve[curve.length - 1].f, curve[curve.length - 1].n], length: curve[curve.length - 1].s, thickness, initialClearance })
    function destination(s: number) {
      if (s < tangentLength && tangentLength > 1e-6) {
        const tf = (tangentF - origin.f) / tangentLength, tn = (tangentN - origin.n) / tangentLength
        return { f: origin.f + s * tf, n: origin.n + s * tn, tf, tn }
      }
      const angle = contactAngle + (s - tangentLength) / radius
      return { f: centerF + radius * Math.cos(angle), n: centerN + radius * Math.sin(angle), tf: -Math.sin(angle), tn: Math.cos(angle) }
    }
    return { source, destination, across }
  })
  for (const sample of samples) {
    if (sample.f <= rootF) continue
    const nearest = digitOf(sample)
    if (nearest < 0) continue
    digitMask[sample.index] = nearest + 1
    const raw = models[nearest].source(sample.f), dest = models[nearest].destination(raw.s)
    const cross = (sample.n - raw.n) / Math.sqrt(1 + raw.slope * raw.slope)
    const deltaF = dest.f - dest.tn * cross - sample.f
    const deltaN = dest.n + dest.tf * cross - sample.n
    const blend = THREE.MathUtils.smoothstep(sample.f, rootF, split)
    const point = sample.point.clone().addScaledVector(finger, deltaF * blend).addScaledVector(normal, deltaN * blend)
    const original = new THREE.Vector3().fromBufferAttribute(a.position, sample.index)
    point.applyMatrix4(fromHand).sub(original)
    offsets.set(point.toArray(), sample.index * 3)
  }
  return { offsets, digitMask, digits: diagnostics }
}
