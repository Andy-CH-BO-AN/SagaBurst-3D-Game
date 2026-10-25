# T5 melee weapons

## Current lance replacement

`lance.glb` now uses the user-supplied textured Meshy file
`Meshy_AI_A_legendary_Tier_5_Co_1025132049_texture.glb`.
Source SHA-256: `64e9a5aac4142f5a51f424f57c405f8c0de9b56ff3c37c7ee8779e05d6d19a8d`.
The source contains no license declaration; the previous lance credit below
does not license this replacement. Rebuild using Python 3 + NumPy:
`python3 tools/build-meshy-weapons.py /path/to/downloads`.

The original 87,284 triangles, one mesh/material, and all three embedded JPEG
maps (base colour, metallic/roughness, normal) are retained byte for byte.
No decimation, texture resizing, or per-frame processing is added.
Uniform scale is `0.433557939`; rotation Z is `-1.132609553` radians;
translation is `(-0.615273859, 0.747846413, 0.000395144)`.
Final length is 3.1 m, Y extent `[-0.5, 2.6]`; main/support grips stay
`(0, 0.15, 0)` / `(0, 0.33, 0)`. The tip coincides with the existing
`(0, 2.6, 0)` reference. Exact matrix, bounds and hashes are in `sources.json`.
The existing cached `spear_t5` loader and attachment/animation/hit paths are unchanged.

## Historical three-weapon import

The lance rows and verification evidence below describe the superseded
Lowpoly Cartoon Spear/Pike. Current lance provenance is above and in
`sources.json`; the other weapons are not rebuilt by this replacement.


These are normalized derivatives of the three supplied models, not procedural
replacements. Credits and license declarations below come from each original
GLB's `asset.extras`; that exact metadata is also retained in the final GLB.
[`sources.json`](sources.json) records original filenames, source and final
SHA-256 hashes, mesh/material/texture counts, and every image's dimensions and
encoded byte size. Original downloads are not shipped.

## Credits and licenses

- **`sword.glb`**: [Paladin Longsword [Free Download]](https://sketchfab.com/3d-models/paladin-longsword-free-download-7baa85e6e5d74526b2dd461d15f2b4ea)
  by [Efarys](https://sketchfab.com/Efarys),
  [Creative Commons Attribution-ShareAlike 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
  This modified sword asset remains under **CC BY-SA 4.0**, including its
  textures. Changes: offline orientation/grip/scale normalization and texture
  resizing/re-encoding. All four meshes, all 3,544 triangles, UVs, normals,
  tangents, and the original geometry/accessor bytes are preserved.
- **`axe.glb`**: [Decorative Double-Bladed Battle Axe](https://sketchfab.com/3d-models/decorative-double-bladed-battle-axe-f0bfbca7a2804efd9cf77fd0f5a806aa)
  by [Arms Museum](https://sketchfab.com/ArmsMuseum),
  [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/).
  Changes: offline orientation/grip/scale normalization, Blender collapse
  reduction at ratio 0.53, and texture resizing/re-encoding. The three source
  meshes and both materials remain; 10,258 triangles become 5,433 (47.0% fewer).
- **`lance.glb`**: [Lowpoly Cartoon Spear/Pike](https://sketchfab.com/3d-models/lowpoly-cartoon-spearpike-89a9d4bc332542e9b05d47f9dec3606c)
  by [OwenKenney](https://sketchfab.com/OwenKenney),
  [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/).
  Changes: offline orientation/grip/scale normalization only. All three meshes,
  all 1,780 indexed triangles, geometry/accessor bytes, and all three untextured
  materials are preserved. The source's authored transverse scale is retained.

## Source versus final

| Asset | Triangles | Meshes / materials / textures | Image resolution | GLB bytes |
| --- | ---: | --- | --- | ---: |
| Sword source | 3,544 | 4 / 4 / 12 | 12 × 1024² | 9,262,824 |
| Sword final | 3,544 | 4 / 4 / 12 | 12 × 512² | 1,744,648 |
| Axe source | 10,258 | 3 / 2 / 6 | 6 × 1024² | 6,619,420 |
| Axe final | 5,433 | 3 / 2 / 6 | 6 × 512² | 1,321,016 |
| Lance source | 1,780 | 3 / 3 / 0 | None | 94,496 |
| Lance final | 1,780 | 3 / 3 / 0 | None | 94,688 |

One primitive is retained per mesh. Triangle counts are glTF index counts
divided by three, including any source degenerate triangles; no lance topology
cleanup is performed. Normal maps use lossless PNG at 512². Colour and packed
material maps use JPEG quality 90, 4:4:4 at 512². No material or texture role is
removed. Sword file size falls 81.2%; axe falls 80.0%. Texture dimensions halve
on each axis, reducing decoded texel count by 75% for both textured assets.

## Attachment-space contract

Every exported asset has its shaft/blade toward local **+Y**, broad blade face
in **XY**, and the authored main grip mapped to **(0, 0.15, 0)**. All orientation
and scale changes are asset-side; there is no character, wrist, or animation
compensation in this build.

- Sword: source leather-wrap centre `(0.65, 0, 0)`; blade tip **Y = 1.3275**,
  matching the existing Paladin sword reference. Final Y extent is
  approximately `[-0.099773, 1.3275]`.
- Axe: source shaft sample `(70, 6.5761, 51.1448)`; blade/finial tip
  **Y ≈ 1.51**, matching the existing procedural axe reference. Final Y extent
  is approximately `[-0.117419, 1.510002]`; width is `0.388789`, thickness
  `0.050245`. The double-blade span is along **X**, thin axis **Z**. Existing
  runtime weapon carry rotation can be applied around the shared grip.
- Lance: final Y extent **[-0.5, 2.6]**, matching the existing T4 polearm;
  primary grip **Y = 0.15**, support grip **Y = 0.33**. No reduction.

Exact source-to-attachment matrices and authored grip samples are in
`sources.json` and each GLB's `asset.extras.attachmentSpace`.

## Build and offline evidence

From the repository root, with Python 3, Pillow, and Blender 4.3.2:

```sh
python tools/build-t5-melee-weapons.py /path/to/supplied/source-directory
blender -b -t 6 --python tools/render-t5-melee-weapons.py
```

The builder verifies all source hashes, creates normalized full-resolution
reference GLBs under ignored `output/t5-melee-assets/`, performs only the axe
reduction, and writes the shipped GLBs and provenance. A second build with
these inputs produced identical final hashes.

[Front/side/back axe comparison](../../../../docs/assets/t5-axe-comparison.png)
shows normalized source and final asset in the same camera and lighting.
The offline pixel review also covered sword and lance front/side/back views,
plus sword hilt and axe head close-ups. Sword's engraved blade, curved guard,
leather grip and decorated pommel remain visible. Axe crescent edges, central
cut-outs, finial and engraved surfaces remain legible; small surface-shading
differences are expected from reduction and texture resampling.

At 600 × 1200 per view, alpha-mask silhouette intersection-over-union was:

| Asset | Front | Side | Back |
| --- | ---: | ---: | ---: |
| Sword | 100% | 100% | 100% |
| Axe | 99.9757% | 99.9958% | 99.9757% |
| Lance | 100% | 100% | 100% |

Sword and lance geometry-accessor content hashes match their originals.
Lance's before/after rendered RGB pixels are identical. Full temporary renders,
close-ups and numeric reports stay in ignored `output/t5-melee-assets/`.
These are **offline asset checks only**; they do not establish in-game grip,
combat-animation, hit timing, gameplay-camera, or GPU-performance acceptance.
