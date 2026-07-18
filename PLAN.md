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
| Assets       | Procedural geometry (for now) |
