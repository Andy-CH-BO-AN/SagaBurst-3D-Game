# 單挑競技場

範圍：Duel 場景、競技場碰撞與墜落、競技場軍團試煉與越獄戰鬥場景。索引與共通規則見 [ARCHITECTURE.md](../ARCHITECTURE.md)。

場地尺寸與墜落門檻以程式為準（`src/arena/DuelArena.ts` 的 `ColosseumLayout`／`ValhallaLayout`、`src/movement/GroundFall.ts` 的 `ARENA_GROUND_FALL_POLICY`）；本檔只記擁有者、不變條件與禁止事項。

## 場地與碰撞

- `createDuelArena(id, scene)`（`src/arena/DuelArena.ts`）是唯一入口，ID 為 `roman-colosseum`／`viking-valhalla`。建立時安裝 `claimFlatTerrainOverride`、`setScenePlayableWorldBound` 與 `setSceneGroundFallPolicy`；**必須在同場景角色建構前呼叫**。
- 平地 claim（`getTerrainHeight` 平地）以每座 arena 的 owner token 持有，只有擁有者 `releaseFlatTerrainOverride` 能清除；舊場景晚 dispose **不影響新場景**。
- `dispose()` 冪等，只釋放 arena 自己建立的資源並還原背景與霧；**共享的程序資源與人物、坐騎資源不釋放**。
- `ColosseumLayout`／`ValhallaLayout` 是純數值 owner（無 mesh），視覺 `RomanColosseum`／`VikingValhalla` 從同一組常數建模。
- 羅馬看台以扇區的 `WalkRampSurface`（`mounted: true`）組成多層可行走面；階梯式 `projectileBoxes` 與 `projectileWorldToLocal` 提供箭矢與鏡頭的實體段。**看台下方不是實心 AABB**，避免旋轉扇區的外接盒變成隱形牆。
- 英靈殿構件全部軸向對齊；屋頂以 `navigationPassable` 的體積阻擋箭與鏡頭。
- 羅馬場地面邊界由 `constrainToColosseumApron` 約束，只限制**存活且有支撐**的身體；跳出外牆的空中身體不被 clamp，必定完成墜落。

## 墜落

- `GroundFall` 是場景 opt-in 的墜落規則（目前只由兩座競技場安裝）。`GroundFallTracker` 記錄失去支撐到落地的最高腳底；`groundFallDamage` 的致死高度與傷害曲線以 `ARENA_GROUND_FALL_POLICY` 為準。
- Player 徒步與騎乘中的地面坐騎各自追蹤。空中上下地面坐騎以 `handOffTo` 交接最高點並延續垂直速度，**不能靠半空下馬規避摔傷**；地面上下馬、Teleport 與 Scene reset 才重設。
- 未安裝政策的場景跳躍規則不變。

## 正式單挑

- 士官長單挑頁的「單挑場地」單選可任選；切換兵種與 Tier 不重置。接受時 `createCareerDuelMission(..., arenaId)` 把 `duelArenaId` 存入 `activeMission`，並保存 `mountState`。
- `CareerTownEntry.start()` 依 `careerDuelArena()` 載入 `CareerDuelArenaScene`；接受後、交戰中與結算畫面的重整走同一路由。正式單挑**必須有合法 `duelArenaId`，缺漏或未知即拒讀**。新兵教學切磋仍走 Town forecourt。
- `CareerDuelArenaScene` 只擁有場景、角色與傷害路由；依 `arenaDuelPartyPlan` 建出臨時身體；T4／T5 職業仍走 `createOpponent`。單挑規則全部委派 `CareerDuelController`。
- `CareerDuelVenue` 提供固定站位：競技場**不行軍**，首次載入直接存成 PREPARING，`beginReturn` 拒絕。
- 結算沿用 `claimCareerMission`；返回時 `clearCareerMission` 後重建 Town。存檔失敗時固定該次 outcome 與統計快照並凍結戰鬥，只重送同一份結算。**載入失敗只提供重試或取消（不計勝負），不寫入戰敗**。
- `ArenaChaseRoute` 讓高低層對手沿階梯前進；階段只前進不倒退，抵達另一端才交回原戰鬥 AI。階梯段使用無障礙導航，物理仍由走道面與牆負責。
- 玩家的地面坐騎由 `CareerMountController` 帶入（巨鷹不帶入）；坐落點檢查排除頭頂屋頂體積。

## 競技場軍團試煉

