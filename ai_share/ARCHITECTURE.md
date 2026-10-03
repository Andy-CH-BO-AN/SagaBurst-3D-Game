# SagaBurst — 架構與契約

本檔只記錄跨模組職責與不易從單一檔案看出的契約。數值、模型清單及操作鍵位以程式／manifest／工作室 UI 為準；驗收流程見 [AGENTS.md](AGENTS.md) 的 skill 索引。

## 程式入口

| 區域 | 入口與職責 |
| --- | --- |
| 啟動 | `src/main.ts`：DEV 路由、有效 session／Career 恢復、主選單與場景啟動 |
| 戰鬥場景 | `src/Game.ts`：資產預載、Player/NPC、主迴圈、碰撞、UI 與場景生命週期 |
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

- `WeaponMeshFactory` 共用於 Player、NPC、掉落物與工作室；[EQUIPMENT_TIERS.md](EQUIPMENT_TIERS.md) 維護外觀範圍。合併剛性零件須保留材質／render flags、幾何、grip/tip metadata 與動態零件。
- `SwordAttachmentContract`／`EquipmentAttachmentContract` 管理握點；固定裝備 attachment 不由 animator idle／cancel 覆寫。調整武器方向繞掌心握點進行，不以扭腕掩蓋資產軸向錯誤。
- 裝備中的盾是唯一持盾狀態來源，步戰／騎乘皆留左手。持盾阻擋拉弓；盾牌變更取消未完成蓄力。一般 T1–T3 劍走單手劍動作。
- Lance idle 沿用 Sword Idle 人體／手形，加固定 attachment；攻擊才加右臂 FK 前伸。不在無關工作恢復舊 Ready pose、左手支撐或 lance IK。
- Maki 使用來源持弓 idle；近戰仍持同一把弓，以重定向 `axeAttack2H` 播放，Player 裝備固定弓近戰／無盾。站立側身姿勢、移動／騎乘腿部所有權見 [posed-source characters](skills/humanoid-rig-skinning/references/posed-source-characters.md)。
- `CharacterBowVisual` 共用弓、弦、nock、搭箭及發射座標；Roman pilum 另有外觀。`ThirdPersonCamera` 瞄準只改 FOV；Player 從 nock 向準星 world ray 命中點發射。
- 箭模型沿 local `-Z`，投射物朝向須顯式對齊速度。飛行箭／pilum 共用不可變 render resources，移除實例不能銷毀模板或每發遺留資源。
- `EquipmentVisualLODController` 跟隨人物 Three.LOD 的當幀 level，不另算距離。只切已標记的靜態細節，保留 socket、弓弦與搭箭的動態 ownership。
- NPC 持有裝備在 LOD2 關閉 castShadow，LOD0/1 還原第一次登記的原值；重建盾牌立即沿用目前 level。Player、飛行物、掉落物、人物與坐騎不屬於此 policy。

## 坐騎

