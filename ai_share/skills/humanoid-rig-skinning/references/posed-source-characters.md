# Static posed source characters

Use this when the source is already posed but has no skin, bones or animations, or when diagnosing a fitted rig's shoulder and forearm deformation. Per-source poses and measurements are not a humanoid template.

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

## Current Ranger replacement contract

Shadow Warden replaces the former Maki body under the persistent `maki-archer-t4` ID. The new source envelope is uniformly normalized to 1.90 m. Its fitted skeleton, hand frames, cloth helpers and retargeted actions belong to the current faction-humanoid pipeline and manifest; do not carry forward the former Maki's side-on rest pose, shorter-leg offsets or body-region coordinates.

- Ranger uses ordinary humanoid equipment and combat selection. The persistent `maki-ranger-bow-ranged` ID remains ranged-only. Melee uses the equipped Sword, Axe, Lance or Mace and its ordinary grip, tip and sweep.
- Keep the existing Ranger Bow geometry and provenance. Recalibrate its attachment against the new actual palm frame; a previous per-character bow calibration cannot be reused based on an unchanged persistent asset ID alone.
- Player setup and HR equipment permit normal melee, ranged, shields and mounts. Preserve legal purchased selections, inventory ownership and the usual ranged/shield exclusion.
- NPC ranged/melee transitions use the existing `reversibleRangedSwitch` policy. Temporary mission loadouts explicitly select their own policy and restore the permanent selection when released.
- Do not run a retired Maki builder or retargeter against the replacement directory. Use the current source-specific pipeline and preserved source audit; source topology, proportions and labels must match the input hash.

## Acceptance and handoff

Use the existing `?devhero=maki-t4&nolock` preview for actual exported assets, all LODs and ordinary equipment. Also inspect `?devhero=roman-civilian&nolock` and `?devhero=viking-civilian&nolock` through the same controller. Source-only clips must be labelled as such and must not imply new gameplay attack actions.

Verify source appearance, idle recovery, both shoulders and sleeves, palm contacts, cape/robe clearance, mounted poses and real attack/shot behavior in the relevant gameplay flows. Matching hashes, triangle budgets, bind transforms or LOD0 screenshots alone cannot establish visual acceptance of all LODs. Keep unsupported or unverified behavior explicit; store one-off captures under ignored `output/`.
