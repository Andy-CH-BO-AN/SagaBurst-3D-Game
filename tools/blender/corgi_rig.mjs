/** Apply only the reviewed corgi wrist/hock rest correction.
 * The original geometry and binary prefix stay untouched. Inverse bind matrices
 * compensate each changed joint, preserving its original bind-space transform.
 */
import fs from "node:fs";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { Matrix4, Quaternion, Vector3 } from "three";
import { loadGLB } from "./glb_pose.mjs";

const allowed = [
  "corgi_front_lower_l",
  "corgi_front_paw_l",
  "corgi_front_lower_r",
  "corgi_front_paw_r",
  "corgi_rear_lower_l",
  "corgi_rear_ankle_l",
  "corgi_rear_paw_l",
  "corgi_rear_lower_r",
  "corgi_rear_ankle_r",
  "corgi_rear_paw_r",
];
function worlds(doc) {
  const parents = new Map();
  doc.nodes.forEach((node, i) =>
    (node.children ?? []).forEach((child) => parents.set(child, i)),
  );
  const result = [];
  function world(i) {
    if (result[i]) return result[i];
    const node = doc.nodes[i];
    const local = node.matrix
      ? new Matrix4().fromArray(node.matrix)
      : new Matrix4().compose(
          new Vector3().fromArray(node.translation ?? [0, 0, 0]),
          new Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]),
          new Vector3().fromArray(node.scale ?? [1, 1, 1]),
        );
    const parent = parents.get(i);
    result[i] =
      parent === undefined ? local : world(parent).clone().multiply(local);
    return result[i];
  }
  return doc.nodes.map((_, i) => world(i));
}

export async function applyCorgiRig(
  baseline,
  spec = JSON.parse(
    fs.readFileSync(
      new URL("./corgi-rig-correction.json", import.meta.url),
      "utf8",
    ),
  ),
) {
  assert.equal(
    crypto.createHash("sha256").update(baseline.raw).digest("hex"),
    spec.baselineSha256,
    "Rig correction requires its pinned source",
  );
  assert.deepEqual(
    spec.joints.map((j) => j.name).sort(),
    [...allowed].sort(),
    "Only the ten reviewed corgi wrist/hock chain bones may change",
  );
  const doc = structuredClone(baseline.doc);
  const oldWorld = worlds(baseline.doc);
  for (const joint of spec.joints) {
    const node = doc.nodes.find((n) => n.name === joint.name);
    assert(node && !node.matrix);
    for (const [key, size] of [
      ["translation", 3],
      ["rotation", 4],
    ]) {
      assert.equal(joint[key].length, size);
      assert(joint[key].every(Number.isFinite));
      node[key] = [...joint[key]];
    }
    assert(
      Math.abs(Math.hypot(...joint.rotation) - 1) < 1e-5,
      "Nonunit rest rotation",
    );
    if (joint.scale)
      assert(
        joint.scale.every(
          (v, i) => Math.abs(v - (node.scale ?? [1, 1, 1])[i]) < 1e-6,
        ),
        "Rig correction cannot resize bones",
      );
  }
  const newWorld = worlds(doc);
  for (let i = 0; i < doc.nodes.length; i++) {
    if (!allowed.includes(doc.nodes[i].name))
      assert(
        newWorld[i].elements.every(
          (v, j) => Math.abs(v - oldWorld[i].elements[j]) < 1e-6,
        ),
        "Unreviewed rest transform " + doc.nodes[i].name,
      );
  }
  const source = await loadGLB(baseline.raw);
  const skin = doc.skins[0],
    values = [...source.data(skin.inverseBindMatrices).values];
  let maxBindMatrixError = 0;
  for (let j = 0; j < skin.joints.length; j++) {
    const node = skin.joints[j];
    if (!allowed.includes(doc.nodes[node].name)) continue;
    const oldBind = new Matrix4().fromArray(values, j * 16);
    const oldTransform = oldWorld[node].clone().multiply(oldBind);
    const newBind = newWorld[node].clone().invert().multiply(oldTransform);
    const packed = newBind.elements.map(Math.fround);
    packed.forEach((v, i) => {
      values[j * 16 + i] = v;
    });
    const actual = newWorld[node]
      .clone()
      .multiply(new Matrix4().fromArray(packed));
    maxBindMatrixError = Math.max(
      maxBindMatrixError,
      ...actual.elements.map((v, i) => Math.abs(v - oldTransform.elements[i])),
    );
  }
  assert(maxBindMatrixError < 1e-5, "Bind compensation exceeds tolerance");
  const padding = (4 - (baseline.bin.length % 4)) % 4;
  const offset = baseline.bin.length + padding,
    bytes = Buffer.alloc(values.length * 4);
  values.forEach((value, i) => bytes.writeFloatLE(value, i * 4));
  const view = doc.bufferViews.length;
  doc.bufferViews.push({
    buffer: 0,
    byteOffset: offset,
    byteLength: bytes.length,
  });
  skin.inverseBindMatrices = doc.accessors.length;
  doc.accessors.push({
    bufferView: view,
    componentType: 5126,
    count: skin.joints.length,
    type: "MAT4",
  });
  doc.buffers[0].byteLength = offset + bytes.length;
  return {
    doc,
    bin: Buffer.concat([baseline.bin, Buffer.alloc(padding), bytes]),
    expectedInverseBinds: values,
    report: {
      algorithm: spec.algorithm,
      changedJoints: spec.joints.map((j) => j.name),
      landmarks: spec.landmarks,
      maximumBindMatrixError: maxBindMatrixError,
    },
  };
}
