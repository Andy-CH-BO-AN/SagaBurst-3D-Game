import { work } from "./config.mjs";
import fs from "node:fs";
import * as T from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { readGlb, encodeGlb } from "../../blender/animal_glb.mjs";
globalThis.ProgressEvent = class {
  constructor(type, p) {
    Object.assign(this, { type }, p);
  }
};
async function load(a) {
  const d = structuredClone(a.doc);
  d.materials = [{}];
  d.meshes.forEach((m) => m.primitives.forEach((p) => (p.material = 0)));
  delete d.textures;
  delete d.images;
  d.extensionsRequired = [];
  const b = encodeGlb(d, a.bin);
  return new GLTFLoader().parseAsync(
    b.buffer.slice(b.byteOffset, b.byteOffset + b.length),
    "",
  );
}
const a = readGlb(work + "/lod.glb"),
  d = a.doc,
  target = await load(a),
  oldAsset = readGlb(work + "/old-donor.glb");
oldAsset.doc.nodes
  .find((n) => n.name === "horse_lod0")
  .children.push(
    ...oldAsset.doc.nodes
      .map((n, i) => (/^saddle.*_lod2$/.test(n.name) ? i : -1))
      .filter((i) => i >= 0),
  );
const old = await load(oldAsset);
const mix = new T.AnimationMixer(old.scene);
mix.clipAction(old.animations.find((c) => c.name === "idle")).play();
mix.setTime(0);
old.scene.updateMatrixWorld(true);
old.scene.traverse((o) => {
  if (o.isSkinnedMesh) o.skeleton.update();
});
target.scene.updateMatrixWorld(true);
const bone = target.scene.getObjectByName("horse_01"),
  skinned = target.scene.getObjectByName("horse_body_lod0"),
  joint = skinned.skeleton.bones.indexOf(bone),
  bind = bone.matrixWorld
    .clone()
    .multiply(skinned.skeleton.boneInverses[joint])
    .invert();
// Fit the donor tack to the new back and flanks in the neutral pose. Sampling
// a static posed surface avoids stale SkinnedMesh raycast bounds during export.
skinned.skeleton.update();
const bodyGeometry = new T.BufferGeometry();
bodyGeometry.setAttribute(
  "position",
  new T.Float32BufferAttribute(
    Array.from({ length: skinned.geometry.attributes.position.count }, (_, i) =>
      skinned
        .getVertexPosition(i, new T.Vector3())
        .applyMatrix4(skinned.matrixWorld)
        .toArray(),
    ).flat(),
    3,
  ),
);
bodyGeometry.setIndex(skinned.geometry.index);
const bodySurface = new T.Mesh(
  bodyGeometry,
  new T.MeshBasicMaterial({ side: T.DoubleSide }),
);
bodySurface.updateMatrixWorld();
const ray = new T.Raycaster();
const bodyPoints = Array.from(
  { length: skinned.geometry.attributes.position.count },
  (_, i) =>
    skinned
      .getVertexPosition(i, new T.Vector3())
      .applyMatrix4(skinned.matrixWorld),
);
const jointMatrices = skinned.skeleton.bones.map((b, i) =>
  b.matrixWorld.clone().multiply(skinned.skeleton.boneInverses[i]),
);
const positions = [],
  normals = [],
  colors = [],
  joints = [],
  weights = [],
  indices = [];
