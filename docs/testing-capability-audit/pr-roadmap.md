# 後續工作包：依能力與依賴排序

這是可拆分的工作包，不預先鎖定PR數量。每包可以拆成機械搬檔、fixture整理、語意去重三類PR；不把數千行移動與刪case混在一起。Runtime 等價去重的案例刪除仍為 **0**；依資產 review 已逐案移除 **4 個 art-only cases**（Humanoid 權重、uniform scale／payload size），判定與人工 QA 場景見 matrix J4a–J4d。Runtime 行為刪除需 replacement mapping 與等價證據；資產 art-only assertion 依 #224 追加 review 逐案提供無 runtime 依賴與人工 QA 判定證據。

## PR 整合方式（使用者指定）

- 整合分支為 `codex/test-capability-audit`，本輪主 PR 的 base 為 `dev`，暫不合併。
- 後續本計畫的能力 PR 從整合分支建立；base 設為 `codex/test-capability-audit`，合併回此分支，不直接進 `dev`。
- 各能力 PR 仍獨立 review、附驗證及 replacement mapping；合入後更新整合 PR 的範圍與驗證紀錄。
- 最終整合 PR 合併到 `dev` 須另有使用者明確指示；不得啟用 auto-merge。

共用驗證 `V`：affected suites → `rtk npm test` → `rtk npm run typecheck:test` → `rtk npm run build` → `rtk npm run test:release`。每批仍需collection前後對照；不以綠燈代替語意review。腳本路徑遷移後命令同步更新。

