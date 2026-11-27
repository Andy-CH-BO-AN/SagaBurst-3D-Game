# 區網合作（LAN Co-op）

範圍：主機權威鏡像、任務交接、客機角色／服務／軍功，以及各場景的合作行為。索引與共通規則見 [ARCHITECTURE.md](../ARCHITECTURE.md)。

## 核心原則

- **主機權威**：世界（任務、城鎮、競技場）只由主機模擬、判定勝負、寫戰況 checkpoint 與結算。客機只呈現快照、操作自己的 Player，並把自己的命中送給主機。
- **客機存檔隔離**：客機絕不寫入主機的世界狀態；寫回客機自己存檔的只有角色資料、技能，以及主機送來、帶收據的獎勵。每份獎勵都以主機 id 作收據，**只套用一次**。
- **傀儡不屬任務名冊**：客機在主機端是 `Faction.PLAYER` 的傀儡 NPC（`coopPuppet`），客機私兵也標記 `coopRemoteCommand`；兩者都不進任務 roster、checkpoint 或主機指揮（Game 只取 `_isMissionRosterActor`，否則嚴格名冊 parser 會拒收整份存檔）。

## 連線與交接

- `electron/coop-hub.cjs` 是只轉送訊息的中繼：一 host（座位 0）與最多 3 個 guest（座位 1–3），滿員以 4001、版本（`v`，`COOP_HUB_VERSION`）不符以 4002 拒絕。每個 frame 開頭一個 route byte（文字為座位數字或 `*`，binary 為座位或 0xff）：host 送出時指定目標座位或全體客機；客機只能送給主機；hub 轉送前改寫成發送者座位，hub 通知以 `h` 開頭。客機以 `key` 重連時，若原座位仍空就拿回原座位。桌面版由主程序在 `coop-net.cjs` 持有 `ws`，經 `preload.cjs` 的 `window.sagaburstCoop` IPC 提供給頁面，所以整頁重載不斷線；網頁版用 `npm run coop:hub` 直接連 WebSocket，重載後依 sessionStorage 重連。
- `CoopSession`（`CoopLink.ts`）管理連線狀態、在線座位（`peers`／`isPeer`）與訊息分派；`send(message, to?)` 預設送全體客機（客機一律送主機），listener 收到發送者座位。控制訊息用 JSON，世界快照用 `CoopProtocol` binary 格式。
- `CoopLaunch`：主機的 `launchCareerCombat` 每次啟動都廣播設定與 Career／RPG／Campaign 存檔位元組及 `sagaburst*` session；客機暫存後整頁重載，`main.ts` 在所有恢復路由**之前**處理。任務中客機的 `gameStorage()`（`src/save/GameStorage.ts`）換成主機存檔的記憶體副本，客機自己的 session 先備份、離開後還原，因此客機 localStorage **不被讀寫**。同一 launch id 不重複重載。
- 場景名單（`CoopAudience`）：戰場（`game`）帶全部客機；Town、競技場、試煉與越獄只帶 1 位隊友（優先上一個單人場景的隊友，否則最低座位），其他客機收到 `wait`，在等待畫面等主機下次出戰。名單以 launch id 存在主機 session，返城重載後沿用；名單內客機斷線後，第一個說 `hello` 的等待客機補位。`CoopHostMission` 只為名單內座位（`isCoopSeatAdmitted`）建立 slot，其他座位的訊息一律忽略。
- 場景切換：主機切換 Game／Town／競技場／試煉／越獄時宣告新場景，名單內客機跟著重載；`end` 或斷線時客機顯示返回畫面。主機從戰場返城不送 `end`，而在寫入返城存檔後以 `announceCoopTownReturn` 宣告 Town，並在 Town 就緒時以同一 launch id 再宣告；客機不再重載，只重送 `ready` 與私兵。

## 角色與模擬

