# 生涯：兵權、小隊與私兵

範圍：正式兵權與命令、指揮 HUD、平民指揮、整補、HR 私兵、全城裝備與軍馬所有權。索引與共通規則見 [ARCHITECTURE.md](../ARCHITECTURE.md)。

編制人數、隊伍容量、價格與招募組合以程式為準（`CommanderTownRoster.commanderGateDefenseSlots()`、`CareerRecruitmentCatalog`、`CareerPersonalSquad`）；本檔只記擁有者、不變條件與禁止事項。

## 共通原則

- **Save-first**：兵權、命令、整補、交易與遷移都先 clone、整筆保存成功，才發布到 runtime；保存失敗不暴露半成品，保留重試。
- 每個 Actor 同時只有一個 owner（原生 AI、任務、Patrol、Garrison、玩家命令、HR 私兵）；交接要逐人 relinquish／claim，不雙重擁有。
- 死亡、未實體化、返營／REFIT 中或屬於其他 owner 的 Actor 不接受命令。Player 死亡後停止接受新命令，既有 AI 繼續。
- 續讀不重新分隊、補員或復活；只有明確的整補流程才補血、復活與補給。

## 正式兵權

- `CaptainMissionCatalog` 擁有獨立 `captain-…` template IDs 與 Captain／Commander 分頁，不以其他 Captain 勝場鎖定順序。Eagle 解鎖讀 `CareerInventory` 真實 xongkoro ownership，部署再驗證 allocation 與戰損，**不以當前騎乘代替 ownership**。
- `CareerCommandAuthority` 以成功保存的 mission ID、Town faction 與 Actor IDs 授予兵權。正式 Commander 另存 `commandRank` 與 `squads`（由 production roster／城門／wave slots 穩定分組，不補兵，同一 Actor 只屬一隊）。正式任務保存接受時的實際授權；和平本城使用 canonical membership，不讀舊名冊或歷史空軍指揮快照。Parser／clone 拒絕重複、不完整、衝突或超額 membership。
- `CareerCommandActorCheckpoint` 保存 HP、位置、彈藥、盾、命令、formation、坐騎與飛行／墜落；authority 不授予裝備或永久私兵 ownership。
- `CareerOfficialCommandOrder` 先保存 `commandedSquadIds` 與 actor checkpoint，成功後才經 `ArmyCommandController`／`FormationController` 交接。
  - 未下令的隊伍維持原生任務 AI；玩家接管後，scripted march、城防定位、Charge／破門流程**不得覆寫**其命令。
  - Dismiss 正式地面隊只交回原任務 owner，不刪兵、瞬移、整補或送往 HR；Town 空軍交回 Garrison 的實際返航整補。Captain 的明確空清單表示交回 AI。
- `TownCommandSquadController`：Captain 接管固定的既有訓練兵；和平本城 Commander 以 `commanderGateDefenseSlots()` 作為官方 1–8 隊**唯一** membership 來源（HR Officer 與 Captain 也在隊中，和平時保留服務位置）。原生巨鷹與塔頂弓兵不可選取、不接受 ALL。
  - 未受命令者維持 Town allegiance 與原生 gate／garrison／Patrol AI，成功保存命令後才逐人 claim；同隊未選中或返營者不自動加入。
  - Dismiss 的一般守軍實際走回原位，Patrol 交回既有返營／整補 owner，之後須再次下令才能接管。接受正式 Town 任務以同一 canonical IDs 交接，回到和平城鎮才恢復先前 authority。
  - Commander 自己的和平非任務本城：居民、服務 NPC、坐騎與建築視為 Player 受保護資產，玩家攻擊不建立 Town Hostility；敵城、任務目標與既有 hostile 存檔不受此保護。
- 士官長指定小隊整補（含全滅隊伍）：先保存選中隊伍 checkpoint 再修復 Live Actor；死亡地面／城牆士兵回原合法 station，存活 Follow／Formation 保留位置。巡邏與空軍只保存 `refittingActorIds`／原生返回請求，由 Patrol 與 Eagle Garrison 完成，不建替身或新坐騎；空軍 `serviceRefit` 完成前不得重新接管。

