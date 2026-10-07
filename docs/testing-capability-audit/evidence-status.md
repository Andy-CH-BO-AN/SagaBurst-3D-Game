# 證據狀態與待確認項目

此文件與 [baseline.json](baseline.json) 分開保存「收集到什麼」「執行是否通過」「理解到哪裡」及「可否等價替代」。未執行的工作不列成已完成。

## 本輪已完成的證據

| 層級 | 實際完成 |
| --- | --- |
| Repository/PR baseline | fetch/讀取 dev 與 PR #222 metadata；最終基準 3cc5a2f36e7d5ffcb46856819975372f16712b15，包含已合併的 #222 及盤點期間新增的 #223 |
| Test discovery | repo tracked TS/JS AST + Vitest list + Node TAP；197 檔、1,857 宣告、2,953 展開，runner mapping 無缺列 |
| Body extraction | 1,857 宣告都有直接或同檔 helper assertion 證據；原 body/參數/來源依賴保存，不只檔名清單 |
| 人工 body | 162 宣告；逐列 review.level 可查。其餘 1,695 為 AST evidence + provisional classification，尚未逐案人工語意審閱 |
| Production path | 上述 162 中有 89 追過相關入口、caller 或 policy；主要包含 command、DamageRouter/XP、equipment transaction、spawn、march、checkpoint、Town orchestration |
| Actual run | 最新 SHA 的完整 Vitest、Patrol focused 確認、typecheck、build、Node release 全部通過；舊 SHA 的失敗另存，不與最新 counts 混算 |
| Settings/CI | package scripts、Vitest discovery/timeout、兩份 TS config、typecheck fingerprint v2，以及 ci/deploy/release workflow 的 test/build/smoke 接線 |
| Standalone | 78 檔 census；46 個 JS/tool 檔 243 個 check sites；smoke 原 body 與分支已读，其餘腳本以 AST/入口證據為主 |
| 規範 | 已先讀使用者提供的 RTK 指示、既有 .agents/.codex wrapper 與 ai_share/AGENTS；root 無既存 AGENTS，tests 無既存 AGENTS。新增 tests/AGENTS，未覆寫既有規範 |

## 最終 baseline 與歷史失敗

最終 SHA `3cc5a2f36e7d5ffcb46856819975372f16712b15` 的完整 Vitest：194 檔、**2,936 pass / 0 fail**，0 skip/todo，runner 約 56.54 秒、命令約 56.90 秒。Patrol 單檔確認 10/10 pass，runner 約 8.39 秒、命令約 8.69 秒；先前失敗 case 在本次 full run 約 2,185.13 ms、單檔約 1,152.23 ms。

舊 SHA `a61a984d953ba3b4b1d27fec209e5fe3f0b134aa` 的 full run 是 **193 檔、2,929 pass / 1 fail**，0 skip/todo。當時失敗項：

```text
tests/TownPatrolRefit.test.ts:21（collection location :23）
Town patrol return, refit and mount lifecycle
keeps both roman Captains on their canonical mount through mount death, refit and Town reload
```

舊 full run duration 約 72.38 秒，該 case 約 5,964.56 ms。JSON failure message 僅為 `Error: STACK_TRACE_ERROR` 與註冊 stack。它接近 local 5 秒 budget，且重跑變快，**只能提出負載／時間敏感性的假說，沒有足夠診斷證據確定原因**。

當時同檔原設定重跑 10/10 pass；同 case 約 1,149.4 ms，suite 約 7.725 秒、命令約 8.39 秒。兩個 SHA 的所有執行均未增 timeout、未改 workers、未 skip、未改 expected。最新 full pass 不代表已確診／修復舊失敗或證明穩定性改善。

執行環境 macOS arm64、Node v26.0.0、Vitest 4.1.11、TypeScript 5.9.3。CI 使用 Node 22，本輪不是 CI 環境重現。隔離 worktree 的 node_modules 指向原 workspace 既有安裝，package-lock bytes 一致；未執行 npm ci。舊 full run 期間曾同步執行短暫 AST 擷取；最終 full run 在 AST/collection 完成後才啟動。兩次的 typecheck/build/release 都在 full run 後依序執行，沒有把 wall-clock 差異當效能 A/B。

- 最終 Typecheck 命令 exit 0，4.58 秒；465 diagnostics 精確符合現有 baseline，並非 0 type errors。349 fingerprints、70 個 tests/helper 檔；30 個 src test 檔沒有 baseline entries。
- 最終 Build exit 0，4.70 秒；有 Vite 大 bundle warning，未改 chunk/config 來消除。
- 最終 Node release 17 pass / 0 fail / 0 skip / 0 todo，命令約 0.18 秒；只測 injected-client 工具行為，未執行正式 publish/release action。
- 最終 evidence 在 ignored `output/test-capability-audit/`；舊 SHA 在 `output/test-capability-audit-a61a984/`，含當時完整 baseline 摘要。baseline.json 保存最終摘要、資料 hashes 與 baseline_delta，不覆寫舊失敗。

## 去重前必須補的證據

