# T4 Black Cat — source-preserving replacement

The user supplied `Meshy_AI_Character_output (1).glb` and confirmed ownership and permission to submit the modified asset. The original file is an external rebuild input; this record does not assign an open-source license to it.

- Source SHA-256: `59c10fb0582b5dd90d3e281a73ad4b522ef33213506b315470b1382f6d521c4b`
- Source: 30,266 triangles, 23,515 vertices, 53 bones, no animation clips.
- Every source triangle is retained exactly once in equipped LOD0, including the original saddle, bags, stirrups, fur, face, whiskers and tail. Rest positions, corner normals, UVs, material settings and three original JPEG images are unchanged.
- Only skeleton animation, skin weights, sockets and separate distant LODs were adapted. The latest requested scope is the equipped black cat; there is no reconstructed unequipped geometry.

## Animation provenance

All seven clips come from the production black cat at commit `ea18eff8ceab74e88afc738019127792ea03e311`, path `public/models/mounts/v2/black-cat/black-cat.glb`, SHA-256 `37c23b7cc3042c8d3aa23f03ca1484ac8f65e07f5ed9b92c0c4214ee1439695b`. The immutable Git version is the donor; the new output must never be used as its own input.

The donor credits [Doginx — Tomate Salat](https://tomate-salat.itch.io/doginx-assets) under CC0 for idle/walk poses, and [Lowpoly Cat + Run Animation — Daily Lowpoly](https://dailylowpoly.itch.io/lowpoly-cat-running) with the creator's permission for commercial-project use. SagaBurst's retained jump, land, hit and authored death motion are inherited from the pinned donor. `animation-source.json` preserves these source hashes and the new offline bake mapping.

The replacement uses source-rest basis adaptation. Walk/run retain donor duration and contact order, with source-length IK and stance timing adapted to this smaller skeleton. It does not claim identical trajectories. No animation is retargeted every frame at runtime.

## Rebuild and verify

Run from repository root. The production dependency versions remain unchanged. The build-only simplifier is meshoptimizer **1.3.0**; the existing production Meshopt encoder/decoder remains **0.18.1**.

```sh
rtk proxy mkdir -p output/black-cat-v3
rtk proxy git show ea18eff8ceab74e88afc738019127792ea03e311:public/models/mounts/v2/black-cat/black-cat.glb > output/black-cat-v3/donor.glb
rtk proxy npm install --prefix output/black-cat-v3/build-deps --no-save --package-lock=false --ignore-scripts meshoptimizer@1.3.0
rtk proxy node tools/blender/build_black_cat_v3.mjs --source '/absolute/path/Meshy_AI_Character_output (1).glb' --donor output/black-cat-v3/donor.glb --output output/black-cat-v3/build --simplifier output/black-cat-v3/build-deps/node_modules/meshoptimizer/meshopt_simplifier.js
rtk proxy node tools/validate-black-cat-v3.mjs --source '/absolute/path/Meshy_AI_Character_output (1).glb' --asset output/black-cat-v3/build/black-cat.glb --donor output/black-cat-v3/donor.glb --transform-json output/black-cat-v3/build/source-transform.json --regions-json tools/blender/black_cat_v3_regions.json --report output/black-cat-v3/contract-audit.json
```

The source-to-game transform is identity: meters, +Y up and +Z forward. The builder reads exact source corner attributes directly, partitions the reviewed source face IDs, repairs weights on the original surface, bakes 60Hz clips and derives LOD1/2 from independent copies. Meshopt encoding does not quantize LOD0. `black_cat_v3_regions.json` is a reviewed source-specific partition, not a generic color threshold to rerun on arbitrary assets.

`audit.json` is the independent final asset check. It proves triangle correspondence, material/image preservation, original binds, clip durations, rigid saddle distances and shared body/gear seams. It does not prove natural motion or gameplay. Final browser evidence and performance results belong in `asset-report.json` and the PR.

Known limits: the original high-resolution texture payload is retained; close underside poses still have fur compression near the fixed saddle. A model-space run sample at phase 0.13 reaches 8.15mm below zero; this is recorded rather than called perfect foot contact. The source rig retains 53 bones and 54 baked channels per clip, including constant offset/restoration tracks.
