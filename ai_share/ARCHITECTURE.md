# SagaBurst — 架構與契約

本檔只記錄跨模組職責與不易從單一檔案看出的契約。數值、模型清單及操作鍵位以程式／manifest／工作室 UI 為準；驗收流程見 [AGENTS.md](AGENTS.md) 的 skill 索引。

## 發布與資產網址

開發使用 `dev`，正式部署與 tag 來源使用預設分支 `main`；功能 PR 先進 `dev`，驗證後再以 PR 推進 `main`。Web 與 Electron 共用 `src/`，`vite.config.ts` 分別輸出 Pages 的 `dist/`（`/SagaBurst-3D-Game/`）與桌面版的 `dist-desktop/`（`/`）。Public runtime 資產透過 `src/assets/publicAssetUrl.ts` 使用 Vite base，音效／語音由 `SoundManager` 集中播放：既有錄音使用 Vite URL，尚未錄製的 Dismiss 使用可選的 `public/audio/career/{roman,viking}/dismiss.wav`，缺檔安靜略過，下次命令重試；新增音檔無須修改命令接線，打包版本需重建。Electron 僅以 `sagaburst://game/` 提供打包內容與安全視窗，沿用原本 Web storage 與存檔格式。發版與 GitHub 一次性設定見 [RELEASING.md](../docs/RELEASING.md)。

## 程式入口

| 區域 | 入口與職責 |
| --- | --- |
| 啟動 | `src/main.ts`：DEV 路由、有效 session／Career 恢復、主選單與場景啟動 |
| 戰鬥場景 | `src/Game.ts`：資產預載、Player/NPC、主迴圈、碰撞、UI 與場景生命週期 |
| 訓練場 | `src/training/`：共用戰場的靜態假人、場內免費庫存與坐騎配置；`Game` 保留正式移動、攻擊與碰撞 ownership |
| 城鎮場景 | `src/town/CareerTownEntry.ts`、`TownScene.ts`：生涯入口、獨立場景、任務與居民生命週期 |
| 角色 | `src/player/Player.ts`、`PlayerInput.ts`、`src/world/NPC.ts`：玩家輸入與 NPC 行為 |
| 地形／導航 | `src/world/Terrain.ts`、`SpatialGrid.ts`、`src/navigation/`：高度、障礙、鄰近搜尋與路徑 |
| 裝備／成長 | `src/rpg/`、`src/save/SaveManager.ts`：裝備資料、庫存、技能與 RPG 存檔 |
| 戰役／編隊 | `src/campaign/`、`src/battle/`：部署、戰役流程、編隊與指令 |
| 生涯 | `src/career/`：軍功、任命軍階、任務狀態、保存及恢復 |
| 呈現 | `src/ui/`、`src/audio/SoundManager.ts`、`src/debug/`：DOM UI、音效與 DEV 工作室／診斷 |

## 角色資產與動畫

- `HumanoidAssetRegistry` 在產生角色前載入可用 manifest／GLB；正式模式不以舊程序人物靜默替代失敗資產。`HeroAssetCatalog` 集中 T4 英雄描述。
- geometry、material、texture、clip 共用模板；每個角色持有獨立 skeleton、mixer、socket 與動作狀態。`CharacterVisuals` 提供共用 `CharacterRig` 契約及舊測試模型。
- `HUMANOID_LOD_DISTANCES` 是人物 LOD 門檻的唯一來源。LOD0 是裝備 socket authority；穩態求值 LOD0 加可見 LOD，切換、fade、seek 必須補齊姿勢／時間，不能重播 gameplay 事件。
- 距離節流只減少視覺求值；AI、移動、攻擊事件與 gameplay timer 每幀推進。跳過的 visual dt 只能補算一次。
- `CharacterCombatAnimator` 擁有一次性攻擊／釋放事件；Player/NPC 在事件到達時造成傷害或產生投射物。完成或取消後回到最新 locomotion，換裝取消未完成動作、不補發事件。
- `CharacterEquipmentPose` 在 mixer 後套姿勢，下一次求值前還原。`bakedEquipmentActions` 表明已烘焙握點的動作，避免疊加通用 IK；資產與 runtime 不能同時擁有同一關節修正。

## 裝備與投射物

- Training Ground 由主選單或 `?training=1` 直接進入，舊 `freeride` 網址轉入相同模式；不讀取生涯角色／裝備、不建立軍隊、任務或 TownWorld。一般角色可用正式目錄全部一般裝備；遊俠固定近戰弓透過場內角色切換使用正式 Ranger 資產及裝備限制。
- `TrainingDummy` 實作 `DamageReceiver`，共用 `WeaponSweep`／`traceCombatSegment`、`ArrowProjectile`、`MountImpact` 及 `DamageRouter`，以 `training` 目標事件保留實際傷害、沒有 HP／死亡或 AI tick。`Game` 額外禁止整個訓練模式的技能 XP（包含停放坐騎與格擋）及 RPG 存讀檔。
- 11 個靶位距離從同一個 0m 假人中心計算水平公尺；玩家出生在旁邊，射擊黃圈放在中心前方 1.5m，以免 0m 靶擋住其他射線。靶場沿用既有地形，125m 跑道與坐騎停放區相互分開；xongkoro 保留正式爪擊與飛行，地面衝撞仍依正式規則排除飛行坐騎。
- 訓練重置保留原有假人／坐騎 identity，安全解除飛行騎乘及墜落狀態、重設坐騎、恢復正式共用箭／標槍彈藥池與盾牌耐久、清除投射物及命中資訊。退出取消事件訂閱、DOM listeners、輸入與場景資源，再載入明確主選單入口，不改 Career 或 Battle session data。

