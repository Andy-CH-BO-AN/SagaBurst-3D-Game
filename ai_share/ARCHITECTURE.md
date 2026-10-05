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
- 老兵「守衛家園 · 老兵守城」需 5 次 Tier 3 任務勝利，解鎖後可重複接取；既有完成紀錄不隱藏或封鎖任務，各場仍以 mission ID 獨立結算。
- `TownScene` 自有 renderer、input、projectiles、城鎮呈現與玩家觀戰控制，不借用 `Game` 迴圈；`TownWorld` 管建物、障礙與場景資源，`TownRules` 管居民配置，`TownEquipment` 管可用裝備及拔出狀態，`TownCombat` 管城鎮命中。
- `TownBounds` 定義 Career Town 專用 ±350m playable／navigation bounds、700m 地面及五個固定索引的外圍 Bandit Camp。`TownWorld` 在生成 actors 前登記 scene bound；Player／NPC／Mount 建構時取得各自場景的範圍，後續任務與購買生成亦沿用，Campaign／Outpost 預設仍為 ±300m。敵城攻擊與 Veteran VI 共用擴張後 Town 地圖。舊 Bandit／Patrol 任務以相同 campId／phase／傷亡重建新路線，允許行軍位置安全重定位。
- `TownMissionCombat.update(dt, cameraYaw, elapsed)` 擁有野外、Duel 與城鎮戰鬥的角色集合、準備階段例外、敵我 grid、NPC／坐騎更新及順序；各任務保留自己的 phase 規則與 controller checkpoint。Outskirts 透過獨立 runtime participants 接入自然交火，與 mission actors 共用附近查詢及同一幀的導航預算，不併入 controller 的任務名單。模組接收明確的傷害、射擊及呈現回呼，TownScene 保留歸因與投射物管理；外部威脅駐軍由此模組登記，結算僅透過 `releaseExternalThreat` 歸還登記。
- Roaming 的個別駐軍威脅登記限非 `duty: patrol` 的 Town military；城門守軍、training 與其他 military 可反擊且不新增整補。Town Patrol 的 roaming 遭遇由 Patrol controller 擁有，combat 以該 controller 的實際參戰集合更新；既有 camp／正式任務威脅及任務借用角色依原有 combat 規則更新。
- `TownOutskirtsRules` 定義 Captain／Commander 在所有 Town runtime（含 Enemy Town Assault、Veteran VI）生成的 6×5 Bandit 與 3×10 T2 Horse cavalry；騎兵外觀及裝備取「目前 Town／world faction 的對立方」，再依玩家 faction 對應 `TOWN`／`ENEMY` allegiance。敵境可能出現玩家友軍，其 rider 沿用任務友軍保護，坐騎保持原有獨立命中規則。
- `TownOutskirtsWarfareController` 管獨立 actor identity、固定 sector route、leader／followers、每隊錯開的 0.35 秒／35m 警戒、整隊 aggro 及全滅補隊；`NPC.updateTownTravel` 巡邏不執行 combat target search。Encounter 沿用 Bandit 的 58m leash：一般 alerted 超距 returning、普通偵測不取消 returning、玩家 provoke 可取消；leader 本人死亡才取 roster 第一名存活者，失馬不另換 leader。全滅從 map edge 實際行軍進場，不逐人補員、不整補或補馬；reload 重建完整隊伍，不保存 roaming 傷亡／位置。
- 舊 generation 的 roaming NPC 完成既有死亡演出後，才從 controller actor list／ownership map 移除並 dispose；演出期間繼續正常 dead update。每次 cavalry 全滅替換將原 generation 的坐騎標記 retired：死馬等既有 dead update 完成，活馬無 NPC／Player 騎乘即可回收；Player 借騎的 retired Horse 保留到下馬，不轉成 owned mount。清理移除 mounts list 並只 dispose 一次，不新增 timer。
- Roaming 與正式任務 actors 依 faction hostility 自然互傷，正式目標／友軍的實際死亡沿原任務規則處理；roaming 本身不進 `targetActorIds`、`remainingEnemies`、mission objective／contribution roster 或 mission survivor／casualty 計數。玩家造成的有效傷害可得一般 combat／skill XP，第三方傷害／擊殺不轉為玩家軍功。可追過開放城門；普通 roaming 遇障礙維持通用 AI fallback；被正式 Siege claim 後改由 Siege 指定城門目標。
- `TownCavalryPatrolController` 管理兩隊各 20 名 `duty: patrol` residents（總 roster 225）；永久 `patrolId`／`patrolLeader` 與 runtime `activeLeaderActorId` 分開。兩隊從兵營經東／西門出城，沿 `TownPatrolRoute` 同向順時針循環。`TownMissionCombat` 以實際 actor 集合排除任務接管者，未被調用者仍巡邏；借方在下達集合命令前逐人 `relinquish`。任務結算後，Patrol 以 `RETURN_TO_BARRACKS → REFIT → REJOIN_PATROL` 接回角色：整補使用 `TOWN_SITES.barracks` 南側庭院的 40 個固定騎乘 slot（間距 4.5 公尺），與巡邏 startup 編隊座標分開；存活者實際騎乘／步行抵達才整補，死亡者以同 ID 在該 slot 恢復；原裝備、HP、盾、彈藥及原坐騎恢復後即可再次借用；兩名 T4 Captain 沿用 faction canonical mount（Roman Corgi／Viking Black Cat），其餘 38 名騎兵保持 Horse，死亡整補及 reload 不回退種類。Captain 缺席時由 runtime deputy 帶隊，Captain 實際追隊接近後才接回 leadership。`NPC.updateTownTravel` 重用 mounted／foot formation、follow 與 navigation，不執行 combat target search；`FollowTrail` 讓長列沿實際路徑轉彎。巡邏位置、waypoint 及結算後回營狀態不存檔，正常 reload 從兵營整補後重新出發。
- `TownCavalryReserve` 只填任務 authoritative roster 的既定 slot，不新增領隊或改變兵種／人數。普通池為 Training 60、Patrol A 19、Patrol B 19；依來源順序，每層先 matching 再暫換裝，不足才 temporary。兩名 Patrol Captain 是獨立、相容 mounted Captain profile 的 T4 officer pool，不能填普通 slot 或 Maki/ranger slot。Cavalry Sweep 與 Town Veteran field acceptance 共用 selection；active mission 以既有 `friendlyActorIds`／`borrowedActorIds`、位置與傷勢 checkpoint 恢復同一份 assignment，不重新挑兵。Campaign／Outpost 與 Enemy Town Assault 保持既有流程。
- `MissionTravelEncounter` 是 `BanditMissionController` 的 runtime-only 行軍中斷：剿匪／Recruit Patrol、Cavalry Sweep 與一般 Veteran field 的 `MARCHING`／`RETURNING` 共用整隊遭遇；既有 Recruit Patrol 正式接戰／續巡流程保留。首位偵測成員或有效受擊 NPC／Player 決定固定 origin，沿用 35m sensor／0.35 秒 squad broad-phase 與 58m leash；整隊取消 travel，圈外隊員實際回援，威脅清空直接從實際位置繼續剩餘 route／stage，不集合、不補兵補馬。NPC／Player 的 HP、shield impact、mount HP／死亡及致死接觸由 TownScene 同步喚醒；TownMissionCombat 只給 incidental participants 有效 roaming threat grid，後來圈外的 Player 戰鬥等本場結束再由新 sensor／hit 判斷。原 mission 接戰條件優先交回正式 ENGAGING；Town mounted march 使用 leader replacement 與無語音重播的 resume，Outpost relief 保留原死亡衝鋒規則。Victory／reward 維持原時機，RETURNING encounter 只阻擋 returnComplete／最終返城收尾。Encounter 不入存檔；原 actor positions／health／casualties/checkpoint 持續保存，reload 由現有 checkpoint 恢復後重新偵測。Town Defense／Enemy Town Assault 沒有此 field travel group，Veteran VI 直接 ENGAGING，Duel 保留自己的 runtime。
- Cavalry Sweep 與一般 Veteran field 共用 mounted assembly：存活任務 NPC 到位人數達 `ceil(存活數 × 90%)` 即保存 `MARCHING` 並沿原 march controller 出發，Player 不列入集結門檻；未到者保留原 actor／mission ownership，接收 follow 命令實際追隊，不 teleport、不刪 roster。陣亡者不列入分母，未滿門檻或保存失敗仍維持集結。
- 正式 field 任務敵軍接近時，20m 內未被任務接管的 Town military（含步／騎訓練守軍）沿既有 external threat 加入反擊；Veteran／Cavalry Sweep 的集結、行軍與交戰期間皆適用，Player 死亡不停止駐軍防衛。守軍與任務敵軍共用實際 hostile grid、melee／projectile／mount-impact 路徑，但不加入任務 roster、整補或玩家 contribution。平民與遠處駐軍維持和平；敵方 native 駐軍不享有 Player 友軍保護，正式借用者保留任務 ownership。
- 任務外圍敵軍從 Town 實際 `±350m` 邊界內側生成：Veteran field／敵境斥候增援在 `x=322m` 附近、Sweep 在 `z=-315m` 附近、四門 Siege 在各門對應 map edge 集結；敵境斥候我方與 Player 在 `z=310m` 附近出發，仍朝向敵城。整隊編隊保留安全邊距，已保存的 actor positions 沿原 checkpoint 恢復。
- Patrol 遭遇以每隊錯開的 0.35 秒 sensor、SpatialGrid 隊伍範圍查詢及整隊 alert 接入；本人 HP 傷害、盾牌實際 impact／block、騎乘中坐騎 HP 傷害／死亡及致死一擊，均可由敵對 mission／ambient／roaming source 喚醒同隊。新敵隊加入沿用固定 origin／58m leash；全滅、所有參戰敵隊消滅／disengage／超界後，參戰成員共用 `beginPatrolReturn` 回固定 slots。死亡者此時才恢復，失馬者步行抵達才補 canonical mount；失馬 Captain 保留指揮，死亡者由 deputy 接手。回營受有效命中可將同 patrolId 的 Patrol-owned 存活 `PATROLLING`／`RETURN_TO_BARRACKS`／`REJOIN_PATROL` 成員拉入新 engagement，以受擊點重建 origin、保留既有 refit destination／傷亡；mission／其他 owner 與 REFIT 排除。交戰、回營及 REFIT 均不可被任務借走；REJOIN 恢復 reserve。Ownership 沿用 relinquish／實際任務 actor 集合，戰鬥資格不要求活坐騎；中間狀態保持 runtime-only。
- 同一 Patrol lifecycle 也接受正式任務敵軍與 ambient Bandit：以實際 field／已放行 Defense／roaming actors 建立共用 threat grid，sensor 與有效 contact 都走整隊 encounter，全滅後同 ID 在固定兵營 slots 整補。Patrol-owned 成員不再被個別 external threat 接管；正式借走者維持任務 ownership。
- `TownMissionSettlement` 集中任務結果保存與返回順序：沿用 `claimCareerMission`／`clearCareerMission`，保存成功後才清理、歸還借用居民及坐騎或重建場景；保存失敗保留現場供重試。守城及清剿原地結算，其他任務依直接返回或步行返抵採取既有恢復方式，TownScene 保留結果 UI 與玩家觀戰控制。
- Home Town 原地返回亦恢復被任務敵軍殺死的非借用居民／駐軍及其 home mount、死亡 Cat，釋放 external threat 並恢復服務；未受害旁觀者保持原狀，Patrol casualties 仍由兵營 return/refit 接回。勝敗皆在 clear 保存成功後才恢復，敵境 native residents 沿重建場景處理。
- `NPC.updateTownPeace`／`updateTownTravel` 的死亡路徑持續既有 3 秒 presentation 後隱藏整個 root，不自行復活；任務／裝備面板暫停活人戰鬥時，`TownMissionCombat.updateDefeatedActors` 仍去重更新所有已死亡 NPC 與 mount，防止雙方屍體永久留在場上。
- Veteran Home Defense 的 PREPARING 讓 attacking-side roaming cavalry 保留 actor／mount／傷勢與位置，轉由 mission ownership 實際騎至 map-edge muster；停止該 roaming squad respawn。Patrol 同時 recall、101 名步兵分門部署、102 名騎兵分四隊預備；Veteran 20 秒只是最低準備時間。存活者抵達才開始（已死者不阻擋），部署／集結沿原生速度啟用衝刺與既有體力消耗／恢復，到位停止；行軍中只就地自衛、不追敵；Player 可提前滲透。Soldier Enemy Town Assault 進入新地圖時，第一次初始化即把攻守軍與平民放到部署點、關閉四門並開始 ATTACKING；同場 reload 保留實際位置與戰損，不重新部署。只有兩個正式 Siege 關門，普通 Town 保持 open。
- `TownSiegeGateClosure` 按 `TOWN_GATES` yaw 推出 closure volume 中所有 Player／NPC／Mount，不依 faction、不造成傷害／combat attribution；mounted rider 與 mount 一起移動。門口 Patrol 視為 recall 抵達，若被推出便留在城外；完整進城者不移動。四門關閉、navigation topology 更新後才 ATTACKING。
- Siege 各隊先接近自己門，近戰沿既有 NPC obstacle damage 破門，遠程在外支援；不能改走別門。每門破壞立即解除該門步兵與 cavalry reserve 的部署命令，轉為主動戰鬥（含同場 reload），攻方實際穿過本門才自由清城。Leader 死亡由同隊存活者接替。Roster 建立後所有死亡（含 PREPARING）永久計戰損，reload 保存 roster／位置／HP／失馬／準備時間／gate HP與breach／reserve release／crossing；同場 reload 不修門，結算返回恢復正常 open。缺少新 Siege state 的舊 Town War 取消回 Town，不做 migration。
- Bandit roaming squad 全滅後各自等 60 秒 runtime cooldown 才從 map edge 整隊回補；一般 roaming cavalry 仍全滅即補，被 Siege claim 者直到結束才歸還外圍生命週期。
- `CareerMissionCheckpoint` 擁有 controller checkpoint 的 5 秒 clock、立即／週期保存資格、profile clone 與同步提交，成功才重設 clock；失敗由 controller 下次提供最新快照重試。各任務保留快照生產、phase guard 及保存頻率：Bandit 的 route／傷亡立即保存，stats／騎兵位置走週期；城防時間每 1 秒、傷亡等變化立即保存；Duel 每次 runtime 快照變化立即保存。立即保存也包含當前完整快照，force 只提前已變更的週期資料，不改存檔格式。
- visual faction 與 `CombatFaction` 分開；城鎮平時不敵視 Player。首次有效犯罪先保存 hostile event，保存失敗則不施加第一擊；只在死亡／建物摧毀時保存終止狀態。自由遭遇與官方任務不等同城鎮犯罪。
- `TownEvent` 結算要求完整居民登記；玩家死亡優先。結算按 event ID 冪等，先保存再轉場；不是每個角色 HP／位置的完整快照。
- `CareerTownDialogue` 集中和平對話與 rank 選擇；`TownEquipment` 只允許已擁有且符合軍階的裝備，不把城鎮拔武器狀態寫進其他模式。

