# Armored Snow Leopard

Model created with Meshy and supplied by the user. The user explicitly stated “我擁有模型並有權提交修改後資產” (they own the model and have the right to submit modified assets). Redistribution of this modified game asset is authorized on that basis. No Meshy subscription plan, public asset URL, or Creative Commons license is inferred.

Formal geometry, texture, skeleton, and initial skin source: `Meshy_AI_Character_output.glb`, SHA-256 `a149122f5ec78ad5573fb5591f4993867bae29b56a75b4979fa4b3592e8d674c`. This source was explicitly selected by the user after the initial raw-FBX attempt. The original download is not redistributed here.

Modifications: native 48-joint rig retained; seven Production BlackCat clips retargeted and baked at 60 Hz; source-specific paw correction, rigid fitted armor controls and continuous connected-surface skin repair; measured saddle/camera sockets; three geometry LODs; resized textures; lossless Meshopt buffer compression. Original source triangles, vertex positions, UVs and custom corner normals are retained before LOD simplification. The repaired skin uses connected source-position domains with continuous collars; coincident UV/normal copies share identical weights. No source faces are split and no backing or lining geometry is added. Native rest matrices remain exact.

Animation donor: current Production BlackCat V2, `public/models/mounts/v2/black-cat/black-cat.glb`, SHA-256 `37c23b7cc3042c8d3aa23f03ca1484ac8f65e07f5ed9b92c0c4214ee1439695b`. Only animation motion is transferred. Donor geometry, weights, and textures are excluded. The donor asset remains unchanged.

Animation attribution inherited from the donor metadata:
- Idle/walk: [Doginx - Assets](https://tomate-salat.itch.io/doginx-assets), Tomate Salat, [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
- Run: [Lowpoly Cat + Run Animation](https://dailylowpoly.itch.io/lowpoly-cat-running), Daily Lowpoly; creator permits commercial project use.
- Death, jump, land, hit: existing SagaBurst authored/accepted animations.
- Historical donor derivation: [Black Cat by 3D Creator](https://sketchfab.com/3d-models/black-cat-dd0adc10d8b94bc99dfffe0268818e0b), CC BY 4.0; no geometry or textures included.

Build: use `tools/blender/snow_leopard_package.mjs prepare OUTPUT`, `blender -b --python-exit-code 1 --python tools/blender/build_snow_leopard.py -- --source-glb SOURCE --donor-decoded OUTPUT/donor.glb --output-directory BUILD`, then the packer’s `pack BUILD DESTINATION`. The source hash is pinned. The LOD simplifier is pinned to meshoptimizer 1.3.0 through `MESHY_SIMPLIFIER_PATH`.

This package is enabled for the runtime loader after independent source-preservation, skin, animation and packed Blender round-trip checks. This is not final art or performance sign-off: flexible belly/chainmail strips still stretch at extreme run poses, and lower LOD armor remains faceted at close range. LOD0 is 17,532 triangles versus the 14,500 target. Browser gameplay, rider/weapon contacts, GPU timing and 200v200 performance were not verified. See `audit.json` for measured improvements and remaining limitations.
