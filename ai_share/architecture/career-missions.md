# 生涯：任務

範圍：各任務 controller、checkpoint、結算與返城、Commander 系列任務、Duel 與 Outpost。索引與共通規則見 [ARCHITECTURE.md](../ARCHITECTURE.md)。

編制人數、準備／戰鬥秒數、距離與 roster 版本以各任務 `src/career/*Roster.ts`／`*State.ts` 的常數為準；本檔只記擁有者、不變條件與禁止事項。

## 共通規則

- 任務保存名單、階段、必要死亡／統計與初始／結算／手動存檔點；**和平小鎮維持既有存檔節奏，生涯任務進行中預設不自動存檔（包含週期、陣亡、`pagehide` 與返回主選單），僅在首次部署完成、玩家於暫停選單按 `ESC → S` 手動存檔或任務結算時寫入存檔（任務中技能經驗亦僅於結算或按 `S` 手動存檔時寫入）**。借用居民不得被任務 cleanup 當臨時 NPC／Mount 銷毀。勝敗優先序由各 state 模組決定，Duel 與團體任務不共用玩家死亡規則。
- 部署或保存失敗一律保留原狀態供重試，不放寬檢查、不推定缺少的欄位。
- 進行中存檔只接受現行 roster／schema 版本；不相容即拒讀，不重建歷史名冊或推定勝利原因。
- `CareerMissionCheckpoint` 擁有 checkpoint clock、立即／週期／手動保存資格（`autoSave: false` 時僅 `manual` 或 `force` 會提交寫入）、profile clone 與同步提交；成功才重設 clock，失敗由 controller 下次以最新快照重試。各任務自行決定快照內容、phase guard 與首次部署／結算／手動存檔時機；force 與 manual 不改存檔格式。

## 結算與返城

- `TownMissionSettlement` 集中結果保存與返回順序，沿用 `claimCareerMission`／`clearCareerMission`：**保存成功後才清理或重建場景**，保存失敗保留現場。
- 已完成守城的正式返回會完整重建本城：`CareerMissionReturnRecovery.stageMissionReturnRebuild` 清除本城戰場 checkpoint、地面／空中指揮權與原生巨鷹舊飛行狀態；正式裝備與坐騎配發不變，新 Actor 以完整資源在正式站位建立，Patrol／Garrison 從基地重新開始。Game／main 的戰場返回與 `CareerTownEntry` 領獎恢復共用這個 owner；普通 reload、遭遇戰與未結束任務不觸發。
- 其他原地返回只恢復平民／商人與服務 NPC，以及被任務敵軍殺死的非借用居民／駐軍與其 home mount；Commander 軍隊與 Patrol／Eagle 保留原本 Return／Refit。勝敗皆在 clear 保存成功後才恢復。
- 重建回城清除 Player 的暫態 race／aerial checkpoint 與坐騎護甲戰損，保留坐騎所有權；原地返回把 Player HP 恢復為實際最大值，並在保存成功後、其他交接 callback 前補滿 live HP，避免巢狀保存寫回舊傷。
- 所有徒步回城落點以 `PlayerFootBody` 的共用腳底偏移與 `Player.standOn()` 放到已驗證表面；直接原地返城先清除飛行／墜落回放再用 scene reset。
- HR 在跨場景正式返回與守城重建時，按永久私兵名冊保存 `returnToHR` 全員整補意圖（含死亡、reserve 與未參戰者）；正式返營成員保存為未部署 reserve，下一次 Follow 才以完整配發資源出營。只有騎兵掃蕩等同場景原地返回保留 HR 戰損。
- `TownEvent` 結算要求完整居民登記，按 event ID 冪等，先保存再轉場；跳槽勝利只排除原生巨鷹騎手（依名冊身份），其餘居民目標不變；玩家死亡優先。

## 任務模組

