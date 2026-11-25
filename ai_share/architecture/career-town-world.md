# 生涯：城鎮場景與世界

範圍：TownScene、城鎮建築／佈局／城牆、居民生活、死亡隱藏、犯罪、載入 barrier 與 Town 導航。索引與共通規則見 [ARCHITECTURE.md](../ARCHITECTURE.md)。

建築尺寸、座標、站位數與距離以程式資料為準（`ArchitectureSpecs`、`TOWN_CENTER_FRAME`／`ROMAN_TOWN_CENTER`、`TownLayout`、`TownBounds`、`TownGatehouse`）；本檔只記擁有者、不變條件與禁止事項。

## 場景職責

- `TownScene` 自有 renderer、input、projectiles、呈現與觀戰控制，**不借用 `Game` 迴圈**。`TownWorld` 管建物、障礙與場景資源；`TownRules` 管居民配置；`TownEquipment` 管可用裝備與拔出狀態（只允許已擁有且有可分配份數者，拔武器狀態不寫進其他模式）；`TownCombat` 管城鎮命中；`CareerTownDialogue` 管和平對話與 rank 選擇。
- `TownBounds` 定義 Career Town 專用 playable／navigation bounds 與外圍 Bandit Camp 索引；`TownWorld` 在生成 actors 前登記 scene bound，之後所有生成沿用。Campaign／Outpost 保持自己的預設範圍。
- Loading barrier 只等待當次已宣告的 Initial Roster（TownScene 的 mission／defense batches 與已接受 HR；Game 的初始 `BattleSpawnPlan`、Captain Eagle 名冊與 HR）。Loading 以 `gameplayNpcSpawns.wait` 推進 RAF，**不推進戰鬥或倒數**；成功 registration／checkpoint 後才可操作。本城原地接任務不用 entry barrier；reinforcement、timed wave、dynamic encounter 不納入等待。

## 建築

- `src/town/architecture/` 是 Roman／Viking 城鎮建築的深層模組，正式 `TownWorld` 與 DEV 展示場景（`/?townarchitecture=roman|viking&nolock`，不讀寫存檔）共用。
- `ArchitectureSpecs` 是純資料平面圖（建築本地座標，+Z 為正門，`side = x`／`forward = z` 與 `townSitePoint` 相同）：佔地、樓板、入口、室內、走道、NPC anchors、碰撞與 HP。`placeArchitecture(kit, kind, site)` 依真實地形從同一份平面圖產生世界碰撞、walk surface、anchor 與 `root`／`roof`／`ruin` 群組。
- 每棟 `TownWorld.buildings` 的 `obstacles` 是帶 HP 的命中／碰撞體，`supports` 是地板與坡面 walk surface（不算命中，摧毀後保留）。廢墟用碎塊 Bounds 碰撞並保留服務通道（`architectureRuinCorridors`）；恢復時移除廢墟並**精確還原**原碰撞，受損外觀由 `setDamaged` 處理。
- 標記 `physicalPassable`／`projectilePassable` 的導航紀錄只留在 supports，沒有實體／投射物碰撞，**不得加入空域**。
- 資源所有權：`ArchitectureKit` 擁有陣營共用材質與合批 geometry，`dispose()` 一次釋放；裝飾 GLB 的 geometry／material／texture 是共享不可變資源，Kit 只釋放 instance buffer。雕像由 `loadArchitectureStatues` 另行擁有；使用方先 `preloadArchitectureStatues()`，失敗提供具名診斷並可重試。
- 城門扇與指揮瞭望塔的開關／HP／碰撞仍由 `TownFortifications`／`TownCommandWatchtower` 擁有；外觀與上層實體共用 `TownGatehouse`。瞭望塔屋頂的 `dressCommandWatchtower().airspace` 須併入飛行空域。
- 巨鷹補給站只以實際立地部件擋碰撞，整體外框只算空域；`TOWN_EAGLE_STATION_SITES` 是補給站、`eagle-trainer` 站位與 `townEagleSigns` 的唯一來源。
- Town Center 兩陣營共用 `TOWN_CENTER_FRAME`／`TOWN_CENTER_ENVELOPE`；模型開口、牆體碰撞與樓板共用同一份尺寸資料（如 `ROMAN_TOWN_CENTER`）。Captain、士官長、Commander 站在 `service:*` 錨點並保留 `SERVICE_MOUNT_TURN_RADIUS`；`townPlayerEntryPoint()` 是和平入口，守城／攻城與空中續讀由各自 checkpoint 恢復。
- HR 以 `expandedHrCenter` 包住原 muster；`hrFloorNavigationEdges` 與 `rampNavigationSides` 讓地面 A* 經坡腳出入，牆壁摧毀後仍保留。壁掛裝備種類由 WeaponDatabase 決定，重用正式預載與 LOD。
- 馬廄坐騎由 `stableHorsePositions(faction)` 指定、以 `civicFloorY` 生成並持續求支撐；和平保護沿原 stableHorses 身分。

