# High tier weapons

Both sources were supplied locally by the user (`Downloads/bow.glb`, `Downloads/spear.glb`). Attribution and license below come from the supplied GLBs' `asset.extras`.

| Asset | Creator | Source | License | Source SHA-256 |
| --- | --- | --- | --- | --- |
| Bow | sujirour | https://sketchfab.com/3d-models/bow-ac9202b135f9479796be43735b7d9b24 | CC BY 4.0 | `93e863a4360d1cee0adf2086803448af40f8f907dd8e4857a74cf8fc0ff9783f` |
| Spear | Desmond.Ballantyne | https://sketchfab.com/3d-models/spear-8aa85683b78d461995bd797bcebf0491 | CC BY 4.0 | `1ac01c894a487fb7a1cdf0fdedc6d27e5f0b0058ff6087a59c9fa2762c4fe6e1` |

License: https://creativecommons.org/licenses/by/4.0/

Rebuild with `node tools/build-high-tier-weapons.mjs /path/to/source-directory`.
Original mesh, material, embedded PNG, skin and animation payloads are preserved. Only a scene wrapper normalizes the attachment space.

Spear: 1 mesh/material/texture, 452 triangles, no skin or clips. Raw Y bounds 3.96069–718.03442 source units. Normalize to Y -0.5–2.6 m, grip Y 0.15, tip +Y, matching existing lance attachments and hit endpoint. `spear_t4` is the shared T4 長槍 for foot and mounted troops. The retired `lance_t4` alias and save conversion have been removed.

Bow: 1 skinned mesh/material/texture, 1,874 triangles, 10 joints, one 0.333333 s `Take 001`. Raw scene X span 1.92577 source units; normalize to 1.7 m along +Y, shot -Z. The source take draws and returns; its first half is sampled over normalized gameplay charge 0–1, preserving the 1.8 s weapon charge. Per-instance SkeletonUtils clone and mixer prevent shared animation state. Existing humanoid poses, string, nock, arrow rest and projectile path remain authoritative. Static drops use shared bind-pose geometry.
