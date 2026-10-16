# Fitted faction characters: offline evidence

Image-pose capture: 2026-10-16T12:02:32.715Z. Latest combined-source runtime recheck: 2026-10-16T13:47:33.378Z.
These three sheets render CPU-evaluated production HumanoidAssetRegistry, HumanoidStudioPlayback, CharacterCombatAnimator, CharacterEquipmentPose and BlackCatVisual poses in Blender. Local fetch/image adapters preserve asset bytes; no replacement controller or synthetic skeleton is used. Lighting/shaders may differ from Three/WebGL. Browser gameplay, actual traversal and GPU performance remain unverified.

## Lossless publication repack
The three JPEGs below are retained unchanged from the reviewed V27 capture; they were **not rerendered** after publication packing. V28 uses PNG level-9 recompression and required `EXT_meshopt_compression`, without quantization or filtering. Independent decoded comparison found all 7,185 non-image buffer views, non-storage document definitions and 27 asset RGBA images identical.

A fresh production-loader run of all nine V28 GLBs matched the original loaded geometry, skin/bind data, rest transforms and all animation track bytes. All 381 production-pose samples were repeated. Their evaluated positions, indices/UVs, geometry groups, material values and decoded texture pixels matched the approved render inputs exactly, including the additional ordinary Roman reference (382 comparisons, zero differences). All 47 decoded texture payloads used by the capture also matched. This establishes why the existing offline images remain applicable; it does not add browser or GPU validation.

The complete offline pose/resource/event, disposal and decoder-failure audit was repeated after PR #330 was merged into source base `84480566610f4322bcb2455c66eca0eb9657b5dd` and integration conflicts were resolved. The same 382 render-input comparisons still have zero differences. Assets and the three JPEGs remain unchanged. This pose audit does not instantiate TownScene or a complete NPC/Player world simulation.

## Selected sheets
- [main-actions.jpg](main-actions.jpg): all three locomotion/melee states; adjacent Nordic rear-run LOD0/1/2 comparison.
- [shadow-bow-mount-cape.jpg](shadow-bow-mount-cape.jpg): real bow strings/nocked and released arrows, moving black-cat seat, rear-low cape, and matched Roman early-fade foot comparison.
- [grips-lods-death.jpg](grips-lods-death.jpg): weapon grips, identical-phase mounted-bow LOD0/1/2, fixed-ground death midpoint/final, standing bow release, pilum and lance.

## Draft limitations
- Early run↔idle fades have extra fitted toe/sole penetration. At idle→run .03 s, fitted Roman reaches −4.64 cm versus −0.96 cm on unchanged ordinary Roman, with the same normalized .25 start phase and update sequence. Other sampled target fades reach about −2.5 to −3.9 cm. This target-specific extra depth is unresolved; there is no runtime/root offset workaround.
- Shadow has a hard upper-arm/elbow fold and a small coarse-LOD shoulder-edge seam; Nordic retains angular under-mantle folds and a small dark upper hood fold at coarse LODs. The two-handed support fingers preserve the ordinary source’s relaxed curl.
- Death retains the inherited propped-prone pose, not natural limp/full-body contact. Reduced LODs can have millimetre-scale final toe/hem floor residuals. The existing axe low point can enter the floor; early 2H foot-transition dipping also occurs on ordinary references.
- Grounded NPC/Player adds no second death floor correction. Existing ground-mount Player death retains its seat-height parent root; this offline audit does not claim that full world path is fixed.

## Standalone runtime checks
381 snapshots, 0 unsupported samples, 0 non-finite vertices. Numeric gates: pass. Each actor has one mixer; its real LODs share a pose/skeleton, while two actors have isolated skeletons and pose state and share geometry/material/texture resources. These identities do not establish draw calls, GPU memory or frame time.
Each asset’s six foot/mounted melee cycles produced one hit and one completion; large-dt, cancellation, additive hit and dead-state suppression checks passed. Existing mounted cape override restores without residue on dismount. The configured axe endpoint matches the visible tilted axe at the unchanged 1.36 m reach. Formal grip/nock distances supplement skin-surface inspection.

Disposal checks on all three assets passed: disposing one actor twice released its owned CPU bone texture once, left the second actor animating with finite vertices, and did not dispose shared geometry/material/textures. After both actors were disposed, a fresh actor from the retained template still animated correctly. These are CPU object/lifetime checks, not GPU-memory measurements.

