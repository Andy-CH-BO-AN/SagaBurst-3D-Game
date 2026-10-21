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

## Equipment and cape review corrections

The eleven selected source clips remain embedded unchanged. A twelfth
`axeAttack1HFoot` clip retargets the shipped Fantasy Bandit `swordSlash` attack
onto ordinary Roman/Viking, Varangian and both T5 rigs. Anatomical limb and
thumb/finger axes map the strike; the target idle pelvis and legs retain forward
heading. The rejected whole-pelvis 1H yaw correction has been removed. Source
active/hit/complete events, the 0.48-second melee budget, hero multipliers and
player skill multipliers are unchanged. Only the foot 1H controller selects the
new clip; mounted and 2H paths retain their original clips and equipment rules.

After source/LOD builds (and the T4 cape repair), reproduce the appended clips:

```sh
node tools/retarget-bandit-foot-axe.mjs
```

The tool verifies the Bandit input hash, preserves the existing binary payload,
adds independently named tracks, and records source license, clip, hashes and
timing in each manifest. Its own append checkpoint supports deterministic rebakes.
Bandit source assets are unchanged.

Ordinary Viking and Varangian Captain foot locomotion retain their authored
shoulder, elbow and wrist.
Only the axe visual rolls about the existing palm station to face its cutting
edge down; the hand socket and other weapons are untouched. This replaces the
rejected arm IK workaround. The Bandit attack uses a separate anatomical grasp
and blends the weapon attachment at entry/recovery. Roman foot axe/sword carry
retains its separately requested forward-facing correction.
The Roman free wrist uses the sampled opposite hand as a natural orientation
reference without changing finger tracks. The Roman shield's cylindrical grip
uses the corrected thumb-up axis sign; its palm center remains source-calibrated.
Varangian's shield grasp has additional torso clearance and still drives the
same visual/collision pivot.

Authored ordinary bow hands register their draw-string and arrow-rest contacts
without generating hand morphs. Roman's contact follows its source index chain.
The mixer distinguishes scheduled bow actions from never-played actions, so
inactive clips do not suppress carry or trigger mounted bow compensation.

The cape repair is a local geometry derivative, not an animation re-export:
posterior backing closes the source cutouts, a tapered rear offset clears the
restored mail torso, and three long LOD2 fold triangles receive local blue-cloth
UVs instead of crossing an unrelated atlas border. Original joints, inverse
binds, source image bytes and all eleven animation buffers are preserved.
The original source SHA remains in the manifest; each derived GLB SHA, source
package SHA and triangle/repair audit are in `manifest.json` and `lod-audit.json`.

The main builder includes this repair. To reproduce it independently from the
pre-review T4 package (the files at commit `ee67a6e9`), run:

```sh
node tools/repair-varangian-cape.mjs /path/to/original-t4-package /path/to/output
```

The command verifies input hashes, preserves skeleton/animation metadata and
payload, and checks idempotence before writing. It needs only the npm dependencies;
source archives or Blender are unnecessary for this local repair. The derived
cape retains source faceting and localized texture seams, especially at LOD2.
Model-view screenshots are visual inspection evidence, not battle acceptance
or a GPU benchmark. Full in-game mode/loadout and paired performance acceptance
remain the separate checklist in the validation document.
