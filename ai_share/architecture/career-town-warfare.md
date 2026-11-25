# 生涯：城外交戰與空軍

範圍：Town Hostility、城外 roaming、巡邏遭遇、任務行軍交火、城鎮與敵方巨鷹空軍。索引與共通規則見 [ARCHITECTURE.md](../ARCHITECTURE.md)。

距離、秒數、編制人數以程式常數為準（如 `src/town/TownOutskirtsRules.ts` 的 `OUTSKIRTS_*`、`TownEagleGarrison.ts`、`EnemyEaglePatrolRules.ts`）；本檔只記擁有者、不變條件與禁止事項。

## 交戰調度

- `TownMissionCombat.update` 擁有野外、Duel 與城鎮戰鬥的角色集合、敵我 grid、NPC／坐騎更新順序；各任務保留自己的 phase 規則與 controller checkpoint。內部 `TownActorUpdates` 以穩定順序推進，Defense 的護送／釋放／返程交接在推進前讀取，**不可用幀初名冊覆寫同幀交接**。
- 每個 NPC 每幀只模擬一次；TownScene 只更新未被騎手控制或已死亡的坐騎。TownScene 保留傷害歸因與投射物管理。
- Outskirts 以獨立 runtime participants 接入自然交火，共用附近查詢與導航預算，**不併入 controller 的任務名單**。外部威脅駐軍由 `TownMissionCombat` 登記，結算只能透過 `releaseExternalThreat` 歸還。

## Town Hostility

- 開始前先保存「取消正式任務與交接」，被取消任務不結算；恢復平時兵權後把 `authorizedTownCommandActorIds` 固定在 event 上，征服 objectives 排除這些 ID，Reload 不重新推算。
- Town command 兵仍效忠 Player；跳槽成功後留在原城鎮、清除舊授權，不轉入 HR 或新 faction。

## 城外 roaming（Bandit／城外騎兵）

- `TownOutskirtsRules` 定義 Captain／Commander 所有 Town runtime 的 Bandit 與城外騎兵編制。騎兵外觀取「目前 Town faction 的對立方」，allegiance 再依玩家 faction 決定，所以敵境可能出現玩家友軍（rider 享任務友軍保護，坐騎維持獨立命中規則）。
- `TownOutskirtsWarfareController` 擁有 actor identity、sector route、leader／followers、警戒、整隊 aggro 與全滅補隊。`NPC.updateTownTravel` 巡邏不做 combat target search。
  - Encounter 用固定 origin 的 leash（`OUTSKIRTS_ENCOUNTER_LEASH`）；leader 本人死亡才換人，失馬不換。
  - **只在整隊全滅後**冷卻、增加 generation、從 map edge 實際行軍進場；不逐人補員、不補半隊。未完成的 spawn batch 不算全滅。
  - `townOutskirts` 保存 generation／剩餘 cooldown（騎兵另存傷亡與待生成 checkpoint）；mission cleanup 不移除。續讀保留剩餘冷卻，不重新 enqueue 已死 generation。
  - Commander 敵巡為獨立英雄編制；編制變更等目前 encounter 結束、實際返回 map edge 才換 generation，冷卻不因任命重設。
  - Captain Patrol Command 另以 `patrolOutskirts`／`patrolAmbient` 保存本場 generation、傷亡、位置與戰損，避免 Reload 重新生成已計擊殺的敵軍。
- 舊 generation：NPC 完成死亡演出後才移除並 dispose；被替換的坐騎標記 retired，死馬等 dead update、無人騎乘的活馬回收、Player 借騎者保留到下馬且不轉成 owned。只 dispose 一次，不新增 timer。
- Roaming 與任務 actors 依 faction hostility 自然互傷，但普通任務的 roaming **不進** `targetActorIds`、`remainingEnemies`、objective／contribution 或 survivor／casualty 計數。例外：Captain Patrol Command 只收當前場景登記的敵對外圍軍，按唯一 Actor ID 計有效擊殺。第三方擊殺不轉玩家軍功。
- Siege 借用城外騎兵：先以無副作用的 `prepareCavalryForSiege` 解析名冊，保存成功才確認 claim；重試只領用原選定 IDs。被 claim 者改由 Siege 指揮，並以 `NPC.bindCombatEventSink` 暫接本場事件流，結束時恢復原 sink、不重複訂閱；Siege 結束才歸還外圍生命週期。未接管的敵巡照常巡邏與冷卻，不借英雄填普通攻方 slot。

## Town Patrol（`duty: patrol`）

