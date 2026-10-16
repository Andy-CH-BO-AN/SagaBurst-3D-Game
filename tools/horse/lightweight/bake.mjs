import { work, donorPath } from "./config.mjs";
import fs from "node:fs";
import * as T from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "meshoptimizer";
import { readGlb, encodeGlb } from "../../blender/animal_glb.mjs";
globalThis.ProgressEvent = class {
  constructor(type, p) {
    Object.assign(this, { type }, p);
  }
};
const source = readGlb(work + "/corrected.glb");
async function load(a) {
  const d = structuredClone(a.doc);
  d.materials = [{}];
  d.meshes.forEach((m) => m.primitives.forEach((p) => (p.material = 0)));
  delete d.textures;
  delete d.images;
  d.extensionsRequired = (d.extensionsRequired ?? []).filter(
    (x) => x === "EXT_meshopt_compression",
  );
  const b = encodeGlb(d, a.bin);
  return new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.length), "");
}
const target = await load(source),
  donor = await load(readGlb(donorPath));
const normalizer = new T.Group();
normalizer.scale.setScalar(0.0073);
normalizer.rotation.y = -Math.PI / 2;
normalizer.position.y = 0.0361;
normalizer.add(target.scene);
const mix = new T.AnimationMixer(target.scene),
  take = mix.clipAction(target.animations[0]);
take.setLoop(T.LoopOnce, 1);
take.clampWhenFinished = true;
take.play();
const dmix = new T.AnimationMixer(donor.scene);
const srcNodes = source.doc.nodes.map((n) =>
  target.scene.getObjectByName(T.PropertyBinding.sanitizeNodeName(n.name)),
);
const snap = () =>
  srcNodes.map((o) => ({
    p: o.position.clone(),
    q: o.quaternion.clone(),
    s: o.scale.clone(),
  }));
const restore = (states) => {
  srcNodes.forEach((o, i) => {
    o.position.copy(states[i].p);
    o.quaternion.copy(states[i].q);
    o.scale.copy(states[i].s);
  });
  normalizer.updateMatrixWorld(true);
};
const native = (f) => {
  mix.setTime(f / 30);
  normalizer.updateMatrixWorld(true);
};
native(23);
const neutral = snap();
const donorRest = {};
donor.scene.updateMatrixWorld(true);
donor.scene.traverse((o) => {
  if (o.isBone)
    donorRest[o.name] = {
      q: o.getWorldQuaternion(new T.Quaternion()),
      p: o.getWorldPosition(new T.Vector3()),
    };
});
const map = {
  horse_01: "DEF-spine005",
  horse_031: "DEF-spine001",
  horse_032: "DEF-spine001",
  horse_02: "DEF-neck001",
  horse_03: "DEF-neck003",
  horse_04: "DEF-head",
  horse_043: "DEF-tail001",
  horse_044: "DEF-tail002",
  horse_045: "DEF-tail003",
  horse_046: "DEF-tail004",
  horse_047: "DEF-tail005",
  horse_048: "DEF-tail005",
};
for (const [base, suffix] of [
  [17, "L"],
  [22, "R"],
])
  for (const [i, role] of [
    "upper_arm",
    "forearm",
    "forefoot",
    "f_toe",
    "f_hoof",
  ].entries())
    map["horse_0" + (base + i)] = "DEF-" + role + suffix;
for (const [base, suffix] of [
  [33, "R"],
  [38, "L"],
])
  for (const [i, role] of [
    "thigh",
    "lower_leg",
    "hind_foot",
    "r_toe",
    "r_hoof",
  ].entries())
    map["horse_0" + (base + i)] = "DEF-" + role + suffix;
const targetRest = {};
normalizer.updateMatrixWorld(true);
for (const n of Object.keys(map)) {
  const o = target.scene.getObjectByName(n);
  targetRest[n] = {
    p: o.getWorldPosition(new T.Vector3()),
    q: o.getWorldQuaternion(new T.Quaternion()),
  };
}
const topological = [];
target.scene.traverse((o) => {
  if (map[o.name]) topological.push(o);
});

