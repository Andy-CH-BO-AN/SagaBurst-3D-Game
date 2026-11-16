# Meshy Roman T4 / Viking T5 and faction equipment

User-supplied assets integrated on 2026-11-02, with follow-up corrections on 2026-11-03. The user confirmed use and GitHub
redistribution rights in the task conversation. Original downloads remain outside
the runtime bundle. Source filenames and SHA-256 values are recorded beside the
published assets; existing animation-source terms remain applicable.

Viking filename reconciliation (2026-11-03): the pasted specification says
`Meshy_AI_viking_warrior_30k_All_Animations(1).glb`, while the actual conversation
attachment and build input both say `Meshy_AI_viking_warrior_30k_All_Animations.glb`.
The latter was rehashed as
`364e19160ba66ae344be73e3d4c8c5e5437b3caab7d339a979aabefd60cb46e2`, matching
the recorded build source. The user clarified that the reviewer filename was
likely mistaken. No build-time rename or substitute model was used. No separate
`(1)` file was supplied or found, so equality with such a second file is not
claimed. `source.filenameEvidence` records this distinction explicitly.

## Published assets

| Identity | Source | Published location |
| --- | --- | --- |
| `roman-hero-t4` | Gondor Knight | `public/models/characters/v2/roman-hero-t4/` |
| `viking-hero-t5` | Viking Warrior | `public/models/characters/v2/viking-hero-t5/` |
| `spear_t4` | Shadowsteel Spear | `public/models/weapons/high-tier/spear.glb` |
| `axe_t5` | Wolfcarver Battleaxe | `public/models/weapons/t5/axe.glb` |
| `roman_officer_shield_t4` | Starlit Silverwood Shield | `public/models/weapons/faction-shields/roman-officer.glb` |
| `viking_berserker_shield_t5` | Wolfguard Shield | `public/models/weapons/faction-shields/viking-berserker.glb` |

`paladin_shield_t4` and `commander_shield_t5` remain independent, usable items.
New shield prices follow the existing shop formula: 1,440 / 2,250 Merit; impact
capacities are 48 / 96. There is no faction or rank restriction on their purchase.

## Geometry and animation contract

| Asset | LOD0 | LOD1 | LOD2 | Texture dimensions |
| --- | ---: | ---: | ---: | --- |
| Roman T4 | 31,105 | 9,999 | 3,000 | 2048 / 1024 / 512 square |
| Viking T5 | 31,256 | 10,000 | 3,000 | 2048 / 1024 / 512 square |

LOD0 retains every original vertex, index, normal and UV accessor byte.
Source inverse binds are retained. A single offline wrapper normalizes stature to
the existing asset heights; runtime actor scale is one. No LOD0 decimation,
remeshing, inserted triangles or hidden geometry is used. The builder rejects a
triangle-count or geometry-accessor mismatch after decoding the final GLB.

The source waist had thigh influences extending into the belt and abdomen, which
collapsed the waist when spreading the legs. Those leg weights are smoothly
transferred to the existing pelvis above its proximal hip region on every LOD.
The exact height range and changed vertex count are audited explicitly. Skin
accessors consequently differ from the source; geometry and inverse binds do not.

The existing geometry-only Blender simplifier generates LOD1/2. Interpolated skin
weights are preserved through the existing four-set skinning plugin. All LODs
retain the same 66-joint skin, clips, bind spaces and socket semantics. The existing
10m / 30m policy and shared actor-owned LOD skeleton/mixer remain in use.

Body animation contracts are frozen to dev revision
`7cb61c07f9daf41cccd35287a6cc842955c3f137`. `bakeFactionClips` performs anatomical
retargeting; thirty existing Roman finger animation channels are transferred,
with a source-joint C-grasp fitted around the measured shaft. No finger topology
or extra skeleton is added. Roman's supplemental foot axe is retargeted into the
main GLB. Viking additionally receives the existing Roman death take through the
same pipeline, avoiding a generated T-pose fall. Original embedded durations,
active windows, hit/release events and runtime weapon cycles are retained.