- `WeaponMeshFactory` 共用於 Player、NPC、掉落物與工作室；[EQUIPMENT_TIERS.md](EQUIPMENT_TIERS.md) 維護外觀範圍。合併剛性零件須保留材質／render flags、幾何、grip/tip metadata 與動態零件。
- `SwordAttachmentContract`／`EquipmentAttachmentContract` 管理握點；固定裝備 attachment 不由 animator idle／cancel 覆寫。調整武器方向繞掌心握點進行，不以扭腕掩蓋資產軸向錯誤。
- 裝備中的盾是唯一持盾狀態來源，步戰／騎乘皆留左手。持盾阻擋拉弓；盾牌變更取消未完成蓄力。一般 T1–T3 劍走單手劍動作。
- Lance idle 沿用 Sword Idle 人體／手形，加固定 attachment；攻擊才加右臂 FK 前伸。不在無關工作恢復舊 Ready pose、左手支撐或 lance IK。
- Maki 使用來源持弓 idle；近戰仍持同一把弓，以重定向 `axeAttack2H` 播放，Player 裝備固定弓近戰／無盾。站立側身姿勢、移動／騎乘腿部所有權見 [posed-source characters](skills/humanoid-rig-skinning/references/posed-source-characters.md)。
- `CharacterBowVisual` 共用弓、弦、nock、搭箭及發射座標；Roman pilum 另有外觀。`ThirdPersonCamera` 瞄準只改 FOV；Player 從 nock 向準星 world ray 命中點發射。
- T4 Ranger 的正式預設 loadout 經 `resolveT4UnitLoadout` 使用 `maki-ranger-bow-ranged`，沿用原本 Maki 弓外觀、動畫與近戰 fallback。遠程傷害／箭速由 WeaponDatabase 實際裝備決定；角色 tier 不會自動升級明確指定的低階弓。
- `EagleRangedCombat` 只覆寫 NPC + xongkoro + bow 的 3D 開火距離，依當前武器 tier 為 200／300／400／500m，不再疊加 Ranger 射程倍率。`ProjectileBallistics` 有界求解真實重力與移動目標攔截，發射前重驗彈道遮擋；發射後投射物不追蹤。NPC 驗證過的空軍射擊及 Player 自由瞄準空軍弓各自產生有界 flight budget，Game／Town 都傳入 ArrowProjectile。Town 非空軍保留五秒政策；共用箭矢使用 scene 方形世界界線與獨立 age／travel cap，不再依世界原點 400m 球體裁切。
- 箭模型沿 local `-Z`，投射物朝向須顯式對齊速度。飛行箭／pilum 共用不可變 render resources，移除實例不能銷毀模板或每發遺留資源。
- `EquipmentVisualLODController` 跟隨人物 Three.LOD 的當幀 level，不另算距離。只切已標记的靜態細節，保留 socket、弓弦與搭箭的動態 ownership。
- NPC 持有裝備在 LOD2 關閉 castShadow，LOD0/1 還原第一次登記的原值；重建盾牌立即沿用目前 level。Player、飛行物、掉落物、人物與坐騎不屬於此 policy。

## 坐騎

- `Mount` 是 HP、移動、碰撞、跳躍、衝撞、死亡／下馬與存檔的權威；`HorseAssetRegistry`、`BlackCatVisual`、`CorgiVisual`、`XongkoroVisual` 負責資產與動畫，保留原 save IDs。
- `QuadrupedAssetPreload` 集中 Black Cat／Corgi 的 manifest／GLB 驗證、並行預載共用與失敗重試；各 Visual 提供路徑、body 前綴與模板發布。全部必要 clips／LOD／seat 通過後才發布模板，失敗後下次預載重新讀取，實例建構與動畫仍由各 Visual 負責。
- 坐騎實例共享 render resources、各自持有 skeleton／mixer。Horse LOD 與遠距動畫節流由 registry 維護；不改變 gameplay timer。
- Black Cat／Corgi 使用 `idle`、`walk`、`run`、`death`，保留遊戲會呼叫的 `jump`／`land`／`hit`；`QuadrupedMountAnimation` 定義種類與速度遲滯，Horse 保留原步態。各實例的全部 LOD 共用一套 skeleton／mixer，死亡單次播放後停在末幀；一次性受擊／落地結束後恢復最新請求的步態與播放速度。
- 騎士骨盆對準解剖 seat socket，腿姿遵循各 rig 的 `forwardBendSign`。Corgi 的 `CorgiSeatContact` 修正座面貼合；DEV 校準是否適用正式 Player/NPC 必須依實際呼叫端確認。
- Custom Battle／Defense Campaign 的 Player 可選坐騎；一般戰場騎兵與營地預設 Horse。Career 的駐軍、英雄與商人坐騎由城鎮規則決定。
- 近戰與投射物沿用 `WeaponSweep`／`traceCombatSegment`，比較 shield、人物 body 與 mount 的 first contact。Mount collider 使用 aim proxy 的 local box，隨完整 world transform 旋轉／縮放；所有存活坐騎都是獨立 physical target，無 rider 或同陣營仍阻擋並承受武器命中，NPC 不主動選無騎士坐騎為目標。攻擊者自己的坐騎排除於自己的武器查詢。
- `CombatContact.mount` 指向真正命中的坐騎。body／盾牌 overflow 只傷人物，mount 只傷坐騎；兩者死亡獨立、正常 release rider。`mount-impact` 是明確例外：目標騎乘存活坐騎時傷坐騎，否则傷人物，不判 first contact、不吃盾。未帶 contact 的 scripted damage 傷指定人物，不因 mounted 轉移。長槍 charge 與 mount impact 避免同次重複傷害；死亡坐騎仍需完成動畫更新。
- 戰場坐騎 HP 傷害與 NPC HP 傷害皆沿用 CombatEvent offensive XP；傷害數字只顯示 actual appliedDamage，HUD 對應實際命中對象。Player 的 mount HUD 由仍然 mounted 且 currentMount 存活決定，不由上一擊 isMountHit 決定。
- `xongkoro` 是 Tier 4 英雄坐騎。`XongkoroConfig` 集中 200 HP、48／96 km/h、起降／高度／射界與主動攻擊參數；`EagleFlightController` 接收 Player／`EagleFlightAI` 共用意圖，執行有限轉向、連續位移碰撞及完整起降淨空。`ThirdPersonCamera` 單獨消費滑鼠 delta，由 `EagleFlightAim` 同時產生準星與飛行意圖；瞄準維持巡航。
- `XongkoroVisual` 使用本地 CC BY 4.0 GLB：固定參考姿勢的頭身尾長度 10 m、+Z forward、MASK 羽毛材質；獨立 skeleton／mixer／程序化頭爪 pose；落地以來源腿鏈建立雙腳支撐並維持展翼的姿勢，依蒙皮腳底一次校準，起降平滑混合回飛行取樣。軀幹／頭部受擊 proxy 跟隨同一骨架；低空依淨高限制拍翼幅度，拍翼聲由 `WingbeatPhaseTracker` 追蹤動畫下拍，`EagleWingbeatAudio` 將 Game／Town 的實例接至既有 SoundManager，依距離與數量預算播放本地音檔；音效不控制動畫或 gameplay。`StandingRider` 在飛行 transform、動畫及姿態後對齊軀幹 standing socket 與雙腳，不把坐騎縮放傳给騎手；Player／NPC 保持 mounted，使用獨立下半身站乘姿勢。
- `EagleAttack` 只在主動窗口掃掠頭／爪，按 attack instance 去重、先判盾／人體／坐騎實際 contact；飛行坐騎排除被動 `MountImpact`。攻擊 method 為 melee、來源 metadata 為 `xongkoro`，技能歸屬 mountedImpact，與手持武器無關。
- `FallingRider` 共用腳底最高點、繼承速度、重力與有效支撐面落地規則；解除綁定冪等，死亡角色仍完成墜落。`fall` 環境傷害繞過戰鬥減傷，以 rider.maxHp × h / 15 結算一次，h ≥ 15 必死；經正式 HP／死亡回呼與歸因事件，不給武器 XP。死鷹先墜落接地再淡出。`CareerAerialState` 與普通 `SaveManager` 保存未決墜落及飛行／戰損，合法退出清除舊場景 callback。
- 授權、來源雜湊與重建方式保留於各模型目錄的 manifest／CREDITS 及必要 provenance；製作／匯出驗證由資產 skill 維護。

