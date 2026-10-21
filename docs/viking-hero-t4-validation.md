# Humanoid replacement manual validation

The former Viking T4 approval and screenshots apply to the superseded asset,
not the current Varangian delivery. Consult the replacement PR for the executed
checks and remaining limitations; automated loading or Blender renders alone
are not in-game visual acceptance.

## Local game checks

1. Run `npm ci`, `npm run dev`, and use the printed localhost URL in graphical
   Chrome. Open `/?devhero=viking-t4` for the existing equipped hero studio.
   Inspect front, side and back; hands / weapon close-up; all three LODs; cloak
   and skirt while stepping through both axe attacks and mounted poses.
2. Open `/?devmodels=humans&nolock` for ordinary faction models, then use
   `/?training=1` for the actual Player, equipment, projectile and mount loop.
   Exercise both factions and the legal sword, one-/two-handed axe, lance, bow,
   pilum and shield loadouts. Inspect fingers and shaft contact, not only shots.
3. Exercise idle/walk/run, repeated attacks, cancellation/equipment switches,
   bow load/hold/release, pilum release, shield interception, hit and death.
   Check Horse, Black Cat, Corgi and xongkoro with the existing legal loadouts.
   Mounted body, bow, arrow, crosshair and mount heading must agree.
4. Move across 28 m and 60 m while actors animate: no restart, missing equipment
   or pose jump. Inspect at distance and close up using forced studio LOD.
5. In Custom Battle, Defense Campaign and Career, verify T1–T3 military actors,
   Viking T4, both faction towns, military NPCs and ordinary Player. Confirm
   civilians/merchants remain unarmoured and other heroes retain their assets.
   Check actual damage, projectile emission, death/drop and scene exit/reload.

Save reproducible screenshots and clip/action timestamps under ignored `output/`.
Varangian's known source limitation is angular inner-skirt folding/gaps at extreme
knee flexion. Reject new tearing, exploding vertices or large body intersections;
do not relabel them as a minor source limitation.

## Paired performance checks

Use graphical Chrome and a real GPU, with no concurrent Blender/build/test load.
Compare the base commit and candidate on the same hardware, viewport, quality,
seed, faction/tier/loadout mix, camera and observation window. Record 50v50,
100v100 and 200v200 configurations. Do not infer FPS from triangle count.

For supported fixed scenarios use the existing protocol and runner documented in
[the performance skill](../ai_share/skills/sagaburst-performance-benchmark/SKILL.md),
including its warm-up/sample eligibility rules. Scenario G is 200v200 infantry;
D–F use 100v100 mounted configurations and are not an infantry substitute. A
50v50 custom setup must record its exact roster and sampling method separately.

Record mean and 1% low FPS, CPU frame time, available GPU time, draw calls,
triangles, memory scope and animation update cost. Missing GPU timing is N/A,
not zero. Compare paired valid runs only; software rendering or a remote browser
without a verified GPU is not a credible shipping-performance result.
