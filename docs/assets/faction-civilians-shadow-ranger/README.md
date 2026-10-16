# Faction characters: offline runtime evidence

This follow-up fixes the three fitted characters’ relaxed left-hand direction and forward axe carry, Nordic sword grasp, and stale mounted-seat contact after an equipment rebuild. The production runtime was frozen on 2026-10-16; these are **offline production-runtime pose renders**, not browser or GPU acceptance. Lighting/shaders can differ from Three/WebGL.

## Selected evidence
- [hand-grips.jpg](hand-grips.jpg): actual fitted actors, same-pose comparisons and Nordic sword contact/real LODs. Low-poly fingers and coarse-handle gaps remain visible.
- [axe-carry.jpg](axe-carry.jpg): all three fitted actors, full axe visible, forward carry in locomotion/mounted contexts. Actor heading is unchanged.
- [slope-seat-contact.jpg](slope-seat-contact.jpg): actual Player update before/after equipment rebuild on a slope. This intentionally retains the original hand/weapon policy to isolate seat-cache ownership.
- [capture-index.json](capture-index.json): capture inputs, hashes and scope. Expected asset ID and one visible real LOD are asserted for final fitted-actor captures.

The earlier cape, locomotion, ground-fade and death review remains available at the [original b211 evidence index](https://github.com/Andy-CH-BO-AN/SagaBurst-3D-Game/blob/b2110e763cfdf55bd7c690125e5a1e2621cdaa57/docs/assets/faction-civilians-shadow-ranger/README.md). Those historical images are not presented as new hand-rig captures. Intermediate repeated-LOD0 diagnostic packages are not shipped or used as true-LOD acceptance.

## Scope and measured changes
- Left-hand thumb-web correction is opted into only by the three fitted manifests and follows the existing mixer contribution. Bow, shield, lance and authored contact ownership retain their existing gates.
- Axe carry changes only weapon attachment heading around its grip. Contact intervals retain the original sweep, timing and damage. The mounted axe-to-lance switch also clears stale axe carry ownership.
- Nordic right-hand repair corrects source-mismatched finger columns and local skin ownership. Nine of twelve original four-finger joint centers were outside the source surface. Four-finger longitudinal joint stations and every rest rotation remain unchanged; exact source joint creases cannot be inferred from the fused low-poly fan.
- Only 15 right-digit node translations/inverse binds and 230/108/29 skin rows change across genuine LOD0/1/2. Mixed thumb/index web weights are retained. Original geometry/normals/UV/index and all animation streams remain byte-exact. Full-rest maximum positional error after Float32 reload is 0.000278/0.000255/0.000187 mm. Left-hand skin and all other body regions are unchanged.
- Nordic sword uses the existing arm/socket composition, a measured grip cross-section and local grasp profile. The cancelled sword-direction flip is not included. Mounted steel/T5 grip translations are 66.095/52.334 mm; normalized world orientation delta in lifecycle checks is at most 5.96e-8 rad. Normal sampled wrist position is retained rather than dragging the arm to an incorrect grip point.
- Seat fitting now invalidates its existing contact cache when a stable rider container receives replacement visual children. Same-mesh animation/LOD visibility reuses contacts. Actual Player runs cover 1,800 frames, four tier swaps, slopes and dismount/remount: before separation reached 3.97 m for Shadow / 4.13 m for ordinary Viking; after anatomical pelvis clearance remains 0.1153–0.1192 m / 0.0947–0.0986 m, with repeated-fit drift <=7.1e-10 m. These anatomical clearances are not surface-air-gap measurements. Corgi current ordinary assets bypass its legacy named surface patches, so that path verifies unchanged/empty-contact handling, not active fitted-surface correction.

## Runtime and asset verification
All nine final GLBs load with the production loader. Structural asset audit passes real LOD budgets, normalized skinning, common bind/clip streams, textures, sockets and attribution hashes. Corrected Nordic checkpoints have separate explicit hand-repair delta evidence; subsequent PNG/meshopt publication packing is byte-exact against those corrected checkpoints, not against the old skin/bind data.

The existing 381-pose audit was repeated against final GLBs: zero unsupported samples and zero non-finite vertices. Resource isolation/sharing, animation events, disposal and decoder-failure checks pass. **The strict numeric reach gate has two failures**, not 381 passes: Shadow mounted axe1H/2H at phase .05 measures 1.360001419/1.360001536 m against 1.360000 m with a 1 µm tolerance. Visible and gameplay tips coincide exactly. The old and new parent matrices/scales are identical; rotating carry projects the inherited tiny nonuniform TRS error onto another axis. The linear world-axis length reproduces both residuals within 2.2e-16 m. There is no accumulating scale. The original failed gate is retained; reach, animation and threshold were not changed to hide it. The other 379 samples meet that gate.

Independent actual-runtime checks cover 84 paired NPC samples and 167 Player frames: equipment/tier refits, sword/axe/lance/mace/none swaps, bow charge/release, attack/cancel, dismount/remount, skipped pose updates, repeated seat fits and stop. No stale correction, non-finite state, ownership failure or accumulated attachment drift was found. A separate phase-aligned Player context probe preserves ordinary actors and actor-local resource state. These checks supplement rather than replace visual review.

## Known visual limits and outstanding acceptance
- Nordic retains a coarse fused-finger/C-shaped grasp on wide steel handles, including gaps between metal rings. Normal-distance mounted grip improved, but it is not a high-detail tight fist.
- Foot T5 has three sampled hand vertices inside the handle, maximum 2.091 mm. Final mounted steel/T5 samples across all three real LODs have no contained hand vertices; this does not establish every animation frame as collision-free.
- Non-sword skin changes are visible in close-ups. At sampled 1H foot axe contact, maximum hand penetration increases from 25.918 to 32.505 mm; mounted 1H increases from 28.005 to 31.255 mm. The source already penetrated the coarse grip. Sampled 2H decreases from 27.214 to 25.315 mm. Bow/2H retain angular finger edges. Same-pose normal-distance review found no obvious new detached hand or large tear; **not all weapon grips are penetration-free**.
- Shadow sleeve/elbow and Nordic shoulder/underarm retain hard folds. Two-handed support retains relaxed source fingers. Death remains propped-prone, with millimetre-scale reduced-LOD floor residuals.
- Earlier run↔idle fades retain additional fitted toe/sole penetration about 2.5–4.6 cm versus ordinary references about 0.2–1.0 cm. No broad runtime/root workaround was introduced.
- Browser gameplay and <=10% same-condition GPU/frame-time acceptance remain outstanding. Cloud Playwright lacks its bundled browser, system Chromium fails OS socket creation, and Electron is unavailable. Offline Horse KTX2 presentation can have white/high-contrast artifacts; no game horse material was modified to compensate.

## Logic, build and review follow-up
Three complete runs each pass 368 Vitest + 36 Node = 404/500 cases, including hooks/cleanup; maximum leaf 41.010/53.065/45.689 ms, wall 18.960/17.501/16.629 s. Test typecheck, separate 36-case release component, web build and desktop build pass. All 102 copied target files match public bytes exactly. Local browser/desktop launch smokes remain blocked as above; exact-head CI is reported in the PR.

Review fixes make peaceful shield collision follow the same eligibility as visibility, and load only the Town roster’s needed civilian faction package(s) before construction. The service Ranger already belongs uniquely to Commander squad4; actual UI bindings now explicitly cover refit/save-before-apply without adding actors or changing eight military squads. A single-actor equipment lookup reuses the existing membership map instead of rebuilding the positioned roster nine times; the unchanged merchant horse case improves from 80.180/94.883/79.168 to 37.857/36.330/42.671 ms. Missing/duplicate/cross-category lookup precedence remains equivalent. No assertions, budgets or CI workflows were weakened.

## Reproduce the asset repair
Use the original pre-repair V28 Nordic package from commit b2110e763cfdf55bd7c690125e5a1e2621cdaa57 (or the matching baked checkpoint). The repair refuses an unreviewed geometry/bind or a second application.

1. `node tools/repair-nordic-right-hand.mjs INPUT_ROOT CORRECTED_ROOT`
2. Copy the corrected Nordic directory to a separate PACKED_ROOT.
3. `python3 tools/pack-faction-humanoid-textures.py PACKED_ROOT viking-civilian 0,1,2 --lossless-recompress`
4. `node tools/pack-faction-humanoid-buffers.mjs PACKED_ROOT viking-civilian`
5. `node tools/verify-faction-publication.mjs CORRECTED_ROOT PACKED_ROOT viking-civilian`
6. `node tools/audit-faction-humanoids.mjs PACKED_ROOT viking-civilian`

## Exact final inputs
Integrated upstream dev: `d3da796537a2f50d5e85f7c03d231c83f9f5295a` (merged PR332). Frozen production runtime bundle: `d9703b2fb278b2fd1ef8c8f55b1b7993f976c6b9a2139549e04ae7fe42ba37ff`. Logic source/test diff SHA-256 against b211: `94f217b2f88560c96ce524790840e9fdd8c89ffc843e8d268631ec23787916c6`. Total nine GLBs: 57,208,200 bytes.

| File | SHA-256 |
|---|---|
| viking-civilian/manifest.json | `0b2975e5e4c869c31fb3cc6bea038358cd706bebf260318ee2b3bb7ff64c3f24` |
| viking-civilian/lod0.glb | `fe95e98a50581906bb306cfcb13a5fe219c904eccfbe2ca2c17427a385de3652` |
| viking-civilian/lod1.glb | `9536629eda6300193197c5388246eccfda01b14d13a1c860e83fa90f43bb0a74` |
| viking-civilian/lod2.glb | `b3f8eead0b088e05b2bfa1550d8ba6d52570808c26dfe1597a3abc50421dcb45` |
| roman-civilian/manifest.json | `882373e4b43dda2fe19a671f6a5068c2f52aabbe279db218b65cba22530dcd9e` |
| roman-civilian/lod0.glb | `f20011d5b915359c497ed1ed4d45508d32f6c5cd551dd18d379269d04e670381` |
| roman-civilian/lod1.glb | `d4f558bd5e4971ac73341593676d97122446740a6c3d2a77280a7a6087e360de` |
| roman-civilian/lod2.glb | `645042dbfc47de915a3c08359f126447b9b783cb6117bcbd97b3b525a5b38196` |
| maki-archer-t4/manifest.json | `3a5ca9544196a9ab15f5ef04da6a72235b2e2b481fa74f2e3f5b358ab2a584fa` |
| maki-archer-t4/lod0.glb | `835614cd616c3dda523dcad18a63798192a46ca3611263d10f5e96cf35f03a48` |
| maki-archer-t4/lod1.glb | `e9330648f5fe2ee5468211fc84f274f27380267b130e135652231f0d07d1d831` |
| maki-archer-t4/lod2.glb | `856d32f3f023d328f774c8b157565fa6df6c0b9775a5d4b6a9a1c42c3c37ddc6` |
