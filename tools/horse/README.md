# Lightweight horse rebuild

From the repository root, with Node dependencies installed, Python with Pillow,
and KTX-Software **4.4.2**:

```sh
node tools/horse/build-lightweight-horse.mjs --source=/path/horse.glb --toktx=/path/toktx --python=/path/python --out=output/horse-build
```

The source-specific repair rejects an unexpected GLB hash. The animation/saddle
donor is read from commit `db7e0c0`; shallow clones may pass `--donor=/path/original-horse_runtime.glb`.
Both original files remain external. Output is staged, never published automatically.
Inspect `tacked.glb` in Blender and `package/horse_runtime.glb` through the game loader
before replacing the public package. The retired v10-only LOD consolidation script is available in Git history,
not a rebuild entry point for this topology.

Pipeline: repair body coordinates/normals/winding → split verified native timeline
and retarget missing motion in world rest space → fit leg lengths using FABRIK →
bake sampled ground clearance → simplify LOD indices → fit the existing saddle and
sockets → tint and compress textures → measure and compress the package.

The source body has a mirrored ×1000 coordinate discrepancy relative to mane/tail.
Only its positions, normals and winding are repaired; original topology, UVs and
weights are retained. Source joints and per-instance skin ownership remain intact.
The additional 848 saddle triangles are included in every LOD's reported total.
The pad is subdivided once and the leather/cloth inherits nearby body skin weights
so the animated back does not cut through it. Its surface is fitted to the posed
back and flanks before inverse skinning into the export bind space.

The seat socket follows the chest and preserves the runtime's existing +0.45 m
pelvis offset. Its height comes from the posed rider's approximately 0.138 m
pelvis-to-contact distance above the measured saddle surface. Gait reference speeds
come from the median backward hoof velocity during sampled contact at source cadence;
these calibrate visual playback only. Inspect actual moving transitions as well as
isolated clips; sampled clearance does not certify arbitrary terrain or blend poses.

The intermediate GLB uses PNG/JPEG textures for Blender inspection. The final
Meshopt/KTX2 package must additionally be inspected in a fresh browser instance.
Build output, screenshots, contact samples and benchmark data belong under ignored
`output/`; unit tests must not load or construct models.

## Armored warhorse

The independent package is `public/models/mounts/v1/armored-horse/`. Its source is
the repository owner's Meshy GLB, SHA-256
`cd3e443eec8d404c4cc4b1b8f800ade5c6679533de1847a78ac1d7a3e4b36ad2`.
It keeps the original texture content, normal/UV corners and horse/barding silhouette,
with one uniform scale and -X → +Z rotation. The existing horse's 70 joints and nine
clips are reused; the ordinary horse package is untouched.

```sh
rtk proxy node tools/horse/build-armored-horse.mjs /path/source.glb /path/toktx
```

This stages `output/armored-warhorse/roundtrip.glb`. Through the dedicated Blender
MCP scene, set `ARMORED_HORSE_STAGE` to that absolute staging directory and execute
`tools/horse/simplify-armored-horse.py`. Then repeat the Node command to package
the reviewed Blender LODs. A first-pass package without reviewed LOD data remains
blocked. Texture compression is cached in staging; remove staging textures when
changing the source/compression recipe. KTX-Software 4.4.2 is used.

`armored-horse-regions.json` pins source triangle ownership. The scan welds leg fur
into the barding and tail, and contains intentionally open hair cards. The builder
retains those cards, splits the hidden lower-leg collars without changing their
rest surface/UVs, closes new boundaries and connects the four flexible legs to the
actual shoulder/hip pivots inside the barding. New collar geometry uses a separate
fur UV patch; it must not interpolate across unrelated atlas islands. Complete
barding follows torso/neck supports; tail ownership never includes leg bones.
Blender simplification only welds vertices with identical skin ownership so distant
LODs cannot reconnect the separated surfaces. It reads numeric bind-space attributes
rather than importer-rebased mesh coordinates, then bakes the original PBR surfaces
onto new UVs for each simplified LOD. The registry retains each LOD material.

Review fresh roundtrip playback, all nine clips and all LODs through the actual
registry/Game before copying `output/armored-warhorse/package/.` to the public
armored-horse directory. Clip extrema, rear/front views, rider contacts and moving
Player/NPC instances require visual inspection; unit tests must not load the model.
Source license/owner statements remain in the package credits.
