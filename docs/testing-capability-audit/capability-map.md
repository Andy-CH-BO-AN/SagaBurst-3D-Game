# Capability map：規則擁有者與 caller 接線

基準與計數見 [README](README.md)。以下「共用」以讀過的 production 介面為依據；每個 case 的抽取證據、mock 與審閱程度見 inventory。候選群組不是刪除授權。

| 能力 | 共用模組、輸入 → 輸出／不變條件 | Core / policy 的主要責任 | 必須保留的 integration／不同實作 |
| --- | --- | --- | --- |
| A 指令輸入 | `ArmyCommandController.update/_issue`，key/wheel、target、canIssueOrder → 發令、submenu、wheel ownership | commands：input routing；`FormationMath`/`FormationPlacement`/`FormationController`：幾何、障礙物、footprint；`NPC`：order semantics | Campaign gate、Personal 可指揮 roster、Relief commands-disabled-but-wheel-enabled 都是 caller 接線；不能用純 WeaponWheel 取代 |
| A Follow | `FollowOrder` 的 local/world slot 轉換；`NPC.assignFollowTarget/setTacticalOrder` | commands：槽位、切 order 清除 Follow、暫時交戰後恢復 | `PersonalSquadRuntime` 的 Player-dead hold、`BanditMissionController` 的 leader replacement、Patrol rejoin 是不同政策 |
| B 傷害與接觸 | `DamageRouter.damageNpc/damagePlayer/damageMount`；contact + amount + context → actual HP delta、shield overflow、event、dismount | combat：formula、ShieldState、trace/sweep、三種 HP 入口、overkill、死後重複命中 | `damagePlayer` 有 spectator guard/HUD；NPC 死亡與 mount release 不同；Town/Game projectile、mount-impact caller 仍要驗證實際 target/context |
| B 事件與成長 | `CombatAttribution` 發事件；`CombatSkillProgression.resolveSkillProgressionAward` 消費 event → skill/xp | progression：source/target/method、actualDamage、structure 排除、cap/HP growth；combat：event emitter | `MountedPhysicalContact:200` 使用真實 NPC/Mount；`CareerSkillProgression:443/500` 使用簡化 HP double；不能互相當完整替代 |
| C 裝備狀態 | `InventoryManager`、`WeaponWheel`、Player input → equip/unequip、bow/shield 排他、aim/cancel | equipment：一般狀態機；NPC temporary loadout 另測自己的實作 | `TownEquipment` extends InventoryManager，但 commit、rank、allocation、drawn state 另有實作；`CareerPersonalSquad.changePersonalEquipment` 也有獨立交易路徑 |
| C 庫存政策 | `CareerInventory` quantities/allocated/available；`CareerPersonalSquad` staged clone → save → commit | equipment：Player/私兵共享數量、last-weapon、Maki 固定裝備、rank、買賣 | 商店 panel failure feedback、save-fail 不先換裝、bulk sale atomicity、schema migration 都保留 |
| D AI/空間查詢 | `SpatialGrid.findNearest`；`NPC._getTarget/_findTarget`；`ChaseTargetCoordinator` | movement：nearest/tie、2/8/16 frame reacquire、invalidation、ranged/melee、collision/navigation | TownMissionCombat 傳入哪個 hostile grid、同 frame 前一 actor 殺敵、phase 是否啟用 AI；不能由純 nearest 測試推定 |
| E 死亡/觀察 | `Player.targetable/takeDamage`、`SpectatorCameraController`；`NPC` respawn/DeathFade；Mount lifecycle | actors：三種死亡與 mount release；camera：移動與 input gate | 開場 spectator ≠ 死亡 observer；TownScene.enterMissionObserver/restore；Duel player death 優先失敗，Bandit/Veteran 有友軍存活時可繼續 |
| F Spawn | `NpcSpawnScheduler` batch/enqueue/tick/wait → 每個不同 RAF frame 最多一個 job；cancel/fail 不 ready；rollback | actors：完整 scheduler 邊界矩陣、layout/bounds/clearance | Game initial/wave、Town resident、Bandit temporary、Defense、Personal pending、Outskirts replacements 的不同 enqueue/materialization 入口各留 readiness/cleanup |
| F 借兵 | `selectTownCavalryReserve` ordered slots + residents + unavailable → 不重複且相容的 actor IDs | actors：Training→Patrol、officer compatibility、mount eligibility、slot identity | `VeteranMission` restore metadata/roster versions、caller relinquish/cleanup、僅 missing materialization 保留；Campaign roster 不是同一 policy |
| G 行軍/衝鋒 | `MountedMissionMarchController` squads/options + positions + save callback → formation/follow/charge once | missions：2/4 squads、chargeDistance/chargeAfterFollow、replace/charge leader death、voice no replay、save-fail gate | `CareerReliefMarchController` 是同一 class 的 re-export；Game/Bandit 各自組 options/roster、接 checkpoint。Relief legacy two-squad 與 Veteran four-squad 不是相同輸入 |
| G 遭遇/回程 | `MissionTravelEncounter` 共用 sensor/leash/resume；Bandit、Patrol、Personal 各自管理完成/整補 | missions：encounter contract；各 return policy 保有自己的 assertions | Patrol 回 barracks/rejoin、Personal Dismiss 回 HR、任務 Player+party 回城、direct return 都不能強行等價 |
| H Checkpoint | `CareerMissionCheckpoint.advance/persist` → 5 秒 clock、immediate/periodic/force、成功才 reset、失敗 fresh retry | persistence：helper 完整邊界 | Bandit dirty snapshot、Defense 每秒 defenseElapsed、Game VeteranOutpost schema、Personal outpost 保存仍有獨立 caller 邏輯；不是全部共用 checkpoint 實作 |
| H Storage/schema | `CareerProfileStore` 與 `SaveManager` 兩種 format；serialize→storage→load/parser | persistence：每個 schema 的缺欄位、malformed、migration、特殊 actor/mount/order 欄位 | #222 Field fixture 是 profile callback；in-memory restore 不能取代 serialized round-trip。Duel、Veteran roster v1/v2、Outpost battle、Personal pending 各留必要接線 |
| H Settlement | `TownMissionSettlement.finish/returnToTown` → claim/clear 存成功後 scene effects | persistence：idempotency、commit-before-cleanup、retry；progression：merit formula | Field/Defense/Duel/敵城 scene restart、Patrol ownership 釋放、Personal physical/direct refit、dead Player restore 分別保留 |
| I Town orchestration | `TownMissionCombat.update` dispatch 到 field/defense/duel，不同分支組 actor sets 與 grids | integration：ownership × phase × hostility contract matrix | 同一 class 不代表同一更新路徑；每個 caller 的 once-update、corpses、riderless mounts、delayed projectile source、objective/crime attribution 保留 |
| J 定義/模式 | BattleConfig、CampaignConfig/Launch/Runtime、MissionCatalog、VeteranMission、DuelState | missions：人數/tier/faction、unlock、reinforcement、勝敗與客觀 expected | 實際 Game/Town launch、accept、restore 各留代表案例；不把 expected 全改讀 constants |
| J 資產/渲染 | Horse/Humanoid/animal registries、rig/mixer/attachment、LOD/shadow；資產邊界與 gameplay actor 分層 | assets：shipped parse/preload、必要 LOD、runtime 查找的 bone/socket/seat、gameplay clip/event、instance 建立、clone mutable state 隔離、missing/malformed 與 manifest/package/path | 各模型實際依賴的契約仍各自執行；gameplay 的真實 NPC/Player/Mount 邏輯保留，無資產責任的案例改用 typed visual fixture；art-only assertion 逐案確認無 runtime 依賴後移除 |
| R Release | Node `assetPath/validateRelease/publishRelease`；Playwright smoke | release：tag/main policy、draft/retry、不 overwrite、protocol path、bundle assets | Web base path；desktop custom protocol/security preferences；packaged macOS codesign；Windows/macOS 包裝各有獨立風險 |