| 任務模組 | 擁有的契約 |
| --- | --- |
| `CaptainMissionCatalog`、`CareerCommandAuthority` | Captain 分頁、獨立 Tier 4 與接受時保存的軍階授權；Commander 依正式名冊分隊，只恢復接受時保存的現行授權 |
| `TownCommandSquadController`、`CaptainPatrolCommandController` | 平時訓練場兵權與任務交接；Patrol 借用、有效擊殺目標、戰損與獨立結算 |
| `CaptainBattleLaunch`、`CaptainEagleCheckpoint` | Stage IX／Custom Battle 空戰路由、正式與 HR 分離部署、完整 battlefield save／resume；不寫 free Campaign progress |
| `BanditMissionController` | 背景營地盜匪與「斥候的悲劇」Town runtime、共用行軍及返程；已遷移的野外任務由 `Game` 擁有 |
| `CavalrySweep`、`MountedMissionMarch` | Town mounted missions 的集合點與自動行軍；Captain 只控制第一隊，Commander 授權兩隊，未接管者走原生 AI，行軍遭遇不覆寫已保存的玩家命令；temporary 友軍結算後實際走到 edge 才移除 |
| `CommanderFourGateDefense*`（Controller／Roster／State／Deployment／Entry） | Commander V 四門守城，見下節 |
| `CareerDuelController` | Duel，見下節 |
| `CareerOutpostMission`、`CareerOutpostLaunch`、`CareerOutpostRelief` | 跨 Town／Game 的啟動與同格式重整；`CareerOutpostRoster` 共用正式 army、wave IDs、Commander 分隊、Pending 與完整 checkpoint。剛接受尚無 checkpoint 是合法首次部署，不從歷史名冊重建 |

## Captain 任務

- **Patrol Command**（`CaptainPatrolCommandController`）：只借用既有、正式編制完整的 Patrol A/B；交戰、傷亡、失馬後都可接管，但整隊返營／REFIT、其他任務或 Siege ownership 不可。原 Patrol controller 逐人 relinquish；live 接管只移交兵權，保留目標、動畫與戰鬥狀態，不生成新兵或額外敵軍。
  - 只有當前場景敵對 NPC 的有效傷害與唯一 `actor_killed` 才計軍功／目標；第三方、友軍、平民與 training 排除。達標優先勝利；Player、正式 Patrol 與已部署 HR 全滅才失敗。
  - 勝利後可直接回城（先保存 grounded return、排除舊 aerial snapshot）或保存 RETURNING 實際返營；`patrolReturnStates` 保證續讀不重複整補或發軍功。結算後不保留任務兵權。
- **Stage IX**（`CaptainBattleLaunch`）：以 `CareerCombatLaunch` 區分 Stage IX Defense 與 Eagle Custom Battle；`main`／`CareerTownEntry` 只從有效 Career active mission 重建，free battle session 不能注入 `careerEagleMissionId`。重用既有 defender capacity、wave、gate 與 timeline；進度與獎勵寫 Career Tier 4，不改 free Campaign progress。`battle` 保存 timeline／wave cursor／gate 與所有正式 NPC 的 actor checkpoint，`officialSquad` 另存命令與 contribution。
- **Captain Eagle**：重用 Custom Battle 地形、`EagleFlightController`／`EagleFlightAI` 與共用 scheduler，只生成本場臨時巨鷹騎士（不入 inventory）。Player 用自己可用的 xongkoro；HR 中原本裝備 xongkoro 的私兵才飛行，其餘在地面參戰。`CaptainEagleCheckpoint` 保存完整空中狀態。

## Commander 任務

- **Commander IV 渡河**（`CareerBridgeBattle`）：獨立 Career launch 與目標死亡判定，不用 Campaign Stage／Outpost runtime；共用 River Crossing planner 與 `Game` 的 field checkpoint／Spawn Scheduler／指揮 UI。順序固定：保存全員身分 → 部署友軍 → 初始 checkpoint 成功後玩家進場與準備 → 生成階段保存成功後才生成敵軍 → 全員保存後同步進攻。`bridgeDeployment` 保存準備剩餘時間與階段（Loading 不計時，交戰 checkpoint 不重新倒數），`bridgeBattle` 保存 actor／mount／player／命令，重載只恢復存活者。軍功與 Tier 5 勝場經 `claimCareerMission` 單次保存。
- **斬首行動**（`CommanderDecapitationDeployment`）：只規劃尚無 Player 位置的首次部署；共用 Navigation connectivity、`PersonalSquadDeployment` 淨空與 `EagleLanding` 翼展檢查，威脅範圍讀實際 NPC 射程。無完整合法配置時明確失敗、不放寬。`CommanderTownMissionController`／`TownScene` 沿既有 scheduler 與 Loading barrier 套用同一配置；已有 `playerPosition` 或完成部署的 checkpoint 保留原狀態。
- **Commander Last Stand**：準備完成後才由 Defense Campaign wave owner 排入攻方騎兵，騎手與坐騎同一 job 建立並立即收到命令；攻方 staging 經 `DefenseCampaignDeployment` 驗證 clearance 與導航連通。勝利按完整 stable target IDs 判定，**未生成的 ID 仍算未消滅**；重載只補尚未存在的 IDs，每個成功 job 保存 checkpoint，不重設 timeline 或重播結算。

