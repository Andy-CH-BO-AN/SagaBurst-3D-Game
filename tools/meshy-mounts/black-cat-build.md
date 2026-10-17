# Midnight Rider Black Cat build

This builder is specific to the user-provided
`Meshy_AI_Midnight_Rider_1017070200_texture.glb`. Its source SHA-256,
measured source-space landmarks and accepted animation donor are pinned in
`black-cat.json`. A changed source must be remeasured; do not remove the checks.
The original GLB and Blender working files are not repository assets.

## Reproduce the staged candidate

Run from the repository root with Blender 4.3.2 and the repository's npm
dependencies installed:

```sh
node tools/meshy-mounts/prepare-black-cat-donor.mjs output/meshy-cat/donor
blender -b -t 4 --python tools/build-meshy-black-cat.py -- \
  /absolute/path/to/Meshy_AI_Midnight_Rider_1017070200_texture.glb \
  output/meshy-cat/donor/accepted-black-cat-decoded.glb \
  output/meshy-cat/staging
```

The donor extractor reads the immutable asset at commit
`2b3447f990772cc133f5cff28a5b96c2763a7e8d`; it never reads the newly replaced
runtime file. It verifies both the compressed donor and decoded GLB hashes.
The seven accepted animations retain their individual motion sources and
provenance. Only their animation transforms are transferred; no old animal,
saddle, texture or geometry correction is used.

## Contracts

- Source is Blender Z-up / -Y-forward. Uniform scale is 2.05; the source paw
  ground and the forward offset are baked into exported vertex and rig positions.
- The measured 25-node contract includes the existing saddle and camera sockets.
- One shared rig drives all body, equipment and off-mode LOD meshes.
- Body/gear cut boundaries inherit identical weights from the complete source
  heat solver. The seat and pannier remain anchored to the back.
- `repair-black-cat-muzzle.py` removes the locally identified malformed whisker
  web, repairs only its open footprints and cleans affected source texture pixels.
  `reconstruct-black-cat-fur.py` classifies fused tack using measured position
  and source albedo, retaining exposed fur and building a continuous concealed
  torso. Its graft normals include sampled source tangent-map shading.
- The complete off skin has its own temporary heat solve so rigid armor weights
  are not transferred into reconstructed anatomy. These solvers are build-only.
- A thin reserved atlas strip supplies neutral-normal fur and six batched
  whiskers, without extra material primitives or six separate draw calls.
- The off-mode complete skin has `replacesEquippedBody: true`. It preserves
  original exposed fur and reconstructs only the region concealed by fused tack.
- LOD-only geometric seam welding preserves loop UVs and source corner normals
  before decimation; this avoids dropping isolated glTF render triangles.
- Geometry simplification is offline. Runtime distance and animation state APIs
  remain unchanged.
- Per-frame exported-pose grounding corrects local mesh penetration, without
  changing the Mount gameplay root, collision, movement or jump physics.

## Validation gate

The builder emits a staging GLB, editable staging blend and numerical build
report. This is not automatic visual acceptance. Before publication inspect
round-tripped exported GLB images for all seven actions, multi-phase gait,
face/whisker close views, equipment-off seams, each LOD, and rider contact.
Run `tools/audit-meshy-mounts.mjs` outside the logic-test runner. Gameplay and
performance validation require the actual browser/runtime; Blender previews
must be labelled as such. Keep the PR Draft when those checks are unavailable.

## Pack the reviewed candidate

The existing shared texture and byte-exact buffer packers are reused:

```sh
python tools/meshy-mounts/pack-mount-textures.py \
  output/meshy-cat/staging/black-cat.glb \
  output/meshy-cat/staging/black-cat-textures.glb 2048
node tools/meshy-mounts/pack-mount-buffers.mjs \
  output/meshy-cat/staging/black-cat-textures.glb \
  output/meshy-cat/staging/black-cat-packed.glb
```

Base color uses opaque JPEG95 without chroma subsampling. The 2048 normal map
is normalized and encoded as PNG; this normalization is not pixel-byte identity.
The 1024 metallic/roughness map remains PNG. The separate buffer audit proves
geometry, skin and animation buffer bytes survive Meshopt packing unchanged.
The final packed package must be decoded and re-imported for visual review,
then tested through the actual runtime loader before replacing the public asset.

## Local repair audit and remaining source detail

The accepted cap repair removes 298 malformed source triangles, retains 10,024
source triangles with their exact positions/UVs/smooth flags, and adds 1,898
locally retriangulated cap triangles. All 38 removed-muzzle boundary segments
are covered. The separate source-space audit measured maximum seam deviation
of 5.27e-8, zero cap winding conflicts, duplicate faces, detected non-coplanar
intersections or coplanar overlaps. Four tiny original open edge segments
outside the muzzle remain; the source as a whole is not claimed watertight.

A small closed cheek shading indent and a narrow shoulder fur-shading transition
remain visible at extreme close range. Contracted upper-leg poses can produce
small folds beneath the original tack. These are art limitations, not new
movement/health/collision rules. Final packed-asset evidence must be associated
with its exact SHA rather than reused from earlier authoring candidates.
