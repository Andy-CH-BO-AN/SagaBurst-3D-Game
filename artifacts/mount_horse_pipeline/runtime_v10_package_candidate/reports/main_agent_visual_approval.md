# Phase 23 v10 candidate — main-agent visual approval

Date: 2026-08-31

## Decision

`PASS_FOR_CANDIDATE_PROMOTION`

The candidate package may be promoted from its blocked review manifest to a
ready candidate manifest and run through the package tests. This approval does
not authorize copying files into `public/`; public replacement remains a later
main-agent step after the ready-candidate tests pass.

## Locked inputs

- Approved eye source GLB:
  `horse_runtime.v9r11.eye-v4.source-detail-v2-uv190.diagnostic.glb`
- Approved eye source SHA-256:
  `8a7990c9e43dd618b2e01868edf8926e73f6bc085424f0c785fb2eea58be6f52`
- Candidate runtime GLB SHA-256:
  `b64153367a3885953283d2b38868e57321f0c8c4ad137a8d642bc609e6b9634f`
- Candidate package size: `6,050,828` bytes
- Candidate LOD triangles: `64,986 / 20,279 / 5,916`

## Evidence personally reviewed

The following images in `renders/final_package_candidate/` were opened and
visually inspected from the actual Meshopt GLB plus KTX2 textures:

- `paint_01_front_lod0.png`
- `paint_01_side_lod0.png`
- `paint_01_three_quarter_lod0.png`
- `paint_01_eye_close_lod0.png`
- `paint_01_side_lod1.png`
- `paint_01_side_lod2.png`
- `paint_02_front_lod0.png`
- `paint_02_side_lod0.png`
- `paint_02_three_quarter_lod0.png`
- `paint_03_front_lod0.png`
- `paint_03_side_lod0.png`
- `paint_03_three_quarter_lod0.png`

## Findings

- All three variants preserve one coherent horse body, rig, tack and groom;
  only the body coat changes.
- Front, side and three-quarter silhouettes remain anatomically coherent after
  compression. No exploded head, collapsed body, detached saddle or fallen
  tail geometry is visible.
- The eye remains visible in the socket and matches the user-approved v2 eye
  candidate. The user explicitly accepted the current eye appearance before
  packaging.
- LOD1 and LOD2 preserve the horse silhouette and tack at their intended lower
  detail. LOD2 loses close-range detail as expected but does not collapse.
- Source-derived mane and tail cards retain visible hard/card edges and a few
  sparse fragments at extreme close range. The user explicitly stated that the
  groom is visually acceptable and should not block this phase, so this is a
  recorded non-blocking limitation rather than a rejection.

## Next gate

Run the packer's explicit ready-candidate promotion using the exact approved
eye SHA above, then execute the candidate package test. Do not copy the package
to `public/` until the ready-candidate test passes and the main agent performs
the public replacement step.
