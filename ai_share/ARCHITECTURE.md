# Warriors: Dedicate Your Heart! — Architecture

## Folder Structure

```
skyrim 3D test/
├── index.html                 Entry point HTML; HUD elements, Enemy HUD, Damage overlay, Quiver UI, Compass, Character Modal, Pickup Prompt
├── package.json
├── tsconfig.json
├── vite.config.ts
├── ai_share/                  Canonical AI documentation; edit files here only
│   ├── AGENTS.md             Project rules and agent guidelines
│   ├── ARCHITECTURE.md       This file
│   ├── PLAN.md               Full phase roadmap (Phases 0~8 & Phase 13)
│   └── PROGRESS.md           Current progress & handoff notes
├── .agents/                   Compatibility entry points; files direct AI to `ai_share/`
├── .codex/                    Codex entry points; files direct AI to `ai_share/`
└── src/
    ├── main.ts                Async Vite entry — preloads humanoid and horse assets before creating Game
    ├── Game.ts                Master orchestrator & combat, AI, heightmap physics, audio, inventory, pickup loop
    ├── debug/
    │   └── CombatTrajectoryDebugger.ts Query-only weapon grip direction, tip trails, and console summaries
    ├── player/
    │   ├── Player.ts          Segmented body (Torso & Limbs), 6 distinct 3D weapon builders, HP/damage/respawn state, heightmap ground collision
    │   └── PlayerInput.ts     Keyboard & mouse event aggregator (added E key detection)
    ├── world/
    │   ├── Sky.ts             Background, atmospheric fog, direction sun & ambient lighting
    │   ├── Terrain.ts         Procedural 3D heightmap terrain with getTerrainHeight(x, z) & calibrated rocks/trees
    │   ├── DummyEnemy.ts      Training dummy enemy target calibrated with getTerrainHeight(x, z)
    │   ├── NPC.ts             Generic NPC AI unit (Faction, Melee/Ranged, Lancer, Cavalry flags) with FSM AI
    │   ├── Mount.ts           Mount gameplay plus legacy Black Cat/Corgi save-compatible visuals
    │   ├── HorseAssetRegistry.ts Licensed horse GLTF cache, KTX2/Meshopt, LOD, variants, sockets and animation
    │   ├── ProceduralMaterials.ts Shared cached PBR textures/materials for skin, cloth, metal, wood, leather and fur
    │   ├── CharacterVisuals.ts Legacy test fixture plus shared CharacterRig/animation contracts
    │   ├── HumanoidAssetRegistry.ts Manifest-gated GLTF cache, SkeletonUtils clones, LOD, mixers and bone/socket adapter
    │   ├── CharacterCombatAnimator.ts Shared allocation-free FK combat timeline and pose sampler
    │   ├── CharacterBowVisual.ts Shared Player/NPC bow mesh, socket aim, string, nock, and launch controller
    │   ├── WeaponPickup.ts    3D world item drop nodes with distinct 3D weapon models (floating animation)
    │   └── ArrowProjectile.ts Arrow entity with parabolic physics and multi-target hit detection
    ├── camera/
    │   └── ThirdPersonCamera.ts  Stable orbit camera with FOV-only aim zoom (58 -> 40) and reticle direction
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
- In one-handed Melee mode, the shield attaches to the left `handSocket`.
- In Ranged mode (or while aiming), the shield attaches to the `bodyMesh` and rotates to rest on the character's back, avoiding visual clipping.

### Phase 20 FK Combat Rig
- `CharacterVisuals` exposes a shared `CharacterRig`; each arm is a `shoulder -> elbow -> wrist -> handSocket` hierarchy.
- Melee weapons attach to the right hand socket, bows to the left hand socket, and shields transition between the left hand socket and back.
- `CharacterCombatAnimator` owns the data-driven dagger, sword, greatsword, bow release, foot-lance, and mounted-lance timelines. Player and NPC damage/projectile code reacts to its one-shot animation events.
- `CharacterBowVisual` is the single implementation for Player and bow-equipped NPC bow geometry, vertical target alignment, string draw, nocked-arrow placement, and projectile launch origin/direction. Allied NPC tiers map to the same shortbow/longbow/runebow models used by the Player; Roman pilum remains separate.
- Greatswords and foot lances use two-handed poses. Mounted lances remain couched under the right arm so the left arm can retain its shield.
- `ThirdPersonCamera` keeps its optical axis and fixed reticle on one world ray. While aiming, `Game` raycasts that ray to a visible world hit (falling back to a distant point), and player arrows travel from the hand's nock socket toward that resolved point.
- Entering aim mode changes FOV only; camera distance and lateral position remain fixed so the world point beneath the original reticle does not jump.
- Melee meshes are authored along local `+Y`. Each hand now owns an animated action pivot with a static weapon-specific grip child, so idle alignment cannot be overwritten by slash/thrust deltas. Lance thrust translation follows its shaft axis.
- Arrow geometry uses local `-Z` as visual forward for both nocked and flying arrows; projectile quaternions explicitly align that axis with physical velocity instead of relying on generic `Object3D.lookAt()`.
- Arrow and pilum instances share immutable shaft, tip, fin/socket/neck/wrap geometries and materials. Removing a transient projectile therefore cannot leave one new GPU resource allocation per shot during the 50v50 stress scenario.
- Hand-held shields are centred above the wrist and face character-forward; hand/back targets retain independent position and quaternion transitions.
- Weapon and shield meshes retain `originalMat` for flash restoration, while shields are excluded from character damage-flash traversal.
- `?devcombat` enables `CombatTrajectoryDebugger` and a fixed Tier-3 50v50 cavalry battle: each faction receives 25 ranged riders and 25 lancers, with front lines starting about 35m from the player. Viking ranged projectiles use arrow visuals while Roman ranged projectiles use full pilum visuals through the same collision pipeline. Grip-to-tip direction lines stay visible and melee actions retain world-space tip trails; completion logs local-space start/end/bounds for Player and NPCs. The debugger is not instantiated on normal URLs.
- The normal release URL uses a deterministic beginner-friendly 10v5 battle: the Player plus nine allied Tier-2 infantry (five melee, four archers) face five Tier-2 Roman infantry (three melee, two pilum), with cavalry randomness disabled for those units.
- NPC ranged units engage out to 22m. Their shared aim point adds distance-squared vertical compensation before both visual aiming and projectile launch, while NPC arrows/pilums use a 20m/s launch speed for readable longer arcs.
- Player physics keeps its 0.95m capsule half-height, while the procedural render rig has a fixed -0.15m visual offset so its -0.8m boot soles meet the terrain exactly like NPC soles without altering collision, jump, or camera roots.

### Phase 21 Procedural Realism Pass
- `ProceduralMaterials` creates deterministic cached albedo, roughness and bump textures with a browser `CanvasTexture` path and a headless `DataTexture` fallback for tests.
- `CharacterVisuals` now builds higher-resolution anatomical bodies, faces, hair/beards, layered Viking/Roman Tier-2 armor and articulated hip/knee/ankle rigs. Mounted poses spread and bend the legs for each saddle width without changing combat hand sockets.
- Tier-2 swords and gladii use tapered diamond-section blade geometry; the recurve bow uses continuous tube curves and laminated limbs; Roman and Viking shields contain curved/planked bodies, rims, bosses and rear grips.
- Black Cat and Corgi retain the exact legacy procedural meshes inside `Mount` solely for loading old save IDs. New games do not spawn them; their external rebuild is deferred.
- The renderer uses ACES filmic tone mapping and rebalanced outdoor key/fill lighting so procedural metal, leather, wood and fur retain readable material separation.
- `?devmodels=mounts&nolock` is the isolated horse studio with a Player-independent Orbit camera, three variants, all nine clips, rider/skeleton toggles, LOD inspection and render-resource counters.
- `ai_share/skills/combat-browser-validation/` is the canonical browser QA workflow for combat work. It documents release/debug URLs, GPT Chrome extension operation, trajectory-overlay semantics, console-log interpretation, visual acceptance checks, and extension-noise filtering; `.agents/skills` and `.codex/skills` expose the same skill through links instead of duplicated copies.

### Phase 22 External Humanoid Pipeline
- `main.ts` calls `Game.create()`, which waits for both faction manifests and all LOD GLBs before any Player or NPC is born. A blocked/missing manifest produces a readable overlay and prevents mixed external/procedural release characters.
- `HumanoidAssetRegistry` loads one immutable GLTF template set per faction and uses `SkeletonUtils.clone` for independent skeletons. Geometry, PBR materials, textures and clips remain shared; each instance owns mixers, socket objects, bounds and lifecycle control.
- The bone adapter preserves Phase-20 right/left arm, leg and hand-socket semantics while exposing pelvis, spine, head and foot sockets. `CharacterCombatAnimator` preserves action timing and one-shot gameplay events while requesting matching mixer clips and retaining procedural bone overlays for weapon alignment.
- The registry refuses `blocked` assets and validates measured height, shoulder width and neck length before loading. LOD0/1/2 switch at 0/12/28m and far animation updates are capped near 12 Hz.
- `?devmodels=humans&nolock` is the neutral-grid external-character studio with a Player-independent Orbit camera and toggleable `SkeletonHelper`. `?legacyhumanoids&nolock` remains a Vite-development-only regression fixture and is not a release fallback.
- Canonical asset preparation instructions live at `ai_share/skills/humanoid-rig-skinning/`; both Viking and Roman manifests are ready and include source hashes, CC BY attribution, bone maps, LOD/image audits and deformation evidence.

### Phase 23 External Horse Pipeline
- `Game.create()` preloads `HorseAssetRegistry` before spawning any mount. `realistic-warhorse-v10` uses local `+Z`, one 80-joint skin, nine clips and saddle/stirrup/camera sockets.
- Each horse receives an independent `SkeletonUtils` clone and `AnimationMixer`; geometry, materials, KTX2 textures and clips are shared. LOD distances are 0/18/38m and animation updates beyond 35m are throttled near 15 Hz.
- `Mount` remains authoritative for HP, movement, collision, jumping, impact and save timing. Horse animation chooses idle/walk/trot/canter/gallop from movement speed and plays jump/land/hit/death once without an extra group-level death roll.
- New scene horses and NPC cavalry use `HORSE`. Stable FNV-1a keys assign the three coat variants; saves accept an optional `appearanceVariant` and default invalid/missing values to 0 without a schema bump.
- `LegRig.forwardBendSign` declares the local-X forward-bend convention for each humanoid rig. The external project-humanoid adapter and legacy procedural fixture provide their own sign, and `applyCharacterMountedPose` applies that convention consistently to hip, knee and ankle rotations so Player, NPC and studio riders share an anatomically forward knee bend.
- Public assets live in `public/models/mounts/v1/horse/`; source hashes and licensing are recorded in its manifest/CREDITS and the retained audit reports under `artifacts/mount_horse_pipeline/`.

---

## Data Flow (per frame)

```
Game Loop
  │
  ├─► WeaponPickup.update() ──► Distance ≤ 2.5m ──► Show [E] 拾取 Prompt ──► (Press E) ──► inventoryManager.addWeapon()
  │
  ├─► Tab / I Key Press ──► equipmentUI.open(skillManager, inventoryManager) ──► Click 【裝備】 ──► player.rebuildWeapon()
  │
  ├─► Player Melee Swing ──► Combat animation hit event ──► Read equipped melee damage/range ──► One hit check
  │
  ├─► Player Bow Fire ────► Charge pose ──► Bow release event ──► Spawn ArrowProjectile
  │
  └─► Mount Impact Damage ─► Horizontal line-segment collision vs Dummy/NPC/Player radii -> deals speed-based damage
  
### Cavalry & Mount Data Flow
- **Spawn**: New cavalry and scene mounts use the external Horse. Legacy Black Cat/Corgi types are created only when restored from an old save.
- **Visuals**: The Horse provides saddle/stirrup sockets, `rideHeightOffset`, `ridePitch`, LOD and animation; riders align their pelvis and mounted leg pose to those landmarks.
- **Roles**: Cavalry can be **Lancers** (3.0 reach, 3x charge damage that suppresses mount impact) or **Mounted Archers** (can shoot while moving, maintaining 6~15m distance. Will drop bows and auto-switch to melee sword charge if enemy enters <6m range).
- **Damage Routing**: Melee/Arrow attacks against a Mounted entity route 100% of damage to `mount.takeDamage()`.
- **Dismount**: If Mount HP drops to 0, `mount.dead = true`, and the entity resets rotation and resumes foot AI / movement.
