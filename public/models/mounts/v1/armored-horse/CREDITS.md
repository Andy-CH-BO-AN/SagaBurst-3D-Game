# Armored warhorse

The repository owner generated and supplied the Meshy asset (SHA-256 cd3e443eec8d404c4cc4b1b8f800ade5c6679533de1847a78ac1d7a3e4b36ad2) for this feature. Meshy account plan / public asset page were not supplied; no third-party license is asserted. Preserve the applicable generation terms.

All original source surfaces and texture content are retained with a uniform 1.27 scale and -X → +Z rotation. Fused fur/barding contacts are separated, concealed leg collars and seam caps are added, and new collar UVs sample a reviewed fur patch in the original atlas. Original visible LOD0 surface UVs remain intact; simplified LODs bake the original PBR surfaces onto new UV atlases. New skin weights, three LODs and saddle/stirrup/camera sockets were authored for the existing 70-joint horse rig; all nine horse clips are reused unchanged. Textures are resized to 2048 and Basis-compressed.

Rig and animation attribution:

# Lightweight ordinary horse

- Horse geometry, rig, original textures and native timeline: **MAXDESIGN-3D**,
  [Horse](https://sketchfab.com/3d-models/horse-d9af6902210645d995e37ba4319957b6),
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- Supplemental motion and saddle: **fdoss001**,
  [Horse Rigged All Gaits](https://blendswap.com/blend/28627), CC0 declaration;
  retain **Tarnyloo**, [Horse base model](https://blendswap.com/blend/17172),
  [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) attribution for the derivative.
- Supplemental motion reference in the existing donor: **Quaternius**,
  [Ultimate Animated Animals](https://quaternius.com/packs/ultimateanimatedanimals.html), CC0.

Changes: source-specific mirrored body scale/normal/winding repair, uniform scale
and +Z orientation, timeline splitting, rest-space motion retargeting with leg-length
IK, sampled ground clearance, fitted saddle and attachment sockets, two simplified
LODs, two tinted coats, Meshopt and ETC1S KTX2 compression. LOD0 retains all 14,796
source triangles; the refitted, skinned saddle adds 848 triangles. One skin has 70 joints.
LOD totals are 15,644 / 6,173 / 2,327 triangles with three materials.

The original GLB and original `fullanaimated.fbx` both contain one 9.433-second
timeline, not nine independent clips. Native source frame ranges at 30 FPS are
idle 23–123, walk 0–22, gallop 186–203 and death 124–185. Trot, canter, jump, land
and hit are retargeted from the pinned previous runtime. Source looping poses and
motion were inspected before selecting these ranges. The source's repeated walk
and gallop segments are not counted as additional motions.

`manifest.json` records exact hashes, measured bounds, LOD counts and package bytes.
`paint_01` preserves the original grey; `paint_02` and `paint_03` are multiply-tinted
variants. Existing mount, asset and variant IDs remain stable.

Rebuild with `tools/horse/build-lightweight-horse.mjs`; source files remain external.
The pinned source GLB SHA-256 is
`1af80d4517beb4c79781b15e50285ebbdf7a4fd3a8f8d08f3c1d54f1e1b60712`.
The original ZIP SHA-256 is
`5de2403a19e74ce6315befbbaf846f28d00cb91065ae4e08b35b8b5fb9a638f7`.
The donor runtime SHA-256 is
`b7632cf8fe55b40d66d7fa60c4e7f43637eb79ac32c2f9d97bbff26e02c282c5`.