const names = [
  "saddle_pad_quilt_random_lod2",
  "saddle_quilt_dark_lod2",
  "saddle_saddle_random_lod2",
  "saddle_stirrup_0F_Corten_mqm_lod2",
  "saddle_stirrup_strap_4C_Leather_Black_mqm_lod2",
];
for (const [part, name] of names.entries()) {
  const o = old.scene.getObjectByName(name),
    g = o.geometry,
    start = positions.length / 3,
    color = new T.Color(
      part === 0 ? "#443c32" : part === 3 ? "#777674" : "#493326",
    );
  const points = Array.from({ length: g.attributes.position.count }, (_, i) =>
    o.getVertexPosition(i, new T.Vector3()).applyMatrix4(o.matrixWorld),
  );
  const directions = Array.from({ length: g.attributes.normal.count }, (_, i) =>
    new T.Vector3()
      .fromBufferAttribute(g.attributes.normal, i)
      .transformDirection(o.matrixWorld),
  );
  const triangles = Array.from(g.index.array);
  // One subdivision gives the cloth enough interior samples to follow the
  // curved flanks instead of cutting through them between sparse vertices.
  if (part < 2) {
    const original = triangles.splice(0);
    for (let i = 0; i < original.length; i += 3) {
      const [a, b, c] = original.slice(i, i + 3),
        mids = [];
      for (const [u, v] of [
        [a, b],
        [b, c],
        [c, a],
      ]) {
        mids.push(points.length);
        points.push(points[u].clone().lerp(points[v], 0.5));
        directions.push(
          directions[u].clone().lerp(directions[v], 0.5).normalize(),
        );
      }
      const [ab, bc, ca] = mids;
      triangles.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
    }
  }
  for (let i = 0; i < points.length; i++) {
    const p = points[i].clone();
    p.y -= 0.015;
    p.z -= 0.25;
    if (Math.abs(p.x) > 0.12) {
      const side = Math.sign(p.x);
      ray.set(new T.Vector3(side * 2, p.y, p.z), new T.Vector3(-side, 0, 0));
      const hit = ray.intersectObject(bodySurface)[0];
      if (hit)
        p.x = side * Math.max(Math.abs(p.x), Math.abs(hit.point.x) + 0.035);
    } else if (part < 3) {
      ray.set(new T.Vector3(p.x, 4, p.z), new T.Vector3(0, -1, 0));
      const hit = ray.intersectObject(bodySurface)[0];
      if (hit) p.y = Math.max(p.y, hit.point.y + 0.025);
    }
    // The cloth pad follows the same skin as the underlying back. A rigid
    // chest attachment lets the moving haunches cut through its rear edge.
    let vertexJoints = [joint, 0, 0, 0],
      vertexWeights = [1, 0, 0, 0];
    let vertexBind = bind;
    if (part < 3) {
      let nearest = 0,
        distance = Infinity;
      bodyPoints.forEach((point, index) => {
        const v = point.distanceToSquared(p);
        if (v < distance) {
          nearest = index;
          distance = v;
        }
      });
      vertexJoints = [0, 1, 2, 3].map(
        (k) => skinned.geometry.attributes.skinIndex.array[nearest * 4 + k],
      );
      vertexWeights = [0, 1, 2, 3].map(
        (k) => skinned.geometry.attributes.skinWeight.array[nearest * 4 + k],
      );
      const matrix = new T.Matrix4();
      matrix.elements.fill(0);
      for (let k = 0; k < 4; k++)
        for (let e = 0; e < 16; e++)
          matrix.elements[e] +=
            jointMatrices[vertexJoints[k]].elements[e] * vertexWeights[k];
      vertexBind = matrix.invert();
    }
    p.applyMatrix4(vertexBind);
    positions.push(...p.toArray());
    const n = directions[i]
      .clone()
      .applyMatrix3(new T.Matrix3().getNormalMatrix(vertexBind))
      .normalize();
    normals.push(...n.toArray());
    colors.push(color.r, color.g, color.b);
    joints.push(...vertexJoints);
    weights.push(...vertexWeights);
  }
  for (const index of triangles) indices.push(start + index);
}
let chunks = [a.bin],
  offset = a.bin.length;
function append(values, width, componentType = 5126) {
  const pad = (4 - (offset % 4)) % 4;
  if (pad) {
    chunks.push(Buffer.alloc(pad));
    offset += pad;
  }
  const arr =
      componentType === 5125
        ? new Uint32Array(values)
        : componentType === 5123
          ? new Uint16Array(values)
          : new Float32Array(values),
    b = Buffer.from(arr.buffer),
    vi = d.bufferViews.length;
  d.bufferViews.push({
    buffer: 0,
    byteOffset: offset,
    byteLength: b.length,
    target: width === 1 ? 34963 : 34962,
  });
  chunks.push(b);
  offset += b.length;
  const ai = d.accessors.length;
  const min = Array.from({ length: width }, (_, k) =>
      Math.min(...values.filter((_, i) => i % width === k)),
    ),
    max = Array.from({ length: width }, (_, k) =>
      Math.max(...values.filter((_, i) => i % width === k)),
    );
  d.accessors.push({
    bufferView: vi,
    componentType,
    count: values.length / width,
    type: { 1: "SCALAR", 3: "VEC3", 4: "VEC4" }[width],
    min,
    max,
  });
  return ai;
}
const mat = d.materials.length;
d.materials.push({
  name: "horse_saddle_leather",
  pbrMetallicRoughness: {
    baseColorFactor: [1, 1, 1, 1],
    roughnessFactor: 0.85,
    metallicFactor: 0,
  },
  doubleSided: true,
});
const primitive = {
  attributes: {
    POSITION: append(positions, 3),
    NORMAL: append(normals, 3),
    COLOR_0: append(colors, 3),
    JOINTS_0: append(joints, 4, 5123),
    WEIGHTS_0: append(weights, 4),
  },
  indices: append(indices, 1, 5125),
  material: mat,
};
const mi = d.meshes.length;
d.meshes.push({ name: "horse_saddle", primitives: [primitive] });
for (let lod = 0; lod < 3; lod++) {
  const group = d.nodes.find((n) => n.name === `horse_lod${lod}`);
  group.children.push(d.nodes.length);
  d.nodes.push({ name: `horse_saddle_lod${lod}`, mesh: mi, skin: 0 });
}
const bn = d.nodes.find((n) => n.name === "horse_01");
for (const [name, world] of [
  ["socket_saddle_seat", [0, 1.79, -0.43]],
  ["socket_stirrup_l", [0.36, 0.985, 0.2]],
  ["socket_stirrup_r", [-0.36, 0.985, 0.2]],
  ["socket_camera", [0, 2.095, -0.85]],
]) {
  const local = new T.Vector3()
    .fromArray(world)
    .applyMatrix4(bone.matrixWorld.clone().invert());
  bn.children ??= [];
  bn.children.push(d.nodes.length);
  d.nodes.push({ name, translation: local.toArray() });
}
d.buffers = [{ byteLength: offset }];
fs.writeFileSync(work + "/tacked.glb", encodeGlb(d, Buffer.concat(chunks)));
console.log({
  tackTriangles: indices.length / 3,
  total: [14796, 5325, 1479].map((n) => n + indices.length / 3),
  joint,
});
