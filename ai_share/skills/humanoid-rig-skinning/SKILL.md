---
name: humanoid-rig-skinning
description: Audit, normalize, rig, skin, optimize, and export realistic humanoid GLB/FBX assets for this Three.js combat game. Use for character asset licensing, anatomical proportions, Blender retargeting, bone/socket mapping, deformation checks, LOD generation, mounted poses, or GLB manifests.
---

# Humanoid Rig And Skinning

Prepare external people through the existing registry and asset descriptors. Preserve gameplay coordinates and behavior; add only the loader/descriptor integration required by the requested asset work.

## Contract and preparation

- Read [humanoid contract](references/humanoid-contract.md) and [manifest contract](references/asset-manifest.md). Faction dimensions apply to ordinary characters; heroes and source-proportion variants use an asset-specific descriptor, not relaxed global checks.
- Audit the source, license and texture provenance before export. Preserve source hashes and attribution; keep source downloads outside the shipped runtime bundle. Resolve missing usage/redistribution evidence before publishing the asset.
- For static posed sources, sleeve/forearm deformation or Maki's bow stance, read [posed-source characters](references/posed-source-characters.md). For clothing and reference-driven appearance work, use [humanoid-from-reference](../humanoid-from-reference/SKILL.md).
- Normalize the full hierarchy to metres and local `+Z` forward. Fit the target skeleton through anatomical rest transforms, not bone names alone; runtime scaling must remain uniform.
- Preserve required bones, sockets, bind transforms and equipment ownership. Validate weights at shoulders, elbows, hips, knees, skirts and rigid armour using the affected actions, including mounted poses when supported.
- Export every required LOD with matching animation names and socket semantics. Share immutable render resources while each runtime character retains independent skeletons, mixers and playback state.

## Tools and evidence

Run from repo root; create the output directory first:

```sh
rtk proxy mkdir -p output/humanoid-audit
rtk proxy python3 ai_share/skills/humanoid-rig-skinning/scripts/audit_glb.py /path/to/model.glb --output output/humanoid-audit/structure.json
```

`audit_glb.py` is a structural inventory, not a deformation or readiness verdict. The other inspection/render scripts require Blender (`blender -b --python <script> -- ...`); inspect each script's arguments and required source naming before use. `prepare_phase22_assets.py` is the original Viking/Roman source-specific builder, not a general hero rebuilder. Use the asset's maintained builder/retarget/audit sequence for current outputs.

Inspect actual texture dimensions and decode integrity, finite transforms, required bindings and representative front/side deformation. Preserve measured audit/provenance beside the manifest; one-off renders and diagnostics belong in ignored `output/`. Promote only after asset checks and the [browser validation](../combat-browser-validation/SKILL.md) pass for the requested scope.

## Deliverables

Keep versioned GLBs/textures, manifest, bone map, audit and attribution under `public/models/characters/v2/<faction-or-assetId>/`, plus a reproducible builder or redistributable source. Match the current loader's bindings and measured descriptor. Report any unsupported actions or unverified visual defects; a structural audit alone cannot establish visual acceptance.
