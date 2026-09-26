# Viking axe animation pipeline

`axeAttack1H` uses Kevin Iglesias's `HumanM@Attack1H01_R.fbx`;
`axeAttack2H` uses `HumanM@Attack2H01.fbx` from the supplied
`Human Melee Animations FREE.zip`. The archive's PDF licenses commercial game
use under the Standard Asset Store EULA. Keep the original archive outside
`public/` and Git; the game embeds only retargeted rotation tracks.

## Rebuild

Run from the project root (substitute the local archive path):

```sh
rtk proxy /Applications/Blender.app/Contents/MacOS/Blender -b --python tools/sample-axe-sources.py -- --archive '/path/Human Melee Animations FREE.zip' --output output/axe/source.json
rtk proxy node tools/rebuild-axe-attacks.mjs
rtk proxy node tools/verify-axe-assets.mjs origin/main
```

The sampler retains every source frame, maps the complete take to the existing
0.48-second melee action budget, and records the ZIP and individual FBX hashes.
The build maps anatomical limb axes and palm frames into each Viking LOD's bind
basis. It removes translations/scales, keeps planted legs, and counter-rotates
the right wrist for the existing axe model's display tilt. Existing animation,
mesh, skin, texture and skeleton data are preserved.

## Runtime contract

- Weapon `animationKind: 'axe'` selects the independent axe family. Player and
  NPC choose 1H/2H from the current shield equipment at each attack start.
- Source frame 10/34 is the 1H hit (0.130909 s); frame 18/49 is the 2H hit
  (0.170000 s). Frame 1 maps to time zero. `AXE_HIT_TIMES` and the manifest
  record these separately. Existing berserker rate scaling still applies.
- The animator alone emits the one-shot melee event, including coarse steps,
  distance throttling and cancellation. Completion restores current locomotion.
- 1H keeps the normal shield layer. 2H closes the off hand and constrains both
  grips to the same haft; reach correction compensates for Viking proportions.
  The left grip is below the right grip, as in the source take.
- Mounted axe carry uses exactly the same wrist and finger pose as the lance.
  Only the weapon attachment changes: retain its outward clearance and roll
  the cutting edge downward about the fixed palm contact. The attachment blends
  to the source strike during 0–0.08 s and back during 0.42–0.48 s, outside the
  hit interval. Mounted 1H prepares above the target and descends along the
  mount's right flank through the original hit time, instead of lifting the
  whole strike above infantry. Corgi carry lift fades out for this strike.
  Mounted 2H retains its neck/ear clearance. Axe geometry/balance are unchanged.

## Verify

```sh
rtk npm test -- --run tests/AxeAttack.test.ts tests/HumanoidAnimationAssets.test.ts tests/CharacterCombatAnimator.test.ts tests/EquipmentPose.test.ts tests/MeleeTierParity.test.ts tests/ShieldEquipmentState.test.ts tests/PlayerLoadout.test.ts tests/VikingInfantryLoadout.test.ts tests/VikingPlayerAxeSelection.test.ts --maxWorkers=2
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
