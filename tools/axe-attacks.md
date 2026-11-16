# Humanoid axe animation pipeline

The independent Roman T4 `axeAttack2H` uses Kevin Iglesias's
`HumanM@Attack2H01.fbx` from `Human Melee Animations FREE.zip`, already retimed
to 0.48 s. Keep it unchanged when processing the selected Meshy attacks.
Ordinary Roman/Viking, Viking T4, both T5 commanders, Maki and both civilian
variants instead inherit the selected Meshy `axeAttack2H` take. Their retained
strike is now genuinely cut/re-keyed to 0.48 s; the discarded windup/wait samples
are removed from the published GLB, not skipped at runtime. Other clips are untouched.
Source licensing remains asset-specific; keep source archives outside `public/` and Git.

## Meshy strike-only final stage

After the relevant selected-humanoid, retarget, LOD and packing builders, run:

```sh
node tools/trim-two-handed-axe.mjs [character-output-root]
```

The default root is `public/models/characters/v2`. The measured, hash-pinned
recipe is `tools/assets/axe-2h-trim.json`; a changed upstream source fails closed
and must be remeasured. Rebuilding the same output is idempotent and checks both
the recipe fingerprint and output hashes. Restore the recorded input files to
apply a changed recipe; never trim an already trimmed clip a second time.

The ordinary/T5/Maki/civilian interval is 0.966666667–1.2 source seconds;
Varangian retains 0.933333333–1.366666667 for its longer recoil. These boundaries
were selected after sampling actual bone/weapon motion: the rapid strike peaks
around 1.0625 s, then decelerates; the long initial raise and late wait are outside
the retained interval. All channels share the same affine mapping to 0–0.48 s.
LINEAR rotations use slerp, STEP retains authored discontinuities, and cubic
curves retain their Hermite interpolation/tangent scale (with bounded adaptive
rotation refinement). Shared non-target accessors and compressed payloads stay intact.

Events are remeasured at 240 Hz through the production registry and actual
`CharacterCombatAnimator.start/update`, after settling Idle, using the outer
cutting edge of the equipped Dane axe (not the source-only Studio preview). `activeStart` is the pre-contact edge-height apex followed by downward and
forward travel, `hit` its maximum forward reach during the
retained downward strike, and `activeEnd` its subsequent descent below the
pelvis. Per-asset times and contact coordinates are in the recipe and manifests.
`sourceEvents` preserves the original manifest for provenance only; it is not
a new measurement and does not drive the new event mapping.
A pelvis-plane entry is not used: corrected carry can keep the edge in front
throughout. These are geometry-based contact markers, not fixed clip percentages or the old
1.06–1.08 s events. `actionComplete` is 0.48 s. Runtime cycles, including weapon
0.54 s overrides, hero/Berserker multipliers and NPC attack gaps remain unchanged.
The eight trimmed bindings opt into an action-clock fade-in scaled with attack
speed: 0.06 s for Varangian and the existing 0.1 s for the other seven. The
Varangian fade retains its measured 0.06 s duration; its left-arm native
shortest-arc seam is prevented by the fixed-offset transition below, not by
shrinking fade until the problem is hidden. A fixed 0.1 s wall-clock blend also crosses seams in
all eight families at high attack speeds; scaling prevents that regression. The independent Roman T4
and all other animation families retain their previous transition defaults.
All eight trimmed 2H bindings opt into a fixed-offset entry/exit
transition: a single initial local TRS offset decays onto the moving clip,
without repeatedly choosing an idle/target quaternion hemisphere. This is C0
pose continuity, not a guarantee of matching velocity or aesthetic acceptance.
The relaxed-hand equipment overlay follows that same transition clock rather
than the immediately full native target weight; its scalar changes cannot
reintroduce a wrist snap outside the corrected bone pose.
Trimmed 2H carry headings unwrap across the atan2 branch cut. Their Corgi
clearance uses continuous root-up yaw to reach the same shaft height/heading,
not a near-antipodal shortest-3D-axis correction. Legacy 1H/2H bindings keep
their original paths. The generic right-hand reach correction is blended out
only during the existing final recovery window, with the left hand following
the actual haft. The generic left arm acquires its support grip using a
fixed initial local rotation offset over the existing first 0.08 s, avoiding
a new per-frame shortest-arc flip; after acquisition the strike solver is
unchanged. Unrelated animation assets are unchanged.

`manifest.axeAttack2HTrim` records this subsequent stage and supersedes the
animation-timing/output-file claims of earlier source/LOD/compression audits;
those earlier files remain historical evidence for their original hashes.
Asset preservation and numeric/controller checks do not establish live browser
visual acceptance, self/mount clearance or arbitrary-large-dt swept collision.
Those checks must be reported separately, not inferred from successful parsing.
Trimmed authored 2H attachments recover during 0.42–0.48 s using a fixed
initial socket-space rotation/anchor offset onto the true carry attachment.
The grip station transitions to the equipped model marker; Roman carry arm
corrections enter over the same interval. This removes the newly enlarged
completion discontinuity without changing the active strike. The pre-existing
attack-entry attachment/IK changes remain, numerically unchanged from dev;
this work does not claim to repair every pre-existing acquisition issue.
Canceling an authored trimmed attack during 0.42–0.48 s stops gameplay and
hit eligibility immediately, while its already-started equipment recovery
finishes at the original action-clock rate. Locomotion begins immediately;
the visual-only tail emits neither hit nor completion events and is cleared
by a new action or equipment change. Other actions and earlier cancellation
retain their prior behavior. Actual playback is still required before visual acceptance.