## 原清單之外的能力

- **Audio lifecycle**：`CareerAudioRuntime` 驗證 SoundManager 真實 ended、lazy load/cache、cancel；`CareerMissionVoice` 驗證 save/start 後才播、reload 不重播。應置於 audio 與 integration，不能把同名 Follow voice 當移動測試。
- **Observability**：RuntimeProfiler、NpcSubphaseProfiling、MainPass/Horse census、Fps sampling、FixedSceneShadowDiagnostic，驗證取樣/報表/renderer instrumentation，不是 GPU 效能 benchmark。
- **Input / UI**：PlayerInputPointerLock、BattleSetupUI3Tabs、BattleStatsView、DefenseCampaignHUD、TownPauseMenu、CareerTownDialogue、#223 新增 HeroMountTrialUI；包含 pointer lock/blur、欄位與 DOM 事件接線。Hero trial 的六個案例使用真實 UI class 與 DOM/actions doubles，不能當成 Game pause/return caller 已驗證。
- **World/structures**：Terrain clamp、Sky shadow map policy、CampaignOutpost、TownFortifications、Siege gate closure、damageable obstacle/導航重建；不能全部歸人物資產。
- **工具演算法**：AnimalQuaternion 的 Vitest case 會執行 Python `animal_quaternion.py`；仍計在 Vitest。AnimalGlbPromotion 測資產提升器的 hash/immutable bytes/evidence guards。
- **手動 QA/探針**：tools 的 browser scenarios、weapon QA、asset audits、Blender MCP smoke 與 profiling 有獨立清單；沒有假設它們都被 CI 執行。

