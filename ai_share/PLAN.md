# Warriors: Dedicate Your Heart! — Development Plan

## Project Overview

An original 3D action RPG web game built with Three.js + Vite + TypeScript.
Combat feel inspired by melee and archery gameplay; skill-growth RPG mechanics.
Pure frontend — no backend server. Save/load via localStorage.

---

## Development Phases

### ✅ Phase 0 — Project Initialisation (DONE)
- Vite + Three.js + TypeScript project scaffold
- Flat terrain (PlaneGeometry 200×200) with decorative rocks and trees
- Sky background colour + atmospheric fog
- Ambient light, directional "sun" light with shadows, hemisphere light
- Player as capsule geometry (CylinderGeometry body + SphereGeometry head)
- WASD movement (camera-relative), Space bar jump, simple gravity
- Mouse Pointer Lock — horizontal/vertical camera orbit (third-person)
- Controls hint HUD and click-to-start overlay

---

### ✅ Phase 1 — Movement Polish (DONE)
- Sprint (Shift) with stamina consumption and stamina bar UI
- Basic obstacle collision (bounding-box or capsule vs box)
- Save/load data structure skeleton:
  - `PlayerSaveData { position, hp, stamina, skillLevels }`
  - Read/write via `localStorage`

---

### ✅ Phase 2 — Melee Combat System (DONE)
- Equip a sword (BoxGeometry blade attached to player hand)
- Left mouse button: swing animation (rotate sword group) + hit sphere detection
- Dummy enemy: static target that takes damage, shows floating damage numbers
- HP bar UI (player + enemy)
- Swing costs stamina

---

### ✅ Phase 3 — Archery System (DONE)
- Equip bow (torus/cylinder geometry)
- Right mouse button: enter aim mode (FOV zoom + crosshair change)
- Hold left button to charge, release to fire
- Arrow: CylinderGeometry projectile with gravity arc (parabolic trajectory)
- Hit detection on release
- Quiver count displayed on HUD

---

### ✅ Phase 4 — Enemy AI (DONE)
- At least one enemy type (cone-head capsule)
- Simple state machine: Idle → Patrol → Alert → Chase → Attack → Dead → Respawn
- Detection radius, attack radius
- Enemy HP bar above head
- Respawn at spawn point after N seconds

---

### ✅ Phase 5 — RPG Interface Shell (DONE)
- Two skills: **One-Handed** (melee uses) and **Archery** (arrow fires)
- Skill level displayed, increases with usage count
- HP / Stamina bars (styled, not placeholder)
- Simple equipment slot overlay
- Original compass/direction bar (Norse-rune aesthetic, not Skyrim clone)

---

### ✅ Phase 6 — Scene & Polish (DONE)
- Terrain height variation (PerlinNoise or heightmap-driven PlaneGeometry)
- Enhanced lighting & fog atmosphere
- Player death screen + respawn
- localStorage full save/load (Phase 1 skeleton → full implementation)
- Basic sound effects (CC0 / royalty-free)

---

### ✅ Phase 7 — Inventory & Ground Pickup System (DONE)
- 3D world item drop nodes (floating animation + glowing light ring)
- Interaction prompt HUD (`[E] 拾取：[物品名稱]`) when approaching within 2.5m
- Press `E` to pick up items into `InventoryManager`
- Tab/I Character Modal extended with Inventory Grid (owned items & quantities)
- Equip button switches active weapons seamlessly
- `SaveManager` persists inventory & equipped items to localStorage

---

### ✅ Phase 8 — Weapon Tier & Distinct 3D Geometry System (DONE)
- Centralized `WeaponDatabase.ts` configuration (no hardcoded combat constants)
- 3 Melee Weapons with distinct 3D Geometries:
  - **Tier 1 生鏽小刀 (Rusty Dagger)**: 0.55m short blade, minimal guard, dark grey metal (Dmg: 12, Swing: 0.24s)
  - **Tier 2 鋼鐵長劍 (Steel Sword)**: 1.1m standard double-edged blade (Dmg: 25, Swing: 0.35s - baseline handfeel)
  - **Tier 3 精鋼戰刃 (Runic Greatsword)**: 1.55m wide double-handed blade, 3 hilt torus rings, octahedron rune gem pommel, winged guard, blue glowing fuller (Dmg: 45, Swing: 0.45s)