## 編隊、傷害與戰績

- `BattleConfig.squadAssignments` 保存部署編隊，`matchesArmyCommandTarget` 是指令與 formation 共用選取規則。UI 部署需分配全部相關 NPC；既有無手動計畫的診斷設定可用 deterministic fallback。
- `CombatActorRef` 在攻擊／發射時擷取穩定 actor、allegiance、faction、preset、squad 身分；延遲命中的投射物保留原射手。
- `DamageRouter` 統一角色／坐騎／建物傷害，回傳實際 HP 損失，包含盾減傷與 overkill 上限。死亡／摧毀事件只在首次終止轉換送出。
- `CombatEventStream` 同步發送歸因事件，戰鬥不直接依賴戰績 UI 或生涯軍功。`BattleStatsTracker` 只做串流累計，不保存完整事件歷史。真實盾牌吸收另發送 `hit_blocked`，只供接觸冷卻等 consumer 使用；不偽造 HP 傷害，也不加入傷害／擊殺軍功。
- 戰績是單場資料；`BattleStatsView` 共用呈現個人／編隊結果。Defense Campaign 不累計進攻建物指標；生涯結算獨立消費有效結果。

## 生涯與城鎮

- `CareerProfileStore` 使用 `sagaburst_career_v1`，與 RPG／Campaign 存檔隔離。`loadChecked` 區分無存檔與損壞／不支援資料；載入失敗不得覆寫。
- `CareerProfile` 分開 lifetime `totalMerit`、可花費 `availableMerit` 與任命 `rank`。晉升按 enlistment baseline 計算資格，必須明確任命；領獎不自動升階。獎勵以已領 battle／mission ID 保持冪等。
- `CareerMissionMeritPolicy`／`MeritCalculator` 管理軍功；Recruit／Soldier／Veteran／Captain board 勝場按任務 Tier 1–4 分開保存，不由當前軍階反推。Duel 擊敗 tier 按 preset 推進，不改 board 勝場。
- `CaptainMissionCatalog` 擁有六個獨立 `captain-…` template IDs 與 Captain／Commander 分頁；不以其他 Captain 勝場鎖定順序。Captain Siege 不需要 Outpost Relief，原 Soldier Assault 的 canonical prerequisite 保持原規則。Eagle 解鎖讀取 `CareerInventory` 真實 xongkoro ownership；部署再驗證玩家可用 allocation 與戰損，不以當前騎乘代替 ownership。
- `CareerCommandAuthority` 保存官方指揮契約：Town faction、Squad 1、穩定 Actor IDs、mission ID 與獨立 contribution。`CareerCommandActorCheckpoint` 共用正式兵的 HP、位置、彈藥、盾、命令、formation、坐騎與飛行／墜落保存；authority 不授予裝備或永久私兵 ownership。`ArmyCommandController` 的 caller 只提供目前授權的正式隊與 `personal` 私兵，All 使用同一集合；正式任務隊不可 Dismiss 到 HR。命令 HUD 依實際城防／私兵返回名冊顯示「返營」，HR reserve 顯示「待命」；成功 Dismiss 清除該目標舊戰鬥命令快取，返營完成後回到防禦／待命，reserve 不影響現場全軍命令標籤。Player 死亡停止接受命令，既有 AI 仍繼續作戰。
- `TownCommandSquadController` 接管固定 30 名既有訓練兵的指揮與返程，Town 保留資源及整補 ownership。Captain／Commander 在沒有正式任務時自動取得兵權；TRAINING、FOLLOWING、RETURNING 與到營後皆保持 Player allegiance，和平時與 Town 友好。Dismiss 只下達實際返訓練場，不取消平時兵權、不瞬移或整補；存活者到營前保留戰損。和平 RETURNING 期間不能重新派出；Town Hostility 中止返程並恢復正式隊的全部命令與戰鬥更新，僅改命令，不改位置、HP 或坐騎；舊 RETURNING snapshot 在敵對重載時同樣恢復戰鬥。接受非守城正式任務先原子保存 `authorized=false`、Town allegiance 與 RETURNING checkpoint，再部署本次任務，不等返回；尚在 RETURNING 的 Actor IDs 排除借兵。新守城任務（一般 Town Defense／Captain III）先整補永久城防名冊並保存兵權交接，再重建場景完成初始定位，已接受任務的續讀不重複整補。真正跨地圖、完成玩家死亡返回／復活，以及守城結算返城也整補永久城防；其他同地圖 reload 保留傷亡。士官長／HR 的手動整補共用 save-first 資源恢復，交戰、Attack／Charge、尚未結束的己方投射物或最近五秒命中／格擋接觸時不可用；HR 私兵不跟隨城防自動整補。任務結束且仍有資格時重新授權原隊。正式任務仍持有的 Actor IDs 不受永久城防 checkpoint 重設隊號或命令；玩家下令會解除守城準備階段的尋敵限制及定位移動。敵軍仍在排程建立時，已到位的玩家部隊透過 TownMissionCombat 執行 Formation／Follow 移動，不推進戰鬥或倒數；最後部署程序保留玩家已下達的命令及實際位置，不再套回預設防守。非玩家守軍僅在敵方致命攻擊攻破該隊所屬門後自由行動；門的物理毀損與敵方破門授權分別保存，友軍或無歸屬毀門不釋放守軍。
- Town Hostility 開始前先保存取消正式任務與交接，不結算被取消任務；恢復平時兵權後將 `authorizedTownCommandActorIds` 固定在 event 上。征服 objectives 排除這份 Actor IDs，Reload 不重新推算。Town command 兵仍效忠 Player；跳槽成功後留在原城鎮，清除舊授權，不轉入 HR 或新 faction。
- `CaptainPatrolCommandController` 只借用正式編制含 20 個有效唯一 ID 的既有 Patrol A/B（含原 T4 Captain）；交戰、傷亡、失馬及整補後歸隊皆可接管，整隊返營／REFIT、其他任務或 Siege ownership 不可接管；混合隊伍中的個別返營／REFIT 隊員保留 Patrol travel ownership、checkpoint 與命令排除，整補完成後才交接任務兵權，不生成新正式士兵或額外敵軍；接受時保存名冊、戰損及授權，原 Patrol controller 逐人 relinquish；live 接管只移交兵權，保留目標、攻擊動畫、戰鬥狀態與實際資源。MissionGuide 每幀追蹤存活隊長位置，死亡選正式隊存活替代者，失馬不換人，全滅／RESULT 隱藏。當前場景敵對 NPC 的有效傷害與唯一 `actor_killed` 事件才計軍功／30 殺目標，玩家、授權 Patrol 與已部署 HR 都可貢獻；第三方擊殺、友軍、平民與 training 排除。達目標優先勝利；尚未完成且 Player、正式 Patrol、已部署 HR 全滅才失敗。勝利存活後可直接回 Career Town 安全出生點，先保存 grounded return 並排除舊 Player aerial snapshot，再使用既有 resetForScene 解除騎乘／落下；或保存 RETURNING 再沿既有 Patrol return／refit 實際返營；玩家到返回區域即清理，不等待全員存活。`patrolReturnStates` 與原 actor checkpoint 保存返营／歸隊，續讀不重複整補或發軍功；ambient field controller 不接管此返程。結算後不保留 Captain 任務兵權。
- `CaptainBattleLaunch` 以 `CareerCombatLaunch` 區分 Stage IX Defense launch 與 Eagle Custom Battle launch；`main`／`CareerTownEntry` 從有效 Career active mission 重建，free battle session 不能注入 `careerEagleMissionId`。Stage IX 重用現有 defender capacity、T3 enemy wave、T4 heroes、gate、120 秒援軍及 timeline，只在原守軍中選第一線 20 人授權；進度、獎勵與結果仍保存 Career Tier 4，不改 free Campaign progress。`battle` 保存 timeline／wave cursor／gate、Player 與所有正式 NPC 的完整可選 actor checkpoint，`officialSquad` 另保存授權隊命令與 contribution。
- Captain Eagle 重用 Custom Battle 地形、正式 `EagleFlightController`／`EagleFlightAI`、NPC 空戰及共用 scheduler；只生成本場 29 名友軍與 30 名敵軍的臨時巨鷹騎士。Player 使用自己的可用 xongkoro，保留 HP／死亡鎖；全體已招募 HR 是額外援軍，只有原本裝備可用 xongkoro 的私兵飛行，其餘以原武器／坐騎在地面參战。`CaptainEagleCheckpoint` 保存完整空中位置、飛行／墜落、HP、彈藥、盾、準備狀態與統計；臨時巨鷹不入玩家 inventory。空中 Follow／Defend／Formation 保持飛行，地面隊伍按地面路徑執行。
- 只有正式 Career 結算發軍功，任務外城防兵貢獻保存但不建立新獎勵入口。Patrol Command 沿用 Recruit patrol policy；Captain Eagle 沿用 offense mission policy，Stage IX 沿用 defense mission policy，其餘模板沿對應舊 controller；不新增 Captain 倍率。Captain Siege 在實際借兵／臨時 roster、傷勢與最終官方授權 IDs 保存成功後，才移交 roaming ownership、排程部署及建立統計 policy；失敗不部署、不計軍功，重試保留同一份 IDs，已死亡借兵不補員。重載讀取同一份名冊，其他三門貢獻不歸玩家。結果鎖定凍結 aggregate，延遲投射物保留攻擊時 source membership，NPC 貢獻不進 Player 個人武器 XP。
- 老兵「守衛家園 · 老兵守城」需 5 次 Tier 3 任務勝利，解鎖後可重複接取；既有完成紀錄不隱藏或封鎖任務，各場仍以 mission ID 獨立結算。
- `TownScene` 自有 renderer、input、projectiles、城鎮呈現與玩家觀戰控制，不借用 `Game` 迴圈；`TownWorld` 管建物、障礙與場景資源，`TownRules` 管居民配置，`TownEquipment` 管可用裝備及拔出狀態，`TownCombat` 管城鎮命中。
- `CareerPersonalSquad` 在 domain 驗證 Captain／Commander、availableMerit 與 30 人上限，以一次 save 原子保存扣款及 `personalSquad.members` 的永久唯一 ID／type；不保存 XP 或 runtime 世界狀態。`CareerInventory` 以 `inventory.quantities` 為唯一數量來源，ownership arrays 僅是相容投影；Player 的近戰／遠程／盾與 selected mount、隊員的近戰／遠程／盾／坐騎設定共同占用庫存，收起與 runtime 回收不解除分配。舊 ownership 與 HR 預設裝備僅在缺少 inventory version 時遷移一次；Maki 固定弓不入庫。換裝及賣人讀取 controller 的整隊 RESERVE 狀態，clone 完整交易、保存成功後才發布；賣人僅退 availableMerit，並從總庫存扣除隨隊員離開的目前可交易裝備；事先換下的物品保留。`TownHRLayout` 從 Horse Shop 後方搜尋 hall／mounted courtyard，驗證實際障礙、道路及城牆；`hr-officer` 是獨立 T4 service actor，使用 faction Captain 特殊坐騎，但不屬軍事 objective 或私人隊伍。
- `PersonalSquadRuntime`（Town 由 `TownPersonalSquadController` 適配）只管理 Player-owned 私兵的部署、命令與返營，不更新 NPC／Mount；TownMissionCombat 或 Game 的共用迴圈各更新一次。實際 squad identity 固定 `personal`，與官方 1–8 不共用 key、領隊、slots 或名冊；官方 readiness、march、借兵、reinforcement 與 breach 命令排除私兵，實際碰撞、關門、投射物與導航包含私兵。Follow me 依已分配裝備建立 T2／T4，tier/profile 不隨裝備改變；三種隊員沿用原生步／騎戰鬥，不授予 Player skill XP。
- 非 Duel 的新 Career mission 接受時 snapshot 私兵 member IDs；舊 active mission 缺少 roster 視為未帶私兵，不回填。`CareerPersonalSquadMission` 的 bounded checkpoint 與永久 ownership／inventory 分開，保存部署／死亡／已退出、HP、彈藥、盾、原坐騎戰損、命令／formation、位置及五項 offensive counters。同 Town 接任務保留實例；跨圖只重建存活／未退出成員，統一 Defend；同圖 reload 恢復命令、位置、戰損，死者／退出者不可再次 Follow 補員。Outpost 的 Player／私兵在官方後方合法部署，原生英雄與固定弓在 Game 建立前預載；regular Outpost checkpoint 另保存 stable 官方 wave IDs、排隊進度、gate、Player 與 timeline，避免重播援軍或已死亡目標。
- 家鄉 Town Dismiss 以原生 formation 實際回 HR，RETURNING 可取消且存活者無距離門檻仍算己方戰力。沒有 HR 的 Outpost／敵城 Dismiss 是完整 no-op，保留原命令。結果不清理陪同私兵：直接返城視為全隊完成 HR 返營，cleanup／RESERVE，下一次部署原生整補；慢慢返回保留 instance 與戰損，任務清除後以 `personalSquadRuntime` 保存，只有 Dismiss 完成實際 HR 返程才整補。沒有 active mission 且沒有未休整部署的普通自由 Town，保留原有全滅／reload 行為。
- `BattleStatsTracker` 保留真實 NPC source snapshot，私兵 source policy 同時驗證 ownership、`personal` key 與 accept-time ID Set；正式隊另驗證 mission ID、Squad 1 與接受時 Actor ID Set；兩者各保留獨立 counters，互斥歸屬後只合併進本場 `meritPlayer`，仍依既有任務 target／structure side 規則排除 roaming／友軍／自家建築。Player raw stats、damageTaken、survived、技能 XP 與 Career lifetime stats 保留個人來源；`meritPlayer` 合併接受時授權的正式隊與私兵 offensive contribution。真實 gate destruction 事件給單次 credit，結果鎖定後 aggregate 凍結，回程世界戰鬥不追加獎勵。Player 死亡後 Follow 改在其最後位置 Defend，不轉投官方 commander；活著、已部署且尚未完成退場的私兵只擴充己方全滅判斷，不改平民或指定保護目標規則。
- `TownBounds` 定義 Career Town 專用 ±350m playable／navigation bounds、700m 地面及五個固定索引的外圍 Bandit Camp。`TownWorld` 在生成 actors 前登記 scene bound；Player／NPC／Mount 建構時取得各自場景的範圍，後續任務與購買生成亦沿用，Campaign／Outpost 預設仍為 ±300m。敵城攻擊與 Veteran VI 共用擴張後 Town 地圖。舊 Bandit／Patrol 任務以相同 campId／phase／傷亡重建新路線，允許行軍位置安全重定位。
- `TownMissionCombat.update(dt, cameraYaw, elapsed)` 擁有野外、Duel 與城鎮戰鬥的角色集合、準備階段例外、敵我 grid、NPC／坐騎更新及順序；各任務保留自己的 phase 規則與 controller checkpoint。Outskirts 透過獨立 runtime participants 接入自然交火，與 mission actors 共用附近查詢及同一幀的導航預算，不併入 controller 的任務名單。模組接收明確的傷害、射擊及呈現回呼，TownScene 保留歸因與投射物管理；外部威脅駐軍由此模組登記，結算僅透過 `releaseExternalThreat` 歸還登記。
- Roaming 的個別駐軍威脅登記限非 `duty: patrol` 的 Town military；城門守軍、training 與其他 military 可反擊且不新增整補。Town Patrol 的 roaming 遭遇由 Patrol controller 擁有，combat 以該 controller 的實際參戰集合更新；既有 camp／正式任務威脅及任務借用角色依原有 combat 規則更新。
- `TownOutskirtsRules` 定義 Captain／Commander 在所有 Town runtime（含 Enemy Town Assault、Veteran VI）生成的 6×5 Bandit 與 3×10 T2 Horse cavalry；騎兵外觀及裝備取「目前 Town／world faction 的對立方」，再依玩家 faction 對應 `TOWN`／`ENEMY` allegiance。敵境可能出現玩家友軍，其 rider 沿用任務友軍保護，坐騎保持原有獨立命中規則。
- `TownOutskirtsWarfareController` 管獨立 actor identity、固定 sector route、leader／followers、每隊錯開的 0.35 秒／35m 警戒、整隊 aggro 及全滅補隊；`NPC.updateTownTravel` 巡邏不執行 combat target search。Encounter 沿用 Bandit 的 58m leash：一般 alerted 超距 returning、普通偵測不取消 returning、玩家 provoke 可取消；leader 本人死亡才取 roster 第一名存活者，失馬不另換 leader。Bandit 與依既有 Faction 判斷的敵方騎兵各隊全滅後，獨立冷卻 60 秒才增加 generation、沿既有 scheduler 從 map edge 實際行軍進場；友方騎兵維持原補隊政策，不逐人補員、不整補或補馬；普通 reload 重建完整隊伍，不保存 roaming 傷亡／位置；每個 Town 的 `townOutskirts` 在任務外也保存最小 generation／cooldown，不含 actor roster，mission cleanup 不移除此 checkpoint；Captain Patrol Command 以 `patrolOutskirts`／`patrolAmbient` 保存本場 generation、傷亡、位置與戰損，避免 Reload 重新生成已計擊殺的敵軍。RESPAWN_COOLDOWN 續讀保留剩餘時間且不 enqueue 死亡 generation，冷卻結束才排下一波。
- 舊 generation 的 roaming NPC 完成既有死亡演出後，才從 controller actor list／ownership map 移除並 dispose；演出期間繼續正常 dead update。每次 cavalry 全滅替換將原 generation 的坐騎標記 retired：死馬等既有 dead update 完成，活馬無 NPC／Player 騎乘即可回收；Player 借騎的 retired Horse 保留到下馬，不轉成 owned mount。清理移除 mounts list 並只 dispose 一次，不新增 timer。
- Roaming 與正式任務 actors 依 faction hostility 自然互傷，正式目標／友軍的實際死亡沿原任務規則處理；普通任務的 roaming 不進 `targetActorIds`、`remainingEnemies`、mission objective／contribution roster 或 mission survivor／casualty 計數；Captain Patrol Command 是明確例外，只收當前場景登記的敵對 Bandit／敵國外圍軍隊，並按唯一 Actor ID 累積有效擊殺。玩家造成的有效傷害可得一般 combat／skill XP，第三方傷害／擊殺不轉為玩家軍功。可追過開放城門；普通 roaming 遇障礙維持通用 AI fallback；Siege 先透過無副作用的 `prepareCavalryForSiege` 解析原騎兵名冊，保存成功才確認 claim；失敗的重試只領用原先選定 IDs，後來生成的騎兵仍由 roaming owner 管理；Reload 以整隊 ownership 及精確借用 IDs 分別排除，保留未領用的原生名冊。被正式 Siege claim 後改由 Siege 指定城門目標，並以 `NPC.bindCombatEventSink` 暫時接到本場事件流，結束／取消時解除 scoped routing，恢復原 sink，不重複訂閱。
- `TownCavalryPatrolController` 管理兩隊各 20 名 `duty: patrol` residents（基礎 roster 230，含五名空軍；Career 城鎮另加 HR Officer 與 eagle-trainer，共 232）；永久 `patrolId`／`patrolLeader` 與 runtime `activeLeaderActorId` 分開。兩隊從兵營經東／西門出城，沿 `TownPatrolRoute` 同向順時針循環。`TownMissionCombat` 以實際 actor 集合排除任務接管者，未被調用者仍巡邏；借方在下達集合命令前逐人 `relinquish`。任務結算後，Patrol 以 `RETURN_TO_BARRACKS → REFIT → REJOIN_PATROL` 接回角色：整補使用 `TOWN_SITES.barracks` 南側庭院的 40 個固定騎乘 slot（間距 4.5 公尺），與巡邏 startup 編隊座標分開；存活者實際騎乘／步行抵達才整補，死亡者以同 ID 在該 slot 恢復；原裝備、HP、盾、彈藥及原坐騎恢復後即可再次借用；兩名 T4 Captain 沿用 faction canonical mount（Roman Corgi／Viking Black Cat），其餘 38 名騎兵保持 Horse，死亡整補及 reload 不回退種類。Captain 缺席時由 runtime deputy 帶隊，Captain 實際追隊接近後才接回 leadership。`NPC.updateTownTravel` 重用 mounted／foot formation、follow 與 navigation，不執行 combat target search；`FollowTrail` 讓長列沿實際路徑轉彎。巡邏位置、waypoint 及結算後回營狀態不存檔，正常 reload 從兵營整補後重新出發。
- `TownCavalryReserve` 只填任務 authoritative roster 的既定 slot，不新增領隊或改變兵種／人數。普通池為 Training 60、Patrol A 19、Patrol B 19；依來源順序，每層先 matching 再暫換裝，不足才 temporary。兩名 Patrol Captain 是獨立、相容 mounted Captain profile 的 T4 officer pool，不能填普通 slot 或 Maki/ranger slot。Cavalry Sweep 與 Town Veteran field acceptance 共用 selection；active mission 以既有 `friendlyActorIds`／`borrowedActorIds`、位置與傷勢 checkpoint 恢復同一份 assignment，不重新挑兵。Campaign／Outpost 與 Enemy Town Assault 保持既有流程。
- `MissionTravelEncounter` 是 `BanditMissionController` 的 runtime-only 行軍中斷：剿匪／Recruit Patrol、Cavalry Sweep 與一般 Veteran field 的 `MARCHING`／`RETURNING` 共用整隊遭遇；既有 Recruit Patrol 正式接戰／續巡流程保留。首位偵測成員或有效受擊 NPC／Player 決定固定 origin，沿用 35m sensor／0.35 秒 squad broad-phase 與 58m leash；整隊取消 travel，圈外隊員實際回援，威脅清空直接從實際位置繼續剩餘 route／stage，不集合、不補兵補馬。NPC／Player 的 HP、shield impact、mount HP／死亡及致死接觸由 TownScene 同步喚醒；TownMissionCombat 只給 incidental participants 有效 roaming threat grid，後來圈外的 Player 戰鬥等本場結束再由新 sensor／hit 判斷。原 mission 接戰條件優先交回正式 ENGAGING；Town mounted march 使用 leader replacement 與無語音重播的 resume，Outpost relief 保留原死亡衝鋒規則。Victory／reward 維持原時機，RETURNING encounter 只阻擋 returnComplete／最終返城收尾。Encounter 不入存檔；原 actor positions／health／casualties/checkpoint 持續保存，reload 由現有 checkpoint 恢復後重新偵測。Town Defense／Enemy Town Assault 沒有此 field travel group，Veteran VI 直接 ENGAGING，Duel 保留自己的 runtime。
- Cavalry Sweep 與一般 Veteran field 共用 mounted assembly：存活任務 NPC 到位人數達 `ceil(存活數 × 90%)` 即保存 `MARCHING` 並沿原 march controller 出發，Player 不列入集結門檻；未到者保留原 actor／mission ownership，接收 follow 命令實際追隊，不 teleport、不刪 roster。陣亡者不列入分母，未滿門檻或保存失敗仍維持集結。
- 正式 field 任務敵軍接近時，未被任務接管的 Town military 沿既有 external threat 加入反擊；地面步／騎守軍維持 20m，Town Eagle Garrison 初次警戒為 120m。空軍登乘期間保留 120m 最小警戒，接戰後按實際弓的有效射程延伸，並同時限制 rider-to-target 3D 距離、home pad 守備半徑及 Town 世界邊界；Veteran／Cavalry Sweep 的集結、行軍與交戰期間皆適用，Player 死亡不停止駐軍防衛。守軍與任務敵軍共用實際 hostile grid、melee／projectile／mount-impact 路徑，但不加入任務 roster、整補或玩家 contribution。平民與遠處駐軍維持和平；敵方 native 駐軍不享有 Player 友軍保護，正式借用者保留任務 ownership。
- 任務外圍敵軍從 Town 實際 `±350m` 邊界內側生成：Veteran field／敵境斥候增援在 `x=322m` 附近、Sweep 在 `z=-315m` 附近、四門 Siege 在各門對應 map edge 集結；敵境斥候我方與 Player 在 `z=310m` 附近出發，仍朝向敵城。整隊編隊保留安全邊距，已保存的 actor positions 沿原 checkpoint 恢復。
- Patrol 遭遇以每隊錯開的 0.35 秒 sensor、SpatialGrid 隊伍範圍查詢及整隊 alert 接入；本人 HP 傷害、盾牌實際 impact／block、騎乘中坐騎 HP 傷害／死亡及致死一擊，均可由敵對 mission／ambient／roaming source 喚醒同隊。新敵隊加入沿用固定 origin／58m leash；全滅、所有參戰敵隊消滅／disengage／超界後，參戰成員共用 `beginPatrolReturn` 回固定 slots。死亡者此時才恢復，失馬者步行抵達才補 canonical mount；失馬 Captain 保留指揮，死亡者由 deputy 接手。回營受有效命中可將同 patrolId 的 Patrol-owned 存活 `PATROLLING`／`RETURN_TO_BARRACKS`／`REJOIN_PATROL` 成員拉入新 engagement，以受擊點重建 origin、保留既有 refit destination／傷亡；mission／其他 owner 與 REFIT 排除。一般任務 reserve 借兵仍排除交戰、回營及 REFIT；Captain I 的整隊接管允許交戰與傷亡，僅排除整隊回營／REFIT 及其他 ownership；個別返營／REFIT 保留原 travel owner，Follow 與其他命令共用權限 gate、HUD 標記返回中；只在未結算的 ENGAGING 任務中，完成整補後才加入任務指揮，接續同兵種隊員的現行命令，Formation 沿既有 placement owner 找空位而不移動既有隊員；RETURNING 仍保存 checkpoint，但不再 reclaim 或下達玩家命令；Captain 的主選單返回與 pagehide 均由自身 controller 保存 checkpoint；REJOIN 恢復 reserve。Ownership 沿用 relinquish／實際任務 actor 集合，戰鬥資格不要求活坐騎；中間狀態保持 runtime-only。
- 同一 Patrol lifecycle 也接受正式任務敵軍與 ambient Bandit：以實際 field／已放行 Defense／roaming actors 建立共用 threat grid，sensor 與有效 contact 都走整隊 encounter，全滅後同 ID 在固定兵營 slots 整補。Patrol-owned 成員不再被個別 external threat 接管；正式借走者維持任務 ownership。
- `TownMissionSettlement` 集中任務結果保存與返回順序：沿用 `claimCareerMission`／`clearCareerMission`，保存成功後才清理、歸還借用居民及坐騎或重建場景；保存失敗保留現場供重試。守城及清剿原地結算，其他任務依直接返回或步行返抵採取既有恢復方式，TownScene 保留結果 UI 與玩家觀戰控制。
- Home Town 原地返回亦恢復被任務敵軍殺死的非借用居民／駐軍及其 home mount、死亡 Cat，釋放 external threat 並恢復服務；未受害旁觀者保持原狀，Patrol casualties 仍由兵營 return/refit 接回。勝敗皆在 clear 保存成功後才恢復，敵境 native residents 沿重建場景處理。
- `NPC.updateTownPeace`／`updateTownTravel` 的死亡路徑持續既有 3 秒 presentation 後隱藏整個 root，不自行復活；任務／裝備面板暫停活人戰鬥時，`TownMissionCombat.updateDefeatedActors` 仍去重更新所有已死亡 NPC 與 mount，防止雙方屍體永久留在場上。
- 一般 Town Defense、Captain III 與 Soldier Enemy Town Assault 均經載入畫面建立戰場，不因 HR 私兵而改用舊場景。首次初始化在敵軍部署前直接定位既有守軍、預備騎兵與平民；攻方沿既有每秒一人的 spawn 節奏建立，完成後關閉四門；玩家進入場景後共用 10 秒 PREPARING 倒數，期間軍隊待命，之後四路正式 ATTACKING。攻方接管的 roaming cavalry 保留 actor／mount／傷勢、改穿 T3 並納入固定 roster，保留實際位置並行軍到所屬 map-edge muster；停止原 roaming squad respawn。各門預備騎兵依 gate frame 排在該門內側最近門區，部署／集結沿原生速度使用衝刺與體力，到位停止。同場 reload 保留實際位置、剩餘倒數與戰損，不重新部署；部署尚未完成的離場 checkpoint 也保留已定位 residents，不保存尚未完成的臨時敵軍。只有兩個正式 Siege 關門，普通 Town 保持 open。
- `TownSiegeGateClosure` 按 `TOWN_GATES` yaw 推出 closure volume 中所有 Player／NPC／Mount，不依 faction、不造成傷害／combat attribution；mounted rider 與 mount 一起移動。被推出的守軍留在城外；完整進城者不移動。首次部署關門後更新 navigation topology，進場倒數完成才 ATTACKING。
- Siege 各隊先接近自己門，近戰沿既有 NPC obstacle damage 破門，遠程在外支援；不能改走別門。只有敵方致命攻擊破門才釋放該門 AI 步兵與 cavalry reserve（含同場 reload），之後使用原生 Charge 自由追敵；其他門繼續守住自己的部署位置。部署 finalizer 只有在原生 formation 仍有效時才能沿用快取目的地，避免戰鬥準備清掉 formation 後留下 Charge。玩家正式隊定位後由玩家命令接管，不等待破門。NPC mission combat target 覆蓋一般、快取與遠程換敵選擇，任務清理後恢復原生選敵，攻方實際穿過本門才自由清城。Leader 死亡由同隊存活者接替。Roster 建立後所有死亡（含 PREPARING）永久計戰損，reload 保存 roster／位置／HP／失馬／準備時間／gate HP與breach／reserve release／crossing；同場 reload 不修門，結算返回恢復正常 open。缺少新 Siege state 的舊 Town War 取消回 Town，不做 migration。
- Bandit roaming squad 全滅後各自等 60 秒 runtime cooldown 才從 map edge 整隊回補；一般 roaming cavalry 仍全滅即補，被 Siege claim 者直到結束才歸還外圍生命週期。
- `CareerMissionCheckpoint` 擁有 controller checkpoint 的 5 秒 clock、立即／週期保存資格、profile clone 與同步提交，成功才重設 clock；失敗由 controller 下次提供最新快照重試。各任務保留快照生產、phase guard 及保存頻率：Bandit 的 route／傷亡立即保存，stats／騎兵位置走週期；城防時間每 1 秒、傷亡等變化立即保存；Duel 每次 runtime 快照變化立即保存。立即保存也包含當前完整快照，force 只提前已變更的週期資料，不改存檔格式。
- visual faction 與 `CombatFaction` 分開；城鎮平時不敵視 Player。首次有效犯罪先保存 hostile event，保存失敗則不施加第一擊；只在死亡／建物摧毀時保存終止狀態。自由遭遇與官方任務不等同城鎮犯罪。
- `TownEvent` 結算要求完整居民登記；玩家死亡優先。結算按 event ID 冪等，先保存再轉場；不是每個角色 HP／位置的完整快照。
- `CareerTownDialogue` 集中和平對話與 rank 選擇；`TownEquipment` 只允許已擁有且符合軍階的裝備，不把城鎮拔武器狀態寫進其他模式。

