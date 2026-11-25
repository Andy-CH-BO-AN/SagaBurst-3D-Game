# 編隊、傷害與戰績

範圍：部署編隊、CombatActorRef、DamageRouter、破甲與戰績。索引與共通規則見 [ARCHITECTURE.md](../ARCHITECTURE.md)。

- `BattleConfig.squadAssignments` 保存部署編隊，`matchesArmyCommandTarget` 是指令與 formation 共用選取規則。UI 部署需分配全部相關 NPC；既有無手動計畫的診斷設定可用 deterministic fallback。`ArmyCommandSelectionMarker`（Game／TownScene 各一個）只唯讀 `ArmyCommandController.commandPreviewTarget`／`forEachCommandPreviewMember`（同一套 authority、roster 與 target 規則，不覆寫 `onNavigation`），以單一 `THREE.Points` 批次在存活成員頭頂畫青色菱形（錨定 `npc.group` 本地座標、高於 `!` 圖示範圍，Town `?` 由場景提供圖示頂端抬高；凍結／UI 占用時隱藏）；場景於 render 前傳入輸入是否被 UI／暫停／死亡／結算占用，並在 dispose 釋放自有 geometry／material／texture。
- `CombatActorRef` 在攻擊／發射時擷取穩定 actor、allegiance、faction、preset、squad 身分；延遲命中的投射物保留原射手。
- `DamageRouter` 統一角色／坐騎／建物傷害，回傳實際 HP 損失，包含盾減傷與 overkill 上限。死亡／摧毀事件只在首次終止轉換送出。
- `CombatEventStream` 同步發送歸因事件，戰鬥不直接依賴戰績 UI 或生涯軍功。`BattleStatsTracker` 只做串流累計，不保存完整事件歷史。真實盾牌吸收另發送 `hit_blocked`，只供接觸冷卻等 consumer 使用；不偽造 HP 傷害，也不加入傷害／擊殺軍功。
- 破甲（Armor Break）：攻擊者等級隨 `createPlayerCombatActorRef` 帶在 `CombatActorRef.armorBreakLevel`（NPC 不帶），`ShieldState.absorb` 依此讓被擋份額每級 1%、最高 50% 穿透成 HP 傷害，盾牌／馬甲耐久仍完整扣除。玩家來源、目標為 NPC／坐騎的 `hit_blocked` 是破甲 XP 的唯一來源（每點被擋 Impact × `SHIELD_CONFIG.xpPerBlockedImpact`）；各場景同步 Player 戰鬥等級一律用 `syncPlayerSkillCombatLevels`。
- 戰績是單場資料；`BattleStatsView` 共用呈現個人／編隊結果。Defense Campaign 不累計進攻建物指標；生涯結算獨立消費有效結果。
