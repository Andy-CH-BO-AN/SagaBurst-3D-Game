# Meshy Saddled Corgi Knight build

This is a source-specific offline build. Do not run the old `build-corgi.py`
geometry masks on this model. Blender 4.3.2 and the repository Node dependencies
are required. The concealed-body solve additionally uses system Python NumPy
and SciPy; set `MESHY_PATCH_PYTHON` if that interpreter is not `python`. Keep
source, decoded donor, `.blend`, and previews in ignored
`output/`, not the public asset directory.

## Inputs

- User-supplied `Meshy_AI_Saddled_Corgi_Knight_1017070214_texture.glb`
- SHA-256: `0d0a7925220ef045b7c70ed7071248565b742d76ea3d356d64b19f49a90175df`
- Meshy free-plan source, CC BY 4.0, provided by repository owner.
- Original: 10,336 triangles; one mesh/material; 2048 base/normal and 4096 MR.
- Accepted animation donor at repository commit `2b3447f`:
  `public/models/mounts/v2/corgi/corgi.glb`
- Donor SHA-256: `601720262ab8ea55ce1c3a7bc684f6202618123d7282515ee9f6f0365cfd392f`
- Decoded donor SHA-256:
  `2afa16764607268b84123dfec818aac141fc1c1fb2afdb4ebd6a51bab19bf5fa`

Extract the donor from that commit before replacing the public file:

```sh
mkdir -p output/meshy-corgi
git show 2b3447f:public/models/mounts/v2/corgi/corgi.glb > output/meshy-corgi/donor-packed.glb
```

Run `node tools/meshy-mounts/prepare-corgi-donor.mjs output/meshy-corgi/donor`
for verified extraction and decode using the existing `animal_glb.mjs` helper.
Install the pinned offline UV-aware simplifier without changing runtime
dependencies or the repository lockfile:

```sh
npm --cache output/npm-cache install --prefix output/meshy-tools --no-package-lock --ignore-scripts meshoptimizer@1.3.0
```

`MESHY_SIMPLIFIER_PATH` can point to that pinned package’s
`meshopt_simplifier.js` in a different staging directory. Then invoke:

```sh
blender -b -t 3 --python tools/build-meshy-corgi.py -- \
  /path/to/Meshy_AI_Saddled_Corgi_Knight_1017070214_texture.glb \
  output/meshy-corgi/donor/accepted-corgi-decoded.glb output/meshy-corgi
```

The builder verifies both input hashes. It emits a staged GLB, Blender scene,
and measured build report. Promotion requires separate asset audit and visual
review. A successful export is not gameplay acceptance.

## Geometry and animation contract

The source front is Blender -Y, exported as gameplay +Z. Uniform scale is 1.65;
source paw minimum establishes the ground. Rest joints are measured against
this short-legged model, not copied from the donor animal. Existing 21 joint
names and both saddle/camera sockets are retained.

A few long source leg triangles are conformingly subdivided in the original
triangle plane, with interpolated UVs and normals. This retains the rest surface
and silhouette while giving the short paw bends adequate skinning resolution.
Visible source subsets are extracted without welding, retaining per-corner
normals and UVs. The original saddle and armor remain the equipped surface.
Equipment-off uses an inverse-visible reconstructed torso, because source
body and tack are fused. The source head, ears and visible legs are retained.
No second saddle is added. Both visibility modes require visual review.

All three LODs share the same bind space and joint contract. Lower LODs use the
pinned Meshopt 1.3.0 simplifier with locked cut borders, fold preservation,
UV/normal attribute-error weighting and index-only reduction.
Position/UV-equivalent render vertices are compacted before simplification; the
selected original position, UV and normal samples remain unchanged. This avoids
Blender collapse averaging leather atlas pixels onto exposed fur. The conservative
LOD2 error limit may stop above the requested triangle target. Original body and
equipment duplicate boundary positions use identical skin weights. Saddle
interior lies outside limb influence bands. A source-derived fur atlas strip
supports the boundary-constrained concealed-body patch; every original PBR UV is remapped consistently,
including the lazily loaded normal map. MR is reduced to 1024.

The seven accepted clips are sampled at 60 Hz and retargeted through old/new
rest bases. No clips are renamed to fake missing actions. Root ground correction
is measured from evaluated geometry; horizontal motion remains gameplay-owned.

Animation attribution remains Doginx by Tomate Salat (CC0) for idle/walk and
Dog corgi animated by zinaida (CC BY 4.0) for run, with the accepted SagaBurst
jump/land/hit/death derivation. See the retained animation-source provenance.

## Final packing

```sh
python tools/meshy-mounts/pack-mount-textures.py \
  output/meshy-corgi/corgi-staged.glb output/meshy-corgi/corgi-textures.glb
node tools/meshy-mounts/pack-mount-buffers.mjs \
  output/meshy-corgi/corgi-textures.glb output/meshy-corgi/corgi-packed.glb
```

Pillow is needed by the texture step. Base color is JPEG quality 95 with no
chroma subsampling, 2048px. Normal is PNG 1024px with normalized vectors; MR is
PNG 1024px. The Meshopt step verifies every non-image buffer view round-trips
byte-exactly through both repository and Three.js decoders. It does not quantize
skin weights, bind matrices, animation tracks or sockets.

The death clip uses a smooth, surface-measured visual-root settle beginning at
15% and completing at 65% of its original duration. Only positive local
clearance is settled; measured penetration is corrected in all clips. Gameplay
root height, jump motion and movement speed are unchanged.

The idle clip has a fixed donor limb offset that raises a front paw on the new
short-legged rest rig. Its limb rotations are normalized against the donor idle
first frame while preserving animated deltas, torso/head/tail motion and the
original 10-second duration. The six other clips are unchanged by this fix.
