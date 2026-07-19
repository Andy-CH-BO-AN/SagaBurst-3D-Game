# Warriors: Dedicate Your Heart! — Progress & Handoff Notes

_Last updated: 2026-07-19 (Phase 19 Complete — Physical Collision Fixes)_

---

## Current Status

**All Phases (0 ~ 8, 13, 14, 15, 16, 17, 18, 19) — ✅ COMPLETE**

The 3D Action RPG web game now features detailed character segmented models, realistic textures/factions aesthetics, dynamic back shields, and comprehensive combat mechanics (Melee, Archery, Cavalry).

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

### Phase 15: 程式碼與效能健檢
- 統一武器建構邏輯 (`WeaponMeshFactory`)
- 坐騎傷害路由重構
- 修正坐騎名稱顯示
- 空間分割優化 (SpatialGrid)
- 索敵機制改為全場掃描 (O(N)，拔除開根號)
- 已移除LOD分層機制，實測200人規模效能足夠，不需要此優化，避免衍生行為異常的風險。
- **坐騎視覺優化**：為黑貓與柯基分別加上專屬幾何體馬鞍，並抽出 `rideHeightOffset` 與 `ridePitch`，讓玩家與NPC騎乘時能精準呈現前傾跨坐姿態。
- 騎射手AI優化：當敵人進入極近距離 (<6m) 時，騎射手會主動收起弓箭拔劍發起近戰衝鋒。
- Agent 文件重構：將所有的 Agent 規則與進度文件 (`AGENTS.md`, `ARCHITECTURE.md`, `PLAN.md`, `PROGRESS.md`) 移入系統標準的 `.agents/` 目錄中，並新增「每次做完事皆需檢查並更新 ARCHITECTURE.md」的強制規則。

### Phase 16: 動態背盾機制 (Dynamic Back Shield)
- 玩家與 NPC 在切換為弓箭模式時，左手的盾牌會自動改掛在背後。
- 切換回近戰武器時，盾牌會自動掛回左手。

### Phase 17: 角色剪影與陣營識別重製 (Realistic Aesthetics)
- 移除原本整身染成紅/藍色的「玩具兵人」感，改為寫實的金屬鐵灰與皮革棕色。
- 維京陣營保留木製圓盾、牛角盔、以及胸前的藍色符文印記作為辨識。
- 羅馬陣營則裝備鐵片盔甲（環形 Lorica Segmentata）、羅馬方盾、以及頭盔上的紅色羽冠。

### Phase 18: 角色肢體結構細節化 (Anatomical Segmentation)
- 軀幹分節：將原本的單一巨大圓柱膠囊體拆分為「胸甲 (Chest)」與「腹部 (Abdomen)」。
- 四肢分節：新增「大腿」與「小腿」的幾何體分段結構，告別純圓柱四肢。
- 比例修正：修復因頭部球體弧度造成的斷頸空隙（加長加粗脖子），並確保玩家與 NPC 擁有完全一致的腿長與整體身高比例（修正 NPC 蹲姿問題）。
- 移除披風以防與箭筒及動態背盾發生嚴重的視覺穿模。

### Phase 19: 實體碰撞與穿模卡死 Bug 修復 (Physical Collision Fixes)
- 實作「方向 A (Reactive Push-Out)」：將 `resolveObstacleCollision` 的邏輯改為「事後推出」，若實體座標進入障礙物內，會自動瞬間擠出至最近的安全邊緣，徹底解決退回上一幀導致的死鎖卡死。
- 實作「方向 B (Predictive Entity Push)」：在 `resolveEntityCollision` 進行實體推擠前，會預判目標位置是否有障礙物。若背後有牆，該實體將獲得臨時 Anchored (不可推動) 屬性，使得衝撞的另一方承受全部推力，增加了被逼到牆角的物理真實感。
- 坐騎防卡死設計：若玩家被不可推動的坐騎推向牆壁（兩者皆視為 Anchored），則取消推擠動作，允許短暫重疊，確保玩家能隨時透過走位滑出，而不會被夾死。
- 在 `Game.ts` 的每一幀最後，增加對所有實體的 `resolveObstacleCollision` 保底驗證。