- 3 Bow Weapons with distinct 3D Geometries:
  - **Tier 1 木製短弓 (Wooden Shortbow)**: 0.9m straight limbs, crude wood (Dmg: 8-22, Speed: 12-32m/s, Charge: 0.8s)
  - **Tier 2 反曲長弓 (Recurve Longbow)**: 1.3m 2-segment S-curve limbs (Dmg: 15-42, Speed: 18-48m/s, Charge: 1.2s - baseline handfeel)
  - **Tier 3 符文精靈弓 (Elven Runebow)**: 1.7m 3-segment elven crescent limbs, octahedron crystals, crescent torus spikes, glowing arrow (Dmg: 28-75, Speed: 25-65m/s, Charge: 1.8s)
- Tier Badges & colors (Tier 1: 灰色 ★, Tier 2: 藍色 ★★, Tier 3: 金色 ★★★)

---

## Technology Stack (Fixed — Do Not Change)

| Layer        | Choice                        |
|--------------|-------------------------------|
| 3D Engine    | Three.js r167+                |
| Build Tool   | Vite 5                        |
| Language     | TypeScript 5.5                |
| Persistence  | localStorage                  |
| Backend      | None (pure frontend)          |
| Assets       | Licensed external humanoids and horse; procedural weapons/shields; legacy procedural save mounts |

---

### ✅ Phase 13 — Cavalry NPCs & Mount Interactions (DONE)
- Historical behavior: cavalry NPCs spawned with a 40% chance on a Corgi or Black Cat. Phase 23 supersedes new spawns with Horses while keeping old save IDs.
- Mount damage routing: If an NPC or Player is mounted, all melee and arrow damage routes to the mount's HP.
- Mount Death: When a mount's HP reaches 0, the rider is forcibly dismounted and resumes foot combat.
- Impact Damage: Sprinting mounts deal horizontal collision-based damage to valid targets with a short cooldown.
- Interaction Restrictions: Players cannot 'E' interact with a mount that is currently ridden by an NPC.

---

### ✅ Phase 14 — Cavalry Weapon Extensions (DONE)
- Lancer (長槍騎兵): Uses a new Lance weapon (`steel_lance`). Charges deal 3x damage and skip mount impact damage.
- Mounted Archer (騎射手): Aims and shoots while moving, maintaining a distance of 6~15m.

---

### ✅ Phase 15 — Performance & Architecture Refactoring (DONE)
- Weapon mesh factory unification.
- SpatialGrid optimization.
- AI logic enhancements (Archers draw swords in melee).
- Documentation moved to `.agents/`.

---

### ✅ Phase 16 — Dynamic Back Shield Mechanism (DONE)
- Shields automatically unequip from the left hand and attach to the character's back when switching to Archery mode.
- Re-equipping melee weapons automatically moves the shield back to the left hand.

---

### ✅ Phase 17 — Realistic Character Aesthetics (DONE)
- Removed toy-like full-body dyes.
- Characters feature realistic metal (iron/bronze) and leather tones.
- Team identification relies on silhouettes (helmet/shield types) and localized accent colors (runes, crests).

---

### ✅ Phase 18 — Anatomical Limb Segmentation (DONE)
- Upgraded the body from a basic capsule to segmented Torso (chest + abdomen) and Legs (thigh + calf).
- Adjusted joint pivots for arms/shoulders to match the new chest width.
- Corrected proportions, fixed floating head gaps, and synchronized Player/NPC height profiles.

---

### ✅ Phase 19 — Physical Collision Fixes (DONE)
- Implement Direction A: Reactive Push-Out from Obstacles (`resolveObstacleCollision`).
- Implement Direction B: Predictive Entity Push to prevent clipping when backed into walls.
- Safety fallback: Handle anchored crushing (Mounts vs Obstacles) via soft overlap.

---