## 城牆與門樓

- `TownRamparts` 擁有環牆走道與城內貼牆坡道。門樓雙塔嵌入城牆，塔基取代該段牆身；走道在雙塔之間抬到 `gatehouseFloorY` 與上層連廊合併，塔外的走道、攻城接牆點、駐軍站位與坡道高度**不變**。駐軍城牆站位排除塔樓範圍。
- `townGatehouseParts(house, faction)` 用同一份資料產生外觀與碰撞：塔基是唯一地面阻擋；實體頂面低於走面以免騎乘卡住，其上只擋投射物（`fill`）；高塔身、塔房、連廊、屋頂與雕飾只作 overhead 碰撞。原門洞輪廓、騎乘淨空與 `towerOuter` 攻城接牆位置不變。`dressTownGate` 回傳分區 `airspace`，取代整體 AABB。
- 地面門洞通行依實際門扇開關／摧毀；摧毀門扇不移除上層。
- `TownCommandWatchtowerLayout` 定義永久指揮塔與入口 footprint，`TownWorld` 驗證道路、障礙與巨鷹走廊後建立；`TownWatchtowerNavigation` 共用真實 WalkRampSurface。`TownWatchtowerGuardPolicy` 計算塔頂固定站位，`townAuthoredRoster()` 永久加入 `watchtower-archer:*`（獨立 `watchtower_guard` duty），**不加入四門分配、HR、平民或任何指揮 preset**。
- `TownGarrison` 為既有居民增加站崗位置，不改 `TownDefenseRoster` 的身份或分隊。固定遠程以實際武器射程警戒；Attack／Defend 留守，Follow／Formation／Charge 交出駐軍權。保存的正式 IDs 不重抽；一般 reload 保留原位置與命令，不推導歷史城牆站位。

## 巨鷹設施

- `TownLayout` 定義 HR 搜尋區、私人 pad 與 Town pad；`TownEagleTrainingGround` 與 `TownEagleGarrison` 驗證完整翼展、障礙、道路、巡邏與 HR footprint。`EagleApproach` 是 AI 與布局共用的進場規格；Town 在生成樹木／岩石前保留進場走廊，再以實際樹冠、屋頂與城牆高度驗證空域。
- xongkoro 持有上限由 domain 以 `CareerInventory` canonical quantity 檢查（含 Player、私兵、Reserve 與戰損）。`EaglePadReservations` 依永久 owner ID 配置與保存 pad，**不使用私兵名冊 index**。
- 敵城沒有友方 HR／私人訓練場：`personalTownEagleDeployment` 在 Player 實際集結點附近建立共享的安全 field pad；同場景合法飛行 checkpoint 優先恢復原位置。

## 居民

