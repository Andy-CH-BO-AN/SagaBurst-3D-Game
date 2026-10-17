# Saddled Corgi Knight

Model created with Meshy – CC BY 4.0 License.

- Source: user-provided `Meshy_AI_Saddled_Corgi_Knight_1017070214_texture.glb`, created with the Meshy free plan.
- Meshy: https://www.meshy.ai/
- License: https://creativecommons.org/licenses/by/4.0/
- Source SHA-256: `0d0a7925220ef045b7c70ed7071248565b742d76ea3d356d64b19f49a90175df`.
- Source: 10,336 triangles, one mesh/material, 2048 base/normal and 4096 metallic-roughness maps.
- SagaBurst changes: uniform scale/ground normalization, measured short-legged canine rig and weights, source saddle/armor visibility separation, concealed-body reconstruction, local conforming leg refinement, three conservative LODs, texture optimization and Meshopt compression.
- The original visible fur/head/ear/paw surfaces and original equipped saddle design are retained. The concealed unarmored torso is reconstructed; small coat-color transitions may remain at the cut border.

## Animation sources

- Idle and walk: [Doginx - Assets](https://tomate-salat.itch.io/doginx-assets), Tomate Salat, CC0 1.0.
- Run: [Dog corgi animated](https://sketchfab.com/3d-models/dog-corgi-animated-5cc0075d0aa645c398c51316236ff156), zinaida, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- Death: SagaBurst-authored collapse. Jump, land and hit derive from the existing accepted SagaBurst clips.
- Accepted donor is pinned to commit `2b3447f`, package SHA-256 `601720262ab8ea55ce1c3a7bc684f6202618123d7282515ee9f6f0365cfd392f`. Donor geometry and textures are not included.
- Seven clips are retargeted to the newly measured rest skeleton. The visual death root settles onto the measured model surface; gameplay movement remains unchanged.

- Historical donor model: [Corgi by leijiaoshou](https://sketchfab.com/3d-models/corgi-dog-7afb2c8ef92c40819abc690584e6772a), CC BY 4.0. Listed for derivation history; old geometry and textures are replaced.

See `animation-source.json` for the retained donor chain and [the reproducible build instructions](../../../../../tools/build-meshy-corgi.md). Source downloads, Blender authoring files and intermediate previews are not shipped. Offline asset review does not establish Browser gameplay or GPU performance acceptance.