### Commander V 四門守城

- `CommanderFourGateDefenseState` 只接受現行守方與攻方 roster 版本（`COMMANDER_FOUR_GATE_DEFENDER_ROSTER_VERSION`、`COMMANDER_FOUR_GATE_DEFENSE_ENEMY_ROSTER_VERSION`，見 `CommanderFourGateDefenseRoster.ts`）；舊版進行中存檔依規則拒讀。現行 checkpoint 驗證精確任務名冊，戰前／戰中 Actor 與坐騎資源由四門任務保存。
- 守方：Commander V 由原生指揮名冊建立任務專用編制。奇數隊指揮城牆步兵、偶數隊指揮城門地面步兵，沿用 wall／cavalry sector 的接戰事件與玩家命令優先權；0 號中央機動隊（居民、原生幹部與 T3 槍騎）獨立於四門接戰與和平居民移動流程。兩種自主守衛（`autonomousActorIds`，保存完整 checkpoint 與 `nativeCombatStats`，不發玩家指揮軍功）與私兵沿用原有權限。
- 城鎮中心在生成前依實體樓板、碰撞與導航連通分配站位；維京機動騎兵離開長屋時先沿地面導航進入中央走道，再通過門洞。四門模式由 TownWorld 建立獨立碰撞的拒馬段，留開城門道路、樓梯與巨鷹淨空。
- 階段：DEPLOYING 等待本城／HR／坐騎 → 保存 PREPARING 後準備 → 零秒保存 SPAWNING 才部署敵軍 → 全部就緒並保存 ATTACKING 才進攻。勝利：消滅全部目標，或有效戰鬥達時限且守方仍有人。時間、傷亡、命令、護航收據與勝利原因都在現行 checkpoint。
- 新任務一律滿編滿血進場：`freshCommanderFourGateDefenseEntry` 不帶入小鎮當下的 Player／坐騎／居民／HR 傷勢。
- 部署：`CommanderFourGateDefenseDeployment` 依真實 walk surfaces 與實體障礙選站；城門地面槍兵以錯列覆蓋門洞，近戰與遠程在後方及兩側。拒馬靠近門內，保留門扇與騎乘通行淨空。城牆弓兵優先佔 gatehouse gallery，配置避開巨鷹 pads 與進場走廊。
- 攻方護航：
  - `CommanderCavalryEscort`：槍騎沿車尾 formation 掩護，不成為 Crew、不改投射物防護；到達釋放距離（`COMMANDER_CAVALRY_ESCORT.releaseDistance`）或本車毀棄／停滯／無推手／全組死亡時，**原子保存** release receipt 與 Charge 後交回 Gate AI，保存失敗維持 escort。
  - `CommanderInfantryEscort`：護車步兵（ID `<mission>:<gate>:<left|right>:escort:infantry:<n>`，不是 Crew、不乘車、不改推車速度）跟在槍騎後方，不因距離城門釋放，只在本車 DOCKED／毀棄／停滯／全組死亡時保存 receipt，再經 `TownFourGateSiege.resumeExternalMovement` 入城。
  - `commanderArcherScreenTarget` 把攻方弓兵排在車前兩側、不擋車道；先鋒步兵開戰即 Charge 城門。
  - 每門增援分八列，左右兩車外側各四列，與原護衛並排。增援持有各自車輛的 formation 命令，命中不取消隨車推進；該車接牆、毀棄或停駛後交回入城導航，優先使用該車已開通的入口。
  - `TownFourGateSiege` 的臨時 movement owner 排除 route／convoy 搶令；同一護車命令只刷新 formation 目標並保留受阻恢復狀態。ATTACKING checkpoint 缺任一 escort 收據即拒讀；`infantryEscort` checkpoint 嚴格驗證完整編組；已釋放者 reload 後不歸隊。
