# Static posed characters and Maki

Use this when the source is already posed but has no skin, bones or animations, or when diagnosing a fitted rig's shoulder and forearm deformation. The Maki values below describe one source, not a humanoid template.

## Establish what the source actually contains

- Audit skins, animations, hierarchy transforms, separate clothing components and embedded equipment before choosing a retargeting approach. A static mesh needs a fitted rig and new weights; renaming bones or importing another character's rest rotations cannot solve that problem.
- Preserve original geometry and proportions when requested. Bake every ancestor transform before measuring height. Distinguish shoe-sole-to-hood height from anatomical height; do not infer the latter from a covered scalp.
- Keep an unmodified source comparison. If the user chooses its pose as idle, verify all idle bone rotations against that fitted bind pose. Check idle again after every change to attacks, sockets or deformation helpers.

## Diagnose the layer before changing it

Compare source/rest, raw animation and the production mixer with equipment at the same normalized phase and camera. Inspect the upper arm, forearm and wrist separately. Determine whether the fault belongs to bone axes, joint motion, skin weights, a runtime pose layer or the weapon attachment.

- Move shoulder, upper arm and elbow together when raising an arm. Keep the original bone lengths and parent hierarchy. Do not translate a detached hand into a sleeve or lengthen clothing to conceal incorrect weights.
- Fix weapon facing in the attachment around its palm contact. Do not rotate the whole arm or bend the wrist to conceal a reversed bow. Anatomical pronation and attachment calibration are separate decisions.
- On a posed mesh, sleeves may lie beside the torso in space. Distance-only weighting can attach an entire body panel to an arm. Identify garment branches from topology, keep the body and sleeve regions anchored, then diffuse the transition near the actual armpit. Weld only an analysis copy when necessary; preserve the original UV/render mesh.
- Transfer clothing weights only across actual overlapping shoulder regions. A broad hood or ornament transfer can drag the collar and chest. Confirm front, back and side silhouettes.
- Large axial rotations can collapse linear skin blends between two distant orientations. Distribute twist through adjacent deformation frames and verify the forearm cross-section during the motion. A local deltoid helper may preserve the shoulder arc; keep its influence local rather than spreading it into the torso.
- Source asymmetry matters. Measure both arms and palm frames; mirroring the successful side is not proof that the other side is correct.

## Maki contract and rebuild

The reviewed source is `maki_archer.glb`, SHA-256 `de18d6e174d8b0e282dfa30a16382af44e1b815512187b8dc5ffea312dd08601`. It has no original rig or animations. The measured sole-to-hood height is about 1.458 m. The builder's source hash guard protects its topology classification and landmarks; a different source requires a new audit.

Maki preserves source idle and the original side-on draw, including feet, neutral wrists, thumb web upward and a drawing elbow level with its shoulder. The bow clips turn the entire standing pose at the hips so the authored +X shot points along gameplay +Z. Do not replace that pose by re-solving both arms in front of the chest. `bowFullBodyStance` declares that standing pelvis heading belongs to the bow clip; only while moving or mounted does the equipment layer transfer the turn above the pelvis, preserving forward locomotion/riding legs. Verify standing, walking, stopping and riding separately, through the production controller and actual release direction. A preview using a special +X target can conceal this integration error.

For a direction-only correction, compare the candidate against the accepted pose after removing the intended whole-body rotation. Meshes, skins, bind transforms, clothing shape, arm tracks, bow calibration and unrelated clips should remain unchanged. In Maki's implementation only the bow clips' hips rotation changes; rebuilding skinning or rotating wrists is outside that correction. `rig.pelvis` is the `socket_pelvis` attachment, so measure the actual `hips` bone (its parent) when checking the stance.

Current equipment is the same T4 bow for ranged and melee. `axeAttack2H` names the reused animation, not an axe loadout. Keep the left-hand bow attachment and source idle; the right hand supports the bow handle during the strike. Read the [combat-animation skill](../../add-combat-animation/SKILL.md) for pose ownership and equipment reuse.

### Maki in player setup and combat

- In both Custom Battle and Campaign, selecting Ranger disables melee and shield controls. Display fixed bow melee / no shield without overwriting the saved choices for other characters; switching back restores those choices. Ranged and mount controls remain selectable.
- `getHeroFixedEquipment` in `HeroAssetCatalog.ts` supplies the fixed equipment contract. `Game` passes the selected hero into `InventoryManager`, which enforces it at creation, save loading and equipment changes. Disabled UI alone must not leave a previously selected lance or shield active in combat. A Ranger-only melee bow from a save must not equip on another character whose bow asset was not preloaded.
- Player bow melee uses the calibrated left-hand bow, `axeAttack2H`, and bow-derived grip/tip positions for contact. Preserve source idle and keep exactly the active melee or ranged visual visible through attack, aim, release and recovery. Rebuilding the character must reattach the melee bow to the new left-hand socket.
- Validate the two setup flows, changing away from Ranger and back, actual starting inventory, and idle → melee → recovery → draw → release. Preview equipment does not establish Player integration; NPC equipment selection is a separate path.

### Rebuild procedure

Run from the repository root with Blender, Python/Pillow and Node available. Pass the reviewed source path explicitly when it is not in the user's Downloads folder:

```sh
rtk proxy blender -b --python tools/build-maki-archer.py -- /path/to/maki_archer.glb
rtk proxy python3 tools/optimize-maki-textures.py
rtk proxy mkdir -p output/maki-clean
rtk proxy cp public/models/characters/v2/maki-archer-t4/lod0.glb public/models/characters/v2/maki-archer-t4/lod1.glb public/models/characters/v2/maki-archer-t4/lod2.glb output/maki-clean/
rtk proxy node tools/retarget-maki-archer.mjs
rtk proxy node tools/audit-maki-archer.mjs
rtk npm test -- --run tests/assets/MakiRangerAssets.test.ts --maxWorkers=2
```

Use the installed Blender executable path when it is not on PATH. Run these stages sequentially and stop on any failure. The clean checkpoint must contain the current skeleton/weights and optimized textures, with no animations. For retarget-only edits, restore those three clean GLBs before running the retargeter; never bake an already animated output. Rebuild the checkpoint after skinning or skeleton changes.

The builder temporarily writes unanimated public files. Validate in the browser only after the complete pipeline succeeds, then hard-reload; a hot reload during export can observe mismatched clips, metadata or partially written GLBs.

Blender duplicate image exports have produced a corrupt PNG despite a valid header. The optimizer reuses the same encoded image for matching asset namespace/name/resolution/alpha and stages outputs before writing them. Fully decode every final embedded texture; header dimensions alone do not prove integrity. Keep different resolutions, assets and alpha modes separate.

## Acceptance and handoff

Use `?devhero=maki-t4&nolock`, LOD0 close views and fixed phases for idle, raising the bow, hold, release and melee acquisition/contact/recovery. Then repeat at every LOD. Check source idle recovery, both shoulders/sleeves, forearm volume, palm contact and weapon clearance. Preserve provenance in the manifest, attribution evidence and source audit; do not commit source downloads or ignored diagnostic screenshots.

Maki's LOD1/2 currently retain hood/clothing intersections from independent mesh reduction. Passing hashes, triangle budgets, matching bone transforms or LOD0 visual checks does not make those lower LODs visually accepted. Keep this visual limitation explicit. Maki is selectable in gameplay; preview checks alone do not establish correct production aiming or mounted behavior.
