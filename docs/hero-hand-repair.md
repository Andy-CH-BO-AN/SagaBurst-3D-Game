# Local hero hand repair

`tools/repair-hero-fingers.mjs` is a post-process for the four existing hero
deliveries. It consumes original GLBs/manifests, verifies their hashes, and
changes only local hand surfaces, finger rest/bind data, finger rotation
channels and local hand-bound metadata. The original character source files
remain the reconstruction source.

## Inputs and reproduction

Use an unmodified asset root from commit `212f07b64df79652c34d23f9d81733df841cc260`:
`public/models/characters/v2`. A separate checkout or extracted Git archive
preserves the input files; never process already repaired manifests recursively.

The normal anatomy reference is Kevin Iglesias's **Human Melee Animations FREE**,
`Models/HumanM_Model.fbx`, SHA-256
`88fd0684f0b3331cc4056b2ddafebf506d52c21c32e18884fd28214c0a8d75cb`.
[Source package](https://kevdev.itch.io/human-melee-animatons-free),
[Unity Asset Store EULA](https://unity.com/legal/as-terms).
The downloaded FBX and extracted standalone hand are not shipped. The two
local hand derivatives embedded in Captain/Ranger retain separate source terms;
they do not inherit the Meshy body's CC BY license.

```sh
rtk proxy blender -b --python tools/prepare-hand-reference.py -- /path/to/HumanM_Model.fbx output/hand-reference.json
rtk proxy node tools/repair-hero-fingers.mjs /path/to/original/characters/v2 output/hand-reference.json
```

Alternatively, pass the FBX as the second argument and set `BLENDER` to the
installed executable. The builder invokes the same extraction step. Blender
5.2 and the repository's pinned Three/meshoptimizer dependencies were used.

## Ownership and limits

- Captain (`varangian63`) already has independent finger channels. The retired
  same-name Viking retargeter is incompatible; it is not this source's builder.
  Replace only the two rebuilt hand meshes, fit the reference phalanges in the
  original wrist frame, and compensate each inverse bind once. Preserve the
  measured original finger length and all body/sleeve geometry.
- Ranger's fitted template joints end before the source fingertips. The local
  repair uses the measured 184 mm source hand envelope and 25 mm lateral palm
  offset, rather than retaining the misplaced template knuckles. The new
  connected palm/thumb surface receives the matching reference skin weights.
- Meshy Viking T5/Roman T4 retain their original LOD0 surface, weights and binds.
  Lower LODs retain the LOD0 distal hand topology to protect the finger gaps.
- `anatomical-finger-pose.mjs` solves absolute target-bind poses with bounded
  MCP/PIP/DIP flexion, coupled distal flexion and thumb opposition. It replaces
  the Roman finger donor plus additive grasp. Natural and contact shapes are
  separate; no new character-specific angle table is applied at runtime.
- `FingerContactPolicy` selects contact from actual equipment ownership and
  restores free hands on unequip. Bow samples keep ownership through the
  return-to-idle fade. The existing pose layer restores prior samples before
  the next mixer evaluation; rotations do not accumulate.
- Sword contact uses the actual weapon's cross-sections, including its child
  transforms and asymmetric outline, rather than a round radius proxy. The
  offline solve checks weighted finger skin and the posed palm/thumb web.
  Palm clearance is fitted separately: fingertip contact alone can leave the
  distal palm penetrating the handle and protruding as a skin-coloured sheet.
- The repaired hand's contact station is separate from the original weapon
  attachment. The existing equipment pose owner solves the arm to that station
  and counter-transforms its equipment proxy, preserving the sampled blade
  world transform. Root-space bone lengths and hand-offset scale are measured
  for this opt-in solve; asset normalization above the arm must not be omitted.
  Body clip data and original socket/weapon metadata remain unchanged.
- Mounted contact is fitted against the existing mounted attachment roll,
  using the production idle calibration and upper-body filter through Vite's
  offline module loader. The arm uses the shortest shaft alignment instead of
  forcing foot palm roll onto the rider. Its own finger/palm contact solution
  avoids making the mounted wrist unreachable while keeping the blade fixed.
- Separate hand meshes carry a conservative wrist-local skin bound derived
  from finger-chain lengths and weighted bind points. The pose callback moves
  that small sphere with the wrist. A cached idle sphere previously culled a
  valid attacking hand in close views; this keeps culling enabled without a
  per-frame vertex scan or a whole-character oversized bound.

LOD0's total triangle count must remain exact. Additional visible resolution
subdivides the local reference hand faces; no hidden or zero-area filler is
used. Lower LOD counts may grow to preserve five distinct fingers. Body clip
samples, non-finger rest/socket transforms and action/event clocks are retained;
the builder verifies byte-level animation/rest digests after compression.

Structural reports do not establish visual acceptance. Inspect the published
`devhero` routes, raw rest, source clips and actual equipment playback with both
hands, multiple angles, all LODs and supported mounted poses. Store screenshots
and one-off diagnostics under ignored `output/`; report the reviewed scope and
remaining contact/appearance limits in the PR.