const ikAudit = [];
const chains = [
  [17, "L", "front"],
  [22, "R", "front"],
  [33, "R", "rear"],
  [38, "L", "rear"],
].map(([base, side, end]) => {
  const bones = Array.from({ length: 4 }, (_, i) =>
      target.scene.getObjectByName("horse_0" + (base + i)),
    ),
    refs = bones.map((o) => targetRest[o.name].p.clone());
  const donorNames =
    end === "front"
      ? ["upper_arm", "forearm", "forefoot", "f_toe"]
      : ["thigh", "lower_leg", "hind_foot", "r_toe"];
  return {
    bones,
    refs,
    lengths: refs.slice(1).map((p, i) => p.distanceTo(refs[i])),
    donorNodes: donorNames.map((n) =>
      donor.scene.getObjectByName("DEF-" + n + side),
    ),
  };
});
function fitFeet() {
  for (const c of chains) {
    const anchor = c.bones[0].getWorldPosition(new T.Vector3());
    const donorEnd = c.donorNodes.at(-1),
      goal = c.refs
        .at(-1)
        .clone()
        .add(
          donorEnd
            .getWorldPosition(new T.Vector3())
            .sub(donorRest[donorEnd.name].p)
            .multiplyScalar(0.65),
        );
    const points = [anchor.clone()];
    for (let i = 1; i < 4; i++)
      points.push(
        points[i - 1].clone().add(
          c.donorNodes[i]
            .getWorldPosition(new T.Vector3())
            .sub(c.donorNodes[i - 1].getWorldPosition(new T.Vector3()))
            .normalize()
            .multiplyScalar(c.lengths[i - 1]),
        ),
      );
    // All four legs retain their own lateral plane. Adapt the donor's hoof path to
    // the target segment lengths with FABRIK instead of copying local rotations.
    for (let k = 0; k < 24; k++) {
      points[3].copy(goal);
      for (let i = 2; i >= 0; i--)
        points[i].copy(
          points[i + 1].clone().add(
            points[i]
              .clone()
              .sub(points[i + 1])
              .normalize()
              .multiplyScalar(c.lengths[i]),
          ),
        );
      points[0].copy(anchor);
      for (let i = 1; i < 4; i++)
        points[i].copy(
          points[i - 1].clone().add(
            points[i]
              .clone()
              .sub(points[i - 1])
              .normalize()
              .multiplyScalar(c.lengths[i - 1]),
          ),
        );
    }
    ikAudit.push({
      root: c.bones[0].name,
      goal: goal.toArray(),
      reached: points[3].toArray(),
      error: goal.distanceTo(points[3]),
    });
    for (let i = 0; i < 3; i++) {
      const bone = c.bones[i],
        next = c.bones[i + 1],
        current = next
          .getWorldPosition(new T.Vector3())
          .sub(bone.getWorldPosition(new T.Vector3()))
          .normalize(),
        desired = points[i + 1].clone().sub(points[i]).normalize();
      const world = new T.Quaternion()
        .setFromUnitVectors(current, desired)
        .multiply(bone.getWorldQuaternion(new T.Quaternion()));
      bone.quaternion.copy(
        bone.parent
          .getWorldQuaternion(new T.Quaternion())
          .invert()
          .multiply(world),
      );
      bone.updateMatrixWorld(true);
    }
    const bone = c.bones[3],
      donorNode = c.donorNodes[3],
      world = donorNode
        .getWorldQuaternion(new T.Quaternion())
        .multiply(donorRest[donorNode.name].q.clone().invert())
        .multiply(targetRest[bone.name].q);
    bone.quaternion.copy(
      bone.parent
        .getWorldQuaternion(new T.Quaternion())
        .invert()
        .multiply(world),
    );
    bone.updateMatrixWorld(true);
  }
}
let chunks = [source.bin],
  offset = source.bin.length;