### ✅ Phase 20 — Procedural Character Combat Animation Overhaul (DONE)
- Rebuilt Player and NPC arms as shoulder/elbow/wrist FK rigs with hand sockets.
- Attached melee weapons and bows to hands instead of independent character-root pivots.
- Added shared data-driven dagger, sword, greatsword, bow release, foot-lance, and mounted-lance timelines.
- Aligned melee hit checks and arrow spawning with one-shot animation events.
- Added two-handed greatsword/foot-lance poses, mounted couching, and smooth shield hand/back transitions.
- Added deterministic combat timeline tests for event ordering, large frame deltas, recovery lockout, and completion.
- Separated static weapon grip alignment from animated action pivots; fixed grounded blades, shaft-axis lance thrusts, shield height/facing, arrow visual direction, and reticle raycast targeting.
- Consolidated Player and bow-NPC geometry, socket aiming, string/nock updates, and launch coordinates into one `CharacterBowVisual`; `?devcombat` currently runs a Tier-3 50v50 cavalry battle with 25 ranged riders and 25 lancers per faction.

---

### ✅ Phase 21 — Procedural Character, Equipment & Mount Realism (DONE)
- Added cached procedural PBR textures for skin, cloth, leather, wood, metals and fur without external image/model assets.
- Rebuilt shared anatomy, faces, Viking/Roman Tier-2 armor and articulated mounted leg poses while preserving the Phase-20 combat sockets.
- Rebuilt Tier-2 swords, gladii, recurve bows, pilums, round shields and scuta with profiled/curved geometry and shared pickup models.
- Prototyped proportioned Black Cat/Corgi rigs; these visuals were later excluded from the final change set in favor of the previous committed save-compatible versions.
- Preserved mount physics, save IDs, movement speed, collision and damage routing; added Phase-21 regression coverage and Chrome validation requirements.

---

### ✅ Phase 22 — External Realistic Humanoids, Rigging & Skinning (IMPLEMENTED)
- Runtime foundation implemented: async manifest-gated preload, shared GLTF templates, per-instance skeleton/mixer, three LOD levels, bone/socket adapter, event-compatible combat cross-fades, 58° gameplay FOV, readable startup failure, and `?devmodels=humans&nolock` studio route.
- Canonical `humanoid-rig-skinning` skill, GLB audit script, anatomical contract, asset manifest contract, compatibility links, and forward-test are complete.
- Authorized Viking and Roman sources were supplied and audited as CC BY 4.0. Both `characters/v2` manifests are ready with common skeleton/socket contracts, Blender skinning, measured proportions, three LODs, downsampled PBR maps and deformation evidence.
- Runtime short horns, free-camera humanoid studio, rider alignment, unified forward heading and rear third-person start view are integrated. Transient arrows/pilums share render resources so the 50v50 live scene does not grow a new geometry/material set per shot. Roman mounted skirt clearance remains a documented provisional item for continued saddle testing.

### ⏸ Black Cat / Corgi Rebuild — DEFERRED
- Keep the exact legacy procedural Black Cat and Corgi visuals plus their save IDs for compatibility.
- Do not spawn either type in new games or NPC formations while the horse runtime is active.
- The discarded Stage-1 sculpt/blockout assets are not part of the repository. Re-open anatomy, topology, rigging, materials and animation as a separate phase only after the horse pipeline is stable.

---

### ✅ Phase 23 — External Realistic Horse Runtime (DONE)

- `realistic-warhorse-v10` is the only shipped horse package: one 80-joint skin, one mixer per instance, nine clips, three source-derived coat variants and source-derived groom/tack.
- Runtime geometry is Meshopt-compressed; 48 KTX2 textures and the Basis transcoder ship with the package. LOD0/1/2 contain 64,986 / 20,279 / 5,916 triangles and the complete payload is about 6.05 MB.
- New scene mounts and NPC cavalry use `HORSE`; stable FNV-1a keys distribute the three coats. `BLACK_CAT` and `CORGI` remain loadable only for legacy saves.
- The isolated `?devmodels=mounts&nolock` studio passed all coats, all nine clips, LOD0/1/2, skeleton, rider/socket and resource-stability review.
- Unit tests and production build are blockers and pass. Release 10v5 and stress 50v50 are recorded diagnostics: neither crashed or emitted application errors; initial load latency, stress FPS and distant formation placement remain follow-up work.
