# Tiered faction soldiers

Only the four new ordinary T1/T2 bodies are built here. Existing Roman/Viking T3,
heroes, civilians, Bandit, merchant and mounts remain their current assets.

## Inputs and ownership

The owner supplied these Meshy archives and confirmed on 2026-10-25 that they own
these models and may publish them with this game. This is not a claim that the
models or the mixed animation data are CC0 or any other inferred public license.
Keep downloaded archives and extracted sources outside `public/`.

| Asset | Exact archive | Source appearance |
| --- | --- | --- |
| roman-t1 | Meshy_AI_Roman_Soldier_Rigged_biped.zip | White tunic, simple helmet, no chest armour |
| roman-t2 | Meshy_AI_roman_soldier_rigged_biped (1).zip | Red tunic, mail, helmet |
| viking-t1 | Meshy_AI_Rigged_Medieval_Warri_biped.zip | Cloth and fur mantle, no helmet |
| viking-t2 | Meshy_AI_rigged_warrior_biped.zip | Blue cloth, mail, helmet |

Extract each archive beneath an input directory named for its asset ID. The builder
checks the exact original FBX SHA-256; different sources require a fresh audit.

## Rebuild

From the repository root:

```sh
blender -b --python-exit-code 1 --python tools/build-tiered-faction-soldiers.py -- /path/to/extracted-input-root
node tools/retarget-tiered-faction-soldiers.mjs public/models/characters/v2
blender -b --python-exit-code 1 --python tools/audit-tiered-source-preservation.py -- /path/to/extracted-input-root
node tools/audit-tiered-faction-soldiers.mjs
# Inspect the uncompressed exported animation, hand grip and clothing first.
node tools/retarget-tiered-faction-soldiers.mjs public/models/characters/v2 --pack
node tools/audit-tiered-faction-soldiers.mjs
```

The first step preserves original body skin and source vertex positions, uniformly
normalizes the source envelope, refines only source hand-owned faces for bending,
and adds thirty fitted deforming finger bones. Original non-hand topology and UV
corners remain unchanged; inserted hand vertices interpolate the original surface.
Each original hand-owned vertex may redistribute its hand weight only to that
hand's finger chain; no closest-bone body re-skinning or blanket top-four truncation
is performed. Source `Spine02/Spine01/Spine` versus Mixamo `Spine/Spine1/Spine2`
are mapped by their audited hierarchy, not by a prefix-only rename.

The anatomical retarget reuses existing animation source clocks and events. Viking
body motion stays Viking; its missing finger motion is supplied by the existing
Roman finger-only bake. The wrapper checks that Viking body channels are unchanged.
Measured `fingerPoseCorrections` in Blender metadata optionally apply target-local
XYZ finger-only postrotations (radians), with per-action overrides. Existing
right-hand bow/pilum release events fade the added grip away; body tracks and
action durations are digest-guarded unchanged.
All LODs retain matching bones, sockets and clips. The wrapper pads all four
JOINTS/WEIGHTS sets and marks `skinInfluenceSets: 4` so the runtime complete-skin
plugin retains source weights beyond four influences; default Three.js skinning
alone is not a valid visual reference for these assets. Conservative simplification
protects head, hands and soles; embedded maps are resized to 2048/1024/512.
The final buffer pack is the existing byte-exact Meshopt path.

## Validation boundary

`blender-measurements.json`, `bone-map.json`, and animation/structural audits record
source identity, hand-only weights, bindings and serialization. They do not prove
visual acceptance. Inspect exported action poses, actual equipment and mounted
contact in the existing preview/runtime, including low LODs, before claiming them
verified. One-off images stay in ignored `output/`. No performance benchmark is
required or run by this pipeline.

### Current sampled offline review (2026-10-25)

Source front/hand renders confirm the four requested appearances. Initial sparse
finger faces produced pointed wedges, and aggressive Viking T1 low LOD distorted
cloth. These iterations were rejected. The final build adds hand-only linear
surface subdivision, smooth proximal-web weight transitions and target-local
finger curl/opposition offsets; it also uses conservative protected LOD reduction.
All four final sword/bow mock-handle closeups were inspected: fingers wrap the
handle and the thumb opposes it without the initial explosive pointed wedges.
The source's low-poly faceting, flattened digit sides and local creases remain;
this is not a photorealistic or zero-intersection claim.

Four right-hand bow-release samples before/after release show a hooked pose
relaxing; ranged right-hand offsets are disabled so the existing string action
is retained. Full-body idle/run/axe/pilum/bow and low-LOD samples were inspected
for major deformation. These are sampled offline Blender renders, not exhaustive
all-frame acceptance or actual game equipment contact. Actual runtime weapons,
seat contact, camera/LOD transitions and runtime-generated hit/death still require
runtime review. Keep the PR a Draft while those checks remain unverified.

Reproduce selected views **before packing** (Blender does not decode this repo's
final Meshopt payload):

```sh
blender -b --python tools/render-tiered-soldier-review.py -- full bowRelease .3 0 output/tiered-sources/final-bow-full.png
blender -b --python tools/render-tiered-soldier-review.py -- full idle .25 2 output/tiered-sources/final-lod2-full.png
blender -b --python tools/render-tiered-soldier-review.py -- grip viking-t2 bowHold .3 l output/tiered-sources/viking-t2/grip-final-l.png
blender -b --python tools/render-tiered-soldier-review.py -- grip viking-t2 bowRelease .8 r output/tiered-sources/viking-t2/release-.8.png
```

The grip cylinder is a mock diagnostic; right bow-release views omit it. The
closeup camera uses a 1 mm near clip to avoid mistaking clipped helmets for holes.
Render time is not recorded or used as a performance measure.

The existing `MultiInfluenceSkinning` runtime plugin is required, not stock Three.js
four-weight skinning: manifests opt in with `skinInfluenceSets: 4`, and the retarget
wrapper pads unused sets with zero weights. Original additional influences are
preserved rather than truncated.

A final Viking T1 bow-release closeup exposed a thumb MCP self-fold (not a torn
UV seam). Only that right thumb MCP now eases to its target bind rotation over
0.12 s after the existing projectile-release event. Its pre-release hook, all
other finger/body tracks and all clocks/events remain unchanged. This correction
is specific to Viking T1; the other three assets are unchanged.
