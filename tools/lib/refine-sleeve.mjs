/** Refine only coarse sleeve triangles before surface fitting. Interpolate
 * all render attributes and merge joint weights, preserving UV seams. */
export function refineSleeve(asset, primitive, scale) {
  const doc = asset.document, sizes = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }
  const read = index => {
    const a = doc.accessors[index], v = doc.bufferViews[a.bufferView], n = sizes[a.type]
    const bytes = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 }[a.componentType]
    const reader = { 5121: 'readUInt8', 5123: 'readUInt16LE', 5125: 'readUInt32LE', 5126: 'readFloatLE' }[a.componentType]
    return Array.from({ length: a.count }, (_, row) => Array.from({ length: n }, (_, col) =>
      asset.binary[reader]((v.byteOffset ?? 0) + (a.byteOffset ?? 0) + row * (v.byteStride ?? n * bytes) + col * bytes)))
  }
  const data = Object.fromEntries(Object.entries(primitive.attributes).map(([key, index]) => [key, read(index)]))
  let indices = primitive.indices === undefined ? data.POSITION.map((_, i) => i) : read(primitive.indices).flat()
  const midpoint = (a, b, cache) => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`
    if (cache.has(key)) return cache.get(key)
    const index = data.POSITION.length
    for (const [key, values] of Object.entries(data)) {
      if (key === 'JOINTS_0' || key === 'WEIGHTS_0') continue
      const value = values[a].map((v, i) => (v + values[b][i]) / 2)
      if (key === 'NORMAL') { const length = Math.hypot(...value); value.forEach((v, i) => value[i] = v / length) }
      values.push(value)
    }
    const weights = new Map()
    for (const i of [a, b]) data.JOINTS_0[i].forEach((joint, k) => weights.set(joint, (weights.get(joint) ?? 0) + data.WEIGHTS_0[i][k] / 2))
    const entries = [...weights].sort((a, b) => b[1] - a[1]).slice(0, 4)
    while (entries.length < 4) entries.push([0, 0])
    const total = entries.reduce((sum, p) => sum + p[1], 0)
    data.JOINTS_0.push(entries.map(p => p[0])); data.WEIGHTS_0.push(entries.map(p => p[1] / total))
    cache.set(key, index); return index
  }
  for (let pass = 0; pass < 3; pass++) {
    const next = [], cache = new Map(), splitEdges = new Set()
    // Mark geometric edges across UV duplicates, then split every adjacent
    // triangle. A projected midpoint must never leave a T-junction crack.
    const edgeKey = (a, b) => [a, b].map(i => data.POSITION[i].map(v => v.toFixed(6)).join(',')).sort().join(':')
    for (let i = 0; i < indices.length; i += 3) {
      const [a, b, c] = indices.slice(i, i + 3), points = [a, b, c].map(j => data.POSITION[j])
      const sleeve = points.every(p => Math.abs(p[0]) > .18 * scale && Math.abs(p[0]) < .47 * scale && p[1] > 1.25 * scale)
      const long = [[0, 1], [1, 2], [2, 0]].some(([a, b]) => Math.hypot(...points[a].map((v, k) => v - points[b][k])) > .06 * scale)
      if (sleeve && long) for (const [u, v] of [[a, b], [b, c], [c, a]]) splitEdges.add(edgeKey(u, v))
    }
    for (let i = 0; i < indices.length; i += 3) {
      let [a, b, c] = indices.slice(i, i + 3)
      const count = [[a, b], [b, c], [c, a]].filter(([u, v]) => splitEdges.has(edgeKey(u, v))).length
      if (!count) { next.push(a, b, c); continue }
      if (count === 3) {
        const ab = midpoint(a, b, cache), bc = midpoint(b, c, cache), ca = midpoint(c, a, cache)
        next.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca)
      } else {
        while (!(splitEdges.has(edgeKey(a, b)) && (count === 1 || splitEdges.has(edgeKey(b, c))))) [a, b, c] = [b, c, a]
        const ab = midpoint(a, b, cache)
        if (count === 1) next.push(a, ab, c, ab, b, c)
        else { const bc = midpoint(b, c, cache); next.push(b, bc, ab, a, ab, c, ab, bc, c) }
      }
    }
    indices = next
  }
  const append = (values, type, componentType) => {
    const array = componentType === 5126 ? new Float32Array(values) : new Uint32Array(values)
    const padding = (4 - asset.binary.length % 4) % 4, offset = asset.binary.length + padding
    asset.binary = Buffer.concat([asset.binary, Buffer.alloc(padding), Buffer.from(array.buffer)])
    doc.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: array.byteLength })
    doc.accessors.push({ bufferView: doc.bufferViews.length - 1, componentType, count: values.length / sizes[type], type })
    return doc.accessors.length - 1
  }
  for (const [key, values] of Object.entries(data)) {
    // glTF joints must be unsigned bytes/shorts, never unsigned ints.
    if (key === 'JOINTS_0') {
      const array = new Uint16Array(values.flat()), offset = asset.binary.length
      asset.binary = Buffer.concat([asset.binary, Buffer.from(array.buffer)])
      doc.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: array.byteLength })
      doc.accessors.push({ bufferView: doc.bufferViews.length - 1, componentType: 5123, count: values.length, type: 'VEC4' })
      primitive.attributes[key] = doc.accessors.length - 1
    } else primitive.attributes[key] = append(values.flat(), doc.accessors[primitive.attributes[key]].type, 5126)
  }
  primitive.indices = append(indices, 'SCALAR', 5125)
  doc.buffers[0].byteLength = asset.binary.length
}
