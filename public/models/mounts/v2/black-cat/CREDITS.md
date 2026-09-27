# Black Cat

Black Cat by 3D Creator (3DChuang-Ke-Ji), Sketchfab, CC BY 4.0. Modified for SagaBurst.

- Model and supplied base-color, normal and roughness maps: [3D Creator's Black Cat](https://sketchfab.com/3d-models/black-cat-dd0adc10d8b94bc99dfffe0268818e0b).
- License: [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/).
- Source SHA-256: `4aec818094bf09a57ff44a24ea0be24a1cf7100f4e7a4b632c21df4dc92f2b57`.
- Source geometry and coat are preserved; uniform scale and heading are baked into the asset.
- SagaBurst additions: fitted feline skeleton, skin weights, forward-facing neck and head pose, idle/walk/trot/canter/gallop/jump/land/hit/death clips, three body LODs, saddle, stirrups and leather plates.
- Textures are reduced to 2048 pixels; geometry uses EXT_meshopt_compression. One immutable package is shared; each cat has its own skeleton and mixer.

Rebuild with `tools/build-black-cat.py`, inspect staged rest and animation exports, then run `tools/package-black-cat.py`. Original downloads and Blender working files remain outside the shipped package.
