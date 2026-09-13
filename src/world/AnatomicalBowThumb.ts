import * as THREE from 'three'
import { DEFAULT_BOW_GRIP_PROFILE, type HandGripFrame } from './BowAttachmentContract'

/** Finite-segment distance, including the triangle interior and its three edges. */
function segmentTriangleDistanceSq(start: THREE.Vector3, end: THREE.Vector3, triangle: THREE.Triangle, onTriangle?: THREE.Vector3, onSegment?: THREE.Vector3): number {
  const edgeA = new THREE.Vector3(), edgeB = new THREE.Vector3(), r = new THREE.Vector3()
  const near = new THREE.Vector3(), direction = end.clone().sub(start), length = direction.length()
  const hit = new THREE.Ray(start, direction.clone().normalize()).intersectTriangle(triangle.a, triangle.b, triangle.c, false, near)
  if (hit && hit.distanceToSquared(start) <= length * length) { onTriangle?.copy(hit); onSegment?.copy(hit); return 0 }
  let best = Infinity
  for (const endpoint of [start, end]) {
    triangle.closestPointToPoint(endpoint, near)
    const distance = near.distanceToSquared(endpoint)
    if (distance < best) { best = distance; onTriangle?.copy(near); onSegment?.copy(endpoint) }
  }
  for (const [a, b] of [[triangle.a, triangle.b], [triangle.b, triangle.c], [triangle.c, triangle.a]]) {
    edgeA.copy(end).sub(start); edgeB.copy(b).sub(a); r.copy(start).sub(a)
    const aa = edgeA.lengthSq(), bb = edgeB.lengthSq(), ab = edgeA.dot(edgeB), ar = edgeA.dot(r), br = edgeB.dot(r)
    let u = aa * bb - ab * ab > 1e-15 ? THREE.MathUtils.clamp((ab * br - ar * bb) / (aa * bb - ab * ab), 0, 1) : 0
    let v = bb > 1e-15 ? (ab * u + br) / bb : 0
    if (v < 0) { v = 0; u = THREE.MathUtils.clamp(-ar / aa, 0, 1) }
    else if (v > 1) { v = 1; u = THREE.MathUtils.clamp((ab - ar) / aa, 0, 1) }
    const distance = r.addScaledVector(edgeA, u).addScaledVector(edgeB, -v).lengthSq()
    if (distance < best) {
      best = distance
      onTriangle?.copy(a).addScaledVector(edgeB, v)
      onSegment?.copy(start).addScaledVector(edgeA, u)
    }
  }
  return best
}

/**
 * Thumb-only articulation about the measured metacarpal base. Distal topology
 * supplies the thumb seed; harmonic mesh weights blend it into stationary palm
 * vertices. The source thumb keeps its length and cross section while the
 * metacarpal root supplies opposition; finger work never changes the arm pose.
 */