- `Mount` 是 HP、移動、碰撞、跳躍、衝撞、死亡／下馬與存檔的權威；`HorseAssetRegistry`、`BlackCatVisual`、`CorgiVisual` 負責資產與動畫。三種均已有外部模型路徑，保留原 save IDs。
- 坐騎實例共享 render resources、各自持有 skeleton／mixer。Horse LOD 與遠距動畫節流由 registry 維護；不改變 gameplay timer。
- Black Cat／Corgi 使用 `idle`、`walk`、`run`、`death`，保留遊戲會呼叫的 `jump`／`land`／`hit`；`QuadrupedMountAnimation` 定義種類與速度遲滯，Horse 保留原步態。各實例的全部 LOD 共用一套 skeleton／mixer，死亡單次播放後停在末幀；一次性受擊／落地結束後恢復最新請求的步態與播放速度。
- 騎士骨盆對準解剖 seat socket，腿姿遵循各 rig 的 `forwardBendSign`。Corgi 的 `CorgiSeatContact` 修正座面貼合；DEV 校準是否適用正式 Player/NPC 必須依實際呼叫端確認。
- Custom Battle／Defense Campaign 的 Player 可選坐騎；一般戰場騎兵與營地預設 Horse。Career 的駐軍、英雄與商人坐騎由城鎮規則決定。
- 近戰與投射物沿用 `WeaponSweep`／`traceCombatSegment`，比較 shield、人物 body 與 mount 的 first contact。Mount collider 使用 aim proxy 的 local box，隨完整 world transform 旋轉／縮放；所有存活坐騎都是獨立 physical target，無 rider 或同陣營仍阻擋並承受武器命中，NPC 不主動選無騎士坐騎為目標。攻擊者自己的坐騎排除於自己的武器查詢。
- `CombatContact.mount` 指向真正命中的坐騎。body／盾牌 overflow 只傷人物，mount 只傷坐騎；兩者死亡獨立、正常 release rider。`mount-impact` 是明確例外：目標騎乘存活坐騎時傷坐騎，否则傷人物，不判 first contact、不吃盾。未帶 contact 的 scripted damage 傷指定人物，不因 mounted 轉移。長槍 charge 與 mount impact 避免同次重複傷害；死亡坐騎仍需完成動畫更新。
- 戰場坐騎 HP 傷害與 NPC HP 傷害皆沿用 CombatEvent offensive XP；傷害數字只顯示 actual appliedDamage，HUD 對應實際命中對象。Player 的 mount HUD 由仍然 mounted 且 currentMount 存活決定，不由上一擊 isMountHit 決定。
- 授權、來源雜湊與重建方式保留於各模型目錄的 manifest／CREDITS 及必要 provenance；製作／匯出驗證由資產 skill 維護。

## 編隊、傷害與戰績

- `BattleConfig.squadAssignments` 保存部署編隊，`matchesArmyCommandTarget` 是指令與 formation 共用選取規則。UI 部署需分配全部相關 NPC；既有無手動計畫的診斷設定可用 deterministic fallback。
- `CombatActorRef` 在攻擊／發射時擷取穩定 actor、allegiance、faction、preset、squad 身分；延遲命中的投射物保留原射手。
- `DamageRouter` 統一角色／坐騎／建物傷害，回傳實際 HP 損失，包含盾減傷與 overkill 上限。死亡／摧毀事件只在首次終止轉換送出。
- `CombatEventStream` 同步發送歸因事件，戰鬥不直接依賴戰績 UI 或生涯軍功。`BattleStatsTracker` 只做串流累計，不保存完整事件歷史。
- 戰績是單場資料；`BattleStatsView` 共用呈現個人／編隊結果。Defense Campaign 不累計進攻建物指標；生涯結算獨立消費有效結果。

## 生涯與城鎮

- `CareerProfileStore` 使用 `sagaburst_career_v1`，與 RPG／Campaign 存檔隔離。`loadChecked` 區分無存檔與損壞／不支援資料；載入失敗不得覆寫。
- `CareerProfile` 分開 lifetime `totalMerit`、可花費 `availableMerit` 與任命 `rank`。晉升按 enlistment baseline 計算資格，必須明確任命；領獎不自動升階。獎勵以已領 battle／mission ID 保持冪等。
- `CareerMissionMeritPolicy`／`MeritCalculator` 管理軍功；Recruit/Soldier board 勝場按任務 tier 分開保存，不由當前軍階反推。Duel 擊敗 tier 按 preset 推進，不改 board 勝場。
- `TownScene` 自有 renderer、input、projectiles、城鎮呈現與玩家觀戰控制，不借用 `Game` 迴圈；`TownWorld` 管建物、障礙與場景資源，`TownRules` 管居民配置，`TownEquipment` 管可用裝備及拔出狀態，`TownCombat` 管城鎮命中。
- `TownMissionCombat.update(dt, cameraYaw, elapsed)` 擁有野外、Duel 與城鎮戰鬥的角色集合、準備階段例外、敵我 grid、NPC／坐騎更新及順序；各任務保留自己的 phase 規則與 controller checkpoint。模組接收明確的傷害、射擊及呈現回呼，TownScene 保留歸因與投射物管理；外部威脅駐軍由此模組登記，結算僅透過 `releaseExternalThreat` 歸還登記。鄰居陣列重用，抽取不增加逐幀輸入物件配置。
- `TownMissionSettlement` 集中任務結果保存與返回順序：沿用 `claimCareerMission`／`clearCareerMission`，保存成功後才清理、歸還借用居民及坐騎或重建場景；保存失敗保留現場供重試。守城及清剿原地結算，其他任務依直接返回或步行返抵採取既有恢復方式，TownScene 保留結果 UI 與玩家觀戰控制。
- `CareerMissionCheckpoint` 擁有 controller checkpoint 的 5 秒 clock、立即／週期保存資格、profile clone 與同步提交，成功才重設 clock；失敗由 controller 下次提供最新快照重試。各任務保留快照生產、phase guard 及保存頻率：Bandit 的 route／傷亡立即保存，stats／騎兵位置走週期；城防時間每 1 秒、傷亡等變化立即保存；Duel 每次 runtime 快照變化立即保存。立即保存也包含當前完整快照，force 只提前已變更的週期資料，不改存檔格式。
- visual faction 與 `CombatFaction` 分開；城鎮平時不敵視 Player。首次有效犯罪先保存 hostile event，保存失敗則不施加第一擊；只在死亡／建物摧毀時保存終止狀態。自由遭遇與官方任務不等同城鎮犯罪。
- `TownEvent` 結算要求完整居民登記；玩家死亡優先。結算按 event ID 冪等，先保存再轉場；不是每個角色 HP／位置的完整快照。
- `CareerTownDialogue` 集中和平對話與 rank 選擇；`TownEquipment` 只允許已擁有且符合軍階的裝備，不把城鎮拔武器狀態寫進其他模式。

