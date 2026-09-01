# Realistic Warhorse v10 Attribution and Runtime Notes

- Horse base mesh: **Tarnyloo**, [Horse base model](https://blendswap.com/blend/17172),
  licensed under **CC BY 3.0**.
- Rig, four source gaits and tack: **fdoss001**,
  [Horse Rigged All Gaits](https://blendswap.com/blend/28627). The BlendSwap page
  declares CC0; this derivative conservatively retains Tarnyloo attribution.
- Supplemental missing-motion reference: **Quaternius**,
  [Ultimate Animated Animals](https://quaternius.com/packs/ultimateanimatedanimals.html),
  **CC0**.

The original `.blend` downloads remain outside the repository. The fdoss001 page's
CC0 declaration is treated as covering the supplied rig, gaits, procedural horse
materials, particle-hair appearance and tack. Source-derived PBR bakes provide the
runtime body maps and three deterministic source body-node-graph coat variants:
warm bay (`paint_01`), dark bay (`paint_02`) and chestnut/buckskin (`paint_03`).
The runtime does not ship Blender particle simulation or hair dynamics; mane and tail
use source-particle guide cards converted to skinned mesh/card geometry.

## Runtime payload

- `horse_runtime.glb` SHA-256:
  `097b3d5e4144749b1e4d9d1aaea3cc72393cbd3366d30926c496b485814cde63`
- Package payload (manifest, GLB, KTX2 textures and Basis transcoder): **6,050,753
  bytes**. It contains one skin with 80 joints, nine clips, and LOD triangle counts
  of 64,986 / 20,279 / 5,916 (LOD0 / LOD1 / LOD2); textures are at most 2048 px.
- Geometry uses `EXT_meshopt_compression`; external ETC1S KTX2 textures use
  `KHR_texture_basisu` with the shipped Basis transcoder.

The v10 package preserves the user-approved source-derived eye appearance and
places `socket_camera` behind the saddle in project-local `-Z`, while project-local
`+Z` remains the horse's gameplay-forward direction.

Static GLB audits passed. Blender 5.2's installed glTF add-on could not freshly import
`KHR_texture_basisu`, so fresh-import inspection in that tool is unavailable; this is
a tooling limitation, not a claim of a Blender visual-import pass.