| 任務模組 | 契約 |
| --- | --- |
| `CaptainMissionCatalog`、`CareerCommandAuthority` | Captain 分頁、獨立 Tier 4 與保存的正式隊授權；缺少新欄位的舊任務保持原玩法 |
| `TownCommandSquadController`、`CaptainPatrolCommandController` | 平時訓練場兵權／實際返回及任務交接；既有 Patrol 借用、有效 30 殺、戰損與獨立結算 |
| `CaptainBattleLaunch`、`CaptainEagleCheckpoint` | Career Stage IX／Custom Battle 空戰場景路由、正式與 HR 分離部署、完整 battlefield save／resume；不寫 free Campaign progress |
| `BanditMissionController` | 剿匪／巡邏與返程；借用同一位隊長，穩定 FOLLOW slots，僅正式名單納入任務歸因 |
| `CavalrySweep`、`MountedMissionMarch` | Town mounted missions 共用騎兵入口前空地的集合點；既有 actor 從目前位置集合，temporary 沿既有 supportApproach／townEntry 從 map edge 進場。集合完成即自動行軍；Captain 版本只由第二隊自動行軍／衝鋒，第一隊接受玩家命令，行軍遭遇仍保留其指令；友軍 temporary 結算後沿既有 departure 實際騎乘／步行到 edge 才移除，結算後 reload 不重建，敵軍仍正常清理 |
| `TownDefenseController`、`TownSiege` | Soldier Enemy Town Assault／Veteran Home Defense 共用四門 Siege：固定 120 人（Assault 含 Player）、每門 30 人：10 槍騎、10 弓騎、Roman 5 步弓＋5 標槍／Viking 10 步弓。T3 普通兵；三名 T4 Captain 計入槍騎，西門 T4 Maki 計入弓騎，Assault Player 替代北門一名普通槍騎。`rosterVersion=2` 固定新版 slot；已開始而缺版本的舊存檔按 v1 保留原全騎兵索引、死亡與領用 identity，不補員。重用 208 名原駐軍（含五名空軍）與 20 名平民；Captain Siege 僅授權 North 29 NPC，另三門維持 AI；Captain Gate Defense 授權原北門部署名冊的完整步兵隊（含遠程步兵及步行軍官），不以 role 白名單或人數上限截斷；舊任務續讀依已保存的北門部署名冊補齊兵權，保留原傷亡及命令 checkpoint；士官長說明依同一名冊顯示實際人數，指引使用相同北門與門內防線，自動破門／reserve 程序排除玩家命令覆寫 |
| `CareerDuelController` | 借用士兵／英雄進行 1v1，保存倒數、戰鬥與結果；任務 ownership 優先，外敵解除後恢復原路；帶路角色死亡由 Captain／referee／其餘存活任務角色接手剩餘路線，全隊死亡仍允許 Player 自行返營結算，結算歸還角色 |
| `CareerOutpostMission`、`CareerOutpostLaunch`、`CareerOutpostRelief`、`EnemyTownAssault` | 跨 Town／Game 的任務啟動與恢復；從 Career 狀態重建配置，避免套用自由戰役裝備 |

