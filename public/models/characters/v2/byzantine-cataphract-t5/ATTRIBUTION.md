# Byzantine Cataphract (T5+ elite)

Owner-supplied Meshy model `Meshy_AI_Byzantine_Warrior_Rigged_20261106_animated_mixamo_All_animation.glb`
(SHA-256 in manifest.json). Mesh, UVs and skin weights are unchanged; the 0.01 Armature scale is baked into
the joints and the three textures are resampled per LOD (2048/1024/512).
Walking, Running, Left_Slash and Punch_Combo_1 are the model's own clips. Idle, bow, pilum and axe clips are
direction-retargeted from `roman-hero-t5` (project-licensed Kevin Iglesias / Quaternius sources, see that
asset). Rebuild: `node tools/build-byzantine-cataphract.mjs <source.glb>`.