- 客機 Player 由 `coopGuestPlayerSource` 從**客機自己的存檔**建立（外觀、英雄／Tier、HP、技能、裝備、坐騎），並帶入主機目前任務／賽馬狀態。場景內換裝或換坐騎只存在這一頁記憶體；技能以 `commitCoopGuestSkills` 只寫回 `skills`（逐項保留較高進度，存檔已換成別的生涯就不寫）。
- 主機先載入客機英雄與裝備再建傀儡（`lookReady`），傀儡最大 HP 用客機實際值（`applyCoopMaxHp`）；各場景以 `coopGuestCharacterAssets` 預載。
- `CoopHostMission`：每個 NPC／坐騎分配 wire ID，生成訊息帶 `NPC.networkDescriptor` 與目前武裝，武裝改變時重送。每個客機座位一個 slot（傀儡、坐騎、私兵、戰績、已送出的 actor／建物 HP），生成與快照逐座位送出，快照的客機 HP 是該座位自己的。每位客機另外收到**其他客機**的傀儡與坐騎（`partner`，只供顯示與碰撞，命中不受理）與其他客機的投射物。敵軍照一般規則鎖定並傷害傀儡。客機的命中由主機以該座位的傀儡為來源經 `damageNpc`／`damageMount` 套用。客機斷線只移除它的傀儡與私兵，戰績留著供重連。單人場景用 `guestProxy`（最低座位的傀儡）。
- `CoopGuestMission`：建出場景後移除本機 NPC 與坐騎（只留自己的坐騎），略過生成排程、任務規則、`battleController` 與 AI，由 `updateWorld` 套用快照。`NPC.updateCoopPuppet`／`Mount.updateCoopPuppet` 只負責呈現。`DamageRouter.setDamageInterceptor` 把客機 Player 的命中轉給主機，回傳結果只用於畫面回饋。客機 HP 以主機為準，**只有墜落傷害**在本機先扣再同步。投射物只用顯示用的 `ArrowProjectile`。
- 玩家之間的碰撞：各場景在本機碰撞後呼叫 `separateLocalPlayerFromPeer`（戰場用 `separateLocalPlayerFromPeers`，主機對所有傀儡、客機對 `peerBodies`），只推自己（騎乘時連同坐騎），把其他玩家視為固定，避免互相拉扯。

## 攻城車、城門與可破壞建物

- 場景以 `siegeRamps`／`siegeGates`／`siegeMirror`／`structures` 接入橋接。客機釋放自己的攻城部署（Town `releaseForCoopGuest`、Game `CampaignSiegeAssault.dispose`），由 `CoopSiegeMirror` 以 `MobileSiegeRamp.mirror` 建出顯示用車輛並外推；車輛碰撞、走道與對接通道照常加入客機 obstacles。
- 兩頁使用一致的 key：`ramp:<id>`、`gate:<id>`、`obstacle:<index>`（依建置順序）。`damageObstacle` 的 interceptor 把客機命中轉給主機，主機依自己的規則套用（Town `damageSiegeStructure`、Game `isDamageableBy`），HP 變動以 `structures` 回傳。

## 指揮權

- 任務屬於主機：主機照單人規則指揮正式部隊與自己的 HR；客機只能指揮自己的 HR 私兵。
- 客機私兵來自客機存檔（`coopGuestOwnSquad`，唯讀），由主機以 `spawnPersonalSquadActor` 生成並模擬；不帶 `player-personal` ownership，`ArmyCommandController._acceptsNpc` 一律拒絕，主機選單碰不到。客機用只操作 `CoopGuestMission.ownSquad` 鏡像的指揮控制器，命令轉送主機套用；Follow 改為跟隨主機上的客機傀儡。客機列陣 command ID 依座位加偏移（`guestFormationId`），避免與主機及其他客機衝突。

## 城鎮

