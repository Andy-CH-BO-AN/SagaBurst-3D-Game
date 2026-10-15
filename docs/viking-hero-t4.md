# Replacement faction humanoids

`viking-hero-t4` is the user-supplied blue-cloaked Varangian Review Candidate.
`viking` and `roman` are the corresponding ordinary infantry deliveries shared
by T1–T3. Tier loadouts and combat profiles remain separate from these visual IDs.

## Source and rebuild

The three manifests and `source-readme.txt` files under
`public/models/characters/v2/{viking-hero-t4,viking,roman}` identify the original
archives, clean GLB entry, SHA-256, animation provenance, and source limitations.
The Varangian directory additionally retains `source-license.txt`. Meshy model
rights and Kevin Iglesias / Quaternius animation attribution remain distinct;
this integration does not grant a new license to the source packages.

Unpack the two user-owned delivery archives outside the repository, preserving
their top-level directory names, then run:

```sh
node tools/build-replacement-humanoids.mjs /path/to/extracted-deliveries
```

Rebuild prerequisites are the repository's npm dependencies, Blender (validated
with 4.3.2), and Python with Pillow. Re-measuring the supplied grip data uses
`tools/calibrate-replacement-humanoid-grips.py` with NumPy; it reads source GLB
data without importing or executing scripts from the delivery archives.

The builder validates the original SHA-256 before transformation. Source ZIPs,
Blender files, mock weapons, videos and temporary renders are not runtime assets.
The earlier `build-viking-hero.py` / `retarget-viking-hero.mjs` tools belong to the
superseded asset and must not be run over the replacement directory.

## Runtime contract

- Heights: Varangian 2.00 m, Viking 1.86 m, Roman 1.78 m; +Z forward and soles at
  ground. Normalization is in exported transforms, not terrain or hitboxes.
- Honest selected-source contracts: `varangian63`, `ordinary22`, `roman54`.
  Viking stays at 22 skin joints; Roman and Varangian retain their finger tracks.
- All three LODs carry the eleven source clips and compatible bind space. The
  existing `SelectedLodPose` contract shares one evaluated pose across LODs;
  identical skin bindings within a character share one Skeleton as well.
- Source axe clips retain their complete 3.0 / 2.833333-second motion. Manifest
  events and `meleeCycleSeconds` feed the existing T5 mixer timing mechanism;
  equipment and hero attack-speed multipliers still own gameplay speed.
- Formal weapons use source-calibrated grip frames. Roman's authored moving
  two-handed axe socket remains animated. Mounted legs, seat support, generated
  melee actions, death, and additive hit reaction remain runtime responsibilities.
- Civilian / merchant actors use the preserved `roman-civilian` body, so fused
  infantry armour does not leak into resident appearance.

LOD triangle counts, texture limits and output hashes are recorded in each
manifest and `lod-audit.json`. These are structural records, not visual approval
or GPU performance measurements. See [manual validation](viking-hero-t4-validation.md).
