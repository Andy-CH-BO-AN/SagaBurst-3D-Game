# Warriors: Dedicate Your Heart! — Progress & Handoff Notes

_Last updated: 2026-07-19 (Phase 20 combat animation overhaul complete)_

---

## Current Status

**All Phases (0 ~ 8, 13, 14, 15, 16, 17, 18, 19, 20) — ✅ COMPLETE**

The 3D Action RPG web game now features detailed character segmented models, realistic textures/factions aesthetics, dynamic back shields, and comprehensive combat mechanics (Melee, Archery, Cavalry).

### Phase 20: 程序角色戰鬥動畫重製
- 玩家與 NPC 共用肩、肘、腕三節 FK rig，所有武器改掛在 hand socket，手與武器不再各自動作。
- 新增資料化小刀、長劍、巨劍、拉弓／放箭、步戰長槍及騎乘架槍時間軸。
- 近戰命中與箭矢生成改由單次動畫事件觸發，並保留傷害、耐力、XP、弓箭蓄力及騎槍三倍傷害規則。
- 巨劍與步戰長槍使用雙手姿勢並將盾牌掛背；騎槍改為右腋架槍、左手保留盾牌。
- NPC 各武器依完整動畫時間加 0.35 秒 AI 間隔進行下次攻擊；羅馬標槍保留獨立投擲姿勢。
- 新增 Vitest 時間軸測試，覆蓋單次命中／放箭事件、大 `dt` 跨幀、收招鎖定與動作完成。
- 實機回報修正：弓箭改用 orbit reticle 方向，不再沿相機看向角色的下斜線發射；FK 正負軸向修正為往角色前方出手。
- 原本固定在角色根節點、會遮住手臂動畫的上臂護甲已改掛肩關節；盾牌材質不再受傷變紅，並會在精確 0.15 秒內回到左手。
- 錄影回報修正：刀劍 pivot 改為由後上方穿越角色前方的實際前劈軌跡，命中事件對齊到刀刃進入前方的接觸幀。
- 右鍵瞄準只改變 FOV，不再縮短相機距離或平移到右肩，原準心下的世界位置保持不動。
- 騎槍 NPC 在 ATTACK 間隔也持續套用腋下架槍姿勢；測試場每個陣營至少保證一名 Tier 3 騎槍兵便於驗收。
- 截圖回報修正：新增 `actionPivot → gripPivot → mesh` 分層；刀劍、巨劍與長槍各自保留固定握持校正，動畫不再把模型 `+Y` 軸翻向地面。
- 長槍待機改為肩／腋下高度，攻擊沿槍桿自身軸前送；步戰雙手、騎乘左手持盾的分流維持不變。
- 固定準心、相機與箭矢使用同一條中心射線；瞄準時先 raycast 解析準心命中點，再由實際 nock 世界座標射向該點。
- 箭頭本地 `-Z` 明確對齊物理速度，修正箭身飛行正確但箭頭朝反方向；搭弓箭也會對準當前準心點。
- 手持盾中心提高到前臂並將盾面轉向角色前方，背盾仍維持獨立 transform 與 0.15 秒過渡。
- `?nolock` 僅供瀏覽器自動化 QA：右鍵與拉弓改用點擊切換，正常網址仍維持 Pointer Lock 與原本按住操作。
- 自動驗證：Vitest 27/27、TypeScript/Vite production build 通過；覆蓋刀尖離地／向上、三種刀劍水平前刺、直線抽回、槍尖沿軸前送、盾面方向、箭頭／速度一致性及含 Sprite 準心 raycast 測試。
- 近戰截圖回報修正：待機刀尖改為明顯微抬；刀劍有效動作反轉為右上起手、穿過身前至左下收尾，移除原本左下往右上的 uppercut 軌跡。
- 新增 `?devcombat` 武器軌跡模式：玩家黃、友軍藍、敵軍紅；場景顯示 grip→tip 方向與攻擊 tip trail，完成時 console 印出角色 local-space 起終點及 XYZ bounds。
- 實機軌跡回報修正：待機刀改為真正 world-up，而非朝前造成俯視投影向下；recovery 改成低位側收後再直立抬刀的 L 型回程，不再倒播左下→右上的斜向砍擊。預設 console 僅印玩家，`?devcombat=all` 才印所有 NPC，且死亡角色不再累積 240-sample 假軌跡。
- 修正右鍵瞄準 raycast：改用 `setFromCamera()` 設定 camera，避免遞迴掃到 NPC Sprite 時觸發 Three.js runtime error。
- 最終取消刀劍揮砍 pose：小刀、長劍與巨劍分別改為短刺、標準刺及雙手重刺；肩肘總俯仰角固定在約 `PI / 2`，有效幀維持水平，收招先沿刺擊線抽回再轉回直立待機。既有 action ID、傷害與命中事件不變，dev mode 顯示名稱改為 `daggerThrust`／`swordThrust`／`greatswordThrust`。
- 測試場改為只生成玩家，不再生成 5 vs 5 NPC；保留木樁、掉落武器及 `?devcombat` 軌跡工具。
- 已透過 Chrome 實際進入 localhost，確認長劍沿角色正前方伸出且待機回到劍尖朝上。
- `?devcombat` 新增弓箭診斷：紫色記錄 nock 拉弦路徑、青色連接弓把與 nock、白色顯示右手與 nock 誤差、橘色顯示搭弓箭方向、綠色記錄實際箭頭飛行拋物線；每次結束會在 console 印出 `bowDraw`／`arrowFlight` 起終點與 XYZ bounds。飛箭採固定空間間距取樣，完整 200m 路徑不受螢幕更新率影響。
- 放箭視覺與事件同步：弓弦及搭弓箭維持滿弓狀態直到 `projectileRelease` 幀，生成飛箭後才回彈並隱藏搭弓箭，避免提早回彈或同時看到兩支箭。
- 弓箭 dev mode 新增紅色 5m 瞄準導引：由玩家上半身沿實際 nock→準心發射方向延伸，末端使用三軸十字標示；只在瞄準及放箭恢復期間顯示。所有 debug 線均標記為 `ignoreAimRaycast`，避免診斷幾何反過來被準心射線命中並污染箭矢方向。
- 修正谷地放箭首幀消失：箭矢地面碰撞由固定世界 `y=0.05` 改為查詢當地 `getTerrainHeight(x,z)+0.05`，並保留離弦前 0.12m 的世界碰撞寬限。針對實機紀錄座標 `(-34,15)` 新增低於零高度谷地回歸測試；Vitest 更新為 28/28。

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

