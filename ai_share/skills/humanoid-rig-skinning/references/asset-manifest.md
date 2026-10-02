# Asset Manifest Contract

Create one `manifest.json` per ordinary faction or distinct asset ID. The example below covers provenance and geometry; a playable asset must also satisfy the current `HumanoidAssetManifest` and binding validation in `src/world/HumanoidAssetRegistry.ts`. Use its descriptor and existing manifest as the contract, not this example alone:

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


For animated assets, preserve `animations.embedded` bindings (clip, source, sourceClip, loop, duration and applicable events) and `runtimeGenerated` states. Equipment metadata such as `handGripFrames`, `swordGripFrames`, `handShapeMode`, `bakedEquipmentActions` and `bowFullBodyStance` is asset-specific: retain existing ownership, and add fields only when the asset implements that contract. Never copy Maki's baked-contact flags to unrelated characters.
