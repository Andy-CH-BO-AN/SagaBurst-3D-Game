# Asset Manifest Contract

Create one `manifest.json` per faction with this minimum shape:

```json
{
  "schemaVersion": 1,
  "id": "viking-tier2-v2",
  "status": "ready",
  "source": {
    "title": "Asset title",
    "author": "Author",
    "url": "https://…",
    "license": "CC-BY-4.0",
    "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
    "downloadedAt": "ISO-8601",
    "sourceSha256": "hex"
  },
  "attribution": "Required credit line",
  "modifications": ["Retopology", "Rig retarget", "Texture rebake"],
  "metrics": {
    "heightM": 1.86,
    "shoulderWidthM": 0.54,
    "neckLengthM": 0.09,
    "triangles": { "lod0": 60000, "lod1": 20000, "lod2": 6000 },
    "textures": { "lod0": 2048, "lod1": 1024, "lod2": 512 }
  },
  "files": { "lod0": "lod0.glb", "lod1": "lod1.glb", "lod2": "lod2.glb" },
  "skeleton": "project-humanoid-v1",
  "boneMap": "bone-map.json",
  "audit": "audit.json"
}
```

Use `status: "blocked"` when the source file or license evidence is missing. Runtime code must only load `status: "ready"`; never infer readiness from the presence of a GLB alone.

Record third-party texture, scan, and photo credits separately if the source author used them. Keep download receipts or page snapshots outside the shipped runtime bundle when they contain account data.

