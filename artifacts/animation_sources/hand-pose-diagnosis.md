# Hand pose regression diagnosis — 2026-09-06

Status: root-cause corrections implemented; verification recorded below. Earlier
claims of full hand-pose acceptance are superseded by this report.

## Corrections following diagnosis

- Restore overlays before `seek()` evaluates the mixer, and reset overlays on
  stop/raw-mode transitions. Remove the unconditional relaxed-left 90° roll.
- **Anatomical retarget correction:** rest-bone roll is not palm orientation.
  Source index-to-pinky base landmarks measured in Kevin hand coordinates are
  L=(-0.999997,0,0.002476), R=(0.999997,0,0.002459). Match these source axes
  (also measured from Quaternius finger bones) to the target mesh thumb sides:
  Viking L=-X/R=+X, Roman L=+X/R=-X, with fingers along +Y. All eight clips
  use this mapping. Remove runtime bow-wrist replacement entirely. Bone rest
  twist compensation remains only on upper arms/forearms, not hands.
- Keep imported shoulders and relaxed left wrist. Sword-carry intent owns only
  the right forearm/hand and optional finger curl; source clips own attack/bow
  orientation. Actual weapon builders declare model-space grip centres, so the
  Roman .10m gladius no longer receives the Viking .15m steel-sword offset.
- Player leaving bow aim while moving now clears bow ownership, like NPC.
- Studio now has two faction rows of all eight clips plus mounted/death, real
  faction equipment and `CharacterCombatAnimator`. B switches raw full-body
  clips vs equipment layers, Space pauses, R replays, H toggles bones.
- Camera/body were both +Z at a fresh start (dot=0.9997), but enemies spawn
  toward -Z. Spawn heading now faces the battle, and initial camera yaw is
  derived from the actor heading. No mesh-level 180° flip. Browser direction
  dot=1; camera is 6m behind; W moves along -Z.
- Roman lower skirt lagged the covered thigh (75% vs 100% upper-leg weight).
  Isolating only that difference removed the exposed thigh patch in idle.
  The reproducible skin repair now uses matching lower-skirt weights and a
  continuous hip blend; it changes no position/index/material/texture data.

## Remaining acceptance limits

The canonical assets have no finger bones. The sword curl morph is approximate;
bow finger articulation and drawing-hand/nock contact are not fully solved by
correcting wrist orientation. Do not label this a complete contact/cloth/IK
acceptance pass. Retain the full mounted/LOD/contact matrix as follow-up QA.

## Reproduction surface

`http://127.0.0.1:5173/?devmodels=humans&nolock`

The original studio had two faction rows (idle, run, walk, attack, bow/pilum,
mounted). It is not a complete gameplay parity test: it directly plays the
controller, without CharacterCombatAnimator or the real equipment hierarchy.
Its bladeGripEnabled defaults to false, while the controller still applies the
bow wrist overlay automatically. Thus even the studio is not uniformly raw GLB.

## Confirmed defects

1. **Extra wrist ownership.** The generated GLB contains bind-roll changes, and
   HumanoidBladeGrip subsequently replaces wrist orientation. In a frozen studio
   pose, applying only the runtime layer rotates the left wrist by exactly 90°
   in idle/walk/run for both factions. This is the hard-coded
   relaxedLeftPalmRoll, not motion requested by the source clip. The right
   wrist is also replaced by a world-oriented guard frame.
2. **Seek/restore ordering.** seek() evaluates the mixer before restoring the
   previous overlay. update() then restores an older pose. Once fades have
   finished, Three.js property caching can leave that older pose in place for
   paused clips. Two Viking studio instances sampled bowLoad at 0.05/0.95:
   the overlay instance differed from an overlay-free reference by 45.3356°
   at the shoulder and 48.9168° at the elbow at 0.05. Restoring the overlay
   BEFORE seek, in browser memory only, reduced both errors to <0.000003°.
   The same alternating sequence reproduced these results repeatedly.
3. **Unverified anatomical constants.** bladeGripAxis = -1 is used for both
   models and the bow code assigns -X to both wrists. This was inferred from
   silhouettes rather than calibrated thumb/palm landmarks. The isolated
   bind-hand views show different mesh frames and mirrored left/right hands;
   a bone name does not establish the palm or thumb direction. Viking thumb
   visibility is partially obscured by cuff geometry and needs an unobstructed
   landmark check before approving its full hand frame.
4. **Wrong Roman weapon grip centre.** alignBladeGrip assumes the static child
   offset +0.05 m and a model-space handle centre +0.15 m (steel sword), yielding
   the hard-coded 0.10 m correction. Actual Roman buildNpcMelee gladius uses
   +0.10 m handle centre: a 0.05 m mismatch. Previous isolated sword QA used
   steel_sword for both factions, so it missed this gameplay-specific error.
5. **Insufficient tests.** Existing pose tests encode the same guessed thumb
   axis and steel-sword grip centre as the implementation. Passing them proves
   algebraic self-consistency, not anatomical correctness. All 75 tests passing
   must not be reported as visual acceptance.

## Scope of the prior retarget evidence

Blender measurements established that source/target bind frames differ (hands
roughly 90°, Roman upper arms roughly 180°). They do NOT by themselves establish
the correct anatomical grip frame or prove every retargeted pose is valid.
The source mesh hand frame and the target mesh hand frame must be compared,
not only the source/target bone quaternions.

## Required correction order

1. Add a regression for alternating paused bow samples after fades finish;
   restore all active overlays before every mixer evaluation (including seek
   and stop). Do not let saved overlay poses overwrite newly sampled poses.
2. Remove the unconditional relaxed-left-hand roll. Establish one ownership
   contract: imported pose first, narrowly scoped calibrated equipment layer
   last; no per-faction angle patches without measured landmarks.
3. Calibrate palm centre, finger direction, thumb direction and palm normal on
   all four actual mesh hands, with cuff-free front/back evidence. Do not infer
   these from joint names or bounds alone.
4. Expose the real weapon grip landmark from each weapon builder. Test Viking
   steel sword and Roman gladius separately, with the real static child
   transforms, and verify hilt/palm contact throughout the attack.
5. Make the existing studio distinguish raw clip and full gameplay layers and
   replay both factions through all eight clips and transitions at identical
   timestamps. Only then run Player/NPC release QA. Do not approve from a single
   screenshot of a specially constructed steel-sword fixture.

## Evidence

Screenshots under output/playwright:

- diagnosis-studio-overview.png
- diagnosis-viking-hand-local-front.png
- diagnosis-viking-right-thumb.png
- diagnosis-viking-left-thumb.png
- diagnosis-roman-right-thumb.png
- diagnosis-roman-left-thumb.png

All browser-only pose isolation is temporary and is discarded on reload.
