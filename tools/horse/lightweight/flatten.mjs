// Remove imported static wrapper transforms, preserving every joint, socket,
// skinned surface and animated world transform. This shortens socket updates.
import fs from "node:fs";
import * as T from "three";
import { work } from "./config.mjs";
import { readGlb, encodeGlb } from "../../blender/animal_glb.mjs";
const asset = readGlb(work + "/tacked.glb"),
  d = asset.doc;
asset.bin = Buffer.from(asset.bin);
const animated = new Set(
  d.animations.flatMap((a) => a.channels.map((c) => c.target.node)),
);
const joints = new Set(d.skins.flatMap((s) => [...s.joints, s.skeleton]));
const matrix = (n) =>
  n.matrix
    ? new T.Matrix4().fromArray(n.matrix)
    : new T.Matrix4().compose(
        new T.Vector3().fromArray(n.translation ?? [0, 0, 0]),
        new T.Quaternion().fromArray(n.rotation ?? [0, 0, 0, 1]),
        new T.Vector3().fromArray(n.scale ?? [1, 1, 1]),
      );
function setMatrix(n, m) {
  const p = new T.Vector3(),
    q = new T.Quaternion(),
    s = new T.Vector3();
  m.decompose(p, q, s);
  delete n.matrix;
  n.translation = p.toArray();
  n.rotation = q.toArray();
  n.scale = s.toArray();
}
for (let index = 0; index < d.nodes.length; index++) {
  const node = d.nodes[index];
  if (
    !(index < 7 || node.name === "horse_normalization") ||
    animated.has(index) ||
    joints.has(index) ||
    node.mesh !== undefined
  )
    continue;
  const transform = matrix(node),
    position = new T.Vector3(),
    rotation = new T.Quaternion(),
    scale = new T.Vector3();
  transform.decompose(position, rotation, scale);
  if (
    scale.x <= 0 ||
    Math.abs(scale.x - scale.y) > 1e-6 ||
    Math.abs(scale.y - scale.z) > 1e-6
  )
    throw new Error("Cannot flatten nonuniform or mirrored wrapper");
  for (const child of node.children ?? []) {
    setMatrix(
      d.nodes[child],
      transform.clone().multiply(matrix(d.nodes[child])),
    );
    for (const animation of d.animations)
      for (const channel of animation.channels) {
        if (channel.target.node !== child) continue;
        const path = channel.target.path,
          ac = d.accessors[animation.samplers[channel.sampler].output],
          view = d.bufferViews[ac.bufferView],
          width = path === "rotation" ? 4 : 3;
        if (ac.componentType !== 5126)
          throw new Error("Expected baked float animation");
        for (let frame = 0; frame < ac.count; frame++) {
          const offset =
              (view.byteOffset ?? 0) +
              (ac.byteOffset ?? 0) +
              frame * (view.byteStride ?? width * 4),
            values = Array.from({ length: width }, (_, k) =>
              asset.bin.readFloatLE(offset + k * 4),
            );
          const result =
            path === "rotation"
              ? rotation
                  .clone()
                  .multiply(new T.Quaternion().fromArray(values))
                  .normalize()
                  .toArray()
              : path === "translation"
                ? new T.Vector3()
                    .fromArray(values)
                    .applyMatrix4(transform)
                    .toArray()
                : new T.Vector3().fromArray(values).multiply(scale).toArray();
          result.forEach((value, k) =>
            asset.bin.writeFloatLE(value, offset + k * 4),
          );
        }
      }
  }
  const replace = (indices) =>
    indices.flatMap((i) => (i === index ? (node.children ?? []) : [i]));
  for (const parent of d.nodes)
    if (parent.children && parent !== node)
      parent.children = replace(parent.children);
  for (const scene of d.scenes) scene.nodes = replace(scene.nodes);
  node.children = [];
}
fs.writeFileSync(work + "/tacked.glb", encodeGlb(d, asset.bin));
