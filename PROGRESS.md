# Warriors: Dedicate Your Heart! — Progress & Handoff Notes

_Last updated: 2026-07-19 (Phase 13 Complete — Cavalry NPCs & Mounts)_

---

## Current Status

**All Phases (0 ~ 8, 13, 14) — ✅ COMPLETE**

The 3D Action RPG web game now includes fully functional Cavalry NPCs, mount damage routing, impact damage, specific player mount interaction rules, and specialized cavalry variants (Lancers and Mounted Archers).

---

## What Was Done in Phase 7 & Phase 8 (Supplement: 6 Distinct 3D Weapon Models)

> **Note**: An attempt was made to integrate a realistic FBX character model (`KnightCharacter.fbx`). However, due to complex issues with bone mounting, animation scales, and material rendering inconsistencies, the decision was made to roll back to the stable procedural capsule geometry version. The downloaded FBX assets remain in `public/models/characters/` for future reference, but are currently not active in the codebase.

### Files Created/Modified
| File | Action | Purpose |
|------|--------|---------|
| `src/player/Player.ts` | Modify | Implemented 6 distinct 3D weapon builders (`rebuildMeleeWeapon` & `rebuildRangedWeapon`) for Tier 1~3 Dagger, Sword, Greatsword, Shortbow, Longbow, and Elvenbow. |
| `src/world/WeaponPickup.ts` | Modify | Rendered 6 distinct 3D weapon geometries for ground drop nodes. |
| `src/rpg/WeaponDatabase.ts` | Modify | Centralized weapon config defining Tier 1~3 Melee & Ranged stats and badges. |
| `src/rpg/InventoryManager.ts` | Modify | Manages inventory grid, equipped weapons, and save/load state. |
| `src/player/PlayerInput.ts` | Modify | Added `KeyE` listener and `consumeKeyE()` method. |
| `index.html` | Modify | Added `#pickup-prompt` HUD, custom scrollbar CSS, and Inventory Grid in Tab modal. |
| `src/ui/EquipmentUI.ts` | Modify | Rendered Inventory Grid, Tier badges (灰/藍/金), damage stats, and equip buttons. |
| `src/save/SaveManager.ts` | Modify | Persisted inventory owned items and equipped weapon IDs to localStorage. |
| `src/Game.ts` | Modify | Spawned 6 weapon pickups + arrow packs, connected E key pickup interaction, and handled smooth pointer lock re-engagement. |

### 6 Distinct 3D Weapon Geometries Implemented
- ✅ **近戰武器 (Melee 3 把)**:
  1. **Tier 1 生鏽小刀 (Rusty Dagger)**: 短刃 (0.55m)、無護手、小木柄，長度僅長劍的一半，暗灰色。
  2. **Tier 2 鋼鐵長劍 (Steel Sword)**: 1.1m 標準雙刃劍，經典比例。
  3. **Tier 3 精鋼戰刃 (Runic Greatsword)**: 1.55m 雙手巨劍 (寬度為長劍的 2.2 倍)，加長 0.45m 柄身上附 3 個皮革/金環、柄頭帶 `OctahedronGeometry` 符文藍水晶寶石、0.58m 翼型護手、劍身中央流線型晶藍發光血槽凹槽。
- ✅ **遠程弓箭 (Ranged 3 把)**:
  1. **Tier 1 木製短弓 (Wooden Shortbow)**: 0.9m 簡易短弧直弓，2 段直線斜向木臂，原木色。
  2. **Tier 2 反曲長弓 (Recurve Longbow)**: 1.3m 雙段 S 型反曲弧度弓臂，經典質感。
  3. **Tier 3 符文精靈弓 (Elven Runebow)**: 1.7m 巨大雙反曲精靈弧度弓臂 (上下各 3 段)，弓臂頂端加裝 `OctahedronGeometry` 藍白螢光精靈符文水晶與月牙刺裝飾，配置發光箭矢。

---

## Final Project Summary

All 8 base phases in `PLAN.md` + Phase 13 are completed.

### Phase 13 Summary: Cavalry NPCs & Mount Interactions
- **Cavalry Architecture**: NPCs are spawned with a `generatedAsCavalry` flag. They bind to a `Mount` instance and their movement controls the mount.
- **Damage Routing**: Arrow and Melee damage are perfectly routed to the `currentMount`'s HP pool while riding.
- **Dismount on Death**: When a mount's HP zeroes out, the rider gracefully dismounts to resume combat.
- **Impact Damage**: A robust line-segment horizontal collision checks for high-speed mounts trampling targets.
- **E Key Filter**: Players can only steal unridden, alive mounts.

### Phase 14 Summary: Cavalry Weapon Extensions
- **Lancer (長槍騎兵)**: Uses a new Lance weapon (`steel_lance`). When charging at high speed (`movementSpeed > 10`), they deal **3x** melee damage, and their successful hit replaces the mount's impact damage for that frame.
- **Mounted Archer (騎射手)**: Armed with bows, they can aim and shoot while their mount is moving, maintaining a distance of 6~15 meters from the target without stopping.
- **Player Support**: Players can also pick up the `steel_lance` which has an extended attack range (3.0) and enjoys the same 3x damage charge bonus and impact-skip rule as NPCs.
