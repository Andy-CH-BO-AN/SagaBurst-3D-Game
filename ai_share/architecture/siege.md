# Standard Defense 攻城坡道與突破口

範圍：Campaign／Town 四門攻城、移動攻城車、突破口與 siege checkpoint。索引與共通規則見 [ARCHITECTURE.md](../ARCHITECTURE.md)。

車隊編制、速度、車體 HP 與坡道尺寸以程式為準（`src/career/TownFourGateSiegePolicy.ts`、`src/campaign/CampaignSiegeAssault.ts`）；本檔只記擁有者、不變條件與禁止事項。

## 攻方車隊（Campaign）

- `CampaignSiegeAssault` 共用於 Standard Defense 與 Career 各攻城任務；Relief 保留原地圖。
- 只從本波正式攻方 plan 分配推手與突擊編組；**不使用守方、騎兵、騎乘 Ranger 或 T4 英雄**。車數依合格步兵人數分配。混合 initial plan 只等待攻方 registration；所有必要 Actor 完成後才一起推進。零台車保留 Gate／Palisade breach。
- 車體起點採實際 staging line。固定 crew **不替補、不 handoff**；一般士兵沿側邊繞行。已由 Player 接管的官方單位，**不被自動 entrance routing 改寫命令**。
- Career Outpost 自動駐軍依 Outpost owner 選正式守軍；無弓兵時合法遠程優先，否則從非英雄步兵選一半以內站後排，保留地面門防。`holdsRampartPosition` 讓近戰留在城牆合法接敵；Formation／Follow／Charge 明確解除自動駐軍。
- Veteran 初始攻軍保留各自編隊，前排以 `BATTLE_FRONTLINE_Z` 對齊外側戰線；玩家從己方編隊後方入場。戰中讀檔以既有 actor／player checkpoint 為準。

## 四門攻城（Town）

- `TownFourGateSiege` 是獨立 opt-in 的四門拓樸與編制 adapter；`TownWorld(..., { fourGateSiege: true })` 才建立可切片的 `TownDockPassages`。
- 外護欄與垛口按材質合批：固定幾何一批，每個 Dock 各自一批，保留獨立碰撞切片。開閉只切換該 Dock 的共享 Mesh；Dispose 每份合併 geometry **只釋放一次**。
- `TownFourGateSiegePolicy` 對實際 rampart surfaces 與障礙做全車合法配置，slot 分為 T4 與既有 T5 hero profiles，**不擴大 UnitTier**。
- 八車共用 `MobileSiegeRamp`、Controller、`MovingPlatformSupport`、`SweptBodyCollision` 與 `SiegeConvoy`；世界座標方向同時支援 X 與 Z。Outpost `siege-ramp-left/right` 與 Campaign checkpoint v1 的 parser **不變**。
- 車體由呼叫端的 `createRamp` 建立；世界與導航只經 `TownSiegeWorld`／`TownSiegeNavigation` 窄介面讀寫。`CareerRaceController`、`CommanderTownMissionController`、`CommanderFourGateDefenseController` **不持有 Scene**；臨時 NPC 與坐騎一律經 `CareerActorFactory`（正式為 `sceneCareerActorFactory`）建立。
- 四門 caller 先建立 Town navigation 與 SpatialGrid，提供明確的 sector wall／cavalry Actor IDs；可用 `attackerActorIds` 指定非 Crew 攻方，並以官方 authority 的 `acceptsOrders` 決定命令權，再 `prepare(slots)`。原生 spawn scheduler 每個建構 job 完成時呼叫 `register(npc)`；`savedActors` 供 caller 篩選已保存的 dead／exited。全部 Crew 註冊後才 ready；每 frame 先更新共用 grid 再呼叫 owner.update，**不另外更新 NPC 或 Mount**。
- 所有顯式玩家命令（含 Defend）須呼叫 `notifyPlayerOrder`。接管中的 Crew 從 carrier 解除，原車**不補人**；退出者由 caller 呼叫 `exit(npc)` 保存 receipt，**不復生或補入其他車**。
- `TownSiegeAirspace` 保持飛行 caller 已捕獲的 `airspaceObstacles` 陣列，以事件更新結構 collider membership，**不複製整個地面集合**。
- `TownGateBreachPolicy` 按 Gate 分開保存 wall 與 cavalry one-shot。單車 Destroyed 只關自身 passage；**只有該 Gate Destroyed 才釋放其 cavalry**。
- `TownLayeredNavigation` 經真實可達的 approach 接入斜坡與橋，**不建立第二套 A\***；攻方自動改道限所屬 Gate，遠程保留 Attack、近戰 Charge。
- `TownFourGateSiegeCheckpoint` 與 Campaign schema 分開。bounded parser 驗證穩定 ID、Crew、狀態、Dock Progress、事件與玩家命令 receipt。只在全部署 ready 時 snapshot；restore 時**不 replay breach 或重複註冊 damageable**。
- DEV `/?fourgatepreview=1&nolock&faction=roman`（或 `viking`）使用真實 TownWorld 與守軍。只寫專用 session key `sagaburst_dev_four_gate_siege_v2`，**不讀寫 Career save**。

## 車體與坡道

- `MobileSiegeRampController` 管理 DEPLOYING → PUSHING → DOCKING → DOCKED，以及不可恢復的 ABANDONED／DESTROYED。推力只計固定存活推手，**無替補**。
- Mount 的高架支撐由 `resolveObstacleCollision` 明確授權。
- `MovingPlatformSupport` 把 carrier delta 加到乘員 world root，**不 parenting、不覆蓋到固定座標**。更新順序：先車與乘員，再 NPC，最後做 Actor 分離。
- `DamageableObstacle` 管理獨立車體 HP。Destroyed 移除 collider、surface 與入口，乘員沿 FallingRider 流程失去支撐；Abandoned 保留車體並沿坡道撤離。
- Dock 才開啟局部 parapet passage、註冊 navigation connection 與 mounted surface；**Dock 不更改 Gate HP 或 state**。
- `MobileSiegeRamp` 維護所有 parts 的 `collisionGroup.bounds`；另以 ground-only 聯集供地面導航使用，**不新增實體或投射物碰撞**。
- Mounted 的 Ground 目標沿合法坡道下降後經現存入口接近；沒有合法地面入口時留在城外，**不以城內坡道取得未突破的外部入口**。Mounted Follow 以 leader identity 保存單列方向，**不以暫存座標或 X 正負號重選方向**。
- `projectileBounds` 是 owner 保證涵蓋旋轉與縮放後 geometry 的 world AABB；接觸仍由 local exact trace 決定。
- `FormationController` 跨左右翼與 Gate Bridge 選取部隊；未選取者與其已保留目的地不變。Preview 與 Confirm 共用解算。

## 突破口與入口

- `CampaignBreachController` 只保存首次 Assault latch；`AvailableBreachEntrances` 保存現在可通行的 Gate、Palisade 與 Ramp。入口變更時只重派必要路線；**尚綁定的車隊排除全軍重派**，遠程兵保留 Attack。
- `CampaignBreachController.restoreBreached` 恢復 latch，**不重播副作用**。
- `CampaignSiegeCheckpoint` 是既有 Career checkpoint 的可選 extension，保存 crew IDs、carrier 狀態、entrance crossing 與已毀 palisade。reload **不重算 allocation、不復活塔或 crew、不搬回已離車突擊兵**。正式身分、傷亡與 spawn budget 不變。
