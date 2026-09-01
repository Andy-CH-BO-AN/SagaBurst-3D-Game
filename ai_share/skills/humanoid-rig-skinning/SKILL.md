---
name: humanoid-rig-skinning
description: Audit, normalize, rig, skin, optimize, and export realistic humanoid GLB/FBX assets for this Three.js combat game. Use for character asset licensing, anatomical proportions, Blender retargeting, bone/socket mapping, deformation checks, LOD generation, mounted poses, or GLB manifests.
---

# Humanoid Rig And Skinning

Prepare external people without changing gameplay coordinates or silently falling back to the legacy procedural body.

## Workflow

1. Read `references/humanoid-contract.md` and `references/asset-manifest.md`.
2. Preserve the downloaded source and its license evidence outside the runtime export folder. Reject assets whose redistribution or commercial-use terms are incomplete; never substitute a different asset without reporting it.
3. Run `python3 scripts/audit_glb.py <file.glb>` before and after Blender work. Save the JSON report beside the asset manifest.
4. In Blender, apply transforms and normalize the character to metres with uniform scale. Match faction height and proportion landmarks in the contract before rigging.
5. Retarget both factions to the project humanoid skeleton. Correct weights in shoulder, axilla, elbow, hip, knee, skirt, and rigid armour test poses.
6. Add the required sockets as bones or named empties parented to bones. Keep weapon-forward semantics compatible with the runtime bone adapter.
7. Export LOD0/1/2 with shared material intent and embedded or colocated PBR textures. Do not bake orange skin tint into albedo.
8. Fill the manifest with measured, not estimated, values. Include attribution and every material modification.
9. Validate front, side, A/T-pose, idle, walk, attack, bow, mounted, and death. Capture neutral-light screenshots for deformation review.

## Acceptance Rules

- Use uniform object scale at runtime. Fix anatomy in Blender.
- Require all contract bones and sockets; aliases must be recorded in `boneMap`.
- Keep skeleton and mixer instances unique per character while sharing immutable geometry, material, texture, and clips.
- Bind rigid chest armour primarily to chest/spine, shoulder plates to clavicle/upper arm, and skirt strips only lightly to legs.
- Treat missing files, missing texture rights, non-commercial licenses, malformed skinning, or failed deformation checks as blockers.
- Do not edit Player, NPC, Game, combat timing, weapon builders, or mount physics from an asset-preparation task.

## Deliverables

- Versioned GLBs and textures under `public/models/characters/v2/<faction>/`.
- `manifest.json`, `audit.json`, `bone-map.json`, and attribution evidence for each faction.
- Blender source or reproducible Blender script when the license permits redistribution.
- Front/side and representative deformation screenshots.

