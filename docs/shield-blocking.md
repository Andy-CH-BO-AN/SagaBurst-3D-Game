# Physical shield blocking

Shields no longer grant passive damage reduction. Both battle and Career Town
resolve a weapon sweep/projectile segment against the body and the shield OBB.
The first contact wins. A single accepted melee hit consumes the existing attack
instance; a projectile stops after its one accepted contact.

- T1/T2/T3: 5/10/20 impact. Sword, spear, lance, arrow and pilum cost 1.
- Viking axe T1/T2/T3: 2/4/8 impact, classified by actual weapon tier.
- Overflow: `damage * (impact - min(remaining, impact)) / impact`.
- Player overflow only: multiply by `1 - min(.5, BlockingLevel * .01)`.
- Exact exhaustion blocks all damage on that hit and breaks the shield.
- Broken shields are hidden and no longer collide. Re-equipping does not repair
  them. A new battle/mission/respawn resets this runtime-only state.
- Space is hold-to-raise when carrying a shield; without a shield it retains jump.
  Spectator Space remains camera-up. Attack is still allowed, then held Space
  resumes the guard pose. Defense raises intact NPC shields without changing AI.
- Blocking uses the existing level-1-through-50 XP curve and persistence.
  Each Blocking level grants +1 max HP (including level 1), separately from the
  original four offensive skills' HP bonuses. XP per absorbed impact is centralized
  in `SHIELD_CONFIG`; only hostile non-self shield contacts award it.
- Mount impacts, falls, environment/scripted damage and body hits bypass shield
  mitigation. Shield overflow hits the rider, not a magically protected mount.

## Animation inventory

Inspected the JSON animation tables embedded in all repository character GLBs,
the current `HumanoidAssetRegistry`, and `artifacts/animation_sources` audit.
The legacy `player.glb`/`enemy.glb` contain `Block`, `Blocking`, `Block_Hit` and
`Block_Attack`, but these are on the old skeleton, not mapped to the active v2
Roman/Viking/hero rigs. The active v2 assets have locomotion, attacks, bow and
pilum clips, and no compatible guard clip. The imported Human Melee axe clips
are already mapped to `axeAttack1H/2H`, not guard.

Phase 1 therefore reuses the existing upper-body equipment IK/guard layer. Only
the shield arm changes while idle/moving; legs retain their locomotion. During
attacks the existing animation/equipment bone pose drives the attached shield. No new animation or
model assets were created.

## Collision cost

No triangle tests, rigid bodies or per-frame collider allocation. Shield model
space bounds are set at equipment rebuild. Hand transform inversion and limb
positions are sampled once per queried target, reused across blade sweep points.
Game player melee uses the existing spatial grid; NPC melee uses its selected
nearby target. Town/projectile paths apply a distance broad phase before testing
any shield. Far/idle NPC shields are not continuously updated for collision.

## Validation

`tests/ShieldBlocking.test.ts` covers impact tiers, axes, exact break, overflow,
level-50 reduction, body/side/rear/feet bypass, transformed OBBs, sweep precedence,
friendly/self XP exclusion, broken shields, Defense, Space movement/attack,
Career persistence, HP, and high-speed arrow/pilum interception. Actual v2 GLBs
are loaded in `EquipmentPose.test.ts` to check frontal coverage, exposed feet and
unchanged leg transforms. These numerical checks are not visual approval.

Manual follow-up: front/side/rear attacks, moving guard and attack recovery on both
factions and mounted riders; Career restart/death/return; 200v200 frame profiling.