- `TownCivilianLife` 依永久 civilian ID 決定固定 home anchor，`TownLayout.townHousing()` 同時供建物與配置使用；正式 Town 以真障礙／navigation 再驗證。日常／返家 checkpoint 保存實際位置，不搬遷歷史錨點。和平散步用有界線段淨空與低頻更新，**不做每 frame A***。玩家命令、疏散、任務與死亡優先於日常 owner。
- `TownCommander` 明確加入唯一 `commander` 服務居民，預載本陣營 T5 資產並騎乘獨立持有的 T5 坐騎；服務位置以實際 Captain 為錨點並保留騎乘與互動通道。本城守城時同一名 commander 納入正式名冊，沿用 T5 外觀、原坐騎與戰損；守城原地結算後經原 scheduler 回補服務居民並原子登記 TownEvent。
- `CareerTownEquipmentState` 將 Commander 原生坐騎納入 Tier 5；原生裝備使用現行 token 目錄，載入時**不補發**。
- `CareerPromotionAuthority` 與任命入口驗證實際服務 NPC：Captain 只能任命到 Captain，Commander 才能任命 Commander；資產載入後重查權限再提交。

## 死亡與犯罪

- NPC 死亡經 `NPC.updateTownPeace`／`updateTownTravel` 的既有 presentation 後隱藏整個 root，不自行復活；面板暫停活人戰鬥時，`TownMissionCombat.updateDefeatedActors` 仍更新已死亡 NPC 與 mount，避免屍體永久留在場上。
- 隱藏後由 `skipHiddenCorpseMatrices` 略過每幀 world-matrix 走訪；明確的 `updateWorldMatrix`／`getWorldPosition` 仍更新自己的鏈，重新顯示後下一幀恢復。
- visual faction 與 `CombatFaction` 分開；城鎮平時不敵視 Player。首次有效犯罪**先保存** hostile event，保存失敗就不施加第一擊；只在死亡／建物摧毀時保存終止狀態。自由遭遇與官方任務不等同城鎮犯罪。

## 導航與接戰

- `NavigationWorld` 統一管理每影格 A* 預算；`NavigationPathFollower` 以自身作為 pending owner，超額時保存最新起終點、下個 `beginFrame` 依 FIFO 優先處理，避免固定順序讓後段 actor 永遠拿不到路徑。拓樸重建清除 deferred 工作與 cache；移動 blocker 跨格只失效路徑並保留 FIFO。四門戰鬥在同一預算內先完成車輛移動再受理等待者，不另重置額度。
- `TownLayeredNavigation` 以小型環狀路徑銜接既有地面 A*，處理上下層、騎乘轉向與 Follow／Formation，**不建立第二套網格**。`LayeredNavigationRoute` 是 Town／Outpost 共用的高架與地面接續，沿用各 actor 原有 `NavigationPathFollower`；保留有效入口 ID，撤銷後重新選路；mounted 旗標、寬度、sector、支撐與地面連通都須有效。不可達快取觀察 live 入口版本。
- Town hostile collision cache 保留完整 ObstacleData，只在拓樸變更時刷新。
- `NPC.enableBattlefieldEngagement` 以場景邊界決定一般地面 `attack` 的接戰與追擊中止；不覆寫保存命令、目標授權、Follow／駐軍／Encounter 或巨鷹政策，武器距離與高差另行判斷。
- 地面 Attack／Charge 被封閉城牆擋住時，由 `TownLayeredNavigation` 從 live 城門取得可達、可破壞的外側 approach，沿同一 follower 前進並接手結構攻擊；開門後恢復一般路徑。顯式任務移動、encounter、駐軍等命令不取得此 fallback；無合法 approach 時暫存該目標並改選其他目標，版本或位置改變後重新允許。
- `TownFourGateSiege` 只對自動 Gate Cavalry 提供 `combatTargetPriority`：附近合法地面攔截可暫時讓出攻門任務，跨 sector 攔截受限於固定分界帶，清除或超界後回原門；玩家接管即移除此政策。
- Outpost：固守只來自明確駐軍旗標，位置與兵種不授予駐軍職責；玩家 Attack 保存成功後解除所選駐軍職責，共同 breach 事件解除未被接管的原生守軍。讀檔先還原 breach latch 再重建入口，保留已保存的玩家命令，Relief 初始化不重派已發生的突破命令。
- 回崗（Town 軍隊、原生 Patrol、平民／商人、HR Dismiss）使用既有 urgent formation 與原生速度／體力規則，到位或重新接令後釋放 urgency；不改巡邏速度、傷害或生命。
