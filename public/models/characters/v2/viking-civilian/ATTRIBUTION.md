# Nordic Warrior

Model generated with **Meshy** and supplied by the user, who confirmed the free Meshy plan. Model licensed under [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/). Meshy policy: https://help.meshy.ai/en/articles/16102098-can-i-use-meshy-assets-commercially

Source: `Meshy_AI_Nordic_Warrior_1016085035_texture.glb`

SHA-256: `d793d2a8aa196d928bd2188ff66502a02eca2328d6024528a856c6787362172d`

Changes: uniform source-envelope normalization; fitted project-humanoid-v1 skeleton and finger chains; anatomical/topological skin weights; measured garment helper bones without cloth physics; localized fused-garment seam separation and source-UV sampled inner lining (exact counts in blender-measurements.json); local original inner-cape tessellation preserving existing position, UV and skin-weight corners; reduced-LOD posterior inner lining derived from matching outer topology and skin weights, sampled from the original inner UVs; three genuine offline LODs; resized embedded texture maps; retargeted existing project animation tracks, fitted contact and grip calibration, and baked cape response. Original source bytes remain preserved outside the runtime bundle.

Animation sources retain their separate terms. See `animation-source-attribution.txt` and `animation-retarget-audit.json`; the model's CC BY license does not replace those terms.

Known visual limitations and review scope are listed in `manifest.json`.

Publication packaging: lossless PNG recompression and byte-exact meshopt buffer packing for publication, preserving all decoded pixels and geometry/skin/animation values. Equality evidence is recorded in `texture-recompression-audit.json` and `buffer-compression-audit.json`.
