# Shared Paladin T4 equipment

The supplied sword and shield declare [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) in their embedded GLB asset.extras. Exact credits, source filenames and SHA-256 hashes are retained in sources.json.

- **Sword**: [Paladin](https://sketchfab.com/3d-models/paladin-4f1c320f2cec49dc9bf38c6aad2d8ea9) by [DJMaesen](https://sketchfab.com/bumstrum). Extracted the original `bastardsword_weapons_0`, not the short sword or either scabbard. Rotated/scaled to the existing right-hand grip; resized original textures to 1024 pixels and JPEG quality 88.
- **Shield**: [Paladin Shield — Free Download](https://sketchfab.com/3d-models/paladin-shield-free-download-0ae0f62030ad48d88364b327b7cd3fc3) by [Efarys](https://sketchfab.com/Efarys). Preserved the two principal front/back surface meshes; removed the three original strap/grip parts; normalized shield height to 1.10 m. Original textures resized to 1024 pixels and JPEG quality 88. The game adds its existing central capsule grip with two attachment brackets; these are SagaBurst geometry, not a substitute shield face.

- **Axe**: User-supplied Meshy `Meshy_AI_slender_handle_battle_1025140134_texture.glb`. Original 3,150 triangles and all three embedded PBR texture images retained byte-for-byte. Uniformly scaled and rotated into the existing T5 axe attachment space: +Y shaft, XY blade face, grip `(0, 0.15, 0)`, total length 1.60 m. Source and output hashes, bounds and transform are recorded in `axe.json`. No third-party license is inferred.

Build sword/shield with `tools/build-paladin.py`, axe with `python3 tools/build-t4-battle-axe.py /path/to/Meshy_AI_slender_handle_battle_1025140134_texture.glb`. Geometry/material/texture objects are shared by runtime instances. No source downloads are shipped.