## 指揮 HUD

- `CareerCommandHudRoster` 只消費當前授權名冊，context 含 mission／Actor identity，避免沿用舊 HUD。官方 `squad:1`–`squad:8`、HR `squad:personal` 與 `squad:civilians` 不共用名冊或容量；ALL 使用同一個實際授權集合。
- `CareerCommandHudTypes` 以 production roster 建立 accepted Actor 的兵種 metadata（不查詢場景、不產生實體），所以死亡與未部署者仍保留兵種；`ArmyCommandHudRoster` 去重顯示。HUD 名稱依 `commandRank` 分流。

## 平民指揮

- `CivilianCommandAuthority`／`CivilianCommandSquadController` 只管理家鄉和平 Town 的平民與武器商人；rank、scene key、mission ID、faction、Actor ID 與 owner 全部匹配才接管，不接管敵城居民、其他服務角色或新增 NPC。
- `civilianCommandSquad` 獨立保存 owner（daily／player／returning）、命令、HP／死亡與 homeMount 狀態。一般恢復不復活死者、不強迫騎乘；整補以原坐騎恢復。日常／疏散 AI 與玩家命令互斥，跨任務不沿用舊兵權。
- 商人 Dismiss 回原服務點；守城平民 Dismiss 交回疏散 owner。平民優先用永久裝備，沒有才用 `NPC.armTownCivilian`／`retaliationWeapon` 預設。Merchant 固定武器不入玩家庫存、不授英雄 profile。平民隊不計官方／HR 軍功，商人不算入平民傷亡目標。
- HUD 只讀輕量身分與狀態；真正 commit 時才建立完整 actor snapshots。

## HR 私兵

- `CareerPersonalSquad` 在 domain 驗證 rank、`availableMerit` 與共用人數上限；招募一次 save 原子保存扣款與 `personalSquad.members`（永久唯一 ID、正式身分、招募兵種與雇用價），不保存 XP 或世界狀態。`CareerRecruitmentCatalog` 是招募配發與價格的唯一來源；`TownRecruitmentPanel` 只呈現。
- `CareerInventory` 以 `inventory.quantities` 為唯一數量來源，ownership arrays 只是投影；Player、HR、Town／Civilian 的配置共同占用庫存，收起與回收不解除分配。
- 招募配發只在招募交易時發生一次；之後卸裝、出售或載入都不重新配發，也不從歷史格式推導裝備。
- 換裝與賣人只在整隊 RESERVE 時進行；賣人只退 `availableMerit` 並扣除隨隊員離開的裝備。
- `PersonalSquadRuntime`（Town 經 `TownPersonalSquadController` 適配）只管 Player-owned 私兵的部署、命令與返營，不更新 NPC／Mount；squad identity 固定 `personal`，與官方 1–8 隊不共用 key、領隊、slots 或名冊。官方 readiness、march、借兵、reinforcement、breach 命令排除私兵；碰撞、關門、投射物與導航包含私兵。
  - 狀態：招募 → HR 待命（RESERVE，`materializeStandby`）→ Follow（DEPLOYING／ACTIVE，沿用同一批實體）→ Dismiss（RETURNING）→ 抵達回 RESERVE；實體、坐騎與傷亡都保留。
  - 只有 `standbyAllowed`（本城有 HR、無任務、非 final-stand）時才實體化待命；HR 待命者只接受 Follow（`acceptsCommand`）；待命生成失敗只暫停該 ID（`standbyError`），不影響正式部署的 `error`／`ready`，只由 `retryStandby` 重試。
  - 交接看「原地／重建」：原地回城保留同一份 checkpoint，不整補、不復活；重建場景的正式返回才套用回 HR 整補。真正遣散、場景卸載與任務 scene 切換才移除實體。
  - 人物模型與 HP 讀保存的正式身分；實際武器決定 AI 類型，換裝不改人物 Tier 或英雄類型；英雄不因低階武器削弱 `HeroCombatProfile`。私兵不改正式任務基礎兵力、不給 Player skill XP。
