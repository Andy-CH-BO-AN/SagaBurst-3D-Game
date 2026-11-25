# 生涯：存檔、軍功與成長

範圍：Career 存檔與提交、教學、劇情事件、軍功、商店、退休與賽馬。索引與共通規則見 [ARCHITECTURE.md](../ARCHITECTURE.md)。

價格、獎勵、軍階門檻與退休資格以程式目錄為準（`src/career/CareerShopCatalog.ts` 的 `CAREER_SHOP_PRODUCTS`、`src/career/CareerStoryEvents.ts` 的 `CAREER_STORY_REWARDS`、`src/career/CareerArenaTrials.ts` 的 `ARENA_TRIAL_DEFINITIONS`）；本檔只記擁有者、不變條件與禁止事項。

## 存檔、軍功與軍階

- `CareerProfileStore` 使用 `sagaburst_career_v2`（profile version 2），與 RPG／Campaign 存檔隔離。`loadChecked` 區分無存檔與損壞資料；**載入失敗不得覆寫**。
- `TownProfileCommit` 集中 Town 候選資料與現場 checkpoint 的優先序、保存後發布、兵權交接與返城恢復。**保存拒絕不發布、不交接**；普通保存與讀檔不整補。
- `CareerProfile` 分開 lifetime `totalMerit`、可花費 `availableMerit` 與任命 `rank`。晉升**必須明確任命**，領獎不自動升階；獎勵以已領 battle／mission ID 保持冪等。
- `CareerMissionMeritPolicy`／`MeritCalculator` 管理軍功；各 board 勝場按任務 Tier 分開保存，**不由當前軍階反推**。Duel 擊敗 tier 不改 board 勝場。
- 只有正式 Career 結算發軍功；任務外城防兵貢獻只保存，不建立獎勵入口。
- `CareerBorrowedIdentity` 保存並驗證 `activeMission.borrowedActorIdentities`；**臨時任務裝備不升降人物**。借兵與官方兵權在同一次保存成功後才移交 ownership；結果鎖定後凍結 aggregate，NPC 貢獻**不進** Player 武器 XP。

## 教學

- `CareerTutorialState` 擁有角色識別、步驟、交易與正式任務收據及一次性獎勵；`CareerTutorial` 載入最新同角色存檔，**保存成功後才發布**。載入**不推導歷史教學**。
- `CareerTownEntry`／`main` 只以持久化 session 啟動 `CareerTutorialLaunch`；自由訓練與一般自訂戰鬥不取得此能力。
- `CareerTutorialScene` 接收 Game 的實際操作、有效命中與 `ArmyCommandController.onAccepted`；拒絕寫入時保留現場供重試。新兵坐騎段以 `mount-impact` 有效傷害事件完成。演練**隔離正式任務、技能與部隊資源**。
- `TownTutorialController` 重用 MissionGuide、商店、HR 與指揮授權；新兵切磋沿用 Duel 並走獨立獎勵結算，**不改正式逐階解鎖**。Captain／Commander 教學隨正式任命交易保存，**不以軍功門檻自行啟動**。

## 城鎮劇情事件

- `CareerStoryEvents`／`CareerStoryGuidance`／`TownStoryController` 獨立於新兵教學，可延後，**不阻擋任務、商店或 NPC 服務**。
- `CareerProfile.careerStory` 狀態為：無（未觸發）、`pending`、`active`（保存活動 ID）與 `settled`（只有 `outcome`／`merit` 才代表實際領獎）。
- 觸發只在既有 owner 的同一交易內寫入：`purchaseCareerContent` 的首次普通 `horse` 購買開 `commander-circuit-race`（`hadHorse` 含教學收據）；`recordCareerMissionCompletion`（正式勝利的唯一計數點）在尚無正式勝利時開 `veteran-squad-spar`。教學的 `settledMissionIds` **不是**勝利收據。
- 活動於正式接受時綁定來源 ID：賽馬為 `CareerRaceSession.story`（僅 `race-1`，經 `CareerRaceController.accept(..., { story: true })`）；競技場為 T1 `arena-squad-trial` 的 `storyEventId`（`acceptArenaStoryTrial`）。
- 結算沿原 owner：`raceRecordProfile` 與 `claimCareerMission` 只在事件 `active` 且 `sourceId` 相符時以固定軍功取代一般獎勵並標記 `settled`。取消僅在部署失敗且無賽果時允許，**不新增賽果或軍功**。
- `parseCareerStoryState` 只接受現行事件狀態；整份或已存在事件損壞即拒讀，**不由軍功、持有物或完成任務重建收據**。
- `selectStoryGuidance` 一次只選一個目標（待接話劇情 → `canAppointCareerRank`／`t4ClassOffer`／`careerClassOffer` 的任命 → `XONGKORO_PRODUCT` 的首隻巨鷹）；進行中任務、賽事、退休或敵對時整體隱藏，目標 NPC 不可用時暫停，**不改指他人**。`eagleIntroSeen` 讓開場台詞只播一次，`eaglePurchased` 讓售出後不重開。`TownTutorialController.occupiesGuidance()` 決定箭頭與 NPC 對話的讓位順序。

