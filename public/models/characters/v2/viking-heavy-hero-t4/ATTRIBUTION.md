# Dragon Oathguard (viking-heavy-hero-t4)

Owner-supplied Meshy model `Meshy_AI_Viking_Warrior_Rigged_20261107_animated_mixamo_All_animation.glb` (SHA-256 in manifest.json). Owner-supplied Meshy asset; the repository owner supplied this file and requested its integration into SagaBurst on 2026-11-10.
LOD0 mesh and UVs are unchanged; thigh skin weight above the hip pivot moves to the pelvis so the waist holds when seated; the 0.01 Armature scale is baked into the joints; LOD1/LOD2 are collapse-decimated copies; textures are resampled per LOD (2048/1024/512 JPEG).
Walking and Running are the model's own clips. Idle is retargeted from `roman-hero-t4`; sword, bow, pilum and axe clips from `roman-hero-t5` (project-licensed Kevin Iglesias / Quaternius sources; the foot one-hand axe attack is tokeshi's Fantasy Bandit `Bandit@attack`, see those assets).
Rebuild: `node tools/build-viking-heavy-heroes.mjs <downloads-dir> viking-heavy-hero-t4`.