## 資產能力追加範圍

[#224 review](https://github.com/Andy-CH-BO-AN/SagaBurst-3D-Game/pull/224#issuecomment-6035596884) 納入本輪完成條件：**Automated asset tests verify runtime contracts, not artistic appearance.**

- Runtime owner：registries、visual instance、rig/attachment、animation event、LOD 與 release paths。每個保留 assertion 要指出 production consumer 或明確失敗契約，不能因模型不同就一律永久保留目前美術數值。
- Gameplay owner：target acquisition、movement、balance、spectator、mission flow。它們需要 actor/mount/combatPosition 時，以輕量 typed visual fixture 替代無關的 GLB parse、skeleton、animation setup；不 mock 受測 AI、locomotion、傷害或任務狀態機。
- 非自動化 correctness owner：精確 duration/pose/quaternion、vertex weights、特定 metallic/roughness、runtime 未查找的 mesh/name、cosmetic clearance/silhouette、rotation-only/payload size、穿模／姿勢／美觀。預設列為 REMOVE candidate，逐案讀 body 並追 runtime 後決定；若 production 確有依賴則保留其必要契約。Test-only 整理只需 runtime 判定、保留／替代 coverage 與測試結果，不附人工 QA 場景，也不以人工 QA 為完成門檻。
- Fixture cleanup 同時檢查 Corgi/BlackCat/Horse/Humanoid consumers；共用 loader 不能視為消除 unrelated gameplay 的重資產依賴。必要真 GLB integration 明列理由與保留案例。
- 本段是追加責任與判定規則，尚未表示所有資產 body/call path 已讀完；個案證據與實作狀態由 matrix／後續 PR 更新。

## 已追過的關鍵接線

1. `src/career/CareerOutpostRelief.ts:79` re-export March；`src/Game.ts:947/2042/2077` 與 `src/career/BanditMissionController.ts:1084/1362` 建立共用 controller。Relief 領隊死 charge 與 Town leader replacement 都由 options 控制。
2. `src/world/NpcSpawnScheduler.ts:64` 的 lastFrame/activeDisposables gate；`src/Game.ts:1755/2249`、`PersonalSquadRuntime.ts:292`、`BanditMissionController.ts:983/996`、`TownDefenseController.ts:434` 為不同 materialization caller。
3. `src/town/TownMissionCombat.ts:149` 在 duel/defense/field 間 dispatch；`:336/703` 等處提供不同 hostile grid。共享 assertion 可以用，分支測試仍需各執行。
4. `src/combat/DamageRouter.ts:74/89/129` 有 Mount/NPC/Player 三個入口；`src/rpg/CombatSkillProgression.ts:46` 是 consumer。Game 的 subscription 在 `src/Game.ts:1064`，手動 stream 訂閱 fixture 不能證明此行有被呼叫。
5. `src/career/CareerMissionCheckpoint.ts` 不擁有 snapshot schema；`tests/helpers/veteranFieldFixture.ts` commit 只更新 profile。Field restore 的「reload」名稱不能提升為 storage 證據。

不在本輪抽 runtime。多個 implementation 若真的要整併，先提出獨立 production consolidation PR，保留各 adapter coverage 到新舊行為等價可驗證為止。
