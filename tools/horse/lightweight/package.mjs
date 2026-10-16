import { work, manifestPath } from "./config.mjs";
import fs from "node:fs";
import crypto from "node:crypto";
import { MeshoptEncoder } from "meshoptimizer";
import { readGlb, encodeGlb } from "../../blender/animal_glb.mjs";
import { packGlbResources } from "../../lib/pack-glb-resources.mjs";
import { measureHorse } from "./measure.mjs";
const a = readGlb(work + "/tacked.glb"),
  d = a.doc,
  out = work + "/package";
const measured = await measureHorse(a);
d.images = ["source-0", "source-1", "paint_01", "source-3", "source-4"].map(
  (name) => ({ name, mimeType: "image/ktx2", uri: `textures/${name}.ktx2` }),
);
a.bin = packGlbResources(d, a.bin);
for (const t of d.textures) {
  t.extensions = { KHR_texture_basisu: { source: t.source } };
  delete t.source;
}
d.extensionsUsed = ["EXT_meshopt_compression", "KHR_texture_basisu"];
d.extensionsRequired = [...d.extensionsUsed];
await MeshoptEncoder.ready;
const chunks = [];
let offset = 0,
  fallback = 0;
for (const v of d.bufferViews) {
  const bytes = a.bin.subarray(
      v.byteOffset ?? 0,
      (v.byteOffset ?? 0) + v.byteLength,
    ),
    stride = v.byteStride ?? (v.target === 34963 ? 4 : 4),
    count = bytes.length / stride,
    mode = v.target === 34963 ? "TRIANGLES" : "ATTRIBUTES";
  const compressed = MeshoptEncoder.encodeGltfBuffer(
      bytes,
      count,
      stride,
      mode,
    ),
    pad = (4 - (offset % 4)) % 4;
  if (pad) {
    chunks.push(Buffer.alloc(pad));
    offset += pad;
  }
  v.buffer = 1;
  v.byteOffset = fallback;
  v.extensions = {
    EXT_meshopt_compression: {
      buffer: 0,
      byteOffset: offset,
      byteLength: compressed.length,
      byteStride: stride,
      count,
      mode,
    },
  };
  chunks.push(compressed);
  offset += compressed.length;
  fallback += v.byteLength;
}
d.buffers = [{ byteLength: offset }, { byteLength: fallback }];
const bytes = encodeGlb(d, Buffer.concat(chunks));
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(out + "/horse_runtime.glb", bytes);
const manifest = JSON.parse(fs.readFileSync(manifestPath));
manifest.gaitReferenceSpeeds = {
  walk: 2.7622,
  trot: 2.1741,
  canter: 3.7392,
  gallop: 12.1285,
};
manifest.revision = "lightweight-source-horse";
manifest.sources = [
  {
    author: "MAXDESIGN-3D",
    url: "https://sketchfab.com/3d-models/horse-d9af6902210645d995e37ba4319957b6",
    license: "CC BY 4.0",
    sha256: "1af80d4517beb4c79781b15e50285ebbdf7a4fd3a8f8d08f3c1d54f1e1b60712",
  },
  ...manifest.sources,
];
manifest.attribution =
  "Horse by MAXDESIGN-3D (CC BY 4.0); supplemental animations and saddle derived from fdoss001 / Tarnyloo (CC0 / CC BY 3.0), with Quaternius (CC0) motion reference.";
manifest.sharedBodyMaps = {
  normal: "textures/source-4.ktx2",
  roughness: "textures/source-3.ktx2",
  ao: "textures/source-3.ktx2",
};
manifest.variants = ["paint_01", "paint_02", "paint_03"].map((id, i) => ({
  id,
  label: ["Original grey", "Bay tint", "Dark tint"][i],
  baseColor: `textures/${id}.ktx2`,
}));
manifest.sharedElements = [
  "source mane",
  "source tail",
  "fitted existing saddle",
];
delete manifest.eyePatch;
delete manifest.reports;
manifest.metrics = measured;
manifest.sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
fs.cpSync("public/models/mounts/v1/horse/basis", out + "/basis", {
  recursive: true,
});
fs.copyFileSync(new URL("./CREDITS.md", import.meta.url), out + "/CREDITS.md");
const payloadBytes = (directory) =>
  fs.readdirSync(directory, { withFileTypes: true }).reduce((sum, entry) => {
    const p = directory + "/" + entry.name;
    return (
      sum +
      (entry.isDirectory()
        ? payloadBytes(p)
        : entry.name === "manifest.json"
          ? 0
          : fs.statSync(p).size)
    );
  }, 0);
const payload = payloadBytes(out);
for (let i = 0; i < 4; i++)
  manifest.metrics.packageBytes =
    payload + Buffer.byteLength(JSON.stringify(manifest, null, 2) + "\n");
fs.writeFileSync(
  out + "/manifest.json",
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log({
  glbBytes: bytes.length,
  packageBytes: manifest.metrics.packageBytes,
  sha256: manifest.sha256,
});