- HUD：`FourGateDefenseHUD` 只在此任務存在並取代 TownScene 左上文字面板，不攔截輸入；資料只來自 `CommanderFourGateDefenseController.hudSource()` 唯讀快照，經 `FourGateDefenseHudModel` 轉成字串。每門守軍固定取部署時 `sectors[]` 的 `wallActorIds`＋`cavalryActorIds`（依 Actor ID 去重，**不隨玩家調動改歸屬**），中央機動隊、塔樓弓手與巨鷹只計入總兵力；敵軍沿用 `remainingEnemies`（未生成者不算死亡）；城門「開啟」與「已攻破」分開，攻城車狀態直接讀 `MobileSiegeRampController.state`。
- 玩家命令與 Dismiss receipt 原子鏡像到 mission／Siege checkpoint；`fourGateDefense` parser 保留完整騎手與原坐騎資源（空軍不進地面 parser）。結算經 `snapshotActiveMission` 把最後一幀與軍功／Tier 5 勝場同次保存，保存成功才清場並重建 Home Town。正式任務隔離 ambient 敵軍。

## Siege 任務 AI

- 各隊只攻自己的門，不改走別門；只有敵方致命攻擊破門才釋放該門 AI 步兵與 cavalry reserve（含同場 reload），其他門繼續守位。部署 finalizer 只在原生 formation 仍有效時沿用快取目的地。
- Commander 隊伍在玩家接管**保存成功**後才排除原生 AI。任務 combat target 覆蓋一般／快取／遠程換敵選擇，清理後恢復原生選敵。
- Roster 建立後所有死亡（含 PREPARING）永久計戰損；同場 reload 不修門，結算返回才恢復 open。不接受退休 Town War 任務或其 Siege state。

## Duel

- `CareerDuelController` 的 `duelMode` 分武裝與空手，各自獨立解鎖（空手用 `unarmedDuelHighestDefeatedTier`），不新增 preset。T5 擴充既有 Duel tier（不擴充 UnitTier），逐級勝利解鎖，不要求軍階或軍功；**單挑勝利不直接晉升**。
- 玩家用暫時限制的裝備視圖，NPC 用借用 loadout；空手 NPC 傷害固定、不套英雄倍率。有效傷害先驗證來源與 contact，違規 `illegal_attack` **先保存再判負**，優先於同次致命勝利。
- 普通 T1–T3 對手暫時同步人物 Tier／模型／Max HP，checkpoint 保存血量基準，返城還原正式身分；英雄不套用此切換。T5 對手借用唯一 Commander、Captain 裁判；騎兵 preset 由 Duel 自建臨時坐騎，不借居民或 Player 坐騎，cleanup 只釋放自己建立的坐騎，重載不復活失馬。
- 帶路角色死亡由其他存活任務角色接手；全隊死亡仍允許 Player 自行返營結算，結算歸還角色與原裝備／服務狀態。
- 場地：`TownDuelArena` 在訓練區間 forecourt 驗證障礙、站位與 navigation，**無合法位置就部署失敗，不退回城外**。`TownMissionCombat` 同幀推進 Duel 與完整 Town runtime，Duel actors 排除於 Patrol／居民 controller；受保護 rider 的坐騎也受保護。Player 離開 arena 不停計時，objective 只追蹤既有 opponent。

## 臨時戰場坐騎

- `TemporaryBattlefieldMounts` 只維護 combat-local 騎乘資格與 cleanup，**不讀寫** Career profile／inventory／購買狀態，runtime temporary 標記不進存檔。
- 只登記本次 combat 生成或騎兵死亡後釋放的坐騎，排除 owned mount 與 Town service／merchant mounts。駐軍坐騎僅在本次釋放後暫時可騎，cleanup 保留其實體並恢復 reserved；其他臨時坐騎清除。永久選擇與 HP persistence 始終指向原購入坐騎。
