/** Reproduce the reviewed corgi limb weights from immutable bind geometry.
 * The surface algorithm lives once in corgi_skin.py; this adapter supplies exact
 * decoded glTF positions and indices and packs only new skin accessors.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadGLB } from "./glb_pose.mjs";

export async function applyCorgiSkin(asset, baseline) {
  const model = await loadGLB(baseline.raw);
  const doc = structuredClone(asset.doc);
  const joints = doc.skins[0].joints.map((i) => doc.nodes[i].name);
  const jointIndex = new Map(joints.map((name, i) => [name, i]));
  const meshes = [],
    originals = new Map();
  for (const node of baseline.doc.nodes.filter((n) =>
    /^corgi_body_lod[012]$/.test(n.name),
  )) {
    const primitive = baseline.doc.meshes[node.mesh].primitives[0];
    const attributes = primitive.attributes;
    const positions = model.data(attributes.POSITION);
    const ids = [...model.data(attributes.JOINTS_0).values];
    const weights = [...model.data(attributes.WEIGHTS_0).values];
    const indices = model.data(primitive.indices).values;
    const vertices = [],
      named = [],
      faces = [];
    for (let i = 0; i < positions.count; i++) {
      // glTF +Y up/+Z forward -> Blender +Z up/-Y forward.
      const p = positions.values;
      vertices.push([p[i * 3], -p[i * 3 + 2], p[i * 3 + 1]]);
      const row = {};
      for (let k = 0; k < 4; k++) {
        const w = weights[i * 4 + k];
        if (w > 0) {
          const name = joints[ids[i * 4 + k]];
          row[name] = (row[name] ?? 0) + w;
        }
      }
      named.push(row);
    }
    for (let i = 0; i < indices.length; i += 3)
      faces.push(Array.from(indices.slice(i, i + 3)));
    meshes.push({ name: node.name, vertices, faces, weights: named });
    originals.set(node.name, { ids, weights, count: positions.count });
  }
  assert.equal(meshes.length, 3, "All corgi body LODs required");
  const output = execFileSync(
    "rtk",
    [
      "proxy",
      process.env.SAGABURST_PYTHON ?? "python3",
      fileURLToPath(new URL("./corgi_skin.py", import.meta.url)),
      "--plan-stdin",
    ],
    {
      input: JSON.stringify({ meshes }),
      maxBuffer: 96 * 1024 * 1024,
    },
  );
  const plan = JSON.parse(output);
  const chunks = [asset.bin];
  let offset = asset.bin.length;
  const expected = new Map(),
    patch = { algorithm: plan.algorithm, meshes: {} };
  const report = { algorithm: patch.algorithm, meshes: [] };
  function append(values, componentType, count) {
    const padding = (4 - (offset % 4)) % 4;
    if (padding) {
      chunks.push(Buffer.alloc(padding));
      offset += padding;
    }
    const size = componentType === 5123 ? 2 : 4;
    const bytes = Buffer.alloc(values.length * size);
    values.forEach((value, i) =>
      componentType === 5123
        ? bytes.writeUInt16LE(value, i * size)
        : bytes.writeFloatLE(value, i * size),
    );
    const view = doc.bufferViews.length;
    doc.bufferViews.push({
      buffer: 0,
      byteOffset: offset,
      byteLength: bytes.length,
      target: 34962,
    });
    chunks.push(bytes);
    offset += bytes.length;
    const accessor = doc.accessors.length;
    doc.accessors.push({
      bufferView: view,
      componentType,
      count,
      type: "VEC4",
    });
    return accessor;
  }
  assert.deepEqual(
    plan.meshes.map((m) => m.name),
    meshes.map((m) => m.name),
  );
  for (const mesh of plan.meshes) {
    const original = originals.get(mesh.name);
    const { ids, weights, count } = original;
    assert.equal(mesh.weights.length, count);
    const named = [];
    let changed = 0;
    for (let i = 0; i < count; i++) {
      const before = meshes.find((m) => m.name === mesh.name).weights[i];
      const rows = Object.entries(mesh.weights[i]);
      const delta = Math.max(
        ...[...new Set([...Object.keys(before), ...rows.map((r) => r[0])])].map(
          (name) =>
            Math.abs((before[name] ?? 0) - (mesh.weights[i][name] ?? 0)),
        ),
      );
      if (delta >= 1e-7) {
        assert(rows.length > 0 && rows.length <= 4);
        const sum = rows.reduce((n, [, w]) => n + w, 0);
        assert(Math.abs(sum - 1) < 1e-6);
        for (const [name, w] of rows)
          assert(jointIndex.has(name) && Number.isFinite(w) && w >= 0);
        for (let k = 0; k < 4; k++) {
          ids[i * 4 + k] = rows[k] ? jointIndex.get(rows[k][0]) : 0;
          weights[i * 4 + k] = rows[k] ? Math.fround(rows[k][1]) : 0;
        }
        changed++;
      }
      const packed = {};
      for (let k = 0; k < 4; k++) {
        const w = weights[i * 4 + k];
        if (w > 0) packed[joints[ids[i * 4 + k]]] = w;
      }
      named.push(packed);
    }
    expected.set(mesh.name, { ids, weights, count });
    patch.meshes[mesh.name] = {
      weights: named,
      regions: mesh.regions,
      metadata: mesh.metadata,
    };
    if (changed) {
      const node = doc.nodes.find((n) => n.name === mesh.name);
      const attrs = doc.meshes[node.mesh].primitives[0].attributes;
      attrs.JOINTS_0 = append(ids, 5123, count);
      attrs.WEIGHTS_0 = append(weights, 5126, count);
    }
    report.meshes.push({
      name: mesh.name,
      changedVertices: changed,
      ...mesh.metadata,
    });
  }
  doc.buffers[0].byteLength = offset;
  return { doc, bin: Buffer.concat(chunks), expected, report, patch };
}