| 次序／工作包 | 目標與前置 | tests / helpers與動作 | 必留接線、風險 | test-only與完成條件／驗證 |
| --- | --- | --- | --- | --- |
| P0 本輪文件 | 已完成資料盤點及責任草案 | tests/AGENTS、inventory、capability map、matrix、migration、roadmap | 明列AST-only、舊baseline失敗及最終重跑、unknown展開 | 僅文件/data；無測試/production/CI變更；驗收資料對齊與連結 |
| P1 Runner收斂與小批機械搬檔 | 依本輪inventory；先挑低相依的Navigation、Checkpoint等src core | 移src tests到movement/persistence/actors；Node3檔到release，先排除新release路徑再搬；每能力可各自PR | include過早收斂會漏跑src；Node/Vitest重跑；relative assets和歷史typecheck指紋 | **不是純test檔**：允許明列config/package/docs，但無gameplay；CI若需改另列。30個src全移完才收斂include；V，runner改動加smoke |
| P2 Typed fixture與生命週期 | 可先於其他包；只做具體consumer所需 | MemoryStorage/canvas、typed輕量visual fixtures與契約所需GLB loader、npcSpawnFrames、gameFixture、townCombatFixture、小型actor builders；SHARE FIXTURE | 不能把realNPC改成mock而降低保護；no import-time hooks；setup/expect失敗cleanup | test-only；至少兩個現有consumer受益、typed介面、failed-setup/partial-spawn資源正確；V；不承諾advanceUntil加速 |
| P3 Command / Formation / Follow / input ownership | 可重用P2；機械搬檔可用P1模式 | ArmyCommandSystem、FollowOrder、WeaponWheel中的routing、MountedMissionMarch相鄰order cases；commands helpers | 保留Campaign gate、Career/Personal authority、Town/Patrol政策；geometry與NPC semantics分開 | test-only；拆核心/接線、MOVE誤置leader policy、SHARE setup；所有order與mode adapter仍跑；V + `rtk npm test -- ArmyCommandSystem FollowOrder WeaponWheel` |
| P4 Combat / Damage / HP / Shield / mount | P2 event recorder與typed actor接縫 | CombatBalance、MountedPhysicalContact、MountedLanceShieldImpact、ShieldBlocking、TargetedCombatStance、CareerSkillProgression/BattleStats | 三種HP實作、overflow、friendly/self、projectile contact、HUD/event/XP；不能只留synthetic event | test-only首輪；MOVE XP到progression/integration、SHARE/必要PARAMETERIZE。先確認Game/Town真實訂閱保護，再談整case合併；V + `rtk npm test -- Combat Shield MountedPhysicalContact CareerSkillProgression` |
| P5 Equipment / input / inventory | P3 input責任；P4僅影響attack context時需要 | PlayerLoadout、DefaultMountedLoadout、ShieldEquipmentState、NPCTemporaryCombatLoadout、TownHub/WeaponShop、CareerSquadEquipment | Player/NPC/TownEquipment不同實作；rank、共享庫存、bulk原子性、save-fail不套用不可刪 | test-only；contract在每個adapter執行，schema留persistence，商店UI留integration；V + `rtk npm test -- WeaponWheel ShieldEquipmentState Loadout TownWeaponShop CareerSquadEquipment` |
| P6 Actor sourcing / Spawn / placement | P2獨立scheduler driver；受P1 runner驗收模式約束 | NpcSpawnScheduler、NpcSpawnIntegration、BattleSpawner、Town/VeteranCavalryReserve、FieldBorrowing/Deployment、OutpostGame | 每render-frame一個；global多caller、missing-only、registration rollback、readiness、ownership/清理 | test-only；core完整邊界只一份、各獨立enqueue留代表接線；V + `rtk npm test -- NpcSpawn BattleSpawner CavalryReserve VeteranField` |
| P7 Assembly / March / encounter / return | P3 order、P6 roster/actor fixture | MountedMissionMarch、Relief、CavalrySweep、CareerMission、FieldFormation/Lifecycle、MissionTravelEncounterFlow、Patrol return | 90%assemble、Player是否需到場、Captain不瞬移、2/4隊、chargeAfterFollow vs distance、save-fail、direct/physical | 首輪test-only，SHARE actor/voice/no-replay assertions、各option/input仍跑。獨立return實作若抽runtime，另開**可選production PR**並保留全部coverage；V + `rtk npm test -- MountedMissionMarch CareerOutpostRelief CavalrySweep MissionTravelEncounter TownPatrol` |
| P8 Checkpoint / restore / migration / settlement | P2 storage adapter、P6 actor snapshot、P7返回語義 | CareerMissionCheckpoint、Controllers、FieldCheckpoint、OutpostGame、CareerPersonalSquadGame/Mission、MissionSettlement、VeteranTownSettlement、兩個store | in-memory≠storage；各schema/version、HP/mount/orders/casualties/pending、claim idempotency與commit順序 | test-only：PARAMETERIZE storage contract每個adapter都跑；補必要serialized bridge後才能去重。獨立Game persistence若需共用runtime另PR；V + `rtk npm test -- Checkpoint Settlement CareerPersonalSquad CareerOutpost CareerSkillProgression` |
| P9 Town combat ownership / phase integration | P4damage context、P6ownership，P8save side effects | TownMissionCombat、OutskirtsMissionCombat、VeteranTownMissionCombat、TownPersonalSquad、TownHub、CombatAttribution | field/defense/duel/hostility不同分支；each-frame一次、hostile grids、held squads、corpses、riderless、延遲投射物、crime/merit | test-only：小型contract matrix逐adapter執行，SHARE fixture，不能只留shared helper；V + `rtk npm test -- TownMissionCombat TownOutskirts VeteranTownMissionCombat TownPersonalSquad CombatAttribution` |
| P10 Death / spectator / respawn | P4 HP事件、P7outcome、P8restore | PlayerDeathAndSpectatorCamera、InitialSpectatorMode、CareerDeathObserver、NPCNoRespawn、DuelState、Mount suites | initial spectator與death observer不同、Duel同死failure、任務繼續/返回、camera/input targetability | test-only：core camera集中、policy與transition integration保留；V + `rtk npm test -- Spectator CareerDeathObserver NPCNoRespawn CareerDuelState` |
| P11 定義/資產/環境/audio/UI/observability | 可依owner獨立進行；不要等全任務整理完 | Campaign/mission definitions、GLB/rig/LOD/socket/shadow、CareerAudioRuntime/MissionVoice、UI/PointerLock、ScenarioE/F/GHI、profiler | 保留model-specific runtime契約；art-only assertion逐案移除／人工QA，gameplay不載無關真GLB；resize fake-only case要有真實replacement | test-only優先；按capability拆多PR，SHARE loader/DOM/audio fixtures，不一包清完所有assets；V，資產路徑或browser input改動加對應smoke/瀏覽器驗證 |
| P12 Release / standalone QA promotion | Node移動依P1；manual QA先補環境證據 | tests/release3檔、smoke入口；從standalone清單選穩定QA移tests/integration/browser或assets | packaged Mac/Windows不可只驗web；手動腳本有sleep/硬編port/log-only判定；工具build guards仍留tools | 不改發布行為；tests/package/config/docs可明列。17Node cases、web、packaged兩平台smoke與case不重跑；promotion逐script完成，不把unknown當0 |

## 資產／GLB／animation 追加工作流

