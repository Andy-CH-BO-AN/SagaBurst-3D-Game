# Viking hero T4 — asset preview

T4 is an independent asset identifier, not a UnitTier. This work is based on origin/main `7ed3860e4125e1a5ca48e4535de9c8d695b07ea8`, on `codex/viking-hero-t4`. The original checkout and its working files were preserved.

## Preview

Run `npm run dev` from this worktree and open `/?devhero=viking-t4`. The running review instance uses http://127.0.0.1:5174/?devhero=viking-t4 . This entry is gated by `import.meta.env.DEV` and dynamically imported before the normal game bootstrap or battle session storage is read.

Controls: front / strict side / free orbit; full body / upper body / head close-up / legs and boots; same-scale Viking comparison; animation; empty hands / long axe / axe plus round shield; explicit LOD0–2; black cat; pause, replay, and normalized fixed time. Axe 1H selects a shield; axe 2H selects the axe alone. Death disables riding. Selecting mounted checks the riding box; unchecking returns to idle. The status shows actual clip time in seconds. Camera views are orthographic.

Missing assets, required bones, sockets, animation bindings or calibration produce an explicit load error; there is no substitute character. The model uses the existing humanoid adapter, mixer, combat pose and equipment attachment code only as a pose preview. There is no damage, AI, campaign or combat generation.

## Revised appearance

The user removed the long beard, requested the original face, and subsequently restored the blue-violet cloak. The original short facial hair remains. The old dome, liner, brow band and cheek plates are removed. Only the original fitted spectacle/nasal metalwork is retained and refinished; it is fused into the new cap as one continuous metal shell, with a smoothed forehead transition. The cap follows measured source head sections; the mail coif follows the outer head and neck surface. The shoulder shawl and back cloak are welded into one surface and use three optional cloth bones. This is baked skinning, not runtime cloth simulation.

The original hands and boot shapes are retained. The torso has a closed abdominal surface unioned with the original shirt to eliminate its open vest slit and intersecting shoulder layers. Continuous leg surfaces span hips, knees and ankles. The original shoes and authored shafts are fused, with a sculpted and rounded ankle transition and a shared ankle weight field. Four mail panels envelope the actual thighs and follow their matching deformation weights below the waist; front/back and side riding splits remain open. Chainmail and helmet use the same metal base color, metalness and roughness. Chainmail detail comes from a generated normal map, not ring meshes. The character mesh includes no weapon or shield.

## Source and rebuild

Versioned runtime deliverables: `public/models/characters/v2/viking-hero-t4/`: three self-contained textured GLBs, manifest, bone map, per-LOD structural/image audits, animation/skin audit, authoring measurements and attribution evidence.

Reproducible authoring is in `tools/build-viking-hero.py` and `tools/retarget-viking-hero.mjs`. The builder recreates ignored `output/hero/hero-source.blend` on demand; screenshots and logs also use ignored `output/`. This session’s temporary output is removed after PR creation at the user’s request. This follows the existing repository's script-managed source workflow. Blender 5.2 was used.

From the repository root:

```sh
blender -b --python tools/build-viking-hero.py
node tools/retarget-viking-hero.mjs
node tools/audit-viking-hero.mjs
npx vitest run tests/VikingHeroAssets.test.ts --testTimeout=20000
```

Run the existing `audit_glb.py` and `audit_glb_images.py` from `ai_share/skills/humanoid-rig-skinning/scripts/` for each LOD after rebuilding. Import the new GLBs in the preview again before recording visual approval. Do not rerun the retarget step repeatedly on already retargeted outputs: rebuild from Blender first.

Animation uses the original ten embedded Viking clips with unchanged names, durations and event metadata. A world-rest delta retarget is baked to the hero skeleton. Ground contact is baked from actual skinned vertices into the hero pelvis track. Existing mounted upper-body and death profiles are baked separately; optional cloth motion is asset-specific. Original Viking/Roman GLBs, skeletons, geometry, event timing and manifest hashes remain unchanged. Every instance has separate bones and animation mixers, with immutable render resources shared.

The black cat mesh and saddle seat are unchanged. The hero uses its own pelvis attachment offset `[0, 0.09, 0]` in metres; this is a visual alignment only.

## Measurement and evidence

The actual GLBs are measured in `audit.json`; Blender authoring measurements are separate in `blender-measurements.json`. Stature is scalp crown minus the anatomical barefoot plane. The outsole and helmet are recorded separately. No runtime nonuniform scale is used. See `viking-hero-t4-validation.md` for the actual executed checks, screenshots and limitations.
