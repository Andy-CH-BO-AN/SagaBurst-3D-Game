# Shared Paladin T4 equipment

All three supplied models declare [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) in their embedded GLB asset.extras. Exact credits, source filenames and SHA-256 hashes are retained in sources.json.

- **Sword**: [Paladin](https://sketchfab.com/3d-models/paladin-4f1c320f2cec49dc9bf38c6aad2d8ea9) by [DJMaesen](https://sketchfab.com/bumstrum). Extracted the original `bastardsword_weapons_0`, not the short sword or either scabbard. Rotated/scaled to the existing right-hand grip; resized original textures to 1024 pixels and JPEG quality 88.
- **Mace**: [Paladin Mace — Free Download](https://sketchfab.com/3d-models/paladin-mace-free-download-a25cbe5724aa493bb16ec352f4e6fd6a) by [Efarys](https://sketchfab.com/Efarys). Preserved all five source meshes, normalized orientation and length to 1.25 m; resized original textures to 512 pixels and JPEG quality 88.
- **Shield**: [Paladin Shield — Free Download](https://sketchfab.com/3d-models/paladin-shield-free-download-0ae0f62030ad48d88364b327b7cd3fc3) by [Efarys](https://sketchfab.com/Efarys). Preserved the two principal front/back surface meshes; removed the three original strap/grip parts; normalized shield height to 1.10 m. Original textures resized to 1024 pixels and JPEG quality 88. The game adds its existing central capsule grip with two attachment brackets; these are SagaBurst geometry, not a substitute shield face.

Build with tools/build-paladin.py. Geometry/material/texture objects are shared by runtime instances. No source downloads are shipped.
