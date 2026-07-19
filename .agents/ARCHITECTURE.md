# Warriors: Dedicate Your Heart! — Architecture

## Folder Structure

```
skyrim 3D test/
├── index.html                 Entry point HTML; HUD elements, Enemy HUD, Damage overlay, Quiver UI, Compass, Character Modal, Pickup Prompt
├── package.json
├── tsconfig.json
├── vite.config.ts
├── PLAN.md                    Full phase roadmap (Phases 0~8 & Phase 13)
├── ARCHITECTURE.md            This file
├── PROGRESS.md                Current progress & handoff notes
└── src/
    ├── main.ts                Vite entry — creates Game instance
    ├── Game.ts                Master orchestrator & combat, AI, heightmap physics, audio, inventory, pickup loop
    ├── player/
    │   ├── Player.ts          Capsule body, 6 distinct 3D weapon builders, HP/damage/respawn state, heightmap ground collision
    │   └── PlayerInput.ts     Keyboard & mouse event aggregator (added E key detection)
    ├── world/
    │   ├── Sky.ts             Background, atmospheric fog, direction sun & ambient lighting
    │   ├── Terrain.ts         Procedural 3D heightmap terrain with getTerrainHeight(x, z) & calibrated rocks/trees
    │   ├── DummyEnemy.ts      Training dummy enemy target calibrated with getTerrainHeight(x, z)
    │   ├── NPC.ts             Generic NPC AI unit (Faction, Melee/Ranged, Lancer, Cavalry flags) with FSM AI
    │   ├── Mount.ts           Mount entity (Black Cat / Corgi) providing movement & impact damage physics
    │   ├── CharacterVisuals.ts Shared 3D procedural character mesh generation for Player and NPCs
    │   ├── WeaponPickup.ts    3D world item drop nodes with distinct 3D weapon models (floating animation)
    │   └── ArrowProjectile.ts Arrow entity with parabolic physics and multi-target hit detection
    ├── camera/
    │   └── ThirdPersonCamera.ts  Orbit camera with smooth FOV zoom (70 -> 40) & shoulder offset
    ├── rpg/
    │   ├── WeaponDatabase.ts  Centralized config for Tier 1~3 Melee & Ranged weapons & consumables
    │   ├── InventoryManager.ts Manages owned items, inventory grid state, and equipped weapons
    │   └── SkillManager.ts    XP & Level-up progression for One-Handed & Archery skills + LevelUp Toast & damage scaling
    ├── audio/
    │   └── SoundManager.ts    Pure Web Audio API procedural sound synthesizer (swords, bows, hits, level-up chimes)
    ├── save/
    │   └── SaveManager.ts     localStorage save/load (skills + inventory + equipped weapons)
    └── ui/
        ├── StaminaBar.ts      DOM stamina bar controller
        ├── HpBar.ts           DOM HP bar controller
        ├── QuiverUI.ts        DOM arrow counter & Skyrim radial charge reticle controller
        ├── CompassUI.ts       Norse-Rune style top compass direction bar moving with camera yaw
        ├── EquipmentUI.ts     Tab-toggled RPG Character & Inventory Panel Modal (Grid & Tier Badges)
        └── DamageNumbers.ts   Floating damage numbers (3D world -> 2D screen projection)
```

---

## 3D Weapon & Armor Geometries

1. **生鏽小刀 (Rusty Dagger - Tier 1)**: `CylinderGeometry` handle (0.18m) + minimal `BoxGeometry` guard + short `BoxGeometry` blade (0.55m) + `ConeGeometry` tip.
2. **鋼鐵長劍 (Steel Sword - Tier 2)**: Standard 1.1m double-edged blade + 0.35m crossguard.
3. **精鋼戰刃 (Runic Greatsword - Tier 3)**: Extended 0.45m handle with 3 `TorusGeometry` grip rings + `OctahedronGeometry` rune gem pommel + 0.58m winged crossguard + 1.55m wide heavy blade + blue glowing fuller groove.
4. **木製短弓 (Wooden Shortbow - Tier 1)**: 0.18m crude grip + 2 straight 0.45m limbs inclined at 0.2rad.
5. **反曲長弓 (Recurve Longbow - Tier 2)**: 2-segment S-curve limbs (0.55m inner + 0.35m outer).
6. **符文精靈弓 (Elven Runebow - Tier 3)**: 3-segment elven crescent limbs (0.65m + 0.45m + 0.35m) + 2 `OctahedronGeometry` cyan crystal gems + 2 `TorusGeometry` moon crescent spikes + glowing arrow.
7. **羅馬方盾 (Roman Scutum)**: Rectangle body curved defensively (Tier 1 wood, Tier 2 iron rim, Tier 3 gold boss). Provides passive damage reduction.
8. **維京圓盾 (Viking Round Shield)**: Wide cylinder radius (Tier 1 wood, Tier 2 iron rim, Tier 3 gold boss). Provides passive damage reduction.

### Dynamic Back-Shield System
- `Player` and `NPC` use a generic `shieldPivot`.
- In Melee mode, the shield attaches to `leftArm`.
- In Ranged mode (or while aiming), the shield attaches to the `bodyMesh` and rotates to rest on the character's back, avoiding visual clipping.

---

## Data Flow (per frame)

```
Game Loop
  │
  ├─► WeaponPickup.update() ──► Distance ≤ 2.5m ──► Show [E] 拾取 Prompt ──► (Press E) ──► inventoryManager.addWeapon()
  │
  ├─► Tab / I Key Press ──► equipmentUI.open(skillManager, inventoryManager) ──► Click 【裝備】 ──► player.rebuildWeapon()
  │
  ├─► Player Melee Swing ──► Reads inventoryManager.equippedMelee stats (damage, speed)
  │
  ├─► Player Bow Fire ────► Reads inventoryManager.equippedRanged stats (damage, speed, maxChargeTime)
  │
  └─► Mount Impact Damage ─► Horizontal line-segment collision vs Dummy/NPC/Player radii -> deals speed-based damage
  
### Cavalry & Mount Data Flow
- **Spawn**: NPCs can generate as Cavalry. A Mount is spawned and assigned to them.
- **Visuals**: Mounts have unique geometries (Black Cat / Corgi) and provide `rideHeightOffset` and `ridePitch` to seamlessly adapt both Player and NPC avatars to a seated posture on custom procedural saddles.
- **Roles**: Cavalry can be **Lancers** (3.0 reach, 3x charge damage that suppresses mount impact) or **Mounted Archers** (can shoot while moving, maintaining 6~15m distance. Will drop bows and auto-switch to melee sword charge if enemy enters <6m range).
- **Damage Routing**: Melee/Arrow attacks against a Mounted entity route 100% of damage to `mount.takeDamage()`.
- **Dismount**: If Mount HP drops to 0, `mount.dead = true`, and the entity resets rotation and resumes foot AI / movement.
