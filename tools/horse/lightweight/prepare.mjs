import { work, sourcePath, donorPath } from "./config.mjs";
import fs from "node:fs";
import { readGlb, encodeGlb, decodeGlb } from "../../blender/animal_glb.mjs";
const a = readGlb(sourcePath);
a.bin = Buffer.from(a.bin);
const p = a.doc.meshes[1].primitives[0];
for (const semantic of ["POSITION", "NORMAL"]) {
  const ac = a.doc.accessors[p.attributes[semantic]],
    v = a.doc.bufferViews[ac.bufferView];
  for (let i = 0; i < ac.count; i++)
    for (let k = 0; k < 3; k++) {
      const o =
        (v.byteOffset ?? 0) +
        (ac.byteOffset ?? 0) +
        i * (v.byteStride ?? 12) +
        k * 4;
      a.bin.writeFloatLE(
        a.bin.readFloatLE(o) * (semantic === "POSITION" ? -0.001 : -1),
        o,
      );
    }
  if (ac.min) {
    const min = ac.max.map((x) => x * (semantic === "POSITION" ? -0.001 : -1));
    ac.max = ac.min.map((x) => x * (semantic === "POSITION" ? -0.001 : -1));
    ac.min = min;
  }
}
const ac = a.doc.accessors[p.indices],
  v = a.doc.bufferViews[ac.bufferView],
  read = ac.componentType === 5125 ? "readUInt32LE" : "readUInt16LE",
  write = ac.componentType === 5125 ? "writeUInt32LE" : "writeUInt16LE",
  size = ac.componentType === 5125 ? 4 : 2;
for (let i = 0; i < ac.count; i += 3) {
  const o = (v.byteOffset ?? 0) + (ac.byteOffset ?? 0) + i * size,
    x = a.bin[read](o + size),
    y = a.bin[read](o + size * 2);
  a.bin[write](y, o + size);
  a.bin[write](x, o + size * 2);
}
a.doc.nodes.forEach((n, i) => {
  if (n.name === "horse") n.name = "source_horse_" + i;
});
fs.writeFileSync(work + "/corrected.glb", encodeGlb(a.doc, a.bin));
const old = await decodeGlb(readGlb(donorPath));
old.doc.materials = old.doc.materials.map((m) => ({
  name: m.name,
  pbrMetallicRoughness: {
    baseColorFactor: [0.3, 0.2, 0.1, 1],
    metallicFactor: 0,
    roughnessFactor: 0.8,
  },
}));
delete old.doc.images;
delete old.doc.textures;
old.doc.extensionsUsed = [];
old.doc.extensionsRequired = [];
fs.writeFileSync(work + "/old-donor.glb", encodeGlb(old.doc, old.bin));

fs.mkdirSync(work + "/textures", { recursive: true });
for (const [i, img] of a.doc.images.entries()) {
  const view = a.doc.bufferViews[img.bufferView];
  fs.writeFileSync(
    work +
      "/textures/source-" +
      i +
      (img.mimeType === "image/jpeg" ? ".jpg" : ".png"),
    a.bin.subarray(
      view.byteOffset ?? 0,
      (view.byteOffset ?? 0) + view.byteLength,
    ),
  );
}
