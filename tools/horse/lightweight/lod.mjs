import { work } from "./config.mjs";
import fs from "node:fs";
import { MeshoptSimplifier } from "meshoptimizer";
import { readGlb, encodeGlb } from "../../blender/animal_glb.mjs";
const a = readGlb(work + "/baked.glb"),
  d = a.doc;
let chunks = [a.bin],
  offset = a.bin.length;
await MeshoptSimplifier.ready;
function data(i) {
  const ac = d.accessors[i],
    v = d.bufferViews[ac.bufferView],
    width = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[ac.type],
    size = { 5123: 2, 5125: 4, 5126: 4 }[ac.componentType],
    method = {
      5123: "readUInt16LE",
      5125: "readUInt32LE",
      5126: "readFloatLE",
    }[ac.componentType],
    values = [];
  for (let n = 0; n < ac.count; n++)
    for (let k = 0; k < width; k++)
      values.push(
        a.bin[method](
          (v.byteOffset ?? 0) +
            (ac.byteOffset ?? 0) +
            n * (v.byteStride ?? width * size) +
            k * size,
        ),
      );
  return values;
}
function indices(values) {
  const pad = (4 - (offset % 4)) % 4;
  if (pad) {
    chunks.push(Buffer.alloc(pad));
    offset += pad;
  }
  const b = Buffer.from(new Uint32Array(values).buffer),
    vi = d.bufferViews.length;
  d.bufferViews.push({
    buffer: 0,
    byteOffset: offset,
    byteLength: b.length,
    target: 34963,
  });
  chunks.push(b);
  offset += b.length;
  const ai = d.accessors.length;
  d.accessors.push({
    bufferView: vi,
    componentType: 5125,
    count: values.length,
    type: "SCALAR",
    min: [Math.min(...values)],
    max: [Math.max(...values)],
  });
  return ai;
}
// Mane and tail use the same material, skin and identity mesh transform. Merge
// their buffers without changing LOD0 vertices or triangles to share one draw.
const hair = d.meshes[d.nodes[78].mesh].primitives[0];
const tail = d.meshes[d.nodes[82].mesh].primitives[0];
if (hair.material !== tail.material) throw new Error("Groom material mismatch");
const hairVertexCount = d.accessors[hair.attributes.POSITION].count;
const mergedAttributes = {};
for (const semantic of Object.keys(hair.attributes)) {
  const old = d.accessors[hair.attributes[semantic]],
    other = d.accessors[tail.attributes[semantic]];
  if (old.type !== other.type || old.componentType !== other.componentType)
    throw new Error("Groom attribute mismatch");
  const values = [
    ...data(hair.attributes[semantic]),
    ...data(tail.attributes[semantic]),
  ];
  const array =
    old.componentType === 5123
      ? new Uint16Array(values)
      : new Float32Array(values);
  const pad = (4 - (offset % 4)) % 4;
  if (pad) {
    chunks.push(Buffer.alloc(pad));
    offset += pad;
  }
  const bytes = Buffer.from(array.buffer),
    bufferView = d.bufferViews.length;
  d.bufferViews.push({
    buffer: 0,
    byteOffset: offset,
    byteLength: bytes.length,
    target: 34962,
  });
  chunks.push(bytes);
  offset += bytes.length;
  const accessor = {
    ...old,
    bufferView,
    byteOffset: 0,
    count: old.count + other.count,
  };
  delete accessor.min;
  delete accessor.max;
  if (semantic === "POSITION") {
    accessor.min = [0, 1, 2].map((k) =>
      Math.min(...values.filter((_, i) => i % 3 === k)),
    );
    accessor.max = [0, 1, 2].map((k) =>
      Math.max(...values.filter((_, i) => i % 3 === k)),
    );
  }
  mergedAttributes[semantic] = d.accessors.length;
  d.accessors.push(accessor);
}
const mergedIndices = indices([
  ...data(hair.indices),
  ...data(tail.indices).map((i) => i + hairVertexCount),
]);
d.nodes[78].mesh = d.meshes.length;
d.meshes.push({
  name: "horse_groom",
  primitives: [
    { ...hair, attributes: mergedAttributes, indices: mergedIndices },
  ],
});
delete d.nodes[82].mesh;
delete d.nodes[82].skin;
a.bin = Buffer.concat(chunks);
const meshNodes = [78, 80],
  parent = d.nodes[6];
parent.children = parent.children.filter((i) => ![78, 80, 82].includes(i));
const report = [];
for (let lod = 0; lod < 3; lod++) {
  const children = [],
    ratio = [1, 0.36, 0.1][lod];
  let triangles = 0;
  for (const ni of meshNodes) {
    let node = { ...d.nodes[ni] },
      mesh = d.meshes[node.mesh],
      p = mesh.primitives[0];
    if (lod) {
      const oldIndices = new Uint32Array(data(p.indices)),
        positions = new Float32Array(data(p.attributes.POSITION)),
        target = Math.max(3, Math.floor((oldIndices.length * ratio) / 3) * 3),
        [reduced, error] = MeshoptSimplifier.simplify(
          oldIndices,
          positions,
          3,
          target,
          0.1,
        );
      mesh = structuredClone(mesh);
      mesh.primitives[0].indices = indices(reduced);
      node.mesh = d.meshes.length;
      d.meshes.push(mesh);
      p = mesh.primitives[0];
      console.log(lod, node.name, reduced.length / 3, "error", error);
    }
    triangles += d.accessors[p.indices].count / 3;
    node.name =
      ni === 80 ? `horse_body_lod${lod}` : `horse_groom_tail_lod${lod}`;
    if (lod) {
      children.push(d.nodes.length);
      d.nodes.push(node);
    } else {
      d.nodes[ni] = node;
      children.push(ni);
    }
  }
  const group = d.nodes.length;
  d.nodes.push({ name: `horse_lod${lod}`, children });
  parent.children.push(group);
  report.push(triangles);
}
d.buffers = [{ byteLength: offset }];
fs.writeFileSync(work + "/lod.glb", encodeGlb(d, Buffer.concat(chunks)));
console.log("LOD triangles", report);