Normal marked loading requested only three local manifests and nine local GLBs; the bundled decoder added no URL request. Isolated Shadow diagnostics removed the manifest decoder marker, disabled the real decoder, or corrupted one compressed-stream header in a local fetch response. The first two failed with `setMeshoptDecoder must be called before loading compressed files`; corruption failed with `Malformed buffer data: -1`. Each failure published no template, blocked instance creation, cleared its pending-load cache, and succeeded on retry with the same asset after restoring the original input. Public files were unchanged by these diagnostics.

| Asset | Triangles LOD0 / 1 / 2 | Vertices LOD0 / 1 / 2 |
|---|---|---|
| maki-archer-t4 | 10933 / 4495 / 1792 | 15489 / 7816 / 3694 |
| roman-civilian | 10300 / 4498 / 1797 | 16166 / 8507 / 4047 |
| viking-civilian | 11704 / 4321 / 1645 | 16634 / 7756 / 3514 |

Actual LOD2 final death minima: maki-archer-t4 -7.45 mm; roman-civilian -3.71 mm; viking-civilian -6.76 mm.

## Exact inputs
Latest source-base commit: `84480566610f4322bcb2455c66eca0eb9657b5dd`. Compressed-public working-tree production bundle SHA-256: `2b8760812cd359e576e2b7080653607075ef2361311ee7f10d3cfb272eba7c48`. Registry source SHA-256: `96c12068d0d5abd17da31b7fa634f345c8170239ec0e8d4a19c1fbdc42d378f6`. The original image-capture bundle was `475463fd5d73842ce0462a85e89f1e3d7be551045eb653c76795892ff9abb52f` on source base `e3d45cd81ec5b4a45b4de3ace35a976769afc5b9`. All final V28 target files below were copied from frozen public assets into an immutable QA snapshot before evaluation.

| Asset/file | SHA-256 |
|---|---|
| maki-archer-t4/manifest.json | `4b12fdd1aa964d996a5e8414c90c0a8cfb3c98745c5f5608e7abde97c8d72395` |
| maki-archer-t4/lod0.glb | `835614cd616c3dda523dcad18a63798192a46ca3611263d10f5e96cf35f03a48` |
| maki-archer-t4/lod1.glb | `e9330648f5fe2ee5468211fc84f274f27380267b130e135652231f0d07d1d831` |
| maki-archer-t4/lod2.glb | `856d32f3f023d328f774c8b157565fa6df6c0b9775a5d4b6a9a1c42c3c37ddc6` |
| roman-civilian/manifest.json | `97544af8e7c665c19fb0efbd9890a99a11a87a6894f8fe42d1418de01e802857` |
| roman-civilian/lod0.glb | `f20011d5b915359c497ed1ed4d45508d32f6c5cd551dd18d379269d04e670381` |
| roman-civilian/lod1.glb | `d4f558bd5e4971ac73341593676d97122446740a6c3d2a77280a7a6087e360de` |
| roman-civilian/lod2.glb | `645042dbfc47de915a3c08359f126447b9b783cb6117bcbd97b3b525a5b38196` |
| viking-civilian/manifest.json | `1ef2c58515d0d7bc51b72c4b1791177bec91acce176af4e06e5431ced6f4dac3` |
| viking-civilian/lod0.glb | `a282eb7c31b79532b7fd1696e656f53a00374e79cf46c4a734965814181c4e85` |
| viking-civilian/lod1.glb | `a5bd6d00d1589b168212312c1e86ccbbd0fa22d0748f8ad772221d439d884590` |
| viking-civilian/lod2.glb | `9f948092b43db11d9a46cbc5d3b5255f363215a1971a560581922479880fc9ab` |
| Ordinary reference roman/manifest.json | `3d3a9eacf1697f1375afa603cb27c0edc9fbadadc8468a5156f96bea4c53592d` |
| Ordinary reference roman/lod0.glb | `2d08e05d15a1690fa80a26066d1e579ed543a0c05b7a6d11d04b52d56a40bda9` |

Full pose data, exact phases, resource/event reports and diagnostic comparison images remain in ignored one-off QA output. The five-phase death sequence and all sampled hit/lance/pilum actions are retained there.
- main-actions.jpg SHA-256: `6f16af336ee4f1178d3bac221eefd903a2c456a5c03c64f5ea63599cb254d129`
- shadow-bow-mount-cape.jpg SHA-256: `b1f3b361238531aa41bc74de55f9525e1e9bb9a457e94d46ba2249ebb57b7dce`
- grips-lods-death.jpg SHA-256: `9b60da8af2416cc730a5953a934daad15627c486741a5b803ec1b4245ae24e59`