| 任務模組 | 契約 |
| --- | --- |
| `BanditMissionController` | 剿匪／巡邏與返程；借用同一位隊長，穩定 FOLLOW slots，僅正式名單納入任務歸因 |
| `CavalrySweep`、`MountedMissionMarch` | 優先借用駐軍／既有坐騎，只生成缺額；歸還借用者、移除臨時角色，保存行軍與 Charge 階段 |
| `TownDefenseController` | 重用城鎮駐軍／平民；接受時固定敵軍名單與比例，按該名單恢復，不因升階重算已接受任務 |
| `CareerDuelController` | 借用士兵／英雄進行 1v1，保存倒數、戰鬥與結果；Duel 敵意不擴散到城鎮，結算歸還角色 |
| `CareerOutpostMission`、`CareerOutpostLaunch`、`CareerOutpostRelief`、`EnemyTownAssault` | 跨 Town／Game 的任務啟動與恢復；從 Career 狀態重建配置，避免套用自由戰役裝備 |

任務保存名單、階段、必要死亡／統計與 checkpoint；不把重載等同新任務。借用居民不得被任務 cleanup 當臨時 NPC／Mount 銷毀。任務勝敗優先序依各 state 模組，Duel 與團體任務不共用同一玩家死亡規則。

`TemporaryBattlefieldMounts` 只維護 combat-local 騎乘資格與 cleanup，不讀寫 Career profile／inventory／購買狀態。玩家用既有 mountVehicle／dismountFromMount 暫時騎乘、下馬與再騎；任務結算、失敗、放棄、撤退、回城／場景退出會解除臨時騎乘並沿用 controller cleanup。只登記本次 combat 生成或騎兵死亡後釋放的可借用坐騎，排除 owned mount 與 Town service／merchant mounts。原有駐軍坐騎僅在本次 combat 釋放後暫時允許騎乘；cleanup 保留其 Town 實體並恢復 reserved 資格，其他臨時無主坐騎清除，仍被 NPC 騎乘者依原 controller 返程／離場。永久選擇與 HP persistence 始終指向原購入坐騎，runtime temporary 標記不進存檔。

`CareerMountController` 維護單一 active mount，切換／遣返保留 HP 與死亡鎖。軍馬只有一份所有權，tier 跟隨任命軍階；舊 tier ID 由存檔相容處理。Captain／Commander 的 T4 身體替換保留運行中玩家狀態，指揮權限仍是待辦。

## 效能解讀

`Renderer Submit` 是 `renderer.render()` 的 CPU 側耗時，可能含 driver／GPU back-pressure，不等同純 GPU 時間。預設 `renderer.info` 在 shadow 後 reset，通常只報 main pass；mesh 數也不等於 submissions。完整 pass 歸因及 A/B 方法以 [benchmark skill](skills/sagaburst-performance-benchmark/SKILL.md) 為準，舊 PR 數據不代替當前 baseline。