任務保存名單、階段、必要死亡／統計與 checkpoint；不把重載等同新任務。借用居民不得被任務 cleanup 當臨時 NPC／Mount 銷毀。任務勝敗優先序依各 state 模組，Duel 與團體任務不共用同一玩家死亡規則。

Duel arena 由 `TownDuelArena` 在步兵／騎兵訓練區之間的 forecourt 搜尋，驗證障礙物、既有訓練站位與 navigation；無合法位置時部署失敗，不退回城外。NPC 自然走到各自站位後才進 PREPARING，Player 沿用自動就位；讀檔保留位置恢復。`TownMissionCombat` 同幀推進 Duel flow 與完整 Town runtime，Duel actors 排除於 Patrol／居民 controller，與 world actors 共用 participants／target grid，每個 actor 只模擬一次。TownScene 沿正常敵意與友軍保護路由 melee／projectile／mount contacts，受保護 rider 的 mount 也受保護。Duel opponent 可選更近外敵、受第三方傷害；Player 離開 arena 不停計時，objective／stats 仍只追蹤既有 opponent，RESULT 暫停與結算不變。

`TemporaryBattlefieldMounts` 只維護 combat-local 騎乘資格與 cleanup，不讀寫 Career profile／inventory／購買狀態。玩家用既有 mountVehicle／dismountFromMount 暫時騎乘、下馬與再騎；任務結算、失敗、放棄、撤退、回城／場景退出會解除臨時騎乘並沿用 controller cleanup。只登記本次 combat 生成或騎兵死亡後釋放的可借用坐騎，排除 owned mount 與 Town service／merchant mounts。原有駐軍坐騎僅在本次 combat 釋放後暫時允許騎乘；cleanup 保留其 Town 實體並恢復 reserved 資格，其他臨時無主坐騎清除，仍被 NPC 騎乘者依原 controller 返程／離場。永久選擇與 HP persistence 始終指向原購入坐騎，runtime temporary 標記不進存檔。

