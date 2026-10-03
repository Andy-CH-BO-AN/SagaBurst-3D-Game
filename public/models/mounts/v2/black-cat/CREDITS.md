# Black Cat

Black Cat by 3D Creator (3DChuang-Ke-Ji), Sketchfab, CC BY 4.0. Modified for SagaBurst.

- Model and supplied base-color, normal and roughness maps: [3D Creator's Black Cat](https://sketchfab.com/3d-models/black-cat-dd0adc10d8b94bc99dfffe0268818e0b).
- License: [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/).
- Source SHA-256: `4aec818094bf09a57ff44a24ea0be24a1cf7100f4e7a4b632c21df4dc92f2b57`.
- Source geometry and coat are preserved; uniform scale and heading are baked into the asset.
- SagaBurst additions: fitted feline skeleton, skin weights, forward-facing neck and head pose, idle/walk/run/death and retained jump/land/hit clips, three body LODs, saddle, stirrups and leather plates.
- Textures are reduced to 2048 pixels; geometry uses EXT_meshopt_compression. One immutable package is shared; each cat has its own skeleton and mixer.


## Animation sources

- Idle and walk: [Doginx - Assets](https://tomate-salat.itch.io/doginx-assets) by Tomate Salat, CC0 1.0. Quadruped poses and foot trajectories retargeted and baked onto the existing SagaBurst armature.
- Run: [Lowpoly Cat + Run Animation](https://dailylowpoly.itch.io/lowpoly-cat-running) by Daily Lowpoly, Creator permits use in commercial projects. Animation retargeted, stride/timing adapted for the mount, and baked onto the SagaBurst armature. Original donor geometry and textures are not included.
- Death: authored on the SagaBurst target rig; jump, land and hit retain the existing SagaBurst animations.
- Skin correction: narrow front-wrist blend with rigid distal paws; lumbar/rump and adjacent tack follow the torso while the tail root stays continuous. Source vertex positions, UVs, materials and rest skeleton are preserved.

Rebuild and validate through [the Blender MCP pipeline](../../../../../tools/blender/README.md). Donor file hashes, mappings and final-package verification are recorded in `animation-source.json`. Original downloads and Blender working files remain outside the shipped package.
