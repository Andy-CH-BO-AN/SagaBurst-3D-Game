/** Index-only LOD reduction: meshoptimizer collapses edges onto existing vertices, so every retained
 * position, normal, UV, joint and weight row stays byte-identical. Triangles touching a protected
 * vertex are kept verbatim; open mesh borders are locked so cloth edges and openings never pull in.
 */
import { MeshoptSimplifier } from 'meshoptimizer'

export async function simplifyTriangles({ indices, positions, protectedVertex = () => false, targetTriangles, maxError, lockBorder = true }) {
  await MeshoptSimplifier.ready
  const kept = [], body = []
  for (let i = 0; i < indices.length; i += 3) {
    const tri = [indices[i], indices[i + 1], indices[i + 2]]
    ;(tri.some(protectedVertex) ? kept : body).push(...tri)
  }
  const bodyTarget = Math.max(0, targetTriangles * 3 - kept.length)
  const [reduced, error] = MeshoptSimplifier.simplify(new Uint32Array(body), positions, 3,
    Math.floor(bodyTarget / 3) * 3, maxError, lockBorder ? ['LockBorder'] : [])
  // `error` is relative to the mesh extent (meshoptimizer's scale).
  return { indices: Uint32Array.from([...kept, ...reduced]), protectedTriangles: kept.length / 3, error }
}

/** Vertices whose summed weight on bones matching `pattern` exceeds `threshold`. */
export function weightedVertices(edit, primitive, skin, pattern, threshold = .05) {
  const names = skin.joints.map(node => edit.document.nodes[node].name ?? '')
  const flags = new Uint8Array(edit.document.accessors[primitive.attributes.POSITION].count)
  for (let set = 0; primitive.attributes[`JOINTS_${set}`] !== undefined; set++) {
    const joints = edit.readNumbers(primitive.attributes[`JOINTS_${set}`])
    const weights = edit.readNumbers(primitive.attributes[`WEIGHTS_${set}`])
    const sums = new Float64Array(flags.length)
    for (let i = 0; i < joints.length; i++) if (pattern.test(names[joints[i]])) sums[Math.floor(i / 4)] += weights[i]
    sums.forEach((sum, v) => { if (sum > threshold) flags[v] = 1 })
  }
  return flags
}

/** Seam-aware reduction for heavily split UV layouts: simplify a position-welded copy (so UV seams
 * no longer block collapses), then give every output corner an original split vertex from a UV
 * island all three corners share. Triangles with no shared island are reported and dropped only
 * if `dropUnmatched`; otherwise they keep the majority island (a small texture smear at distance).
 */
export async function simplifyWelded({ indices, positions, protectedVertex = () => false, targetTriangles, maxError, lockBorder = true, dropUnmatched = false }) {
  await MeshoptSimplifier.ready
  const count = positions.length / 3, key = i => `${positions[i * 3]},${positions[i * 3 + 1]},${positions[i * 3 + 2]}`
  const canonical = new Uint32Array(count), first = new Map()
  for (let i = 0; i < count; i++) { const k = key(i); if (!first.has(k)) first.set(k, i); canonical[i] = first.get(k) }
  // UV islands: connected components of the split (original) topology.
  const parent = Uint32Array.from({ length: count }, (_, i) => i)
  const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i] } return i }
  for (let i = 0; i < indices.length; i += 3) for (const [a, b] of [[0, 1], [1, 2]]) {
    const x = find(indices[i + a]), y = find(indices[i + b]); if (x !== y) parent[x] = y
  }
  const splits = new Map() // canonical -> Map(island -> split vertex)
  for (let i = 0; i < count; i++) {
    const c = canonical[i]; let m = splits.get(c); if (!m) splits.set(c, m = new Map())
    const island = find(i); if (!m.has(island)) m.set(island, i)
  }
  const kept = [], body = []
  for (let i = 0; i < indices.length; i += 3) {
    const tri = [indices[i], indices[i + 1], indices[i + 2]]
    if (tri.some(protectedVertex)) kept.push(...tri)
    else body.push(...tri.map(v => canonical[v]))
  }
  const bodyTarget = Math.max(0, targetTriangles * 3 - kept.length)
  // Duplicate split rows left in the position stream still read as seams to meshoptimizer;
  // simplify over the unique welded positions only, then map back to canonical vertices.
  const unique = [...new Set(body)], local = new Map(unique.map((v, i) => [v, i]))
  const compact = new Float32Array(unique.length * 3)
  unique.forEach((v, i) => compact.set(positions.subarray(v * 3, v * 3 + 3), i * 3))
  const [localReduced, error] = MeshoptSimplifier.simplify(Uint32Array.from(body, v => local.get(v)), compact, 3,
    Math.floor(bodyTarget / 3) * 3, maxError, lockBorder ? ['LockBorder'] : [])
  const reduced = Uint32Array.from(localReduced, i => unique[i])
  const out = [...kept]
  let unmatched = 0
  for (let i = 0; i < reduced.length; i += 3) {
    const corners = [reduced[i], reduced[i + 1], reduced[i + 2]].map(c => splits.get(c))
    let island = [...corners[0].keys()].find(k => corners[1].has(k) && corners[2].has(k))
    if (island === undefined) {
      unmatched++
      if (dropUnmatched) continue
      const votes = new Map()
      for (const m of corners) for (const k of m.keys()) votes.set(k, (votes.get(k) ?? 0) + 1)
      island = [...votes].sort((a, b) => b[1] - a[1])[0][0]
    }
    out.push(...corners.map(m => m.get(island) ?? m.values().next().value))
  }
  return { indices: Uint32Array.from(out), protectedTriangles: kept.length / 3, error, unmatched, reducedTriangles: reduced.length / 3 }
}