| 優先／群組 | 已知事實 | 尚待確認／完成條件 |
| --- | --- | --- |
| B：damage → progression | DamageRouter 真實 emit、actual damage/clamp 與合成 event consumer 都有 cases；部分 integration fixture 自行 subscribe | 列出真正 Game/Town constructor subscription 的 executable case ID；若沒有，補窄接線測試。斷 emit／斷訂閱時應失敗，才能评估刪合成或重複流程；本輪未確認整 repo 是否已有其他接線保障 |
| H：Field restore vs storage | #222 fixture commit 只更新記憶體 profile，controller restore 保護 snapshot、identity、position、HP | 查各 mission schema 是否已有真正 store serialization/parser round-trip，逐欄建立 mapping；未找到的橋接先補，不將 in-memory reload 宣稱為 storage coverage |
| H：兩個 store | CareerProfileStore 與 SaveManager 各有技能 round-trip case | 共用 contract 必須各自 save→string storage→load；保留各 schema/version/migration/defaults。新 contract 尚未實作或做負向驗證 |
| A/G：Follow/return | NPC Follow primitive 可共用；Personal、Patrol、mission 的 leader/arrival/整補政策不同 | 完成各 caller authority、phase、Player 到場與回程完成條件矩陣；不可僅憑 Follow 名称移除任務接線 |
| F：spawn callers | scheduler 的 frame budget/cancel/rollback 已讀；Game/Personal/Bandit/Defense 為不同 caller | 對 AST-only Outpost、Field、Outskirts 等 case 逐body確認哪個 enqueue、factory、register、readiness 受保護；確認 cross-owner singleton 與部分失敗 cleanup 不被 mock 掉 |
| I：Town ownership | TownMissionCombat dispatch 有 field/defense/duel 多條路徑；free-play/Defense personal 可共享 once-update assertion | 對 Outskirts、Duel、delayed projectile、crime/merit 等尚未逐body比較的 rows 完成 adapter mapping；同 class 不能當成同 execution path |
| E：death/observer | 開場 spectator 與死亡 observer 不同；Duel 同死 failure 與 allies 勝負 policy 不同 | 補足每種 transition 的 camera/input/targetability、mount ownership、return/restore 接線清單；不得把所有 outcome 改成同一 contract |
| K：resize | ScenarioF:262 的 setPixelRatio/setSize 是測試內自寫算術，未呼叫 production resize | 找真實 resize 入口與現有保護；先有可執行 replacement 並驗證錯誤可被抓到，再決定這個 case。現在保留，不當 production resize coverage |
| K/F：測試內模擬與跨 case 狀態 | DevCombatFpsSampling:4/30、FixedSceneShadowDiagnostic:124/151 自寫公式或 setter；CharacterCombatAnimator:1036、DirectionalMovement:102 只測 Three.js primitive。BattleSpawner:216 只讀其他案例累積的 minObservedDist，初值 Infinity 也满足 >=2 | 各自確認 production caller 是否另有接線 coverage；spawn report 改為獨立 Arrange 的方案另列 fixture 工作，保留原 plan invariants。本輪只由 body 指出限制，未執行 filter/隨機順序或 mutation 實驗 |
| K：#223 Hero mount trial | 最終 dev 新增六個 UI cases；真實 UI class、stub DOM/window、mock callbacks；已讀 body、UI 實作與 Game 新接線 | 保留 nolock/locked/equipment 與鍵盤焦點政策；這六例沒有建立 Game，不能證明 query gate、pause loop 或 return-home。瀏覽器原生 pointer lock/keyboard 須另驗，本輪未執行 browser smoke |
| J：assets | GLB geometry loader 可重用；部分 loader strip images/materials；各 model/rig regression 不同 | 每模型核對 seat/socket/animation/LOD/material 的獨立 expected；GPU畫面、動畫形變、效能與瀏覽器實景本輪未驗證 |
| Infrastructure | 清單識別 MemoryStorage、canvas/GLB、Game/TownScene prototype、hidden hooks、scheduler globals 與 private spies | 選具體 consumers 改 typed seam，驗 failed setup/expect cleanup；不能只把大 fixture 包成一個更大 factory。任何加速／flaky改善需實測 |
| AST-only rows | 原body/assertions/展開均可查，標籤與 target 是保守提案 | 後續每包先讀 body、辨認 mock domain、追實際入口，再提升 review.level；1,695 個宣告未因已執行而自動視為語意已審閱 |

## 未執行、未證明

- 未做 replacement mutation 或負向等價實驗；0 MERGE、0 REMOVE 已證明。
- 未跑 web smoke、desktop unpackaged/packaged smoke、Windows 或 CI Node 22；未重新發布、包裝或 deploy。
- 未跑 coverage，也未用 coverage 百分比推論等價；未做固定環境效能 A/B 或承諾 `advanceUntil` 可加速。
- 未逐個執行 78 個 standalone scripts；工具 guard 不是獨立 runner case。部分 Python helper 由既有 Vitest case 執行，CSV 標明 parent；沒有額外重複计數。
- 未完成所有檔案逐 case 的人工語意分類；未讀到的項目留有明確 pending 標記。這份計畫不批准未審閱 cases 的語意去重。

本輪完成條件是盤點資料完整、責任提案可追證據、必要差異有保留、後續工作可 review。實際搬檔及重構的驗收由 [roadmap](pr-roadmap.md) 各能力工作包承接。
