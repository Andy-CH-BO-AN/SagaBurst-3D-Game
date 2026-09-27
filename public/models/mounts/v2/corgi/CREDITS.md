# Corgi

Corgi by leijiaoshou, Sketchfab, CC BY 4.0. Modified for SagaBurst.

- Model and supplied base-color map: [leijiaoshou corgi dog](https://sketchfab.com/3d-models/corgi-dog-7afb2c8ef92c40819abc690584e6772a).
- License: [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/).
- Source SHA-256: `498dcc12755599e30de1c458f2eb852609876968c89490c8616456d072a0c19d`.
- Source geometry and coat are preserved; uniform scale and heading are baked into the asset.
- SagaBurst additions: fitted canine skeleton, skin weights, idle/walk/trot/canter/gallop/jump/land/hit/death clips, three body LODs, saddle and stirrups.
- The original 1024px texture is preserved; geometry uses EXT_meshopt_compression. One immutable package is shared; each corgi has its own skeleton and mixer.

Rebuild with `tools/build-corgi.py`, inspect staged rest and animation exports, then run `tools/package-corgi.py`. Original downloads and Blender working files remain outside the shipped package.
