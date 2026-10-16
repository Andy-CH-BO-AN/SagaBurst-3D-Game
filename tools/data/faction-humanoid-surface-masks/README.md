# Reviewed faction garment surfaces

These masks belong to the exact user-supplied Meshy originals named in each JSON.
Both the original file SHA-256 and normalized imported topology SHA-256 are
checked before the builder uses source vertex/face indices. A changed source or
import topology requires a new visual review; do not transfer indices blindly.

The masks preserve the reviewed distinction between cloak, inner clothing and
limbs at the original fused contacts. They contain cape fractions for the
position-welded analysis graph, original cape face indices, and mixed bridge
faces removed during local separation. The originals remain immutable outside
`public`. Surviving original corners retain their UVs; local lining samples the
original texture. Exact removals, duplicated source vertices, lining triangles,
and boundary adjustments are recorded in `blender-measurements.json`.

Nordic's inspected center-back lining required a separate inward correction:
165 generated interior vertices move at most 0.045 m toward the measured body
envelope. Original source corners, UVs, cape ownership and upper/sleeve repairs
stay fixed. The builder records every adjusted point and its bounded falloff
contract. This prevents the generated body lining from appearing as a narrow
strip through the animated cape; it is not a change to trouser or leg weights.

Nordic's original inner cape also contained long triangles spanning 35.5 cm.
The accepted run bend exposed that dark inner shell through the more finely
triangulated outer surface. A reviewed 32-face inner-shell mask receives local
edge subdivision: 191 inserted vertices and 313 additional triangles at LOD0.
Original corner positions, UVs and skin weights are preserved and checked in
the builder; new corners interpolate source UVs and the existing continuous
cape weights. Exact affected neighboring faces and the preservation digest are
recorded in `surfaceSplit.innerCapeRefinement`. This is separate from generated
body lining and does not move the outer cape or introduce a new helper chain.

Independent inner/outer reduction reintroduced intersections at Nordic LOD1/2.
Those reduced LODs therefore replace only the measured posterior inner-shell
region with a 2 mm inward lining derived from the reduced outer topology. Each
inner/outer vertex pair has identical skin weights; inner UVs are sampled from
the original inner surface. LOD0 retains the original refined shell. The frozen
`lodPairedShell` face masks, per-LOD counts and exported vertex-pair audits make
this reproducible. The abandoned independent-collapse guard is not used.

Shared rebuild pipeline, from repository root:

1. Run `blender -b --python-exit-code 1 --python tools/build-faction-humanoids.py -- SOURCE_ROOT OUTPUT_ROOT`.
2. Run `python tools/pack-faction-humanoid-textures.py OUTPUT_ROOT`.
3. Run `node tools/retarget-faction-humanoids.mjs --root OUTPUT_ROOT viking-civilian,roman-civilian,maki-archer-t4 --grounded-death`.
4. Preserve that animated, uncompressed checkpoint. Run `python tools/pack-faction-humanoid-textures.py OUTPUT_ROOT --lossless-recompress`, then `node tools/pack-faction-humanoid-buffers.mjs OUTPUT_ROOT` for publication. PNG pixels and every decoded non-image buffer view must remain exact; JPEG bytes are unchanged. Set the manifests' explicit `bufferCompression: "EXT_meshopt_compression"` contract and refresh file hashes from the packing audit.
5. Run `node tools/audit-faction-humanoids.mjs OUTPUT_ROOT` separately from unit tests. It decodes compressed views before the original numeric rig/skin/animation checks.
6. Review the exact exported LODs through production action, grip, mount and
   death composition before replacing runtime assets. A structural pass is not
   visual acceptance. Diagnostic duplicated LOD0 files are never shippable.

The final PNG/meshopt steps are lossless packaging for the publication transport
limit. Do not rebake animation from a publication-packed file: restore the saved
uncompressed checkpoint first. The Blender-only diagnostic renderer is used
before final buffer packing; final evidence uses the production loader/decode
path. Packaging equality reports are separate from deformation acceptance and
do not establish browser/GPU performance.

The builder supports an isolated model ID and `--lod0-only` for focused surface
review. Nordic's `--refine-mantle` is an explicit measurement aid for the local
brown shoulder mantle, not a substitute for approving a new mask. Generated
candidate masks are written beside their output assets; the reviewed copies
here are deliberately source-controlled.

The rig has no cloth physics. Fitted helpers use baked, measured clearance and
the existing mounted pose contract. Hard inner-sleeve folds remain a disclosed
art limitation. The adapted existing death is slightly propped rather than a
new naturalistic collapse. Bow contact must be evaluated after the production
idle-leg composition; independently planting the raw bow clip can erase its
required stance clearance.