### AI 共用文件架構
- 新增 `ai_share/` 作為 `AGENTS.md`、`ARCHITECTURE.md`、`PLAN.md` 與 `PROGRESS.md` 的唯一真實來源。
- `.agents/` 與 `.codex/` 保留同名指引檔，內容明確指向 `ai_share/` 的對應檔案，讓不同 AI 工具都能找到最新內容。
- 後續只需編輯 `ai_share/`，不需複製或同步其他目錄。

### Phase 20: 拉弓姿勢外移修正

- 修正拉弓 pose 的肩膀側向旋轉符號：持弓左手固定伸到身體左前方，弓、弦與搭箭軌跡不再埋入胸口。
- 拉弦右手會隨充能比例由箭尾附近向後上方移動至臉側，形成可讀的滿弓姿勢。
- 新增 FK 空間回歸測試，鎖定持弓手外移、拉弦手高度、前後距離與雙手間距。
- 已使用 `?devcombat&nolock` 實機檢查 0% 與 100% 拉弓姿勢及軌跡線。
- 玩家三種弓的弓身獨立放大 22%，短弓、長弓與精靈弓維持不同尺寸，箭矢與 socket 不跟著縮放。
- 統一搭箭與發射座標：弓弦中央 nock 改為箭尾接觸點，視覺箭身與 `ArrowProjectile` 均由同一點沿瞄準方向前移半支箭長，不再從弓身旁跳出。
- 新增弓跨度與箭尾／nock 對齊測試，並以 dev mode 實機檢查滿弓及離弦起點。
- `?devcombat` 新增完整弓形診斷：綠色九點中心線覆蓋上弓梢至下弓梢，青色三點折線顯示完整弓弦（上弓梢 → nock → 下弓梢）。
- 修正弓 socket 繼承手腕旋轉後向前倒下的問題：每幀抵消 parent twist，使弓身本地 Y 維持世界垂直、箭軸維持指向準心；同步降低持弓手，讓上弓梢位於額頭附近。
- dev mode 的洋紅 nock 軌跡只記錄實際拉弦，不再包含抬弓過渡，且回到待機後隱藏，避免把殘留弧線誤認為弓身或射擊方向。
- 玩家與 NPC 的靴子改為明確沿角色本地 `-Z` 延伸的前長後短剪影，不再看起來雙腳朝後。
- 盾牌手持姿勢改為左肩、肘將手掌與盾一起送到胸前；手掌 socket 對齊盾背握把，並抵消手臂旋轉使盾面維持朝前。
- 單手近戰與騎乘架槍保持盾牌 guard pose；弓、巨劍與步戰長槍仍沿用掛背狀態。
- 新增 `CharacterBowVisual`：玩家與真正持弓的 NPC 共用弓模型、垂直目標對齊、弓弦、搭箭與發射起點，移除 NPC 舊的獨立小弓更新邏輯。
- 維京遠程 NPC 依階級改用與玩家相同的短弓、長弓、精靈弓；羅馬遠程兵保留獨立的 pilum 投擲行為。
- `?devcombat` 改為 Tier 3 的 50v50 全騎兵大會戰：雙方各 25 名遠程騎兵與 25 名長槍騎兵，所有 NPC 皆強制騎乘。
- 校正弓身與弓弦的前後關係：只鏡射實體弓身，使弧面朝射擊前方 `-Z` 凸出；弓弦 nock 恢復在靠近射手的 `+Z` 側，箭與發射座標不隨弓身翻轉。
- 羅馬遠程 NPC 的飛行投射物由箭矢改為完整 pilum 標槍模型（長木杆、鐵頸與槍尖），命中、傷害與陸地碰撞仍共用 `ArrowProjectile` 管線。
- 50v50 騎兵兩軍向外移：前排由玩家約 ±35m 開始，遠程後排由約 ±55m 開始。
- 正式版一般網址改為固定 10v5 新手友善戰鬥：玩家＋5 名我方近戰＋4 名我方弓兵，對戰 3 名羅馬近戰＋2 名羅馬投槍兵；全部 Tier 2 且關閉隨機騎兵。
- NPC 射手最大交戰距離由 15m 提高到 22m，弓兵與投槍兵共用根據水平距離平方增加的拋物線抬高瞄準點，並將 NPC 投射速度提高為 20m/s。
- 修正玩家腳底懸空 15cm：保留玩家 0.95m 膠囊半高與物理根節點，只將程序角色視覺 rig 下移 0.15m，使玩家與 NPC 靴底都精確貼合地形。