- 士官長面板「競技場軍團試煉」分頁，獨立於 1v1、賽馬與正式戰役。`CareerArenaTrials` 擁有 T1–T5 定義（`ARENA_TRIAL_DEFINITIONS`）、軍階資格、`kind: 'arena-squad-trial'` 任務、`arenaTrial` checkpoint 與勝負判定。Tier 只決定 NPC 編制，**不改玩家職階**。
- 存讀只接受現行 rosterVersion 與固定 Actor ID。雙方索敵與傷害只看 NPC allegiance（`PLAYER`／`ENEMY`），**不靠外觀**。
- `ArenaTrialFormation` 以出生線與真實障礙檢查站位，容量不足即拒絕載入。
- `CareerArenaTrialScene` 沿用 `claimCareerMission`，每場獨立 ID 只領一次，**不寫入正式任務完成數、1v1 進度或死亡次數**。
- HP 歸零為擊倒：退出索敵，存檔立即記錄，重整**不重生、不永久傷亡**。玩家被擊倒後觀戰，只有我方全員倒下才敗北。
- `stage` 區分部署中（重整重新列隊）、交戰中（只重建站立者）與結果已保存（顯示結果、**不重打**）。返回沿用 `DUEL_ARENA_RETURN_KEY`。

## 越獄（戰俘逃脫）

- 正式重騎兵戰敗後，`Game._showFieldBattleResult` 經 `claimCareerFieldResult` 只為 Soldier Iron Encounter、Veteran Iron Tide 與 Commander Iron Legion 的新敗北保存 `activeMission.prisonBreak`；俘虜方取實際敵軍文化。玩家陣亡但友軍勝利、取消、載入失敗、其他任務與試煉 KO **不授予此能力**。
- `main` 在一般回城恢復前辨識此紀錄；保存成功的敗北頁與被俘重整恢復頁共用說明，按「開始越獄」保存後進入俘虜方的競技場或英靈殿。
- `CareerPrisonBreak` 集中三關 Tier、臨時戰俘與看守編制、固定獎勵、T1 劍的唯一歸屬與嚴格 parser；羅馬標槍兵保留 `legionary_pilum`。**不借用正式或 HR Actor，也不改永久配裝或坐騎所有權**。
- `CareerArenaCombatScene` 是 `CareerArenaTrialScene` 與 `CareerPrisonBreakScene` 的共用戰鬥 host，兩者沿 `createSceneRenderer`／`bindWindowResize` 共用 renderer 政策。普通試煉保留 `CareerArenaSession` 的 profile、結算與回城交易；關押維持獨立逃脫軍功收據。逃脫的臨時名冊只作 runtime view，**不覆寫原任務戰報或部隊 checkpoint**。
- `PrisonBreakLayout`／`PrisonBreakProps` 只在關押模式開出既有場景的地面鐵門通道。該場看守全倒只開門；玩家或任一存活戰俘從地面實際穿過指定門才全隊成功；玩家與戰俘全倒且無人逃出才失敗。
- 玩家倒下後沿 `SpectatorCameraController` 觀戰；NPC 續戰與拾劍不中斷，開門後沿 Town formation travel 出門。
- 結果與實際逃出者、逃脫軍功**同次保存**；保存失敗凍結快照供重試，**門外位置不先單獨寫入**。結果重載**不重發獎、不重播嘲諷或開門**。
- 關押戰鬥不寫回正式或 HR 部隊快照。返回經 `commitPrisonBreakReturn`：先取出原任務私兵快照，再清原 active mission，沿 `stageMissionReturnRebuild` 完成部隊復位；保存成功才沿 `SergeantReturn` 的安全落點回城。
- 關押只等待實際存活名冊所用的裝備，原配裝已沒收，不納入阻塞預載。出口寬度由 `prisonExitPlan.halfWidth` 與共用 Player 碰撞半徑計算；門洞只裁掉牆段在通道內的部分，**弧牆不得整段刪除而擴大物理缺口**。關門阻擋沿 `prisonGateObstacle` 使用同一組通道尺寸。

## 開場與 DEV

- 試煉與越獄部署完成後共用開場提示：先等待玩家點擊並取得 pointer lock，再開始倒數；倒數途中失去鎖定時保留剩餘時間。`?nolock` 以點擊開始。等待與倒數**不啟動交戰或越獄拾劍**。
- DEV 預覽 `/?duelarena=roman&nolock`、`/?duelarena=valhalla&nolock`（可加 `faction=roman|viking`）**不讀寫 Career／session，也不建立 Duel 任務**；production build 不包含該路由。
