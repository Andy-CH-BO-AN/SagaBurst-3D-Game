# Meshy medieval Bandit build

This replaces only the `bandit` visual contract. NPC IDs, AI, combat events, mission rules and controller API are unchanged.

## Reproducible inputs and order

1. Place the owner's `Meshy_AI_ragged_warrior_rerigg_All_Animations.glb` in ignored `output/meshy-bandit/source.glb`. Required SHA-256: `fcc975506d11b7ecd2e3eaadee55f0b28ae280e05bb814bafa5e75e8588cef64`.
2. Run `blender -b --python tools/build-meshy-bandit.py -- output/meshy-bandit/source.glb output/meshy-bandit` (see builder `--help` for supported syntax).
3. Run `node tools/bake-roman-t4-foot-axe.mjs` to preserve the exact previous Roman T4 foot axe result independently of the new appearance.
4. Run `node tools/retarget-meshy-bandit.mjs`. It recovers original Bandit LODs from pinned commit `bb517258398423039a7a0dfa983681322c92a51d` into ignored output and verifies the original hashes. Only hammer dependencies are copied; no old body payload is shipped.
5. Run `python3 tools/package-meshy-bandit.py`, then `node tools/audit-bandit.mjs` (the existing audit entry point delegates to the Meshy-specific audit).
6. Round-trip final GLBs into Blender for body/hand/hammer/LOD inspection, then validate the actual runtime Studio and combat flow when a permitted browser is available.

Builder output must finish before the retarget stage; never rebuild while capturing final evidence. Original Meshy takes are not silently renamed into production clips. All six production takes come from the independently attributed, previously shipped tokeshi donor. Clip sampling is offline, and the original attack contact at 0.252 seconds and completion at 0.48 seconds are preserved.

Both arms and legs use anatomical longitudinal axes rather than copying named-bone quaternions. Hand mapping uses an explicit palm frame because the new source has no finger joints. Ground corrections are baked into the hips track and do not move the gameplay actor. The rigid original hammer uses the same hand-local transform in every animation. No helper finger joint pretends to supply missing donor anatomy.

The older `build-bandit.py` / `package-bandit.py` are legacy original-source converters, not the replacement pipeline. The generic foot-axe bake is pinned to the original donor, so future Bandit appearances cannot change other characters' strikes.

## Verification boundaries

The standalone GLB audit checks required bones/sockets, finite skin bounds, normalized weights, real/distinct clips, exact attack duration, immutable hammer attachment, emitted triangles, size and source hashes. It is not a visual or gameplay verdict. GPU timing/FPS must be measured only with the project's real-GPU benchmark workflow.

Full Local Test Suite: Not Run — intentionally excluded by owner for this asset-only PR.
Only affected existing preload/registry/combat-timing logic tests should run; no scene/model-heavy unit tests, test-policy changes or CI changes. `npm run typecheck:test` and `npm run build` remain required. Draft PR acceptance must separately list actual browser gameplay, visual and GPU items that could not be performed.

The source's semi-open hand has no finger joints. Grip fitting is an offline local mesh operation, not runtime finger animation. Retargeting calibrates the hand cavity and the original hammer shaft separately. A coherent run-only carrying-arm correction opens the shoulder chain to prevent the longer hammer intersecting the new face; it does not twist the wrist/torso or alter the attack. Final QA must sweep the whole run, not accept one clear frame.

LOD2 deliberately retains approximately 4K body triangles rather than forcing the suggested 1.5K–2.5K total. Tested 2K reductions collapsed the face and hands despite finite bounds and normalized weights. Face/neck/hand feature protection and sole/toe/head extrema preserve the distant silhouette; actual final counts are in the manifest/audit.