## 商店

- `CareerShopCatalog` 是價格與品質 Tier 的可信目錄。`purchaseCareerContent` 核對 ID、分類、價格、Tier 與數量後才允許購買；正常商品**不以軍階限制**，Tier 只表示品質。
- 巨鷹訓練服務保留原軍階與持有上限；NPC 配發保留既有 HR／全城管理權限與所有權驗證。

## 退休

- `CareerRetirement` 只判斷正式 Commander、Tier 5 勝場與 `completedCareerMissionTemplateIds` 的四門守城勝利；**不讀 lifetime victories**，退休不新增軍階。
- `CareerRetirementState` 保存 departing／mobilizing／final-stand／completed 與 `combatElapsedSeconds`。尚未退休時不寫入此欄位；非法 checkpoint 使整個 profile **拒絕載入與保存**。
- `startCommanderRetirement` 重用資格，拒絕既有退休、任務、賽事、敵對 Town 與非法時間；經 `TownScene.startCommanderRetirement` 的 `commit` 保存成功後才套用 runtime；`TownRetirementUI` 固定顯示退休資格與按鈕。
- 一般 Town commit 以 `validateOrdinaryRetirementCommit` 拒絕改寫既有 checkpoint（含動員 receipt）與新增任務、據點或賽事。一般敵對由 `canStartOrdinaryTownHostility` 阻擋，**不得替換 hostile townEvent**；既有 hostile 輸入**不得進入 mobilizing**。
- `CareerRetirementMobilization` 專門驗證 departing → mobilizing，先保存再交給 runtime，**不提供一般 commit bypass**。`careerRetirement.phase` 是 reload 的 source of truth。
- `CareerRetirementFinale` 驗證完整動員 receipt，只允許 mobilizing → final-stand。`TownRetirementFinaleController` 在北方退役集合區**先保存再發布敵對**；沿用既有 formations、`beginTownHostility` 與 native eagle combat，**不建立 generic Town event、任務結算或軍功**。
- 結局判定：玩家與可戰私兵全滅為 fallen（坐騎不算戰力）；完整 canonical 敵方名冊全部確認死亡或累計時限為 escaped。**缺失或未載入的敵人不算死亡**。terminal candidate 保存前即凍結戰鬥，拒絕寫入只重試同一結局。
- final-stand **不整補或復活**，HR 永久 roster 不刪除。`areOrdinaryTownServicesPeaceful` 直接讀取保存的 phase 關閉服務，**不依賴 generic hostile event**。退休戰鬥統計由 `BattleStatsTracker` 分開計入 `retirementRuntime.stats`，**不進入任務軍功結算**；缺少計數即拒讀。
- `CareerRetirementQaProfile` 與 `CareerRetirementQA` 僅在 `import.meta.env.DEV` 且 `?careerQa=retirement` 時動態載入；**Production 不載入 QA 入口**。

## 入城與建立角色

- `CareerTownEntry` 在建立 TownScene 前分流 completed 到已保存結局；返回主選單**不刪檔**。
- 新生涯僅選擇陣營，不配發永久武器；已有角色不因缺少 `starterWeaponId` 重建或補選。
- `CareerCreation.createAndSaveCareer` 原子保存新 Recruit；取消或寫入失敗保留原結局。

## 賽馬

- `CareerRaceState`／`CareerRaceController` 只使用現行賽程（`RACE_SCHEDULE_VERSION`、`MOUNTED_RACES`、`RACE_MOUNT_NAMES`）；**不接受舊版賽程、歷史 DNF 修復或舊版進度欄位**。正式邀請使用獨立固定獎勵。
- Session、結果與進度保存現行 scheduleVersion；倒數、路線、死亡、坐騎資源、敵對與結算在同格式重整時保留。沒有 `activeRace` 是合法空閒狀態。
- 賽果保存成功後才公開，session ID 保證不重發，保存失敗可重試；`CareerRaceReturn` 保存成功才清 Session、移動 Player 或套用延後 TownEvent 結果。
