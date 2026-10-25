/** Source-preserving Black Cat v3 builder. See --help. No LOD0 mesh processing. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { Matrix4, Quaternion, Vector3 } from "three";
import { MeshoptEncoder } from "meshoptimizer";
import { readGlb, encodeGlb } from "./animal_glb.mjs";
import { loadGLB } from "./glb_pose.mjs";
import { createLocomotion } from "./black_cat_v3_motion.mjs";
import { repairSkin } from "./black_cat_v3_skin.mjs";
import { packGlbResources } from "../lib/pack-glb-resources.mjs";
const args = process.argv.slice(2),
  get = (key, fallback) => {
    const i = args.indexOf(key);
    return i < 0 ? fallback : args[i + 1];
  };
if (args.includes("--help")) {
  console.log(
    "node tools/blender/build_black_cat_v3.mjs --source SOURCE.glb --donor PINNED.glb --output DIRECTORY --simplifier PATH",
  );
  process.exit(0);
}
const source = get("--source"),
  donorFile = get("--donor"),
  out = get("--output", "output/black-cat-v3/build");
const simplifierFile = get("--simplifier");
if (!source || !donorFile || !simplifierFile)
  throw Error(
    "Explicit source, immutable donor and meshoptimizer 1.3.0 simplifier required",
  );
const simplifierPackage = JSON.parse(
  fs.readFileSync(
    path.join(path.dirname(path.resolve(simplifierFile)), "package.json"),
  ),
);
if (
  simplifierPackage.name !== "meshoptimizer" ||
  simplifierPackage.version !== "1.3.0"
)
  throw Error("The reviewed LOD build requires meshoptimizer 1.3.0");
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const sourceSha =
    "59c10fb0582b5dd90d3e281a73ad4b522ef33213506b315470b1382f6d521c4b",
  donorSha = "37c23b7cc3042c8d3aa23f03ca1484ac8f65e07f5ed9b92c0c4214ee1439695b";
const asset = readGlb(source);
if (
  sha(asset.raw) !== sourceSha ||
  sha(fs.readFileSync(donorFile)) !== donorSha
)
  throw Error("Unexpected source/donor");
const doc = asset.doc;
let bin = asset.bin;
const donor = await loadGLB(donorFile),
  originalPrimitive = structuredClone(doc.meshes[0].primitives[0]);
const widths = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 },
  sizes = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 },
  methods = {
    5121: "readUInt8",
    5123: "readUInt16LE",
    5125: "readUInt32LE",
    5126: "readFloatLE",
  };
function read(index) {
  const a = doc.accessors[index],
    v = doc.bufferViews[a.bufferView],
    w = widths[a.type],
    s = sizes[a.componentType],
    stride = v.byteStride ?? w * s;
  return Array.from({ length: a.count * w }, (_, i) =>
    bin[methods[a.componentType]](
      (v.byteOffset ?? 0) +
        (a.byteOffset ?? 0) +
        Math.floor(i / w) * stride +
        (i % w) * s,
    ),
  );
}
function append(values, type, componentType = 5126, target) {
  const pad = (4 - (bin.length % 4)) % 4;
  bin = Buffer.concat([bin, Buffer.alloc(pad)]);
  const C = {
      5121: Uint8Array,
      5123: Uint16Array,
      5125: Uint32Array,
      5126: Float32Array,
    }[componentType],
    bytes = Buffer.from(new C(values).buffer),
    view =
      doc.bufferViews.push({
        buffer: 0,
        byteOffset: bin.length,
        byteLength: bytes.length,
        ...(target ? { target } : {}),
      }) - 1;
  bin = Buffer.concat([bin, bytes]);
  const a = {
    bufferView: view,
    componentType,
    count: values.length / widths[type],
    type,
  };
  if (type === "VEC3" || type === "SCALAR") {
    const w = widths[type];
    a.min = Array(w).fill(Infinity);
    a.max = Array(w).fill(-Infinity);
    for (let i = 0; i < values.length; i++) {
      a.min[i % w] = Math.min(a.min[i % w], values[i]);
      a.max[i % w] = Math.max(a.max[i % w], values[i]);
    }
  }
  return doc.accessors.push(a) - 1;
}
const arrays = Object.fromEntries(
    Object.entries(originalPrimitive.attributes).map(([k, v]) => [k, read(v)]),
  ),
  indices = read(originalPrimitive.indices),
  pos = arrays.POSITION;
const originalNodes = structuredClone(doc.nodes),
  byName = new Map(doc.nodes.map((n, i) => [n.name, i])),
  parents = new Map();
doc.nodes.forEach((n, i) =>
  (n.children ?? []).forEach((c) => parents.set(c, i)),
);
const v3 = (a) => new Vector3().fromArray(a),
  q4 = (a) => new Quaternion().fromArray(a),
  qWorld = (m) =>
    new Quaternion().setFromRotationMatrix(new Matrix4().extractRotation(m));
function local(n) {
  return n.matrix
    ? new Matrix4().fromArray(n.matrix)
    : new Matrix4().compose(
        v3(n.translation ?? [0, 0, 0]),
        q4(n.rotation ?? [0, 0, 0, 1]),
        v3(n.scale ?? [1, 1, 1]),
      );
}
function worldStates(states) {
  const result = [];
  function w(i) {
    if (result[i]) return result[i];
    const m = local(states[i]),
      p = parents.get(i);
    return (result[i] = p === undefined ? m : w(p).clone().multiply(m));
  }
  states.forEach((_, i) => w(i));
  return result;
}
const rest = worldStates(originalNodes),
  restQ = rest.map(qWorld),
  donorRest = donor.pose({ channels: [] }, 0),
  donorNodes = new Map(donor.doc.nodes.map((n, i) => [n.name, i]));
const jointNodes = doc.skins[0].joints,
  jointByNode = new Map(jointNodes.map((n, i) => [n, i])),
  jointByName = (n) => jointByNode.get(byName.get(n)),
  root = byName.get("Bone_000"),
  rootJoint = jointByNode.get(root),
  inverse = read(doc.skins[0].inverseBindMatrices)
    .reduce((a, v, i) => {
      (a[Math.floor(i / 16)] ??= []).push(v);
      return a;
    }, [])
    .map((v) => new Matrix4().fromArray(v));
const regions = JSON.parse(
  fs.readFileSync(new URL("./black_cat_v3_regions.json", import.meta.url)),
);
if (regions.sourceSha256 !== sourceSha) throw Error("Wrong regions");
const gearSet = new Set(regions.equipmentFaceIndices),
  bodyFaces = [],
  gearFaces = [];
for (let i = 0; i < indices.length; i += 3)
  (gearSet.has(i / 3) ? gearFaces : bodyFaces).push(...indices.slice(i, i + 3));
// Retain native shafts and solve only source-surface attachment weights.
const skin = repairSkin({
  arrays,
  indices,
  rigidFaceIndices: regions.rigidEquipmentFaceIndices,
  jointNodes,
  nodes: doc.nodes,
  rootJoint,
});
const bodyArrays = args.includes("--native-skin-audit") ? arrays : skin.arrays,
  gearArrays = bodyArrays;
const patched = bodyArrays.WEIGHTS_0.reduce(
  (n, w, i) => n + (Math.abs(w - arrays.WEIGHTS_0[i]) > 1e-7 ? 1 : 0),
  0,
);
console.log("skin", skin.report);
function meshFrom(name, attrs, faces, extras = {}) {
  const ordered = [...new Set(faces)],
    remap = new Map(ordered.map((v, i) => [v, i])),
    attributes = {};
  for (const [k, values] of Object.entries(attrs)) {
    const type =
        k === "POSITION" || k === "NORMAL"
          ? "VEC3"
          : k === "TEXCOORD_0"
            ? "VEC2"
            : "VEC4",
      w = widths[type];
    attributes[k] = append(
      ordered.flatMap((i) => values.slice(i * w, i * w + w)),
      type,
      k === "JOINTS_0" ? 5123 : 5126,
      34962,
    );
  }
  const mi =
    doc.meshes.push({
      name,
      primitives: [
        {
          attributes,
          indices: append(
            faces.map((v) => remap.get(v)),
            "SCALAR",
            5125,
            34963,
          ),
          material: 0,
        },
      ],
    }) - 1;
  const ni = doc.nodes.push({ name, mesh: mi, skin: 0, extras }) - 1;
  doc.nodes[byName.get("SmartRigArmature")].children.push(ni);
  parents.set(ni, byName.get("SmartRigArmature"));
  return ni;
}
// Remove only original mesh node routing; its every triangle is retained exactly once in the two partitions.
delete doc.nodes[byName.get("Mesh_0")].mesh;
delete doc.nodes[byName.get("Mesh_0")].skin;
const body = meshFrom("cat_body_lod0", bodyArrays, bodyFaces),
  gear = meshFrom("cat_saddle_leather", gearArrays, gearFaces);
const mapping = {},
  bn = (i) => "Bone_" + String(i).padStart(3, "0"),
  map = (ns, d) => ns.forEach((n) => (mapping[bn(n)] = d));
map([0, 1, 2, 3, 4, 23, 24, 25, 26], "cat_torso");
map([27, 28], "cat_chest");
map([29, 30, 41, 42, 44], "cat_neck");
map([43, 45, 46, 47, 48, 49, 50, 51, 52], "cat_head");
const chains = {
  front_l: [35, 34, 33, 32, 31],
  front_r: [40, 39, 38, 37, 36],
  rear_l: [14, 13, 12, 11, 10],
  rear_r: [9, 8, 7, 6, 5],
};
for (const [side, ns] of Object.entries(chains))
  ns.forEach((n, i) =>
    map(
      [n],
      "cat_" +
        side.split("_")[0] +
        "_" +
        (side.startsWith("front")
          ? ["upper", "lower", "lower", "paw", "paw"]
          : ["upper", "lower", "ankle", "paw", "paw"])[i] +
        "_" +
        side.at(-1),
    ),
  );
[22, 21, 20, 19, 18, 17, 16, 15].forEach((n, i) =>
  map([n], "cat_tail_" + Math.min(4, Math.floor((i * 5) / 8))),
);
const orderedJoints = [];
const visit = (i) => {
  if (jointByNode.has(i)) orderedJoints.push(i);
  for (const c of originalNodes[i].children ?? []) visit(c);
};
visit(byName.get("SmartRigArmature"));
function setWorldRotation(states, worlds, i, q) {
  const p = parents.get(i),
    pq = p === undefined ? new Quaternion() : qWorld(worlds[p]);
  states[i].rotation = pq.invert().multiply(q).normalize().toArray();
  const m = local(states[i]);
  worlds[i] = p === undefined ? m : worlds[p].clone().multiply(m);
}
function updateWorlds(states) {
  return worldStates(states);
}
function skinVertices(worlds, attrs = bodyArrays, subset = null) {
  const matrices = jointNodes.map((n, i) =>
      worlds[n].clone().multiply(inverse[i]),
    ),
    result = [];
  const ids = subset ?? Array.from({ length: pos.length / 3 }, (_, i) => i);
  for (const i of ids) {
    const point = v3(attrs.POSITION.slice(i * 3, i * 3 + 3)),
      sum = new Vector3();
    for (let k = 0; k < 4; k++) {
      const w = attrs.WEIGHTS_0[i * 4 + k];
      if (w)
        sum.addScaledVector(
          point.clone().applyMatrix4(matrices[attrs.JOINTS_0[i * 4 + k]]),
          w,
        );
    }
    result.push(sum);
  }
  return result;
}
const pawVertices = Object.fromEntries(
  Object.entries(chains).map(([name, ns]) => {
    const js = new Set(ns.slice(2).map((n) => jointByName(bn(n))));
    return [
      name,
      Array.from({ length: pos.length / 3 }, (_, i) => i).filter(
        (i) =>
          pos[i * 3 + 1] < 0.2 &&
          arrays.JOINTS_0.slice(i * 4, i * 4 + 4).reduce(
            (sum, j, k) => sum + (js.has(j) ? arrays.WEIGHTS_0[i * 4 + k] : 0),
            0,
          ) > 0.5,
      ),
    ];
  }),
);
const seatGame = [0, 1.266, 0.12];
for (const [name, point] of [
  ["socket_saddle_seat", seatGame],
  ["socket_camera", [0, 1.566, 0.12]],
]) {
  const p = v3(point).applyMatrix4(rest[root].clone().invert());
  const node = doc.nodes.push({ name, translation: p.toArray() }) - 1;
  doc.nodes[root].children.push(node);
  parents.set(node, root);
}
const clips = [],
  clipReports = {};
doc.animations = [];
for (const clip of donor.doc.animations) {
  const duration = Math.max(
      ...clip.samplers.map((s) => donor.data(s.input).values.at(-1)),
    ),
    frames = Math.round(duration * 60),
    times = Array.from(
      { length: frames + 1 },
      (_, f) => (duration * f) / frames,
    ),
    samples = [];
  let maxGround = 0;
  const locomotion = createLocomotion({
    donor,
    clip,
    duration,
    frames,
    rest,
    byName,
    chains,
    sourcePositions: pos,
  });
  for (let f = 0; f <= frames; f++) {
    const dp = donor.pose(clip, times[f]),
      states = originalNodes.map((n) => structuredClone(n)),
      worlds = rest.map((m) => m.clone());
    const dt = donorNodes.get("cat_torso"),
      deltaP = new Vector3()
        .setFromMatrixPosition(dp.worlds[dt])
        .sub(new Vector3().setFromMatrixPosition(donorRest.worlds[dt]));
    states[root].translation = v3(originalNodes[root].translation)
      .addScaledVector(deltaP, 0.78)
      .toArray();
    for (const i of orderedJoints) {
      const name = originalNodes[i].name,
        d = donorNodes.get(mapping[name]);
      if (d === undefined) continue;
      const chainName = Object.keys(chains).find((k) =>
        chains[k].some((n) => bn(n) === name),
      );
      const legPose =
        locomotion && chainName
          ? donor.pose(
              clip,
              locomotion.legs[chainName].samples[f][2] * duration,
            )
          : dp;
      const donorDelta = qWorld(legPose.worlds[d]).multiply(
        qWorld(donorRest.worlds[d]).invert(),
      );
      let q = donorDelta.multiply(restQ[i].clone());
      if (
        /cat_(front|rear)_/.test(mapping[name]) &&
        !mapping[name].includes("_paw_") &&
        clip.name !== "death"
      ) {
        const dir = new Vector3(0, 1, 0)
            .applyQuaternion(qWorld(legPose.worlds[d]))
            .normalize(),
          base = new Vector3(0, 1, 0).applyQuaternion(restQ[i]);
        const lateral = base.x,
          planar = Math.hypot(dir.y, dir.z);
        if (planar > 0.001) {
          dir.set(
            lateral,
            (dir.y / planar) * Math.sqrt(1 - lateral * lateral),
            (dir.z / planar) * Math.sqrt(1 - lateral * lateral),
          );
          q = new Quaternion()
            .setFromUnitVectors(base, dir)
            .multiply(restQ[i].clone());
        }
      }
      setWorldRotation(states, worlds, i, q);
    }
    let ws = updateWorlds(states);
    // The shared donor phase adapter narrows stance to stride/speed while retaining
    // support order. IK uses the new rig's own lengths; no runtime retarget remains.
    if (locomotion)
      for (const [name, ns] of Object.entries(chains)) {
        const motion = locomotion.legs[name].samples[f],
          eff = byName.get(bn(ns[3])),
          hip = byName.get(bn(ns[0])),
          kind = name.split("_")[0],
          hipPoint = new Vector3().setFromMatrixPosition(ws[hip]);
        const target = new Vector3(
          hipPoint.x + (rest[eff].elements[12] - rest[hip].elements[12]),
          rest[eff].elements[13] + motion[1] * locomotion.lift,
          hipPoint.z + locomotion.restOffset[kind] - motion[0],
        );
        const distal = ns
          .slice(3)
          .map((n) => [byName.get(bn(n)), qWorld(ws[byName.get(bn(n))])]);
        const aim = (i, direction) => {
          const base = new Vector3(0, 1, 0).applyQuaternion(restQ[i]);
          const q = new Quaternion()
            .setFromUnitVectors(base, direction.clone().normalize())
            .multiply(restQ[i].clone());
          setWorldRotation(states, ws, i, q);
          ws = updateWorlds(states);
        };
        const twoLink = (origin, goal, l1, l2, bendSign) => {
          const delta = goal.clone().sub(origin),
            distance = Math.min(
              l1 + l2 - 0.00001,
              Math.max(Math.abs(l1 - l2) + 0.00001, delta.length()),
            ),
            axis = delta.normalize();
          const along =
              (l1 * l1 - l2 * l2 + distance * distance) / (2 * distance),
            height = Math.sqrt(Math.max(0, l1 * l1 - along * along));
          const bend = new Vector3(0, 0, bendSign).addScaledVector(
            axis,
            -bendSign * axis.z,
          );
          if (bend.lengthSq() < 1e-8) bend.set(0, -1, 0);
          bend.normalize();
          return origin
            .clone()
            .addScaledVector(axis, along)
            .addScaledVector(bend, height);
        };
        const solve = () => {
          const ids = ns.map((n) => byName.get(bn(n))),
            origin = new Vector3().setFromMatrixPosition(ws[ids[0]]),
            rp = ids.map((i) => new Vector3().setFromMatrixPosition(rest[i]));
          if (kind === "front") {
            const elbow = twoLink(
              origin,
              target,
              rp[0].distanceTo(rp[1]),
              rp[1].distanceTo(rp[2]) + rp[2].distanceTo(rp[3]),
              -1,
            );
            aim(ids[0], elbow.clone().sub(origin));
            const lower = target.clone().sub(elbow);
            aim(ids[1], lower);
            aim(ids[2], lower);
          } else {
            const ankleDirection = new Vector3(0, 1, 0)
              .applyQuaternion(qWorld(ws[ids[2]]))
              .normalize();
            const hock = target
              .clone()
              .addScaledVector(ankleDirection, -rp[2].distanceTo(rp[3]));
            const knee = twoLink(
              origin,
              hock,
              rp[0].distanceTo(rp[1]),
              rp[1].distanceTo(rp[2]),
              1,
            );
            aim(ids[0], knee.clone().sub(origin));
            aim(ids[1], hock.clone().sub(knee));
            aim(ids[2], ankleDirection);
          }
          for (const [i, q] of distal) {
            setWorldRotation(states, ws, i, q);
            ws = updateWorlds(states);
          }
        };
        solve();
        if (motion[3])
          for (let pass = 0; pass < 3; pass++) {
            const low = Math.min(
              ...skinVertices(ws, bodyArrays, pawVertices[name]).map(
                (p) => p.y,
              ),
            );
            target.y += 0.003 - low;
            solve();
          }
      }
    const supports =
      clip.name === "death"
        ? null
        : [...new Set(Object.values(pawVertices).flat())];
    let min = Math.min(
      ...skinVertices(ws, bodyArrays, supports).map((v) => v.y),
    );
    const lift = Math.max(0, 0.002 - min);
    states[root].translation[1] += lift;
    maxGround = Math.max(maxGround, lift);
    samples.push(states);
  }
  const animation = { name: clip.name, samplers: [], channels: [] },
    input = append(times, "SCALAR");
  for (const i of orderedJoints) {
    const values = [];
    let previous = null;
    for (const sample of samples) {
      let q = q4(sample[i].rotation ?? [0, 0, 0, 1]).normalize();
      if (previous && q.dot(previous) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      values.push(...q.toArray());
      previous = q;
    }
    const output = append(values, "VEC4"),
      sampler =
        animation.samplers.push({ input, output, interpolation: "LINEAR" }) - 1;
    animation.channels.push({ sampler, target: { node: i, path: "rotation" } });
  }
  const output = append(
      samples.flatMap((s) => s[root].translation),
      "VEC3",
    ),
    sampler =
      animation.samplers.push({ input, output, interpolation: "LINEAR" }) - 1;
  animation.channels.push({
    sampler,
    target: { node: root, path: "translation" },
  });
  doc.animations.push(animation);
  clips.push({ name: clip.name, duration });
  clipReports[clip.name] = {
    samples: frames + 1,
    maxGroundLift: maxGround,
    ...(locomotion ? { trajectory: locomotion.report } : {}),
  };
  console.log(clip.name, clipReports[clip.name]);
}

const counts = [
  {
    body: bodyFaces.length / 3,
    equipment: gearFaces.length / 3,
  },
];
if (simplifierFile) {
  const { MeshoptSimplifier } = await import(
    pathToFileURL(path.resolve(simplifierFile))
  );
  await MeshoptSimplifier.ready;
  for (let level = 1; level < 3; level++) {
    const result = {};
    for (const [kind, attrs, faces, ratio, name, extras] of [
      [
        "body",
        bodyArrays,
        bodyFaces,
        level === 1 ? 0.46 : 0.13,
        "cat_body_lod" + level,
        {},
      ],
      [
        "equipment",
        gearArrays,
        gearFaces,
        level === 1 ? 0.46 : 0.13,
        "cat_equipment_lod" + level,
        {},
      ],
    ]) {
      const target = Math.floor((faces.length * ratio) / 3) * 3;
      const vertexCount = attrs.POSITION.length / 3,
        attributeStride = 5,
        attributes = new Float32Array(vertexCount * 5);
      for (let i = 0; i < vertexCount; i++)
        attributes.set(
          [
            ...attrs.TEXCOORD_0.slice(i * 2, i * 2 + 2),
            ...attrs.NORMAL.slice(i * 3, i * 3 + 3),
          ],
          i * 5,
        );
      const lock = new Uint8Array(vertexCount);
      const [simplified, error] = MeshoptSimplifier.simplifyWithAttributes(
        Uint32Array.from(faces),
        Float32Array.from(attrs.POSITION),
        3,
        attributes,
        attributeStride,
        [2, 2, 0.3, 0.3, 0.3],
        lock,
        target,
        level === 1 ? 0.018 : 0.05,
        ["Permissive", "PreserveFolds"],
      );
      meshFrom(name, attrs, Array.from(simplified), extras);
      result[kind] = simplified.length / 3;
      result[kind + "Error"] = error;
    }
    counts.push(result);
  }
}
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(
  path.join(out, "source-transform.json"),
  JSON.stringify({ sourceToAsset: new Matrix4().toArray() }, null, 2) + "\n",
);
bin = packGlbResources(doc, bin);
const uncompressed = encodeGlb(doc, bin);
fs.writeFileSync(path.join(out, "black-cat-roundtrip.glb"), uncompressed);
// Meshopt is lossless: no quantization, vertex welding, texture resampling, or LOD0 simplification.
await MeshoptEncoder.ready;
const images = new Set(doc.images.map((i) => i.bufferView)),
  chunks = [];
let offset = 0,
  fallback = 0;
for (let i = 0; i < doc.bufferViews.length; i++) {
  const view = doc.bufferViews[i],
    bytes = bin.subarray(
      view.byteOffset ?? 0,
      (view.byteOffset ?? 0) + view.byteLength,
    ),
    pad = (4 - (offset % 4)) % 4;
  if (pad) {
    chunks.push(Buffer.alloc(pad));
    offset += pad;
  }
  if (images.has(i)) {
    view.byteOffset = offset;
    chunks.push(bytes);
    offset += bytes.length;
    continue;
  }
  const a = doc.accessors.find((a) => a.bufferView === i),
    stride = view.byteStride ?? widths[a.type] * sizes[a.componentType],
    mode = view.target === 34963 ? "TRIANGLES" : "ATTRIBUTES",
    compressed = Buffer.from(
      MeshoptEncoder.encodeGltfBuffer(
        bytes,
        bytes.length / stride,
        stride,
        mode,
      ),
    );
  view.buffer = 1;
  view.byteOffset = fallback;
  view.extensions = {
    EXT_meshopt_compression: {
      buffer: 0,
      byteOffset: offset,
      byteLength: compressed.length,
      byteStride: stride,
      count: bytes.length / stride,
      mode,
    },
  };
  chunks.push(compressed);
  offset += compressed.length;
  fallback += bytes.length;
}
doc.buffers = [{ byteLength: offset }, { byteLength: fallback }];
doc.extensionsUsed = ["EXT_meshopt_compression"];
doc.extensionsRequired = ["EXT_meshopt_compression"];
const packed = encodeGlb(doc, Buffer.concat(chunks));
fs.writeFileSync(path.join(out, "black-cat.glb"), packed);
const report = {
  sourceSha256: sourceSha,
  donorSha256: donorSha,
  sha256: sha(packed),
  bytes: packed.length,
  bones: jointNodes.length,
  sourceTriangles: indices.length / 3,
  lods: counts,
  mapping,
  clips,
  clipReports,
  seatGame,
  patchedSkinInfluences: patched,
  skin: skin.report,
  sourceToAsset: new Matrix4().toArray(),
  validation: {
    structural: "pending independent validator",
    visual: "candidate, pending review",
    gameplay: "pending",
    performance: "pending",
  },
};
fs.writeFileSync(
  path.join(out, "build-report.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(report);
