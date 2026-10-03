// Read-only animation/skin QA. No Blender scene, browser, or image decoding.
import fs from "node:fs";
import { Matrix4, Quaternion, Vector3 } from "three";
import { MeshoptDecoder } from "meshoptimizer";

export async function loadGLB(input, lod = 0) {
  const raw = Buffer.isBuffer(input) ? input : fs.readFileSync(input),
    jsonLength = raw.readUInt32LE(12);
  if (raw.toString("ascii", 0, 4) !== "glTF" || raw.readUInt32LE(4) !== 2)
    throw new Error("Not glTF 2 GLB");
  const doc = JSON.parse(raw.toString("utf8", 20, 20 + jsonLength)),
    bin = raw.subarray(28 + jsonLength);
  await MeshoptDecoder.ready;
  const buffers = new Map(),
    accessors = new Map();
  const component = {
    5120: ["getInt8", 1],
    5121: ["getUint8", 1],
    5122: ["getInt16", 2],
    5123: ["getUint16", 2],
    5125: ["getUint32", 4],
    5126: ["getFloat32", 4],
  };
  const widths = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
  function data(index) {
    if (accessors.has(index)) return accessors.get(index);
    const a = doc.accessors[index],
      v = doc.bufferViews[a.bufferView];
    if (a.sparse)
      throw new Error("Sparse accessor requires an explicit adapter");
    if (!buffers.has(a.bufferView)) {
      const e = v.extensions?.EXT_meshopt_compression;
      if (e) {
        const decoded = new Uint8Array(e.count * e.byteStride);
        MeshoptDecoder.decodeGltfBuffer(
          decoded,
          e.count,
          e.byteStride,
          bin.subarray(e.byteOffset ?? 0, (e.byteOffset ?? 0) + e.byteLength),
          e.mode,
          e.filter,
        );
        buffers.set(a.bufferView, decoded);
      } else
        buffers.set(
          a.bufferView,
          bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength),
        );
    }
    const bytes = buffers.get(a.bufferView),
      dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const [read, size] = component[a.componentType] ?? [],
      width = widths[a.type];
    if (!read || !width) throw new Error(`Unsupported accessor ${index}`);
    const stride =
      v.byteStride ??
      v.extensions?.EXT_meshopt_compression?.byteStride ??
      width * size;
    const values = new Float64Array(a.count * width);
    for (let i = 0; i < a.count; i++)
      for (let j = 0; j < width; j++) {
        let value = dv[read]((a.byteOffset ?? 0) + i * stride + j * size, true);
        if (a.normalized) {
          if (a.componentType === 5120) value = Math.max(value / 127, -1);
          else if (a.componentType === 5121) value /= 255;
          else if (a.componentType === 5122)
            value = Math.max(value / 32767, -1);
          else if (a.componentType === 5123) value /= 65535;
        }
        if (!Number.isFinite(value))
          throw new Error(`Nonfinite accessor ${index}, element ${i}:${j}`);
        values[i * width + j] = value;
      }
    const result = { values, count: a.count, width };
    accessors.set(index, result);
    return result;
  }
  const parents = new Map();
  doc.nodes.forEach((n, i) =>
    (n.children ?? []).forEach((c) => parents.set(c, i)),
  );
  if (![0, 1, 2].includes(lod)) throw new Error("LOD must be 0/1/2");
  const meshIndex = doc.nodes.findIndex((n) =>
    new RegExp(`(?:cat|corgi)_body_lod${lod}$`).test(n.name),
  );
  if (meshIndex < 0) throw new Error("Expected source body node");
  const meshNode = doc.nodes[meshIndex],
    skin = doc.skins[meshNode.skin];
  const primitive = doc.meshes[meshNode.mesh].primitives;
  if (primitive.length !== 1) throw new Error("Expected one body primitive");
  const attrs = primitive[0].attributes,
    positions = data(attrs.POSITION),
    joints = data(attrs.JOINTS_0),
    weights = data(attrs.WEIGHTS_0);
  if (attrs.JOINTS_1 !== undefined || attrs.WEIGHTS_1 !== undefined)
    throw new Error("Extra skin influences require an explicit adapter");
  const inverse = data(skin.inverseBindMatrices);
  const inverseBinds = skin.joints.map((_, i) =>
    new Matrix4().fromArray(inverse.values, i * 16),
  );
  const paws = {};
  skin.joints.forEach((n, joint) => {
    if (/_paw_[lr]$/.test(doc.nodes[n].name))
      paws[doc.nodes[n].name] = { joint, vertices: [] };
  });
  for (let i = 0; i < positions.count; i++) {
    let sum = 0;
    for (let j = 0; j < 4; j++) {
      const joint = joints.values[i * 4 + j],
        weight = weights.values[i * 4 + j];
      if (joint >= skin.joints.length || weight < 0)
        throw new Error("Invalid skin influence");
      sum += weight;
      for (const paw of Object.values(paws))
        if (paw.joint === joint && weight >= 0.35) paw.vertices.push(i);
    }
    if (Math.abs(sum - 1) > 0.02)
      throw new Error(`Unnormalised vertex weights ${i}: ${sum}`);
  }
  if (
    Object.keys(paws).length !== 4 ||
    Object.values(paws).some((p) => p.vertices.length === 0)
  )
    throw new Error("Expected four actual weighted paw regions");

  function pose(animation, time) {
    const states = doc.nodes.map((n) => {
      const p = new Vector3(),
        q = new Quaternion(),
        s = new Vector3(1, 1, 1);
      if (n.matrix) new Matrix4().fromArray(n.matrix).decompose(p, q, s);
      else {
        if (n.translation) p.fromArray(n.translation);
        if (n.rotation) q.fromArray(n.rotation);
        if (n.scale) s.fromArray(n.scale);
      }
      q.normalize();
      return { p, q, s };
    });
    for (const channel of animation.channels) {
      const sampler = animation.samplers[channel.sampler],
        times = data(sampler.input).values,
        out = data(sampler.output);
      let hi = 1;
      while (hi < times.length && times[hi] < time) hi++;
      hi = Math.min(hi, times.length - 1);
      const lo = Math.max(0, hi - 1),
        duration = times[hi] - times[lo],
        u =
          duration > 0
            ? Math.max(0, Math.min(1, (time - times[lo]) / duration))
            : 0;
      const cubic = sampler.interpolation === "CUBICSPLINE",
        stride = cubic ? out.width * 3 : out.width;
      const offset = lo * stride + (cubic ? out.width : 0),
        next = hi * stride + (cubic ? out.width : 0);
      const result = [];
      for (let c = 0; c < out.width; c++) {
        const a = out.values[offset + c],
          b = out.values[next + c];
        if (cubic)
          result.push(
            (2 * u ** 3 - 3 * u * u + 1) * a +
              (u ** 3 - 2 * u * u + u) *
                duration *
                out.values[offset + out.width + c] +
              (-2 * u ** 3 + 3 * u * u) * b +
              (u ** 3 - u * u) * duration * out.values[next - out.width + c],
          );
        else
          result.push(sampler.interpolation === "STEP" ? a : a + (b - a) * u);
      }
      const state = states[channel.target.node];
      if (channel.target.path === "rotation") {
        if (cubic) state.q.fromArray(result).normalize();
        else if (sampler.interpolation === "STEP")
          state.q.fromArray(out.values, offset);
        else
          state.q
            .fromArray(out.values, offset)
            .normalize()
            .slerp(new Quaternion().fromArray(out.values, next).normalize(), u);
        state.q.normalize();
      } else if (channel.target.path === "translation")
        state.p.fromArray(result);
      else if (channel.target.path === "scale") state.s.fromArray(result);
      else throw new Error(`Unsupported animated path ${channel.target.path}`);
    }
    const worlds = [];
    const world = (i) => {
      if (worlds[i]) return worlds[i];
      const { p, q, s } = states[i],
        m = new Matrix4().compose(p, q, s),
        parent = parents.get(i);
      worlds[i] = parent === undefined ? m : world(parent).clone().multiply(m);
      if (!worlds[i].elements.every(Number.isFinite))
        throw new Error("Nonfinite evaluated world transform");
      return worlds[i];
    };
    return {
      states,
      worlds: doc.nodes.map((_, i) => world(i)),
      matrices: skin.joints.map(
        (node, i) => world(node).clone().multiply(inverseBinds[i]).elements,
      ),
    };
  }
  function vertices(pose) {
    const result = new Float64Array(positions.values.length);
    for (let i = 0; i < positions.count; i++) {
      const x = positions.values[i * 3],
        y = positions.values[i * 3 + 1],
        z = positions.values[i * 3 + 2];
      let a = 0,
        b = 0,
        c = 0;
      for (let j = 0; j < 4; j++) {
        const w = weights.values[i * 4 + j],
          m = pose.matrices[joints.values[i * 4 + j]];
        a += w * (m[0] * x + m[4] * y + m[8] * z + m[12]);
        b += w * (m[1] * x + m[5] * y + m[9] * z + m[13]);
        c += w * (m[2] * x + m[6] * y + m[10] * z + m[14]);
      }
      if (!Number.isFinite(a + b + c))
        throw new Error("Nonfinite skinned vertex");
      result[i * 3] = a;
      result[i * 3 + 1] = b;
      result[i * 3 + 2] = c;
    }
    return result;
  }

  return {
    raw,
    doc,
    skin,
    positions,
    joints,
    weights,
    primitive,
    data,
    pose,
    vertices,
    paws,
    meshIndex,
    parents,
  };
}