export function buildAnatomicalBowThumbShape(
  object: THREE.SkinnedMesh,
  hand: THREE.Bone,
  frame: HandGripFrame,
  fingers: { offsets: Float32Array; digitMask: Uint8Array },
  radius = DEFAULT_BOW_GRIP_PROFILE.gripRadius,
  padContact?: THREE.Vector3,
): { offsets: Float32Array; clearance: number; rotation: number[]; tip: number[]; weights: Float32Array } {
  const a = object.geometry.attributes, index = object.skeleton.bones.indexOf(hand), ix = object.geometry.index!
  const offsets = fingers.offsets.slice(), weights = new Float32Array(a.position.count)
  if (index < 0 || !ix) return { offsets, clearance: Infinity, rotation: [0, 0, 0, 1], tip: [], weights }
  const toHand = new THREE.Matrix4().multiplyMatrices(object.skeleton.boneInverses[index], object.bindMatrix), fromHand = toHand.clone().invert()
  const finger = frame.fingerDirection!.clone().normalize(), normal = frame.palmNormal.clone().normalize(), across = frame.thumbDirection!.clone().normalize()
  const pivot = frame.thumbBaseCenter!.clone(), lateral = pivot.clone().sub(frame.wristCenter!)
  lateral.addScaledVector(finger, -lateral.dot(finger)).normalize()
  const raw: THREE.Vector3[] = [], posed: THREE.Vector3[] = [], weld = new Map<string, number>(), ids: number[] = [], unique: THREE.Vector3[] = []
  const vertexIds: number[][] = [], links: Map<number, number>[] = []
  for (let i = 0; i < a.position.count; i++) {
    const p = new THREE.Vector3().fromBufferAttribute(a.position, i).applyMatrix4(toHand); raw.push(p)
    posed.push(new THREE.Vector3().fromBufferAttribute(a.position, i).add(new THREE.Vector3().fromArray(offsets, i * 3)).applyMatrix4(toHand))
    let skinWeight = 0
    for (let k = 0; k < 4; k++) if (a.skinIndex.getComponent(i, k) === index) skinWeight += a.skinWeight.getComponent(i, k)
    // A few source thumb vertices are weighted entirely to the forearm.
    // The anatomical hand boundary, not a skin-weight threshold, determines
    // membership; otherwise adjacent thumb vertices receive 0/1 discontinuities.
    if (skinWeight <= 0 && (p.dot(finger) <= frame.wristCenter!.dot(finger)
      || p.distanceTo(pivot) > frame.fingerBase! * 2 + pivot.distanceTo(frame.wristCenter!))) { ids[i] = -1; continue }
    const key = p.toArray().map(v => v.toFixed(5)).join(',')
    if (!weld.has(key)) { weld.set(key, unique.length); unique.push(p); vertexIds.push([]); links.push(new Map()) }
    const id = weld.get(key)!; ids[i] = id; vertexIds[id].push(i)
  }
  for (let i = 0; i < ix.count; i += 3) {
    const tr = [0, 1, 2].map(k => ids[ix.getX(i + k)])
    for (const x of tr) for (const y of tr) if (x >= 0 && y >= 0 && x !== y) links[x].set(y, 1 / Math.max(.001, unique[x].distanceTo(unique[y])))
  }
  const maxF = Math.max(...unique.map(p => p.dot(finger)))
  let seed: number[] = []
  for (let cut = pivot.dot(finger); cut < frame.fingerBase!; cut += .002) {
    const seen = new Set<number>(), components: number[][] = []
    for (let i = 0; i < unique.length; i++) {
      if (seen.has(i) || unique[i].dot(finger) <= cut) continue
      const todo = [i], component: number[] = []; seen.add(i)
      while (todo.length) {
        const j = todo.pop()!; component.push(j)
        for (const k of links[j].keys()) if (!seen.has(k) && unique[k].dot(finger) > cut) { seen.add(k); todo.push(k) }
      }
      if (component.length >= 8) components.push(component)
    }
    seed = components.find(component => Math.max(...component.map(i => unique[i].dot(finger))) < maxF * .82
      && component.reduce((sum, i) => sum + unique[i].dot(lateral), 0) / component.length > pivot.dot(lateral)) ?? []
    if (seed.length) break
  }
  if (!seed.length) return { offsets, clearance: Infinity, rotation: [0, 0, 0, 1], tip: [], weights }
  const distal = seed.slice().sort((a, b) => unique[b].distanceToSquared(pivot) - unique[a].distanceToSquared(pivot))
  const tips = distal.slice(0, Math.max(3, Math.ceil(distal.length * .15)))
  const tip = tips.reduce((p, i) => p.add(unique[i]), new THREE.Vector3()).multiplyScalar(1 / tips.length)
  const sourceAxis = tip.clone().sub(pivot), thumbLength = sourceAxis.length(); sourceAxis.normalize()
  const thumbRadius = Math.max(...seed.map(i => {
    const d = unique[i].clone().sub(pivot); return d.addScaledVector(sourceAxis, -d.dot(sourceAxis)).length()
  }))
  const seedSet = new Set(seed), fixed = new Int8Array(unique.length).fill(-1), w = new Float64Array(unique.length)
  for (let i = 0; i < unique.length; i++) {
    const along = unique[i].clone().sub(pivot).dot(sourceAxis)
    const isFinger = vertexIds[i].some(id => fingers.digitMask[id] > 0)
    if (isFinger || unique[i].dot(finger) <= frame.wristCenter!.dot(finger) || along <= 0 || unique[i].dot(lateral) < pivot.dot(lateral) - thumbRadius * .65) fixed[i] = 0
    else if (seedSet.has(i) && along > thumbLength * .45) fixed[i] = 1
    w[i] = fixed[i] >= 0 ? fixed[i] : THREE.MathUtils.smoothstep(along, 0, thumbLength * .45)
  }
  for (let pass = 0; pass < 100; pass++) for (let i = 0; i < unique.length; i++) {
    if (fixed[i] >= 0) continue
    let sum = 0, total = 0
    for (const [j, weight] of links[i]) { sum += w[j] * weight; total += weight }
    if (total) w[i] = sum / total
  }
  for (let i = 0; i < unique.length; i++) for (const vertex of vertexIds[i]) weights[vertex] = w[i]
  const affected = raw.map((_, i) => weights[i] > 1e-5 ? i : -1).filter(i => i >= 0)
  const triangles: number[][] = []
  for (let i = 0; i < ix.count; i += 3) {
    const tr = [0, 1, 2].map(k => ix.getX(i + k))
    if (tr.some(i => weights[i] > 1e-5)) triangles.push(tr)
  }
  const center = frame.palmContactCenter.clone().addScaledVector(normal, radius)
  const start = center.clone().addScaledVector(across, -DEFAULT_BOW_GRIP_PROFILE.gripLength / 2), end = center.clone().addScaledVector(across, DEFAULT_BOW_GRIP_PROFILE.gripLength / 2)
  const triangle = new THREE.Triangle()
  const padRadius = Math.max(...tips.map(i => {
    const d = unique[i].clone().sub(pivot); return d.addScaledVector(sourceAxis, -d.dot(sourceAxis)).length()
  }))
  const sourceNormal = normal.clone().addScaledVector(sourceAxis, -normal.dot(sourceAxis)).normalize()
  const sourceSide = new THREE.Vector3().crossVectors(sourceAxis, sourceNormal).normalize()
  const region = unique.filter((_, i) => w[i] > .65)
  const curve: Array<{ point: THREE.Vector3; s: number }> = [{ point: pivot.clone(), s: 0 }]
  for (let k = 1; k < 8; k++) {
    const along = thumbLength * k / 8
    const nearest = region.slice().sort((a, b) => Math.abs(a.clone().sub(pivot).dot(sourceAxis) - along)
      - Math.abs(b.clone().sub(pivot).dot(sourceAxis) - along)).slice(0, Math.max(6, Math.ceil(region.length / 8)))
    const ns = nearest.map(p => p.clone().sub(pivot).dot(sourceNormal)), ts = nearest.map(p => p.clone().sub(pivot).dot(sourceSide))
    const point = pivot.clone().addScaledVector(sourceAxis, along)
      .addScaledVector(sourceNormal, (Math.min(...ns) + Math.max(...ns)) / 2)
      .addScaledVector(sourceSide, (Math.min(...ts) + Math.max(...ts)) / 2)
    curve.push({ point, s: curve[k - 1].s + point.distanceTo(curve[k - 1].point) })
  }
  curve.push({ point: tip, s: curve[7].s + tip.distanceTo(curve[7].point) })
  const sourceCurve = new THREE.CatmullRomCurve3(curve.map(p => p.point), false, 'catmullrom', .5)
  const arcLengths = sourceCurve.getLengths(128)
  const source = (p: THREE.Vector3) => {
    const t = THREE.MathUtils.clamp(p.clone().sub(pivot).dot(sourceAxis) / thumbLength, 0, 1)
    const k = Math.min(127, Math.floor(t * 128)), blend = t * 128 - k
    return { point: sourceCurve.getPoint(t), tangent: sourceCurve.getTangent(t), s: THREE.MathUtils.lerp(arcLengths[k], arcLengths[k + 1], blend) }
  }
  const measurements = new Map(affected.map(i => [i, source(raw[i])]))
  const thickness = Math.max(padRadius, ...region.map(p => Math.abs(p.clone().sub(source(p).point).dot(sourceNormal))))
  const q = new THREE.Quaternion(), blended = new THREE.Quaternion()
  const df = pivot.clone().sub(center).dot(finger), dn = pivot.clone().sub(center).dot(normal), distance = Math.hypot(df, dn)
  const initialAngle = Math.atan2(dn, df)
  let finalTip = tip.clone()
  const pose = (pathRadius: number) => {
    const tangentLength = Math.sqrt(Math.max(0, distance ** 2 - pathRadius ** 2))
    const contactAngle = initialAngle - Math.acos(Math.min(1, pathRadius / distance))
    const contactF = center.dot(finger) + pathRadius * Math.cos(contactAngle), contactN = center.dot(normal) + pathRadius * Math.sin(contactAngle)
    const destination = (s: number) => {
      let f: number, n: number, tf: number, tn: number
      if (s < tangentLength && tangentLength > 1e-6) {
        tf = (contactF - pivot.dot(finger)) / tangentLength; tn = (contactN - pivot.dot(normal)) / tangentLength
        f = pivot.dot(finger) + tf * s; n = pivot.dot(normal) + tn * s
      } else {
        const angle = contactAngle - (s - tangentLength) / pathRadius
        f = center.dot(finger) + pathRadius * Math.cos(angle); n = center.dot(normal) + pathRadius * Math.sin(angle)
        tf = Math.sin(angle); tn = -Math.cos(angle)
      }
      const tangent = finger.clone().multiplyScalar(tf).addScaledVector(normal, tn).normalize()
      const point = finger.clone().multiplyScalar(f).addScaledVector(normal, n).addScaledVector(across, pivot.dot(across))
      const pad = center.clone().sub(point); pad.addScaledVector(across, -pad.dot(across)).addScaledVector(tangent, -pad.dot(tangent)).normalize()
      return { point, tangent, pad }
    }
    for (const i of affected) {
      const src = measurements.get(i)!, dest = destination(src.s)
      q.setFromUnitVectors(src.tangent, dest.tangent)
      blended.identity().slerp(q, weights[i])
      posed[i].copy(raw[i]).sub(src.point).applyQuaternion(blended).add(src.point).addScaledVector(dest.point.clone().sub(src.point), weights[i])
    }
    finalTip = destination(arcLengths[128]).point
  }
  const clearance = () => {
    let min = Infinity
    for (const tr of triangles) {
      triangle.set(posed[tr[0]], posed[tr[1]], posed[tr[2]])
      min = Math.min(min, segmentTriangleDistanceSq(start, end, triangle))
    }
    return Math.sqrt(min)
  }
  let bestScore = Infinity, bestClearance = -Infinity, bestRadius = radius + thickness
  for (let margin = 0; margin <= .014; margin += .001) {
    const pathRadius = radius + thickness + margin
    pose(pathRadius)
    const clear = clearance(), score = Math.max(0, radius + .0003 - clear) * 1000 + margin
    if (score < bestScore) { bestScore = score; bestClearance = clear; bestRadius = pathRadius }
  }
  pose(bestRadius)
  // Solve the thumb surface as locally rigid patches. Curve samples supply
  // fingertip handles; the palm/wrist boundary stays fixed. This prevents the
  // thenar web from shearing when source topology has no finger bones.
  const x = vertexIds.map(vs => posed[vs[0]].clone())
  const handles = x.map(p => p.clone())
  if (padContact) {
    const target = padContact.clone().addScaledVector(normal, padRadius + .0015)
      .addScaledVector(across, pivot.dot(across) - padContact.dot(across))
    const shift = target.sub(finalTip)
    for (let i = 0; i < unique.length; i++) if (w[i] > .95 && unique[i].clone().sub(pivot).dot(sourceAxis) > thumbLength * .82) handles[i].add(shift)
    finalTip.add(shift)
  }
  const rotations = unique.map(() => new THREE.Quaternion())
  const movable = unique.map((_, i) => w[i] > .01)
  const terminal = unique.map((p, i) => w[i] > .95 && p.clone().sub(pivot).dot(sourceAxis) > thumbLength * .82)
  const totals = links.map(edges => [...edges.values()].reduce((a, b) => a + b, 0))
  const rhs = unique.map(() => new THREE.Vector3())
  const restEdge = new THREE.Vector3(), deformedEdge = new THREE.Vector3(), rotated = new THREE.Vector3()
  const contactPoint = new THREE.Vector3(), axisPoint = new THREE.Vector3(), bary = new THREE.Vector3()
  const surfaceTriangles = triangles.map(tr => tr.map(v => ids[v])).filter(tr => tr.every(v => v >= 0))
  for (let pass = 0; pass < 24; pass++) {
    for (let i = 0; i < unique.length; i++) {
      if (!movable[i]) continue
      const m = new Float64Array(9)
      for (const [j, weight] of links[i]) {
        restEdge.copy(unique[i]).sub(unique[j]); deformedEdge.copy(x[i]).sub(x[j])
        for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) m[a * 3 + b] += weight * restEdge.getComponent(a) * deformedEdge.getComponent(b)
      }
      const tr = m[0] + m[4] + m[8]
      const matrix = [tr, m[5]-m[7], m[6]-m[2], m[1]-m[3],
        m[5]-m[7], m[0]-m[4]-m[8], m[1]+m[3], m[2]+m[6],
        m[6]-m[2], m[1]+m[3], -m[0]+m[4]-m[8], m[5]+m[7],
        m[1]-m[3], m[2]+m[6], m[5]+m[7], -m[0]-m[4]+m[8]]
      const shift = matrix.reduce((s, v) => s + Math.abs(v), 0)
      let v = [rotations[i].w, rotations[i].x, rotations[i].y, rotations[i].z]
      for (let iteration = 0; iteration < 12; iteration++) {
        const next = v.map((value, row) => value * shift + v.reduce((s, value, column) => s + matrix[row * 4 + column] * value, 0))
        const length = Math.hypot(...next)
        if (length < 1e-12) break
        v = next.map(value => value / length)
      }
      rotations[i].set(v[1], v[2], v[3], v[0])
    }
    for (let i = 0; i < unique.length; i++) {
      if (!movable[i]) continue
      rhs[i].set(0, 0, 0)
      for (const [j, weight] of links[i]) {
        restEdge.copy(unique[i]).sub(unique[j])
        rotated.copy(restEdge).applyQuaternion(rotations[i]).add(restEdge.applyQuaternion(rotations[j]))
        rhs[i].addScaledVector(rotated, weight / 2)
      }
    }
    for (let iteration = 0; iteration < 12; iteration++) for (let i = 0; i < unique.length; i++) {
      if (!movable[i]) continue
      if (terminal[i]) { x[i].copy(handles[i]); continue }
      x[i].copy(rhs[i])
      const fidelity = totals[i] * .002
      x[i].addScaledVector(handles[i], fidelity)
      for (const [j, weight] of links[i]) x[i].addScaledVector(x[j], weight)
      x[i].multiplyScalar(1 / (totals[i] + fidelity))
      const axis = new THREE.Line3(start, end).closestPointToPoint(x[i], true, new THREE.Vector3())
      const delta = x[i].clone().sub(axis), distance = delta.length()
      if (distance < radius + .0005) x[i].copy(axis).addScaledVector(delta, (radius + .0005) / Math.max(distance, 1e-8))
    }
    // The full triangular surface must clear the handle, including the web
    // between vertices. Vertex-only projection misses chord intersections.
    for (let collisionPass = 0; collisionPass < 3; collisionPass++) for (const tr of surfaceTriangles) {
      triangle.set(x[tr[0]], x[tr[1]], x[tr[2]])
      const distance = Math.sqrt(segmentTriangleDistanceSq(start, end, triangle, contactPoint, axisPoint))
      if (distance >= radius + .0003) continue
      triangle.getBarycoord(contactPoint, bary)
      const direction = contactPoint.clone().sub(axisPoint)
      if (direction.lengthSq() < 1e-10) direction.copy(triangle.getMidpoint(new THREE.Vector3())).sub(axisPoint)
      direction.normalize()
      const mass: number[] = tr.map(i => movable[i] && !terminal[i] ? 1 : 0)
      const total = mass.reduce((sum, value, k) => sum + value * bary.getComponent(k) ** 2, 0)
      if (total < 1e-8) continue
      for (let k = 0; k < 3; k++) x[tr[k]].addScaledVector(direction, (radius + .0003 - distance) * mass[k] * bary.getComponent(k) / total)
    }
  }
  for (let i = 0; i < unique.length; i++) if (movable[i]) for (const vertex of vertexIds[i]) posed[vertex].copy(x[i])
  bestClearance = clearance()
  for (const i of affected) {
    const delta = posed[i].clone().applyMatrix4(fromHand).sub(new THREE.Vector3().fromBufferAttribute(a.position, i))
    offsets.set(delta.toArray(), i * 3)
  }
  return { offsets, clearance: bestClearance, rotation: q.toArray(), tip: finalTip.toArray(), weights }
}
