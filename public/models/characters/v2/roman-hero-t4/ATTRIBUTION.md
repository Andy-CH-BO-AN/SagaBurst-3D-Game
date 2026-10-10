# Paladin — Roman T4 appearance

[Paladin](https://sketchfab.com/3d-models/paladin-4f1c320f2cec49dc9bf38c6aad2d8ea9) by [DJMaesen](https://sketchfab.com/bumstrum), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

Credit and license are preserved from the supplied `paladin.glb` asset.extras metadata. The source SHA-256 and exact embedded credit are in attribution-evidence.json. The original download is not shipped.

Changes: original weighted body and clothing retained; arms normalized offline to the project rest pose and bone axes; metre scale (1.95 m overall including helmet horns); source swords and scabbards removed; original bastard sword extracted as independent equipment. Source finger curl is baked; static digit weights are collapsed to the hand joints, leaving 31 joints per LOD. Existing Roman T4 animations are retargeted offline with grounded root translations, matching clip names and gameplay events. Three simplified LODs and compressed/resized source textures are exported.

## Existing animation credits

- Kevin Iglesias — Human Archer Animations FREE; Unity Asset Store EULA. Source package hash is retained in manifest.json.
- Kevin Iglesias — Human Melee Animations 2.0 FREE; Standard Asset Store EULA. Existing source URL, package hash and license evidence remain in manifest.axeAttackBuild.
- Quaternius — Universal Animation Library 2; CC0 1.0. Source package hash is retained in manifest.json.
- SagaBurst — existing mounted pose layers, lance, hit response and death adaptation.

The retarget input is the previously integrated Roman T4 GLB at commit ae06476, originally derived from Roman Soldier by Andy Woodhead (CC BY 4.0). Its original body, helmet and boots are not included in this Paladin. No original FBX or separate animation-only package is redistributed.

## Rebuild

From the repository root with Blender 5.2 and the three user-supplied GLBs in one source directory:

```sh
blender -b --python tools/build-paladin.py -- /path/to/source-directory
node tools/retarget-paladin.mjs
```

The retarget step requires Git history containing ae06476. It reads that pinned GLB into ignored output/paladin-build, then emits runtime clips, manifest and audit. See weapons/paladin/ATTRIBUTION.md for the separate equipment credits.
