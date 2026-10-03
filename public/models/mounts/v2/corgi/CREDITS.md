# Corgi

Corgi by leijiaoshou, Sketchfab, CC BY 4.0. Modified for SagaBurst.

- Model and supplied base-color map: [leijiaoshou corgi dog](https://sketchfab.com/3d-models/corgi-dog-7afb2c8ef92c40819abc690584e6772a).
- License: [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/).
- Source SHA-256: `498dcc12755599e30de1c458f2eb852609876968c89490c8616456d072a0c19d`.
- Source geometry and coat are preserved; uniform scale and heading are baked into the asset.
- SagaBurst additions: fitted canine skeleton, skin weights, idle/walk/run/death and retained jump/land/hit clips, three body LODs, saddle and stirrups.
- The original 1024px texture is preserved; geometry uses EXT_meshopt_compression. One immutable package is shared; each corgi has its own skeleton and mixer.


## Animation sources

- Idle and walk: [Doginx - Assets](https://tomate-salat.itch.io/doginx-assets) by Tomate Salat, CC0 1.0. Quadruped poses and foot trajectories retargeted and baked onto the existing SagaBurst armature.
- Run: [Dog corgi animated](https://sketchfab.com/3d-models/dog-corgi-animated-5cc0075d0aa645c398c51316236ff156) by zinaida, CC-BY-4.0. Animation retargeted, stride/timing adapted for the mount, and baked onto the SagaBurst armature. Original donor geometry and textures are not included.
- Run animation license: [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/).
- Death: authored on the SagaBurst target rig; jump, land and hit retain the existing SagaBurst animations.

Rebuild and validate through [the Blender MCP pipeline](../../../../../tools/blender/README.md). Donor file hashes, mappings and final-package verification are recorded in `animation-source.json`. Original downloads and Blender working files remain outside the shipped package.
