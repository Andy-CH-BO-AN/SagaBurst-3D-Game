# 編隊、傷害與戰績

範圍：部署編隊、CombatActorRef、DamageRouter、破甲與戰績。索引與共通規則見 [ARCHITECTURE.md](../ARCHITECTURE.md)。

盾牌吸收與 XP 數值以程式為準（`src/combat/ShieldBlocking.ts` 的 `SHIELD_CONFIG`）；本檔只記擁有者、不變條件與禁止事項。

- `BattleConfig.squadAssignments` 保存部署編隊；`matchesArmyCommandTarget` 是指令與 formation 共用的選取規則。UI 部署需分配全部相關 NPC；無手動計畫的診斷設定可用 deterministic fallback。
- `ArmyCommandSelectionMarker`（Game 與 TownScene 各一個）只唯讀 `ArmyCommandController.commandPreviewTarget`／`forEachCommandPreviewMember`，**不覆寫 `onNavigation`**；以單一 `THREE.Points` 批次錨定 `npc.group` 本地座標繪製，高於 `!` 圖示，Town 的 `?` 由場景抬高；凍結或 UI 占用時隱藏，dispose 時釋放自有資源。
- `CombatActorRef` 在攻擊或發射時擷取穩定 actor、allegiance、faction、preset 與 squad 身分；延遲命中的投射物保留原射手。
- `DamageRouter` 統一角色、坐騎與建物傷害，回傳實際 HP 損失，包含盾減傷與 overkill 上限。死亡與摧毀事件**只在首次終止轉換時送出**。
- `CombatEventStream` 同步發送歸因事件；戰鬥**不直接依賴戰績 UI 或生涯軍功**。`BattleStatsTracker` 只做串流累計，不保存完整事件歷史。
- 真實盾牌吸收另發送 `hit_blocked`，只供接觸冷卻等 consumer 使用；**不偽造 HP 傷害，也不加入傷害或擊殺軍功**。
- 破甲（Armor Break）：攻擊者等級隨 `createPlayerCombatActorRef` 帶在 `CombatActorRef.armorBreakLevel`（NPC 不帶）。`ShieldState.absorb` 依此提高穿透份額（有上限），穿透部分成為 HP 傷害；盾牌與馬甲耐久**仍完整扣除**。玩家來源、目標為 NPC 或坐騎的 `hit_blocked` 是破甲 XP 的唯一來源（按被擋 Impact 與 `SHIELD_CONFIG.xpPerBlockedImpact` 計算）；各場景同步 Player 戰鬥等級一律用 `syncPlayerSkillCombatLevels`。
- 戰績是單場資料；`BattleStatsView` 共用呈現個人與編隊結果。Defense Campaign **不累計進攻建物指標**；生涯結算獨立消費有效結果。