依 [#224 review](https://github.com/Andy-CH-BO-AN/SagaBurst-3D-Game/pull/224#issuecomment-6035596884)，此區與 P2/P11 一起納入本輪，現在開始處理，不留到整理完 mission 後才盤點。原則：**Automated asset tests verify runtime contracts, not artistic appearance.**

1. 更新 capability map、dedup matrix 與長期 tests/AGENTS，分清 runtime 契約、gameplay visual 邊界與 art-only 候選。此步只有文件，不能算資產 cleanup 已完成。
2. 盤點 Corgi/BlackCat/Horse/Humanoid 的真 GLB consumer，逐案讀 body 與实际 runtime 依賴；先用 typed 輕量 visual fixture 處理 target acquisition、movement、balance、spectator、mission flow，保留真實 NPC/Player/Mount 的受測行為與必要 integration。Fixture 修改獨立 PR，cleanup 在 setup/assertion 失敗仍生效。
3. 對資產 suites 每個 assertion 標 KEEP 或 REMOVE/manual QA candidate：parse/preload、必要LOD、runtime lookups、gameplay clip/event、instance/isolation、missing/malformed、package/manifest/path 保留；精確美術內容逐案追 caller 後決定。混合 case 只移除不具 runtime 依賴的 assertion，不能整案丟掉必要契約。
4. 語意修改獨立 PR，提供原 ID → 保留契約 ID／人工 QA 場景 mapping 與無 runtime 依賴證據；若人工 QA 未實際執行則明示。共用 loader 明示省略的內容，材質/紋理契約保留所需 payload。
5. 純搬檔另開小批 PR，機械 mapping 與 collection 對照獨立驗證。每個實作批次跑 V，fixture/assets 接線變更加 web 與受影響 desktop smoke；改善成本/穩定性須附量測，不能只因不載 GLB 就宣稱更快。

資產工作流完成條件：所有列入範圍的 consumer 與 assertion 有個案判定；必要真 GLB 契約有明確 owner；非資產 gameplay 的重載入已替換或列出保留理由；不存在僅共用 loader 卻保留無關資產成本的未處理項。完成後才進最終清理。

## 最後一支清理 PR（使用者指定）

所有本輪能力整理（包含上述資產工作流）完成、相關 PR review 並合入整合分支後，才從最新 `codex/test-capability-audit` 開出最後一支清理 PR，base 仍為該分支。清理完成並驗證後，#224 才具備最後整合到 dev 的條件；#224 合併仍須使用者明確指示。

1. 撤回 #225 的暫時設定：移除 `.github/workflows/ci.yml` 的 `pull_request.branches` 中 `codex/test-capability-audit`，保留 dev/main 與後續正式 CI 變更。僅撤回此 PR 的作用，不重設整份 workflow。
2. 刪除本輪一次性 `docs/testing-capability-audit/` 全目錄，包含本 roadmap、能力盤點、CSV/JSON inventory、baseline 快照、遷移 ledger 與驗證報告；歷史決策與證據由 Git／PR 紀錄保存，不另搬到新的暫存文件。
3. 一併清除僅供本輪測試整理使用的一次性 scripts、doc/audit 與舊拆檔盤點（包含 `tests/veteran-field-test-inventory.md`）。收尾時先列出確切清單並核對現行引用；持續使用的測試 helpers、runner、release/typecheck 工具與必要 fixtures 保留。
4. 本機屬於本輪的 ignored `output/` 與 `/tmp` 一次性腳本／logs 依清單另外清除；未納管的產物不會出現在 PR diff，也不先提交再刪除。後續臨時腳本持續放 ignored output 或 /tmp。
5. 保留 `tests/AGENTS.md` 的長期測試規則、`ai_share/AGENTS.md` 的全域入口與既有 wrappers；移除測試規範中的臨時 audit 連結、整合分支收尾後已失效的專案規則，以及其他文件／scripts 對刪除產物的引用。
6. 驗證刪除清單、剩餘引用／文件連結、runner collection、full tests、typecheck、build 與 release tests。撤回 CI filter 後，清理 PR 可能不再觸發 integration-base CI；以清理合入後 #224 對 dev 的最終 head 跑完整 web 與 Windows/macOS desktop CI（含 smoke），不能沿用清理前的綠燈。

這是整輪的必要完成條件，不在能力搬檔尚未完成時提早刪除 audit 或撤回 #225。最終對 dev 的變更應保留正式測試架構與規範，移除本輪臨時支援內容。

## 已實作批次

- [Navigation core](migrations/navigation-core.md)：4 個 suite、26 個案例完成機械搬檔；#226 已合入整合分支，web、Windows/macOS desktop CI 全數通過。
- [Collision core](migrations/collision-core.md)：從合併後整合 head `6da4b787…` 建立；3 個 suite、11 個案例完成機械搬檔、collection 對照與完整本機驗證，另開 PR review。
- #225 已補上 integration-base CI filter；其餘 src/release 遷移、fixture 整理與語意去重仍按下列依賴分批進行。

## 依賴關係與review策略

P1、P2可獨立啟動；P3/P4/P6是高重用基礎。P5依input/transaction接縫，P7依order/sourcing，P8依snapshot/return，P9與P10需跨上述能力核對。P11按較小能力平行排期即可，這不代表本輪啟動平行代理或新工作。

- **機械PR**：只改位置、imports、mock/asset路径与明确的runner設定；case/參數/assertions完整mapping一致。
- **Fixture PR**：只改準備/cleanup/typed adapters，列出仍用real implementation的consumer；若失敗訊息或成本改变，附實測。
- **Dedup PR**：只處理已有body/call-path/equivalence證據的群組；Runtime 整case MERGE/REMOVE 必須有可執行replacement ID；art-only assertion 移除須逐案符合 matrix 的無 runtime 依賴／人工 QA 判定門檻。
- **Production consolidation PR**：明示behavior scope、不同實作與adapter保護；不以clean-tests名義偷改Game/Town/Bandit runtime。

## 完成條件

每個工作包關閉時交付：更新inventory與replacement mapping、未刪的integration清單、collection前後對照、affected/full/typecheck/build/release結果、尚未驗證的平台與等價限制。若有歷史type errors，附一對一fingerprint遷移或修復證據。case數變化與速度都不是單獨成功指標。
