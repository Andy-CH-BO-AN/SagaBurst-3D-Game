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
before replacing the public package. The legacy `consolidate-horse-lod2.mjs` tool
does not support this topology.

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
