/** Decode reviewed mount packages for Blender and merge only baked animation data.
 * Geometry/material/image bytes stay immutable; corgi wrist/hock rest edits
 * must match the reviewed canonical correction and preserve the bind shape.
 * Only reviewed cat paw/lumbar and corgi limb weights may replace skin attributes.
 * Run from repository root: node tools/blender/animal_glb.mjs prepare|merge [animal]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
export const BASELINE_COMMIT = "e44a5240c1668e767fdee4964ab9507e9f53adf7";
import { MeshoptDecoder } from "meshoptimizer";
import { applyCatSkin } from "./cat_skin.mjs";
import { applyCorgiSkin } from "./corgi_skin.mjs";
import { applyCorgiRig } from "./corgi_rig.mjs";
async function canonicalSource(before, animal) {
  return animal === "corgi" && before.doc.nodes.some(n => n.name === "corgi_rig")
    ? applyCorgiRig(before) : before;
}
const skinCorrectionFor = (animal) =>
  animal === "black-cat" ? applyCatSkin : applyCorgiSkin;
import { loadGLB } from "./glb_pose.mjs";
const out = path.resolve(
  process.env.SAGABURST_ANIMATION_STAGE ?? "output/mount-retarget",
);
const names = {
  "black-cat": {
    file: "black-cat.glb",
    sha: "09a6b9a6d3d62522abb9e0bf341a303b1a9443bf909411fcc9052d0a55e01c7d",
  },
  corgi: {
    file: "corgi.glb",
    sha: "67472e0b01af163bd30d89bd1087d799a6527154b7883de4f58fb0957798df4e",
  },
};
export const sha = (bytes) =>
  crypto.createHash("sha256").update(bytes).digest("hex");
export function readGlb(file) {
  const raw = Buffer.isBuffer(file) ? file : fs.readFileSync(file);
  assert.equal(raw.toString("ascii", 0, 4), "glTF");
  const length = raw.readUInt32LE(12);
  return {
    raw,
    doc: JSON.parse(raw.toString("utf8", 20, 20 + length)),
    bin: raw.subarray(28 + length),
  };
}
export function encodeGlb(doc, bytes) {
  const s = Buffer.from(JSON.stringify(doc));
  const json = Buffer.concat([s, Buffer.alloc((4 - (s.length % 4)) % 4, 32)]);
  const bin = Buffer.concat([
    bytes,
    Buffer.alloc((4 - (bytes.length % 4)) % 4),
  ]);
  const h = Buffer.alloc(20),
    b = Buffer.alloc(8);
  h.write("glTF");
  h.writeUInt32LE(2, 4);
  h.writeUInt32LE(28 + json.length + bin.length, 8);
  h.writeUInt32LE(json.length, 12);
  h.write("JSON", 16);
  b.writeUInt32LE(bin.length);
  b.write("BIN\0", 4);
  return Buffer.concat([h, json, b, bin]);
}
export async function decodeGlb(asset) {
  await MeshoptDecoder.ready;
  const d = structuredClone(asset.doc);
  const chunks = [asset.bin];
  let offset = asset.bin.length;
  for (const view of d.bufferViews) {
    const e = view.extensions?.EXT_meshopt_compression;
    if (!e) continue;
    const padding = (4 - (offset % 4)) % 4;
    if (padding) {
      chunks.push(Buffer.alloc(padding));
      offset += padding;
    }
    const bytes = Buffer.alloc(e.count * e.byteStride);
    MeshoptDecoder.decodeGltfBuffer(
      bytes,
      e.count,
      e.byteStride,
      asset.bin.subarray(e.byteOffset ?? 0, (e.byteOffset ?? 0) + e.byteLength),
      e.mode,
      e.filter,
    );
    view.buffer = 0;
    view.byteOffset = offset;
    view.byteLength = bytes.length;
    chunks.push(bytes);
    offset += bytes.length;
    delete view.extensions.EXT_meshopt_compression;
    if (!Object.keys(view.extensions).length) delete view.extensions;
  }
  d.buffers = [{ byteLength: offset }];
  for (const key of ["extensionsUsed", "extensionsRequired"])
    if (d[key]) {
      d[key] = d[key].filter((x) => x !== "EXT_meshopt_compression");
      if (!d[key].length) delete d[key];
    }
  return { doc: d, bin: Buffer.concat(chunks) };
}
function viewBytes(a, i) {
  const v = a.doc.bufferViews[i];
  assert.equal(v.buffer, 0);
  return a.bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength);
}
export async function preserveReport(before, after, animal) {
  const approved = await canonicalSource(before, animal);
  assert.deepEqual(
    after.doc.buffers.map(({ byteLength, ...binding }, i) =>
      i === 0 ? binding : { ...binding, byteLength },
    ),
    before.doc.buffers.map(({ byteLength, ...binding }, i) =>
      i === 0 ? binding : { ...binding, byteLength },
    ),
    "Changed immutable buffer binding",
  );
  assert.ok(
    after.doc.buffers[0].byteLength >= before.doc.buffers[0].byteLength &&
      after.doc.buffers[0].byteLength <= after.bin.length &&
      after.bin.length - after.doc.buffers[0].byteLength < 4,
    "Invalid merged buffer length",
  );
  const keys = [
    "nodes",
    "skins",
    "materials",
    "textures",
    "images",
    "samplers",
    "scenes",
    "scene",
    "extensionsUsed",
    "extensionsRequired",
  ];
  for (const key of keys)
    assert.deepEqual(
      after.doc[key],
      approved.doc[key],
      `Changed immutable ${key}`,
    );
  const allowedSkinMeshes = new Set(
    before.doc.nodes
      .filter(
        (n) =>
          n.skin === 0 &&
          (animal === "black-cat" || /^corgi_body_lod[012]$/.test(n.name)),
      )
      .map((n) => n.mesh),
  );
  const meshes = (doc) =>
    doc.meshes.map((mesh, i) => ({
      ...mesh,
      primitives: mesh.primitives.map((p) => {
        const attributes = { ...p.attributes };
        if (allowedSkinMeshes.has(i)) {
          delete attributes.JOINTS_0;
          delete attributes.WEIGHTS_0;
        }
        return { ...p, attributes };
      }),
    }));
  assert.deepEqual(
    meshes(after.doc),
    meshes(before.doc),
    "Changed immutable mesh geometry/material",
  );
  for (const key of ["accessors", "bufferViews"]) {
    assert.deepEqual(
      after.doc[key].slice(0, approved.doc[key].length),
      approved.doc[key],
      `Changed original ${key} metadata`,
    );
  }
  assert.equal(
    sha(after.bin.subarray(0, approved.bin.length)),
    sha(approved.bin),
    "Original mesh/skin/image/animation byte prefix changed",
  );
  let skinCorrection = null;
  if (
    animal === "black-cat" ||
    (animal === "corgi" && allowedSkinMeshes.size > 0)
  ) {
    const patch = await skinCorrectionFor(animal)(before, before);
    const actual = await loadGLB(after.raw);
    for (const [name, expected] of patch.expected) {
      const node = after.doc.nodes.find((n) => n.name === name);
      const attrs = after.doc.meshes[node.mesh].primitives[0].attributes;
      for (const [key, values] of [
        ["JOINTS_0", expected.ids],
        ["WEIGHTS_0", expected.weights],
      ]) {
        const accessor = after.doc.accessors[attrs[key]];
        assert.equal(
          accessor.type,
          "VEC4",
          `Invalid skin layout ${name}/${key}`,
        );
        assert.equal(
          accessor.count,
          expected.count,
          `Invalid skin count ${name}/${key}`,
        );
        if (key === "JOINTS_0") {
          assert.ok(
            [5121, 5123].includes(accessor.componentType) &&
              !accessor.normalized,
            `Invalid joint component type ${name}`,
          );
        } else {
          assert.ok(
            accessor.componentType === 5126 ||
              ([5121, 5123].includes(accessor.componentType) &&
                accessor.normalized === true),
            `Invalid weight component type ${name}`,
          );
        }
        const a = actual.data(attrs[key]).values;
        assert.equal(a.length, values.length);
        for (let i = 0; i < a.length; i++)
          assert.ok(
            key === "JOINTS_0"
              ? a[i] === values[i]
              : Math.abs(a[i] - values[i]) < 1e-6,
            `Unreviewed skin change ${name}/${key}/${i}`,
          );
      }
    }
    skinCorrection = patch.report;
  }
  return {
    nodesExact: !approved.report,
    reviewedRigCorrection: approved.report ?? null,
    geometryExact: true,
    skinsExact: !approved.report,
    materialsExact: true,
    imagesExact: true,
    originalBinaryPrefixExact: true,
    skinCorrection,
    baselineSha256: sha(before.raw),
    sha256: sha(after.raw),
  };
}

export function validatePlaybackEvidence(
  animationSource,
  finalSha,
  root = process.cwd(),
) {
  const validation = animationSource.validation;
  assert.equal(
    validation?.roundtripMcpPlayback,
    true,
    "Validate final GLB playback before promotion",
  );
  assert.equal(
    validation.sha256,
    finalSha,
    "Playback evidence belongs to another GLB",
  );
  assert.ok(validation.evidence?.length > 0, "Missing playback evidence");
  const output = fs.realpathSync(path.resolve(root, "output")) + path.sep;
  for (const evidence of validation.evidence) {
    const file = fs.realpathSync(path.resolve(root, evidence.path));
    assert.ok(
      file.startsWith(output),
      "Playback evidence must be a local output artifact",
    );
    assert.equal(
      sha(fs.readFileSync(file)),
      evidence.sha256,
      "Playback evidence has changed",
    );
  }
}

function importAnimation(base, baked, animation, chunks, state) {
  const samplers = [];
  const channels = [];
  const cache = new Map();
  function copy(index) {
    if (cache.has(index)) return cache.get(index);
    const a = baked.doc.accessors[index];
    assert.ok(!a.sparse, "Sparse animation unsupported");
    const padding = (4 - (state.offset % 4)) % 4;
    if (padding) {
      chunks.push(Buffer.alloc(padding));
      state.offset += padding;
    }
    const bytes = viewBytes(baked, a.bufferView);
    const v = structuredClone(baked.doc.bufferViews[a.bufferView]);
    assert.ok(!v.extensions, "Bake must be uncompressed");
    v.buffer = 0;
    v.byteOffset = state.offset;
    chunks.push(bytes);
    state.offset += bytes.length;
    const viewIndex = base.bufferViews.length;
    base.bufferViews.push(v);
    const accessor = structuredClone(a);
    accessor.bufferView = viewIndex;
    const accessorIndex = base.accessors.length;
    base.accessors.push(accessor);
    cache.set(index, accessorIndex);
    return accessorIndex;
  }
  for (const c of animation.channels) {
    const name = baked.doc.nodes[c.target.node].name;
    const node = base.nodes.findIndex((n) => n.name === name);
    assert.ok(node >= 0, `Donor or unknown node exported: ${name}`);
    assert.ok(
      base.skins[0].joints.includes(node),
      `Only target bone animation may be merged: ${name}`,
    );
    const s = animation.samplers[c.sampler];
    channels.push({
      sampler: samplers.length,
      target: { node, path: c.target.path },
    });
    samplers.push({ ...s, input: copy(s.input), output: copy(s.output) });
  }
  return { name: animation.name, channels, samplers };
}
function audit(asset) {
  const d = asset.doc;
  return {
    file: null,
    byteLength: asset.raw.length,
    asset: d.asset,
    counts: {
      scenes: d.scenes.length,
      nodes: d.nodes.length,
      meshes: d.meshes.length,
      primitives: d.meshes.reduce((s, m) => s + m.primitives.length, 0),
      triangles: d.meshes.reduce(
        (s, m) =>
          s +
          m.primitives.reduce(
            (n, p) => n + d.accessors[p.indices].count / 3,
            0,
          ),
        0,
      ),
      materials: d.materials.length,
      textures: d.textures.length,
      images: d.images.length,
      skins: d.skins.length,
      joints: d.skins[0].joints.length,
      animations: d.animations.length,
    },
    jointNames: d.skins[0].joints.map((i) => d.nodes[i].name),
    animationNames: d.animations.map((a) => a.name),
    extensionsUsed: d.extensionsUsed,
    extensionsRequired: d.extensionsRequired,
  };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [command, animal] = process.argv.slice(2);
  const animals = animal ? [animal] : Object.keys(names);
  fs.mkdirSync(out, { recursive: true });
  for (const id of animals) {
    assert.ok(names[id], `Unknown animal ${id}`);
    const { file, sha: expected } = names[id];
    const directory = path.resolve("public/models/mounts/v2", id);
    const current = path.join(directory, file),
      baseline = path.join(out, `${id}-baseline.glb`);
    if (command === "prepare") {
      const source = process.env.SAGABURST_ANIMATION_BASELINE_DIR;
      const raw = source
        ? fs.readFileSync(path.join(source, id, file))
        : execFileSync(
            "rtk",
            [
              "proxy",
              "git",
              "show",
              `${BASELINE_COMMIT}:public/models/mounts/v2/${id}/${file}`,
            ],
            { maxBuffer: 32 * 1024 * 1024 },
          );
      const a = readGlb(raw);
      assert.equal(
        sha(a.raw),
        expected,
        "Baseline changed; explicitly update baseline rather than importing a prior bake",
      );
      fs.writeFileSync(baseline, a.raw);
      if (id === "corgi") {
        const legacy = await decodeGlb(a);
        fs.writeFileSync(
          path.join(out, "corgi-legacy-input.glb"),
          encodeGlb(legacy.doc, legacy.bin),
        );
      }
      const approved = await canonicalSource(a, id);
      const input = await skinCorrectionFor(id)(approved, a);
      if (input.patch)
        fs.writeFileSync(
          path.join(out, `${id}-canonical-skin-patch.json`),
          JSON.stringify(input.patch),
        );
      const decoded = await decodeGlb(input);
      fs.writeFileSync(
        path.join(out, `${id}-input.glb`),
        encodeGlb(decoded.doc, decoded.bin),
      );
      console.log(
        JSON.stringify({
          animal: id,
          baselineSha256: sha(a.raw),
          decodedBytes: decoded.bin.length,
        }),
      );
    } else if (command === "merge") {
      const before = readGlb(baseline);
      assert.equal(sha(before.raw), expected);
      const baked = readGlb(path.join(out, `${id}-baked.glb`));
      const approved = await canonicalSource(before, id);
      const d = structuredClone(approved.doc),
        chunks = [approved.bin],
        state = { offset: approved.bin.length };
      assert.equal(
        new Set(d.nodes.map((n) => n.name)).size,
        d.nodes.length,
        "Target node names must be unique",
      );
      assert.equal(
        new Set(baked.doc.nodes.map((n) => n.name)).size,
        baked.doc.nodes.length,
        "Baked node names must be unique",
      );
      const parents = (doc) =>
        new Map(
          doc.nodes.flatMap((n, i) =>
            (n.children ?? []).map((c) => [c, n.name]),
          ),
        );
      const originalParents = parents(d),
        bakedParents = parents(baked.doc);
      let maximumRestError = 0;
      for (const joint of d.skins[0].joints) {
        const n = d.nodes[joint],
          index = baked.doc.nodes.findIndex((b) => b.name === n.name);
        assert.ok(index >= 0, `Missing target joint ${n.name}`);
        const b = baked.doc.nodes[index];
        assert.equal(
          bakedParents.get(index),
          originalParents.get(joint),
          `Changed bone parent ${n.name}`,
        );
        for (const [key, defaultValue] of [
          ["translation", [0, 0, 0]],
          ["scale", [1, 1, 1]],
        ]) {
          const x = n[key] ?? defaultValue,
            y = b[key] ?? defaultValue;
          const error = Math.max(...x.map((v, i) => Math.abs(v - y[i])));
          maximumRestError = Math.max(maximumRestError, error);
          assert.ok(
            error < 1e-4,
            `Changed ${key} rest basis ${n.name}: ${error}`,
          );
        }
        const q = n.rotation ?? [0, 0, 0, 1],
          r = b.rotation ?? [0, 0, 0, 1];
        const dot = Math.abs(q.reduce((sum, v, i) => sum + v * r[i], 0));
        assert.ok(
          1 - dot < 1e-5,
          `Changed rotation rest basis ${n.name}: ${1 - dot}`,
        );
      }
      const required = id === "corgi"
        ? ["idle", "walk", "run", "death", "jump", "land", "hit"]
        : ["idle", "walk", "run", "death"];
      for (const animation of baked.doc.animations) {
        assert.ok(
          animation.channels.length > 12,
          "Clip must animate the target representation",
        );
        const pairs = animation.channels.map(
          (c) => baked.doc.nodes[c.target.node].name + "." + c.target.path,
        );
        assert.equal(
          new Set(pairs).size,
          pairs.length,
          "Duplicate channel target",
        );
        for (const c of animation.channels)
          assert.ok(
            ["rotation", "translation", "scale"].includes(c.target.path),
          );
      }
      assert.deepEqual(
        baked.doc.animations.map((a) => a.name).sort(),
        required.sort(),
      );
      d.animations = [
        "idle",
        "walk",
        "run",
        "death",
        "jump",
        "land",
        "hit",
      ].map((name) => {
        const a = baked.doc.animations.find((a) => a.name === name);
        return a
          ? importAnimation(d, baked, a, chunks, state)
          : before.doc.animations.find((a) => a.name === name);
      });
      assert.ok(d.animations.every(Boolean));
      d.buffers[0].byteLength = state.offset;
      let bytes = encodeGlb(d, Buffer.concat(chunks));
      {
        const patched = await skinCorrectionFor(id)(readGlb(bytes), before);
        bytes = encodeGlb(patched.doc, patched.bin);
      }
      const staged = path.join(out, `${id}-final.glb`);
      fs.writeFileSync(staged, bytes);
      const final = readGlb(staged);
      const report = await preserveReport(before, final, id);
      report.maximumRestTranslationOrScaleError = maximumRestError;
      report.restBasisChecked = true;
      report.animationClips = final.doc.animations.map((a) => ({
        name: a.name,
        channels: a.channels.length,
        duration: Math.max(
          ...a.samplers.map((s) => final.doc.accessors[s.input].max[0]),
        ),
      }));
      fs.writeFileSync(
        path.join(out, `${id}-preservation.json`),
        JSON.stringify(report, null, 2) + "\n",
      );
      const decoded = await decodeGlb(final);
      fs.writeFileSync(
        path.join(out, `${id}-roundtrip.glb`),
        encodeGlb(decoded.doc, decoded.bin),
      );
      console.log(JSON.stringify(report));
    } else if (command === "promote") {
      const final = readGlb(path.join(out, `${id}-final.glb`));
      const before = readGlb(baseline);
      assert.equal(
        sha(before.raw),
        expected,
        "Promotion baseline differs from the pinned source",
      );
      const report = await preserveReport(before, final, id);
      const animationSource = JSON.parse(
        fs.readFileSync(path.join(out, `${id}-animation-source.json`), "utf8"),
      );
      validatePlaybackEvidence(animationSource, sha(final.raw));
      const manifestFile = path.join(directory, "manifest.json");
      const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
      manifest.clips = final.doc.animations.map((a) => a.name);
      manifest.modifications = manifest.modifications.filter(
        (x) => !x.includes("in-place animations") && !x.startsWith("Donor-retargeted"),
      );
      manifest.modifications.push(
        id === "corgi"
          ? "Donor-retargeted and target-baked idle/walk/run, authored death, jump/land/hit adapted to corrected wrist/hock basis"
          : "Donor-retargeted and target-baked idle/walk/run, authored death, retained jump/land/hit",
      );
      manifest.metrics.packageBytes = final.raw.length;
      manifest.sha256 = sha(final.raw);
      manifest.animationSource = "animation-source.json";
      const a = audit(final);
      a.file = file;
      a.preservation = report;
      const manifestJson = JSON.stringify(manifest, null, 2) + "\n";
      const auditJson = JSON.stringify(a, null, 2) + "\n";
      const sourceJson = JSON.stringify(animationSource, null, 2) + "\n";
      fs.writeFileSync(current, final.raw);
      fs.writeFileSync(manifestFile, manifestJson);
      fs.writeFileSync(path.join(directory, "audit.json"), auditJson);
      fs.writeFileSync(
        path.join(directory, "animation-source.json"),
        sourceJson,
      );
      console.log(
        JSON.stringify({
          promoted: current,
          clips: manifest.clips,
          sha256: manifest.sha256,
        }),
      );
    } else throw new Error("Use prepare, merge, or promote");
  }
}