Source-to-project bone aliases, sockets, uniform transforms, actual output hashes,
per-LOD measurements, exact-buffer checks and finger fit diagnostics are in each
asset's `bone-map.json`, `manifest.json` and `audit.json`. Byte-exact meshopt packing
uses the existing bundled decoder. It does not quantize geometry or animation.

## Equipment attachment and collisions

The spear is 3.1m long along +Y, from -0.5 to 2.6m. Grip, support and tip remain
`[0,.15,0]`, `[0,.33,0]` and `[0,2.6,0]`. The axe retains the existing grip and
1.51m tip marker, normalized to a 1.9m overall length. Its source is rotated 180
degrees around the shaft so the single cutting blade faces down in mounted carry.
Damage, range, shield impact and 0.42s / 0.54s weapon cycles are unchanged.

Shields are 1.1m / 0.9m high, front +Z, with rear handles at `[0,0,.085]`.
The immutable preload cache supplies their geometry, materials and textures.
`FactionShieldGeometry.ts` contains offline horizontal slices of the real surface:
32 height divisions, nine silhouette samples per division, a 3mm inward margin,
and per-slice depth. Runtime collision reuses `ShieldCollider` band/OBB queries;
there are no combat-time triangle queries. Standalone validation confirms centre
hits, misses outside the silhouette, and no blocking after breakage.

## Production owners and saved ownership

Hero IDs preserve every caller's current appearance selection, including Career,
Custom Battle, Defense Campaign, Training, Duel, Town, Commander missions and HR.
`T4HeroCatalog` owns Roman T4's new default shield;
`CareerCommanderEquipment` owns the Viking Commander's new default.
`CareerDuelController` selects the corresponding T5 Duel shield.

`ArmorDatabase`, `HighTierEquipment`, `WeaponMeshFactory`, `BattleConfig` and
`BattleSetupUI` expose the new independent IDs. Existing shop, Inventory and
personal squad transactions consume the same database; no separate ownership or
free equipment grant is introduced.

Town native catalogues created after this change record `factionShieldVersion: 1`
and their Commander shield species. Historical catalogues keep their old T4 and
Commander token species, including transferred, reserved and sold tokens. Saved
inventory equipment and explicit null slots remain authoritative. Native default
resolution and catalogue generation share the same shield rule.

## Rebuild and validation

Requires Node dependencies, Blender, and Python with NumPy/Pillow on PATH.
`BLENDER` can select a different Blender executable; `MESHY_PYTHON` can select the Python interpreter with Pillow installed.

```sh
node tools/build-meshy-faction-heroes.mjs /path/to/supplied-glbs
python3 tools/build-faction-meshy-equipment.py /path/to/supplied-glbs
```

The builders check source hashes and preserve the fixed animation donor revision.
The existing animation donor manifest/readmes retain licensing context. One-off
screenshots, GLB pose samples and validation scripts belong in ignored `output/`.

Representative browser review uses the production controller at
`?devhero=roman-t4&nolock` and `?devhero=viking-t5&nolock`, with actual public GLBs
and HTTP SHA verification: locomotion, sword/axe/polearm/bow, shield, death, LOD
switches, four ground mounts and dismount/remount. These are representative poses,
not exhaustive collision clearance for every frame and camera angle. Source cloth
and fur have no dynamic collision; extreme folds can still intersect rigid armour.

FPS/performance A/B, 100-actor and 200v200 measurements are explicitly deferred at
the user's request. No FPS, draw-call improvement or 10% performance target is
claimed. The PR records current-head CI and any remaining gameplay validation.

Viking T5 uses the existing 1.1m Viking hero first-person clearance, avoiding shoulder fur and draw-hand obstruction. Projectile direction and camera obstacle collision still use their existing owners.

## Equipment names

T4/T5 display names come from the weapon and armour databases. The supplied files
retain their original provenance filenames; the axe and Viking shield's in-game
names are Warcat Clawreaver and Warcat Roarshield, describing their cat motifs.
IDs, prices and item combat statistics are unchanged by the naming update.