| 任務模組 | 契約 |
| --- | --- |
| `BanditMissionController` | 剿匪／巡邏與返程；借用同一位隊長，穩定 FOLLOW slots，僅正式名單納入任務歸因 |
| `CavalrySweep`、`MountedMissionMarch` | Town mounted missions 共用騎兵入口前空地的集合點；既有 actor 從目前位置集合，temporary 沿既有 supportApproach／townEntry 從 map edge 進場。集合完成即自動行軍；友軍 temporary 結算後沿既有 departure 實際騎乘／步行到 edge 才移除，結算後 reload 不重建，敵軍仍正常清理 |
| `TownDefenseController`、`TownSiege` | Soldier Enemy Town Assault／Veteran Home Defense 共用四門 Siege：固定 120 人（Assault 含 Player）、每門 30 人、T3 普通兵與四名 T4 officer；重用 203 名原駐軍與 20 名平民，authoritative roster 建立後不補員 |
| `CareerDuelController` | 借用士兵／英雄進行 1v1，保存倒數、戰鬥與結果；任務 ownership 優先，外敵解除後恢復原路；帶路角色死亡由 Captain／referee／其餘存活任務角色接手剩餘路線，全隊死亡仍允許 Player 自行返營結算，結算歸還角色 |
| `CareerOutpostMission`、`CareerOutpostLaunch`、`CareerOutpostRelief`、`EnemyTownAssault` | 跨 Town／Game 的任務啟動與恢復；從 Career 狀態重建配置，避免套用自由戰役裝備 |