## Legacy Kevin-source rebuild

Run from the project root (substitute the local archive path):

```sh
rtk proxy /Applications/Blender.app/Contents/MacOS/Blender -b --python tools/sample-axe-sources.py -- --archive '/path/Human Melee Animations FREE.zip' --output output/axe/source.json
rtk proxy node tools/rebuild-axe-attacks.mjs output/axe/source.json viking,roman,roman-hero-t4
rtk proxy node tools/rebuild-bow-lods.mjs
```

The sampler retains every source frame, maps the complete take to the existing
0.48-second melee action budget, and records the ZIP and individual FBX hashes.
The build maps anatomical limb axes and palm frames into each selected asset LOD's bind
basis. It removes translations/scales, keeps planted legs, and counter-rotates
the right wrist for the existing axe model's display tilt. Unrelated animation samples and textures are preserved. Roman assets also receive the source-specific arm bind and garment repair described below.
The builder retains a payload checkpoint so repeated runs produce identical files.
Run it after upstream humanoid or Roman hero builds; existing independent
Praetorian outputs can be repaired directly without rebuilding their appearance.
The ordinary Viking bow stage re-expresses the authority LOD0 bow poses in
LOD1/2 bind bases so the visible hands reach the LOD0-owned equipment sockets.
The left palm follows the authority world frame because `BowGripLOD` preserves
LOD0 hand geometry in hand-local coordinates; other bones use rest-delta skin
deformation. Each static bowLoad is completed toward its own bowHold at load.
It preserves axe and other unrelated clips; rerun it after upstream builds.
Varangian already inherits the Viking clips through its own retarget pipeline.

## Roman arm repair

The source arm joints were 65 mm above the anatomical wrist centre (scaled for the Praetorian). `roman-arm-bind.mjs` rebases the parallel arm chain, inverse bind matrices, sockets and grip coordinates. It retains vertex positions, limb lengths and rest rotations. `roman-arm-surfaces.mjs` gives overlapping shoulder skin, sleeves and armour compatible weights; it fits sleeves outside the unchanged skin and binds the shortened ordinary bracer below the elbow. Coarse sleeve triangles in LOD1/2 receive local, conforming refinement before fitting. No skin is shrunk or deleted.

Each repair is asset-owned and idempotent. When verifying a rebuild, check unchanged anatomical rest vertices, hand-socket rest positions, materials, texture bytes, unrelated payloads and animation samples outside these explicit arm edits. Keep comparison probes and their reports in ignored `output/`; these outputs are not an animation-only edit.

## Runtime contract

- Weapon `animationKind: 'axe'` selects the independent axe family. Player and
  NPC choose 1H/2H from the current shield equipment at each attack start.
- For the legacy Kevin clips only, source frame 10/34 is the 1H hit (0.130909 s); frame 18/49 is the 2H hit
  (0.170000 s). Frame 1 maps to time zero. `AXE_HIT_TIMES` and the manifest
  record these separately. Meshy 2H uses the remeasured per-asset events above.
  Existing berserker rate scaling still applies.
- The animator alone emits the one-shot melee event, including coarse steps,
  distance throttling and cancellation. Completion restores current locomotion.
- 1H keeps the normal shield layer. 2H closes the off hand and constrains both
  grips to the same haft; reach correction compensates for limb proportions. The solver retains the sampled elbow plane and upper-arm roll. It aligns the support thumb along the shaft without forcing a fixed palm roll back through the elbow. LOD0 supplies the physical support-palm frame to other LODs, including delayed LOD catch-up.
  The left grip is below the right grip, as in the source take.
- Viking mounted axe carry retains the lance wrist/finger pose. Roman and Praetorian use `axeMountedIdle`, anatomically retargeted from Viking carry with a separate palm calibration; it is selected only for mounted axes without shields. Completion and cancellation restore the same carry.
- Mounted axe carry keeps its fixed palm contact.
  Only the weapon attachment changes: retain its outward clearance and roll
  the cutting edge downward about the fixed palm contact. The attachment blends
  to the source strike during 0–0.08 s and back during 0.42–0.48 s, outside the
  hit interval. Mounted 1H prepares above the target and descends along the
  mount's right flank through the original hit time, instead of lifting the
  whole strike above infantry. Corgi carry lift fades out for this strike.
  Mounted 2H retains its neck/ear clearance. Axe geometry/balance are unchanged.

## Verify

```sh
npm test -- tests/combat/CommanderWeaponSwitching.test.ts tests/assets/HumanoidAssetPreload.test.ts
```

Use the production humanoid and mount studios with the normal Vite server
running. Exercise shield on/off and attack/recovery for every Viking LOD,
on foot, on the horse, and on the Corgi. Compare lance and axe carry at the
same animation phase: the wrist/finger pose should match while the axe cutting
edge faces down.

For frame-by-frame inspection, create a temporary gallery under ignored
`output/axe/` using the production registry, studio controller, and equipment.
Place the rider with the production anatomical pelvis seat. Sample both
character-local and world-space blade positions before/contact/after contact;
mounted 1H must descend through its hit time. A 120 Hz haft/body centreline ray
scan helps find intersections but does not prove full-volume clearance. Inspect
blade, rider, shield, fingers, and recovery visually as well.

Raw screenshots, structural audits, test logs and preservation checks belong in
ignored `output/axe/` and `output/playwright/axe/`.