`TownEagleTrainingGround` 從實際 Town 障礙、道路、巡邏與 HR footprint 搜尋候選起降空地，正式 layout 只建立三個私人 pad，另由 `TownEagleGarrison` 建立五個獨立 Town pad。兩處標示重用騎兵場大型木看板，每根實體支架依自身地形高度接地並註冊碰撞；不保留懸空標牌。訓練場仍售 xongkoro（10,000 availableMerit、Captain／Commander），domain 以 CareerInventory canonical quantity 限制同時持有三隻，包含 Player／私兵／Reserve／戰損；舊版超額庫存保留且禁止繼續購買。`EaglePadReservations` 依永久 owner ID 配置、保存優先 pad 與釋放，不使用整份私兵名冊 index；Player 與私兵共用私人配置，Town 不入私人庫存。敵城沒有友方 HR／私人訓練場：待任務設定 Player 的實際集結點後，`personalTownEagleDeployment` 在其附近建立共享的三個安全 field pad，普通私兵 muster 避讓其翼展；同場景合法飛行 checkpoint 仍優先恢復原位置。

Siege 攻方的 `missionAerialDefense` 明確允許行軍時以現有武器 3D 射程回應真正飛行中的目標，目標離開／死亡即沿原 formation 繼續；地面接敵與其他任務仍維持 20m 行軍中斷政策。新版步弓越過城門後使用 `attack`，避免套用 Viking `charge` 收弓近戰規則。普通步弓 50m、馬弓 30m 與標槍等原武器數值不變，不能因目標是巨鷹而越過自身射程。