- `TownCavalryPatrolController` 擁有兩隊 patrol residents；永久 `patrolId`／`patrolLeader` 與 runtime `activeLeaderActorId` 分開。Captain 缺席由 deputy 帶隊，Captain 實際追隊接近後才接回。路線由 `TownPatrolRoute` 定義，`FollowTrail` 讓長列沿實際路徑轉彎；整補用 `TOWN_SITES.barracks` 的固定騎乘 slots，與巡邏出發編隊座標分開。
- 生命週期 `RETURN_TO_BARRACKS → REFIT → REJOIN_PATROL`：存活者**實際抵達**兵營 slot 才整補；死亡者以同 ID 在 slot 恢復原裝備、HP、彈藥與原坐騎種類（Captain 用 faction canonical mount），死亡整補與 reload 不回退種類。
  - 部分傷亡：等存活者返營後才補死者。全滅：等冷卻後整隊重出；home mount 被占用時維持等待，釋放後只增加一次 generation。
  - 普通 reload 不補滿死者。正式借用、Siege、玩家整補與正式返回各走自己的 ownership，不套自主全滅冷卻。
- `townPatrols` 保存 generation、cooldown、資源、返營成員與 waypoint／travel state；讀檔續走同一段 route，缺欄位時從實際位置推回最近路段，不強制回兵營重走。
- 遭遇：sensor 或有效受擊（本人 HP、盾牌 impact、坐騎 HP／死亡）都可喚醒整隊；Player 由 DamageRouter 的有效 contact event 通知，**不把缺 source 或環境墜落當成玩家攻擊**。交戰以固定 origin 的 leash 維持，不隨隊伍或 Player 移動重設；結束後共用 `beginPatrolReturn`。
- 回營中受有效命中可把同 `patrolId`、Patrol-owned 的存活成員拉入新 engagement（保留 refit destination 與傷亡）；REFIT 中與其他 owner 的成員排除。
- 一般任務 reserve 借兵排除交戰、回營與 REFIT 中的成員；Captain I 整隊接管允許交戰中的隊伍。個別返營／REFIT 成員保留 travel owner，整補完成後才加入仍在 ENGAGING 的任務指揮。中間狀態只存在 runtime。
- 同一 lifecycle 也接受正式任務敵軍與 ambient Bandit；Patrol-owned 成員不再被個別 external threat 接管。Roaming 的個別駐軍威脅登記只限非 patrol 的 Town military（城門守軍、training 等可反擊且不新增整補）。
- `TownCavalryReserve` 只填任務 authoritative roster 的既定 slot，不新增領隊、不改兵種或人數；Patrol Captain 是獨立 officer pool，不填普通或 ranger slot。進行中任務以既有 `friendlyActorIds`／`borrowedActorIds` checkpoint 恢復同一份 assignment，不重新挑兵。

## 任務行軍遭遇

- `MissionTravelEncounter` 是 `BanditMissionController` 的 runtime-only 行軍中斷，處理 Town 共用的 `MARCHING`／`RETURNING` 整隊遭遇。野外任務已由 `CareerTownEntry`／`main` 分流到 `Game`，不經舊 Town 部隊部署。
- 首位偵測者或有效受擊者決定固定 origin；整隊取消 travel、圈外隊員實際回援；威脅清空後從實際位置續走剩餘 route，**不集合、不補兵補馬**。
- 原任務接戰條件優先交回正式 ENGAGING；Victory／reward 時機不變，RETURNING encounter 只阻擋最終返城收尾。Encounter 不入存檔，reload 由既有 checkpoint 恢復後重新偵測。
- Cavalry Sweep 與 Veteran field 共用 mounted assembly：存活任務 NPC 到位達門檻即保存 `MARCHING` 出發（Player 不計入、陣亡者不計分母）；未到者保留 ownership 並追隊，不 teleport、不刪 roster；保存失敗維持集結。
- 任務外圍敵軍從 Town 實際邊界內側生成，已保存位置沿 checkpoint 恢復。

## 城鎮駐軍反擊

- 正式 field 任務敵軍接近時，未被任務接管的 Town military 以 external threat 反擊；共用 hostile grid 與 melee／projectile／mount-impact 路徑，但**不加入任務 roster、整補或玩家 contribution**。Player 死亡不停止駐軍防衛。平民與遠處駐軍維持和平；敵方 native 駐軍不享 Player 友軍保護。
- 空軍警戒／追擊受最小警戒半徑、實際弓射程、以城鎮為中心的追擊半徑與世界邊界共同限制；優先空中威脅，失效目標立即解除。
- Commander I／II 敵城：原生居民由 Town duty controllers 更新，只有正式部隊屬任務 `fieldNpcs`，部署完成不喚醒全城。守軍越過 home leash 只對近距離接觸原地 Defend、不追擊，威脅離開後經 formation／navigation 實際回崗；城牆弓兵維持駐守。Sky Raid 的原生減員（含背景死亡）與 Player／正式部隊擊殺分開保存。
- Siege 攻方 `missionAerialDefense` 允許行軍中以**現有武器射程**回應飛行目標，不可因目標是巨鷹而越過射程；地面接敵維持一般行軍中斷政策。步弓越過城門後使用 `attack`，不套 Viking `charge` 的收弓近戰規則。

## 退休撤離