const d = source.doc;
function append(values, width) {
  const pad = (4 - (offset % 4)) % 4;
  if (pad) {
    chunks.push(Buffer.alloc(pad));
    offset += pad;
  }
  const b = Buffer.from(new Float32Array(values).buffer),
    view = d.bufferViews.length;
  d.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: b.length });
  chunks.push(b);
  offset += b.length;
  const index = d.accessors.length;
  d.accessors.push({
    bufferView: view,
    componentType: 5126,
    count: values.length / width,
    type: { 1: "SCALAR", 3: "VEC3", 4: "VEC4" }[width],
    ...(width === 1
      ? { min: [Math.min(...values)], max: [Math.max(...values)] }
      : {}),
  });
  return index;
}
const clips = [];
const report = [];
function bake(name, duration, evaluate, loop = false) {
  const count = Math.round(duration * 60),
    times = Array.from({ length: count + 1 }, (_, i) => (i * duration) / count),
    samples = [];
  for (const t of times) {
    evaluate(t);
    normalizer.updateMatrixWorld(true);
    const mesh = target.scene.getObjectByName("Object_80");
    mesh.skeleton.update();
    let min = Infinity;
    const v = new T.Vector3();
    for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
      mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld);
      min = Math.min(min, v.y);
    }
    const correction = (name === "walk" ? -min : Math.max(0, -min)) / 0.0073;
    srcNodes[0].position.y += correction;
    samples.push(snap());
    srcNodes[0].position.y -= correction;
  }
  if (loop) {
    for (let k = 0; k < samples[0].length; k++) {
      const first = samples[0][k],
        last = samples.at(-1)[k];
      for (let i = 0; i < samples.length; i++) {
        const u = i / (samples.length - 1);
        samples[i][k].p.addScaledVector(first.p.clone().sub(last.p), u);
        const fix = last.q.clone().invert().multiply(first.q);
        samples[i][k].q.multiply(new T.Quaternion().slerp(fix, u)).normalize();
      }
    }
  }
  const anim = { name, samplers: [], channels: [] },
    input = append(times, 1);
  for (let node = 0; node < srcNodes.length; node++)
    for (const [key, path, width] of [
      ["p", "translation", 3],
      ["q", "rotation", 4],
      ["s", "scale", 3],
    ]) {
      if (!srcNodes[node]) continue;
      const values = [];
      let prev = null;
      for (const sample of samples) {
        const v = sample[node][key].clone();
        if (key === "q" && prev && prev.dot(v) < 0)
          v.set(-v.x, -v.y, -v.z, -v.w);
        prev = v;
        values.push(...v.toArray());
      }
      const initial = neutral[node][key].toArray();
      if (
        values.every(
          (v, i) =>
            Math.abs(v - initial[i % width]) < (key === "p" ? 0.001 : 0.00001),
        )
      )
        continue;
      anim.channels.push({
        sampler: anim.samplers.length,
        target: { node, path },
      });
      anim.samplers.push({
        input,
        output: append(values, width),
        interpolation: "LINEAR",
      });
    }
  clips.push(anim);
  report.push({ name, duration, channels: anim.channels.length });
}
for (const [name, start, end, loop] of [
  ["idle", 23, 123, true],
  ["walk", 0, 22, true],
  ["gallop", 186, 203, true],
  ["death", 124, 185, false],
])
  bake(name, (end - start) / 30, (t) => native(start + t * 30), loop);
for (const name of ["trot", "canter", "jump", "land", "hit"]) {
  dmix.stopAllAction();
  const clip = donor.animations.find((c) => c.name === name),
    action = dmix.clipAction(clip);
  action.setLoop(T.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  bake(
    name,
    clip.duration,
    (t) => {
      restore(neutral);
      dmix.setTime(t);
      donor.scene.updateMatrixWorld(true);
      for (const o of topological) {
        const dn = map[o.name],
          dr = donorRest[dn],
          src = donor.scene.getObjectByName(dn),
          tr = targetRest[o.name];
        const delta = src
            .getWorldQuaternion(new T.Quaternion())
            .multiply(dr.q.clone().invert()),
          world = delta.multiply(tr.q);
        o.quaternion.copy(
          o.parent
            .getWorldQuaternion(new T.Quaternion())
            .invert()
            .multiply(world),
        );
        if (["horse_01", "horse_031"].includes(o.name)) {
          const displacement = src.getWorldPosition(new T.Vector3()).sub(dr.p);
          displacement.x = 0;
          displacement.z = 0;
          o.position.copy(
            o.parent.worldToLocal(tr.p.clone().add(displacement)),
          );
        }
        o.updateMatrixWorld(true);
      }
      fitFeet();
    },
    ["trot", "canter"].includes(name),
  );
}
restore(neutral);
for (let i = 0; i < d.nodes.length; i++) {
  if (!srcNodes[i]) continue;
  delete d.nodes[i].matrix;
  d.nodes[i].translation = neutral[i].p.toArray();
  d.nodes[i].rotation = neutral[i].q.toArray();
  d.nodes[i].scale = neutral[i].s.toArray();
}
const ni = d.nodes.length;
d.nodes.push({
  name: "horse_normalization",
  children: d.scenes[d.scene ?? 0].nodes,
  translation: normalizer.position.toArray(),
  rotation: normalizer.quaternion.toArray(),
  scale: normalizer.scale.toArray(),
});
d.scenes[d.scene ?? 0].nodes = [ni];
d.animations = clips;
d.buffers = [{ byteLength: offset }];
fs.writeFileSync(work + "/baked.glb", encodeGlb(d, Buffer.concat(chunks)));
fs.writeFileSync(
  work + "/bake-report.json",
  JSON.stringify({ mapping: map, clips: report }, null, 2),
);
fs.writeFileSync(work + "/ik-audit.json", JSON.stringify(ikAudit));
console.log(report);