- 任務帶私兵：非 Duel 的新任務接受時 snapshot HR member IDs（舊 active mission 缺 roster 視為未帶，不回填）。`CareerPersonalSquadMission` 的 bounded checkpoint 與永久 ownership 分開。`captureForNewMission` 把已完成返 HR 者轉為整補 reserve，回程中與既有部署保留戰損，死者不復活；新 roster 不繼承舊命令。保存成功後才由 `beginMission` 接管 live 實例。
  - Duel 不帶私兵，接受時保存原 Town checkpoint，回城原樣恢復。
  - 私兵戰損另存於任務的 `personalSquad`，不混入正式名冊；任務清除時以同一筆保存交給 `personalSquadRuntime`。
  - 家鄉 Town Dismiss 實際回 HR；沒有 HR 的 Outpost／敵城 Dismiss 是完整 no-op。直接返城視為全隊完成返營，慢慢返回保留戰損，只有實際完成 HR 返程才整補。
- `TownHRLayout` 驗證 HR hall／courtyard 的實際障礙、道路與城牆；`hr-officer` 是獨立 T4 service actor。Captain／士官長／Commander 由 `TownWorld.serviceStation` 讀城鎮中心平面圖的 `service:*` anchor，站位須可導航抵達，不另找替代點。

## 軍功歸因

- `BattleStatsTracker` 保留真實 NPC source snapshot。私兵 source 驗證 ownership、`personal` key 與接受時 ID；正式隊驗證 mission ID、Actor→Squad 對應與 allegiance，Commander 另要求 `mission-official` ownership。
- 正式軍隊 faction 由授權決定，**不以角色外觀判斷**。官方與 HR 各自 aggregate，互斥歸屬後只合併一次至 `meritPlayer`；拒收事件不混入分隊統計。平民隊、roaming、友軍與自家建築不計。結果鎖定後凍結 aggregate，回程不追加獎勵。
- Player 死亡後 Follow 改在最後位置 Defend，不轉投官方 commander；已部署私兵只擴充己方全滅判斷。

## 全城裝備

- `CareerTownEquipment` 提供 Commander 本城全城裝備與 HR 共用交易；`CommanderTownRoster` 與 `TownDefenseRoster` 是同一份純資料編制，缺員不重編。
- `BulkEquipmentPlanner` 以現裝、原生備品與未分配 Inventory 做最大權重配對：先最大化嚴格升級人數，任何欄位與有效 Tier **都不降級**，沒有更佳全隊結果就 No-op；以 Actor ID 與 Item ID 決勝確保穩定。
- `townEquipment` 保存每城 Actor 的四欄來源 ref 與 native reserve。原生 token 固定來源與所屬小隊、不轉為 Inventory，每件互斥地屬於 NPC、native reserve 或 `soldNativeIds`；原生裝備不增加玩家庫存。Parser 拒絕偽造、重複與來源重疊；Reload／守城／整補不恢復已售 token。
- `CareerTownNativeResale` 只在 Commander 本城和平、無正式任務時，向可互動的 Merchant 出售未分配的原生武器／盾牌；每次重新驗證 live 狀態與 token 所有權，只增加可用軍功。固定裝備、原生坐騎，以及 Ranger、eagle-trainer、Merchant 的原生裝備不可售。
- 保存成功後才由 `TownEquipmentRuntime` 預檢整批 NPC 並套用；`NPC.applyCareerEquipment` 保留英雄身份、HP、彈藥與盾耐久。返回、交戰、死亡、飛行、未實體化成員與玩家接管中的巨鷹唯讀；HR 須整隊 RESERVE。

## 軍馬與任命

- `CareerMountController` 維護單一 active mount，切換／遣返保留 HP 與死亡鎖。軍馬只有一份 `horse` 所有權，tier 跟隨任命軍階，不接受歷史 tier ID。
- 任命先載入並暫建新角色，保存成功才替換；失敗保留舊角色與可重試任命，重複點擊不重複提交。替換保留坐騎、位置、HP 比例、體力、彈藥、盾耐久、inventory／skills 與相機狀態。Commander 存檔載入 T5 失敗不降回 T4。