- 主機的 `TownScene.start` 建立 `CoopHostMission` 並宣告 `town`；客機以 `startCoopGuest` 移出本機 actor、顯示主機鏡像。主機快照經 `NPC.live`／`Mount.live`（`LiveActorRegistry`，弱參照）收集所有 actor，不需各控制器回報；隱藏狀態以 `ACTOR_HIDDEN`／`MOUNT_HIDDEN` 同步。
- 客機在城鎮不能接任務、使用 Tab／Q 或指揮。可騎自己或本頁的馬（`keepCoopBorrowedMount`）；借馬廄馬時以 `stable:<index>` 回報，主機 `syncCoopLentHorse` 把自己那匹移出場景，歸還後放回。
- 主機開選單時，隊友在線且無結果、賽馬或退休終局，`coopWorldKeepsRunning` 讓城鎮照常模擬、只暫停主機操作；結算與返城仍等選單關閉。
- 城鎮敵對（同進退）：客機命中由 `coopGuestHitsTown` 依主機出手的同一分流處理——敵方 NPC／坐騎走 `hitFieldNpc`／`hitBattlefieldMount`，居民與城鎮動物走 `prepareDamage` → 傷害 → `activateHostility` → `persistCasualties`，所以任一方打居民都觸發全鎮追擊。`combatAllegiancesHostile` 把傀儡視為玩家方；`TownMissionCombat` 把活傀儡加入名冊、grid 與敵方對手清單，命中經 `damageCoopPartner`。`coopTeamDown`：兩人都倒下才 `player_defeated`。主機結算後送 `townResult`，客機以 `commitCoopTownResult` 寫入自己存檔（主機事件 id 為收據），客機自己未結的事件不變。
- 客機服務：`TownScene` 的 `store`／`profile` 換成客機自己的，商店、坐騎、HR、晉升、Tab 裝備照原規則，但改走 `commitCoopGuestProfile`——**只寫角色與技能，不寫城鎮世界**（指揮隊、巡邏、巨鷹駐軍、私兵部署、任務）。接任務、教學、劇情與退役對客機關閉；敵對時服務暫停（`townState`）；找服務 NPC 用主機鏡像位置（`servicePoint`）。沒有生涯存檔的客機不開放服務。

## 客機軍功（各算各的）

- 主機把客機本人與客機私兵的戰鬥事件記為客機戰績（`recordCoopGuestEvent`；Town 只在四門守城期間記錄）。主機結算保存後以 `missionMerit` 逐座位送出各自的戰績與勝負（每座位一次），客機用**與主機相同的公式**（`careerMissionMerit`；前哨用 `calculateMerit`）計算，經 `commitCoopMissionMerit` 寫入。Town 結算後 `notifySettled`，客機重讀自己存檔，避免之後的服務用舊資料覆寫軍功。
- 賽馬：`CareerRaceController.coopRacer` 推進只存在於執行期的騎手，不寫 race session 或存檔。`coopGuestWinsRace` 判定客機先合法完賽時，主機這場鎖定為 loss，送出 `raceAward`；客機以 `commitCoopRaceAward` 寫入，同一主機 session id 只發一次。

## 競技場與越獄

- 共通：計時、勝負、checkpoint 與結算只由主機執行；客機不讀主機存的玩家狀態，一律從主機旁邊起步；客機命中只限主機標記為 `target` 的對手。
- 單挑 2v1：`CareerDuelArenaScene` 宣告 `arena`；對手攻擊較近的活人（`setMissionCombatTarget`），客機命中只限對手（`canDamageOpponent`）。`CareerDuelController.coopPartnerAlive`：隊友活著時玩家死亡不算落敗。空手違規判定把隊友事件視為玩家來源，但隊友傷害不計主機戰績。城鎮內單挑場地不支援合作。
- 小隊試煉：`CareerArenaCombatScene` 宣告 `trial`；傀儡加入我方，傷害走 `damageBodyFrom`，`counts()` 把活傀儡算一名我方。客機命中只在 `fight` 階段有效。客機軍功以 `arena-squad-trial` 照單人規則計算，劇情邀請的固定獎勵只給主機。
- 越獄：同一 scene 在主機開始越獄時宣告 `prison`，客機重載跟進。客機徒手起步、不能換裝或騎乘，在主機端是一名戰俘。拾劍只是請求（`prisonPickup`），主機依自己的規則以 `PRISON_COOP_PARTNER` 寫入 `swords` 並保存，再以 `prisonState` 同步；客機只更新記憶體副本。客機逃出記為 `escapedBy: PRISON_COOP_PARTNER`。客機只以 `commitSkills` 保存技能；主機成功保存後送 `missionMerit`（`kind: 'prison-break'`，收據 `<主機任務 id>:prison-break`，與原戰役收據分開），客機只加固定逃脫軍功一次，失敗不扣。
