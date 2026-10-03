/** The user-selected v6 paw/lumbar skin correction, on original vertex order.
 * Geometry, rest transforms, materials and animation channels are preserved.
 */
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { loadGLB } from "./glb_pose.mjs";

const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export async function applyCatSkin(asset, baseline) {
  const doc = structuredClone(asset.doc);
  const chunks = [asset.bin];
  let offset = asset.bin.length;
  const model = await loadGLB(baseline.raw);
  const joints = doc.skins[0].joints.map((i) => doc.nodes[i].name);
  const jointIndex = new Map(joints.map((name, i) => [name, i]));
  const idle = model.doc.animations.find((a) => a.name === "idle");
  const idlePose = model.pose(
    idle,
    model.data(idle.samplers[0].input).values[0],
  );
  const pawInverse = Object.fromEntries(
    ["l", "r"].map((side) => {
      const index = doc.nodes.findIndex(
        (n) => n.name === "cat_front_paw_" + side,
      );
      return [side, idlePose.worlds[index].clone().invert()];
    }),
  );
  const report = { algorithm: "cat-paw-lumbar-v6", meshes: [] };
  const expected = new Map();

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

  for (const node of doc.nodes.filter(
    (n) => n.mesh !== undefined && n.skin === 0,
  )) {
    const body = /cat_body_lod[012]$/.test(node.name);
    const lodModel =
      body && !node.name.endsWith("lod0")
        ? await loadGLB(baseline.raw, Number(node.name.at(-1)))
        : model;
    const originalNode = baseline.doc.nodes.find((n) => n.name === node.name);
    const original =
      baseline.doc.meshes[originalNode.mesh].primitives[0].attributes;
    const positions = lodModel.data(original.POSITION);
    const ids = [...lodModel.data(original.JOINTS_0).values];
    const weights = [...lodModel.data(original.WEIGHTS_0).values];
    const idlePoints = body ? lodModel.vertices(idlePose) : null;
    let changed = 0;
    for (let i = 0; i < positions.count; i++) {
      const p = new Vector3().fromArray(positions.values, i * 3);
      const before = {};
      for (let k = 0; k < 4; k++) {
        const w = weights[i * 4 + k],
          name = joints[ids[i * 4 + k]];
        if (w > 0) before[name] = (before[name] ?? 0) + w;
      }
      const after = { ...before };
      const side = p.x >= 0 ? "l" : "r";
      const paw = "cat_front_paw_" + side,
        lower = "cat_front_lower_" + side;
      let touched = false;
      if (
        body &&
        p.y < 0.28 &&
        p.z > 0.52 &&
        (before[paw] ?? 0) + (before[lower] ?? 0) > 0.2
      ) {
        const local = new Vector3()
          .fromArray(idlePoints, i * 3)
          .applyMatrix4(pawInverse[side]);
        const blend = smooth(-0.055, 0.03, local.y);
        if (blend > 0) {
          for (const name of Object.keys(after)) after[name] *= 1 - blend;
          after[paw] = (after[paw] ?? 0) + blend;
          touched = true;
        }
      }
      if (p.z < -0.42 && p.z > -1.45 && p.y > 1.03) {
        const blend =
          smooth(1.03, 1.25, p.y) *
          smooth(-0.42, -0.65, p.z) *
          (1 - smooth(-1.18, -1.45, p.z));
        let transfer = 0;
        for (const name of Object.keys(after)) {
          if (
            /^cat_rear_(upper|lower)_[lr]$/.test(name) ||
            name === "cat_tail_0"
          ) {
            const amount = after[name] * blend;
            after[name] -= amount;
            transfer += amount;
          }
        }
        if (transfer > 0.00001) {
          after.cat_torso = (after.cat_torso ?? 0) + transfer;
          touched = true;
        }
      }
      if (!touched) continue;
      const rows = Object.entries(after)
        .filter(([, w]) => w > 0.000001)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4);
      const total = rows.reduce((sum, [, w]) => sum + w, 0);
      assert(total > 0);
      const packed = rows.map(([name, w]) => [
        jointIndex.get(name),
        Math.fround(w / total),
      ]);
      const named = Object.fromEntries(
        packed.map(([index, w]) => [joints[index], w]),
      );
      const delta = Math.max(
        ...[...new Set([...Object.keys(before), ...Object.keys(named)])].map(
          (name) => Math.abs((before[name] ?? 0) - (named[name] ?? 0)),
        ),
      );
      if (delta < 0.000001) continue;
      for (let k = 0; k < 4; k++) {
        ids[i * 4 + k] = packed[k]?.[0] ?? 0;
        weights[i * 4 + k] = packed[k]?.[1] ?? 0;
      }
      changed++;
    }
    expected.set(node.name, { ids, weights, count: positions.count });
    if (changed) {
      const attrs = doc.meshes[node.mesh].primitives[0].attributes;
      attrs.JOINTS_0 = append(ids, 5123, positions.count);
      attrs.WEIGHTS_0 = append(weights, 5126, positions.count);
      report.meshes.push({ name: node.name, changedVertices: changed });
    }
  }
  doc.buffers[0].byteLength = offset;
  return { doc, bin: Buffer.concat(chunks), report, expected };
}
