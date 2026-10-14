# Selected T5 asset pipeline

The only source is `Roman_Steppe_Selected_Complete.zip`. Extract it into ignored
`output/t5-selected-source/`; retain the supplied README, verification and preview
files. The importer verifies both selected GLB SHA-256 values before writing a
candidate. It never loads the previous Roman/Steppe archives.

```sh
rtk proxy node tools/import-selected-t5.mjs output/t5-selected-source output/t5-selected-candidate
```

LOD0 retains the source mesh, UVs, textures, all weights, bind matrices, hierarchy
and eleven clips. The approved exception is Roman's two axe clips: their eighty
finger rotation channels use the source cupped rest pose. Body/wrist channels,
key times, interpolators and all other animations remain unchanged. The manifest
records the original source hash, delivered file hash and exact changed channels.

The runtime adapter preserves Roman's 66 joints and all four influence sets,
adds equipment sockets, and scales the whole character uniformly to same-faction
T4 body landmarks. Steppe retains its 37 joints, five skirt helpers and rigid
scabbard. Identical LOD bind spaces and animation samples are checked before
sharing one actor-owned skeleton/mixer across its three meshes. Runtime clips
omit only properties equal to bind in every source clip; raw clips stay intact. Source axe durations stay 3 / 2.833333 seconds; the runtime maps the full
take to the existing 0.48-second combat cycle before weapon/hero speed modifiers.

After LOD0 equipment and mounted visual acceptance, promote that reviewed LOD0
and manifest to its `public/models/characters/v2/<faction>-hero-t5/` directory.
Create lower-LOD candidates using the repository's Node dependencies and Pillow:

```sh
rtk proxy node tools/simplify-selected-t5.mjs output/t5-lod-candidate
rtk proxy python3 tools/resize-selected-t5-textures.py output/t5-lod-candidate
rtk proxy node tools/pack-selected-t5-lods.mjs output/t5-lod-candidate output/t5-lod-candidate/assets
rtk proxy env T5_ASSET_ROOT=output/t5-lod-candidate/assets npm test -- tests/assets/T5CommanderAssets.test.ts
```

The conservative index-only simplifier protects head/hand/scabbard triangles and
locks UV boundaries. Retained positions, UVs, normals and all influence sets use
the source values. The packer preserves original joints, inverse binds and all
animation samples. Lower-LOD textures are 1024 / 512 pixels in the source UV
frame; LOD0 is unchanged. The supplied mesh has many UV boundaries, so this
quality-preserving method stops above the suggested 7–9K / 3–5K reference budgets.
Report actual counts and performance rather than accepting damaged armour to
meet the reference numbers. Aggressive Blender collapse/rebake candidates were
rejected during visual review; they are not the shipped pipeline.

Package tests establish loading, attachments, animation state and ownership,
not visual acceptance. Compare all LODs from the front, side and back, including
movement, equipped attacks and all mounts. Promote only reviewed candidates;
reload the preview to avoid retaining old registry templates. Preserve source
licensing notices verbatim and distinguish the source verification warnings
from runtime acceptance.

Run the independent 100-NPC A/B benchmark after all assets/runtime edits finish:

```sh
rtk proxy node tools/benchmark-hero.mjs --host=localhost:5173 --faction=all --view=all --runs=3 --max-runs=5 --warmup-ms=6000 --observation-ms=20000 --cycles=5 --out=output/t5-acceptance/benchmark.json
```

Use local headed Chrome with the actual GPU and unchanged quality. No concurrent
Blender, build, test or browser QA. This is a DEV-instrumented real Game/NPC/melee
loop, not an uninstrumented production benchmark. The report preserves asset
hashes, actual LOD counts, GPU timer availability, renderer submissions, CPU
costs, frame statistics and repeated load/unload resource checkpoints. A failed
visual or performance gate is not a finished integration.