任務保存名單、階段、必要死亡／統計與 checkpoint；不把重載等同新任務。借用居民不得被任務 cleanup 當臨時 NPC／Mount 銷毀。任務勝敗優先序依各 state 模組，Duel 與團體任務不共用同一玩家死亡規則。

Duel arena 由 `TownDuelArena` 在步兵／騎兵訓練區之間的 forecourt 搜尋，驗證障礙物、既有訓練站位與 navigation；無合法位置時部署失敗，不退回城外。NPC 自然走到各自站位後才進 PREPARING，Player 沿用自動就位；讀檔保留位置恢復。`TownMissionCombat` 同幀推進 Duel flow 與完整 Town runtime，Duel actors 排除於 Patrol／居民 controller，與 world actors 共用 participants／target grid，每個 actor 只模擬一次。TownScene 沿正常敵意與友軍保護路由 melee／projectile／mount contacts，受保護 rider 的 mount 也受保護。Duel opponent 可選更近外敵、受第三方傷害；Player 離開 arena 不停計時，objective／stats 仍只追蹤既有 opponent，RESULT 暫停與結算不變。

`TemporaryBattlefieldMounts` 只維護 combat-local 騎乘資格與 cleanup，不讀寫 Career profile／inventory／購買狀態。玩家用既有 mountVehicle／dismountFromMount 暫時騎乘、下馬與再騎；任務結算、失敗、放棄、撤退、回城／場景退出會解除臨時騎乘並沿用 controller cleanup。只登記本次 combat 生成或騎兵死亡後釋放的可借用坐騎，排除 owned mount 與 Town service／merchant mounts。原有駐軍坐騎僅在本次 combat 釋放後暫時允許騎乘；cleanup 保留其 Town 實體並恢復 reserved 資格，其他臨時無主坐騎清除，仍被 NPC 騎乘者依原 controller 返程／離場。永久選擇與 HP persistence 始終指向原購入坐騎，runtime temporary 標記不進存檔。

`CareerMountController` 維護單一 active mount，切換／遣返保留 HP 與死亡鎖。軍馬只有一份所有權，tier 跟隨任命軍階；舊 tier ID 由存檔相容處理。Captain／Commander 的 T4 身體替換保留運行中玩家狀態，指揮權限仍是待辦。

## 效能解讀

`Renderer Submit` 是 `renderer.render()` 的 CPU 側耗時，可能含 driver／GPU back-pressure，不等同純 GPU 時間。預設 `renderer.info` 在 shadow 後 reset，通常只報 main pass；mesh 數也不等於 submissions。完整 pass 歸因及 A/B 方法以 [benchmark skill](skills/sagaburst-performance-benchmark/SKILL.md) 為準，舊 PR 數據不代替當前 baseline。