`TownEagleGarrisonController` 管五對固定 rider／mount／home pad identity 與 duty，Roman／Viking 都為真正 T3 Archer。和平時地面待命；既有合法 combat phase 才實際步行登乘、錯峰起飛，返回時排隊飛抵自己的 pad、落地、卸乘與步行待命。空軍不進一般借兵名單；新增 rider 加入適用人口／objective，坐騎不加必殺目標。`townEagleGarrisons` 按城鎮陣營各自保存戰損、位置、飛行、未決墜落與 duty，整補只在既有結算授權後進行；舊任務保存的目標 IDs 保持權威，不因新名冊重置戰況。

`EagleFlightAI` 在共用 FlightController 上維持 RANGED_GROUND／DIVE_GROUND／RANGED_AIR／DIVE_AIR 的持續 maneuver，固定 20–40m AGL 巡航、有限轉向／預測拉升與 3D 空軍鄰居避讓。弓箭裝備／彈藥可用性與已選定戰術分開：有箭的騎手先完成騎射承諾窗口，遇到安全且對準的近距機會才俯衝，完成 pass／拉升後重新取得騎射窗口；換目標不逐幀重選或永久延後戰術決策。Follow／Formation／Defend 不等於 Return；只有明確 return order 才指定安全降落。`AerialViewPolicy` 只在 xongkoro 騎乘或高空 observer 啟用 700m camera far／fog，返回地面時還原場景原值；既有 LOD 與 gameplay update 獨立，不扩大高精度模型距離。

`CareerMountController` 維護單一 active mount，切換／遣返保留 HP 與死亡鎖。軍馬只有一份所有權，tier 跟隨任命軍階；舊 tier ID 由存檔相容處理。Captain／Commander 的 T4 身體替換保留運行中玩家狀態；正式隊指揮權由接受時保存的 authority 決定。

## 效能解讀

`Renderer Submit` 是 `renderer.render()` 的 CPU 側耗時，可能含 driver／GPU back-pressure，不等同純 GPU 時間。預設 `renderer.info` 在 shadow 後 reset，通常只報 main pass；mesh 數也不等於 submissions。完整 pass 歸因及 A/B 方法以 [benchmark skill](skills/sagaburst-performance-benchmark/SKILL.md) 為準，舊 PR 數據不代替當前 baseline。