- Retirement 存在時，`TownOutskirtsWarfareController`、`EnemyEaglePatrolController`、`BanditMissionController` 在 constructor／restore／enqueue／refill 前就抑制外部敵軍生產；已存在的敵軍沿既有 travel／patrol flight 離場後由原 owner cleanup。不改全域 hostility、AI／spawn／navigation 預算或平時補員規則；退休 reload 不重建外部威脅、不讓舊 cooldown 補回敵軍。
- 玩家首次越過 `TOWN_CITY` 核心後，先保存 mobilizing 與 Town command revoke（HR 私兵指揮獨立）；`TownRetirementMobilizationController` 再原子保存 receipt 與既有 resource checkpoints（塔樓守衛另存 `retirementTowerGuards`）後才套用 staging。
- 完整退休名冊由八隊、原生鷹手、塔樓弓手、平民與商人組成；patrol 已在八隊中不重複編組，未編隊者依 stable ID 排入 auxiliary。被接管的 native patrol 停止 refill／AI。
- 地面部隊在北門至廣場間以既有 formation placement 集合，保留主幹道、城門、階梯與坡道通行；牆上人員經 layered navigation 實際下樓，不瞬移、不重設資源。已保存的 mobilizing checkpoint 只更新集合命令，不再次整補。之後的敵對與終局由 retirement finale owner（見 [career-profile](career-profile.md)）接管。

## 城鎮空軍

- `TownEagleGarrisonController` 擁有原生城鎮空軍的固定 rider／mount／home pad identity、巡邏、戰鬥、傷亡、返航與補員；不建立第二份友軍名冊，**不保存或恢復歷史 Town 空軍玩家兵權**。
  - 只有實際抵達自己基地、落地卸乘、騎手回到待命位置才整補。
  - 失去作戰能力後倒數補員，以原 ID 恢復；騎手與死亡坐騎的墜落／死亡呈現須先完成。正式 Siege 接管者、受保護 Duel 與 Town Hostility 不使用 ambient 復活權限。
  - `townEagleGarrisons` 的戰損、位置、飛行、未決墜落與 pad identity 是權威狀態。正式 Town Defense／Conquest 的守軍、目標 IDs 與結算授權不變，保護階段暫停巡邏。
- 任務空軍（Sky Raid、Captain VI 等）使用正式任務授權，不屬 Garrison。
- `EnemyEaglePatrolController` 是獨立 ambient owner：依已任命 rank 啟用、經共享 `NpcSpawnScheduler` 在城外地面部署，slot＋generation identity 與 HR、私人 pads、地面 Outskirts 及任務名冊分離；返航、整補、補員與死亡清理都由它管理。`enemyEaglePatrols` 保存完整 actor／mount checkpoint。正式城鎮任務不因任務旗標停止它，受保護 Duel／Outpost／Town Hostility 保留既有安全限制。空中移動使用 `airspaceObstacles`。

## 巨鷹起降與空戰

- Town 空軍與 HR 私兵巨鷹共用自動垂直起降：`NPC.eagleVerticalFlight`（由 `TownEagleGarrisonController` 與有 HR 的 `PersonalSquadRuntime` 開啟）經 `EagleFlightIntent.vertical` 原地升降，沿用既有 `takeoff`／`landing` phase 與快照格式；巡航不可懸停。**Player 與敵鷹不啟用**；Player 手動降落走一般合法落地規則。
- `EagleAirspace` 是起降共用的即時空域規則：`isEagleColumnClear` 檢查完整翼展柱內無障礙、無其他巨鷹與將穿越的航線；`eaglePadTransitionHeight` 決定可前飛／偏離 pad 朝向的最低高度。受阻時盤旋或原地降回重試。
- `EagleLandingQueue` 只讓空域重疊（`eagleColumnsConflict`）的 pad 互等；每場景 Town 空軍與 HR 私兵各一個佇列，空域檢查涵蓋所有巨鷹。逾時排到隊尾重試，盤旋不續期。
- `EaglePadArrival` 統一完成條件：水平誤差、實際接地、速度歸零、朝向與停放翼展淨空；**不做水平瞬移**。`EagleLandingOccupants` 對巨鷹用完整翼展、對地面坐騎用實際碰撞盒。
- `PersonalSquadHomeReturn` 只消費現行 `returnToHR` 意圖並分配私人 pad；一般 reload 的飛行、墜落、死亡與停放狀態保持權威，不遷移歷史座標。
- `EagleFlightAI` 在共用 FlightController 上維持 RANGED_GROUND／DIVE_GROUND／RANGED_AIR／DIVE_AIR 持續 maneuver；裝備／彈藥可用性與已選戰術分開，換目標不逐幀重選戰術。Follow／Formation／Defend 不等於 Return，只有明確 return order 才降落。
- `AerialViewPolicy` 只在騎乘 xongkoro 或高空 observer 時放大 camera far／fog，回地面還原；不擴大 LOD 高精度距離。
