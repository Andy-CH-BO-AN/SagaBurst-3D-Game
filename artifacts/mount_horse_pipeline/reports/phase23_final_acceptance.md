# Phase 23 Final Acceptance — Realistic Warhorse Runtime

Date: 2026-09-01

## Decision

`PASS`

The external realistic horse is the default new-game, scene and NPC cavalry mount.
Legacy `BLACK_CAT` and `CORGI` save IDs remain loadable with their previous
committed procedural appearance; their unfinished external rebuild was removed.

## Shipped asset

- Manifest: `public/models/mounts/v1/horse/manifest.json`
- Runtime GLB: `public/models/mounts/v1/horse/horse_runtime.glb`
- Runtime SHA-256: `097b3d5e4144749b1e4d9d1aaea3cc72393cbd3366d30926c496b485814cde63`
- Package: 6,050,753 bytes, one 80-joint skin, nine clips, 48 KTX2 textures,
  Meshopt geometry and the Basis transcoder.
- LOD triangles: 64,986 / 20,279 / 5,916.
- Variants: three source-derived body coats; tack, mane, tail, hooves and eyes
  remain shared.
- Attribution: fdoss001 source page declaration (CC0), Tarnyloo base mesh
  attribution (CC BY 3.0), Quaternius motion reference (CC0).

## Automated gates

- `npm test -- --run`: PASS, 3 files and 62 tests.
- `npm run build`: PASS.
- `git diff --check`: PASS.
- Expected non-blocking build notices: Vite CJS API deprecation and a generated
  JavaScript chunk larger than 500 kB.

## Browser acceptance

### Isolated studio

- URL: `http://127.0.0.1:5173/?devmodels=mounts&nolock`
- Hard reloaded after the final constructor/rig changes.
- Cycled all three body coats; only the horse coat changed.
- Inspected idle, walk, trot, canter, gallop, jump, land, hit and death.
- Reached LOD0, LOD1 and LOD2 by orbiting through their distance thresholds.
- Toggled skeleton and rider. The pelvis sits on the saddle, knees bend
  forward/down, feet remain near the stirrups and the earlier reversed-knee
  double-pose defect is gone.
- Repeated variant and LOD cycles after warm-up. Studio counters remained at one
  mixer/one skeleton and 108 geometries/101 textures.
- No console error or warning pointed to `src/`, Vite, a project asset or a game
  class. Observed warnings were Chrome-extension/MetaMask stream noise only.
- Evidence: `output/browser/phase23-horse-studio-idle.png` and
  `output/browser/phase23-horse-rider-side.png`.

### Release 10v5 diagnostic

- URL: `http://127.0.0.1:5173/?nolock`
- Result: scene and horses loaded, battle ran, no crash and no application
  console error.
- Evidence: `output/browser/phase23-release-10v5.png`.
- Non-blocking observation: the first scene load took roughly 25 seconds and the
  initial camera can be partly obstructed by the central training dummy.

### 50v50 stress diagnostic

- URL: `http://127.0.0.1:5173/?devcombat&nolock`
- Result: 104 horses (100 cavalry plus four world horses) and 104 mixers ran
  without a crash or application console error.
- Observed FPS: about 23–31.
- LOD snapshot: 54 / 14 / 36 at the later sample.
- Geometry remained stable at 1,447. Textures changed once from 3,084 to 3,085
  during late first-use upload; no continuing growth was observed.
- Evidence: `output/browser/phase23-devcombat-50v50.png`.
- Non-blocking observation: some distant NPC formations appear outside or above
  the terrain and should be investigated independently from the horse asset.

## Accepted limitations and follow-up TODO

- Source-derived mane/tail cards can reveal card edges at extreme close range;
  the user accepted the current groom. Eyelashes are not a blocker.
- Blender 5.2's installed importer cannot freshly import the package's external
  `KHR_texture_basisu` images. Static GLB/KTX2 audits and browser rendering pass;
  this remains a tooling limitation.
- Profile the 25-second cold load and 23–31 FPS stress result without changing
  horse appearance or animation semantics.
- Investigate distant 50v50 formation terrain placement.
- Restart Black Cat/Corgi anatomy, topology, rig, materials and animation only as
  a separate later phase after horse behavior remains stable.

## Cleanup

Removed untracked and superseded horse candidates v2–v9, rejected public backups,
diagnostic work `.blend` files, duplicate v10 package/build output, rejected renders,
Playwright scratch files and the unfinished Black Cat/Corgi Stage-1 sculpt tree.
The original 584 MB source `.blend` remains in Downloads and is identified by its
hash in the retained source audit.
