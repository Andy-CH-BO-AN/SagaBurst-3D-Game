# Supercov exact per-test impact PoC

量測日期：2026-11-06（Asia/Taipei）。來源 baseline：`e927b699110d442827f32c71a30b34cba959bad0`，為開始實驗時最新的 `origin/dev`。

**Decision: GO — worth a production-design PR.** Supercov 在這個 repo 確實提供 individual-test execution provenance。代表性 #408／#409 changed-line diagnostics 分別為 **12／194 leaves**；即使加回歷史輸入中直接修改的測試，也只有 **14／196**。這兩組沒有 changed-line setup attribution，符合至少 2/3 <200 的 Strong GO 數值條件。這是設計下一個 prototype 的依據，並非現有 CI 或任意變更已能安全選到 200 以下的證明。

#407 的 92 leaves 另有 **74 個 setup identities**，不能把 setup 當作零影響，更不能將 92 當成完整、安全的 selection。這組不作為 Strong GO 的安全證據。Shared helper 仍有 168 leaves；工具也未解決 setup/init consumer policy、未執行程式碼或資產問題。

## Environment

| Field | Measured value |
| --- | --- |
| Supercov | **4.24.2**, `rust contract v1` |
| Node / npm | v24.22.1 / 11.9.0 |
| Vitest / Vite | 4.1.10 / 5.4.21 |
| OS / arch | Linux 6.18.57, GNU/Linux x86_64 |
| Vitest workers | 原設定 `maxWorkers: 2` |
| Authoritative diagnostic run | `run_22d5014a73318b1e` |

先執行 `npx --yes supercov --version`；後續固定使用 `supercov@4.24.2`。沒有安裝 permanent dependency、coverage provider 或 testpick；package/lockfile、Vitest config、reporters、setupFiles 均未修改。

官方參考：[runner support](https://supercov.com/docs/supported-suites)、[CLI](https://supercov.com/docs/cli)。以下結果以實際 CLI evidence 為準，沒有以官方宣稱取代驗證。

## Baseline、checkout 與 regression

獨立 worktree 從 `origin/dev` 建立。`npm ci` exit 0，9.820s。原 repo 的 sparse checkout 起初未包含 public assets：第一輪只有 736 leaves；補 JSON 後仍缺 `?raw`／`?url` imports，只有 737 leaves。這兩輪的 stdout/stderr/exit/timing 完整保留，但不參與 precision 或效能比較。補齊既有四貓目錄、JSON、credits 和 URL imports 後，兩個正式對照都 collection/execution 完整；沒有造假檔案、改測試或修 failure。

第一輪使用要求的 `supercov -- npx vitest run`。正式 coverage run 使用官方環境參數 `SUPERCOV_SOURCE_ROOTS=src,tests/helpers`，才能量到 shared `memoryStorage`；預設 automatic roots 只有 `src`。這只是量測 scope，沒有修改 runner discovery 或 source。

```bash
npm ci
LOGIC_TEST_VITEST_REPORT=/absolute/evidence/normal.vitest.json npx vitest run
SUPERCOV_SOURCE_ROOTS=src,tests/helpers \
SUPERCOV_RUN_ID_FILE=/absolute/evidence/baseline-id \
LOGIC_TEST_VITEST_REPORT=/absolute/evidence/supercov.vitest.json \
npx --yes supercov@4.24.2 -- npx vitest run
npm run typecheck:test
npm run build
```

| Command | Files / leaves | Assertion outcomes | Exit / qualification |
| --- | ---: | --- | --- |
| `npx vitest run` | 109 / 740 | 739 passed, 1 failed; 0 skipped/retries | 1 |
| Supercov + 同一 Vitest command | 109 / 740 | 739 passed, 1 failed; 0 skipped/retries | 1，保留 child exit |
| `npm run typecheck:test` | — | 既存 Game.ts TS6133 | 1 |
| `npm run build` | — | 同一 TS6133，未進入 Vite build | 2 |

兩邊都保留既存 CombatAttribution label failure：expected `敵方巨鷹弓兵 · T3`，actual `敵方巨鷹弓兵`。另外，直接全量 `vitest run` 仍受既有 reporter 的單 shard 500 gate 擋下（740 >500）；不是正式 Full planner/shard 通過。普通 run 有 2 個 leaf >100ms，instrumented run 有 12 個，均未放寬 gate。普通 run 最慢 156.585ms，instrumented 最慢 374.698ms。

普通 baseline 的兩個超標案例是 CaptainMissionPolicy 的 `stages the complete native army between the north gate and plaza with roads open`（156.585ms），以及 CommanderMission 的 `keeps the last HR survivor fighting after reload and restores its surviving mount without reviving a dead rider`（120.001ms）；完整檔案、名稱與 Top 10 在 evidence archive。時間是這個執行環境的觀測，不宣稱所有開發機都必然超標。

所有 gameplay/test source 與 baseline 相同；尤其 `src/Game.ts` blob 為 `9be3579c5dc0f6a68ddf9c93c95d7224121035d8`，`tests/combat/CombatAttribution.test.ts` 為 `429fd7940823239e7f5c8d909912a41677268ec3`，working bytes、HEAD、origin/dev 一致。未更新 typecheck baseline，未修 unrelated failure。

## Exact attribution 與 completeness

只讀公開 CLI，不讀取或猜測 `.supercov` 私有 schema：

```bash
npx --yes supercov@4.24.2 runs latest
npx --yes supercov@4.24.2 runs run_22d5014a73318b1e --json
npx --yes supercov@4.24.2 runs run_22d5014a73318b1e test '' --json --limit 200
npx --yes supercov@4.24.2 runs run_22d5014a73318b1e test <id> --json --limit 1000
npx --yes supercov@4.24.2 runs run_22d5014a73318b1e line src/career/CareerDuelState.ts:19 --json
```

CLI 有 response-size cap；`--limit 0` **不保證一次拿完**。每次跟隨回傳的 `pagination.nextOffset`，直到完整取得 identity list；每個 test 的 `lines` 亦核對 `totals.lines`，沒有使用被截斷的第一頁。大量查詢使用 npx 已下載的相同 4.24.2 CLI entrypoint，避免重複 npm 啟動；仍只經過公開 commands。

| Completeness check | Result |
| --- | ---: |
| 正常 Vitest collected/executed leaves | 740 |
| Supercov `role: test` identities | 740 |
| 以 `(file, full name)` 與正常 reporter 比對 missing / unexpected | **0 / 0** |
| Duplicate IDs / duplicate `(file, name)` | **0 / 0** |
| `attribution: exact` / time-based / partial / run-wide | **740 / 0 / 0 / 0** |
| 獨立 `role: setup` identities | 109 |
| 有 identity、但沒有 source-line evidence | 1 |

唯一無 source-line evidence 的 test 是 QuadrupedAssetPreload 的 `validates the four feline mount manifests, source preservation reports and baked clip contracts`：44 assertions 驗證 asset metadata/credits/URL，不執行 measured source，並非 missing identity。沒有把它當成可忽略的 asset policy。

`test.each` 每列均存在，nested describe 完整名稱亦與正常 reporter 全量相符。例如 BattleStatsTracker 的 `gates all personal squad counters…` 與 `gates all official squad counters…` 有不同 IDs：`vitest:-1152390528_0_1`／`vitest:-1152390528_0_2`，沒有合併成 registration template。

失敗的 CombatAttribution test 仍有 exact identity `vitest:1944107531_0_1`、`outcome: failed`、retry 0，以及 **57 source lines**。其他 739 passing identities 也完整存在。

Run summary 明確為 `valid: false`、`testExitCode: 1`、`complete: false`；measurement 則為 `complete: true`、0 limitations/corruptions/blockers。`complete` 也包含 structural coverage 含意，不能直接當作 leaf inventory 指標。查詢 exit 0／`ok: true` 只代表查詢成功，**不是失敗 suite 變成有效 CI evidence**。這份 failed-run evidence 僅供診斷；任何 production design 都需要另取成功、可信的 Full baseline 並預先檢查 run status。

## Selection model 與 precision

僅 union 公開 `test <id>` 回傳的 `(file, line)` execution evidence；`role: setup` 分開計數，沒有混入 leaf。Whole-file 對該 source 任意 executed location 取 union；changed-lines 對 Git diff ranges 取 union。沒有 AST/import/dependency analyzer、semantic inference、source→test manual map 或 native `tests affected` 的額外 selection semantics。

暫時 exporter/replay/union glue 合計 **78 lines**，未加入 production；可在 evidence archive 重現。只提交本報告，不提交 diagnostic scripts 或 coverage database。

| Scenario | #427 leaves | #429 leaves | Supercov whole-file exact leaves | Supercov changed-lines exact leaves |
| --- | ---: | ---: | ---: | ---: |
| CareerDuelState | 347 | 333 | **19** | **6** |
| Game | 21 | 21 | **6** | **5** |
| TownScene | 77 | 71 | **14** | **2** |
| memoryStorage | 310 | 296 | **179** | **168** |
| PR #407 source | 593 ref | Full | **93** | **92**, representative |
| PR #408 source | 543 ref | 542 | **40** | **12**, representative |
| PR #409 source | 539 ref | 538 | **254** | **194**, representative |

**Representative current-code changed-line diagnostic, not historical exact replay.** #427 使用自己的 107-file/663-leaf inventory；#429 與這次使用 109/740。因此前兩欄是歷史 reference，不是受控的同 inventory 效能比較。#429 的 #407 source-only 原生 fallback 為 Full，不能硬填一個 coverage-selection leaf 數字。

### Setup 不能藏進精準度數字

| Scenario | Whole-file setup identities | Changed-line setup identities |
| --- | ---: | ---: |
| CareerDuelState | 39 | 0 |
| Game | 3 | 0 |
| TownScene | 6 | 0 |
| memoryStorage | 36 | 0 |
| PR #407 | 83 | **74** |
| PR #408 | 74 | **0** |
| PR #409 | 73 | **0** |

這些不是 leaf，也不能當成沒有 downstream consumers。特別是武器資料和 visual state 在 module initialization 執行時，body-only union 不會自動回答所有 consumers 應跑哪些 tests。本 PoC 不實作 setup fan-out policy；whole-file 表格不是可直接投產的完整 selection。

### Synthetic ranges

在 baseline 的 detached temporary worktree，於以下 executable lines 加同行 trailing comment，使用 `git diff --unified=0` 取得精確 ranges，再 restore；沒有修改正式 branch 或建立 synthetic commit。所有 edits 不增減行數或改行為。Native affected command 會忽略 comments，因此本實驗直接查原行 execution evidence，沒有把 native semantic-impact 結果冒充 changed-line union。

| Scenario | Current function / executable changed line |
| --- | --- |
| CareerDuelState | `careerDuelOpponentHealth`, `src/career/CareerDuelState.ts:19` |
| Game | `_showDefenseCampaignResult`, `src/Game.ts:3753` |
| TownScene | `finish`, `src/town/TownScene.ts:3717` |
| memoryStorage | `setItem`, `tests/helpers/memoryStorage.ts:27` |
| #407 representative | `defaultRangerMeleeWeaponId` (`WeaponDatabase.ts:39`), `createEquipmentPoseState` (`CharacterEquipmentPose.ts:51`) |
| #408 representative | `_showDefenseCampaignResult` (`Game.ts:3753`), `TownMissionSettlement.finish` (`TownMissionSettlement.ts:89`), `TownScene.finish` (`TownScene.ts:3717`) |
| #409 representative | `careerDuelOpponentHealth` (`CareerDuelState.ts:19`), `migrateCareerHealth` (`CareerHealthMigration.ts:31`), `acceptsCareerMissionStat` (`CareerMissionState.ts:205`) |

這些是事先選定的 existing function locations；沒有試遍函式後挑最好數字。每組只診斷這個小 diff，不能推論該歷史 PR 的所有實際變更也會如此精準。

### #429 exact input provenance

輸入清單沿用 [#429](https://github.com/Andy-CH-BO-AN/SagaBurst-3D-Game/pull/429) PR body 的「Exact historical inputs」，沒有重新猜 filename，也沒有 cherry-pick implementation：

- #407 source：`src/rpg/WeaponDatabase.ts`、`src/world/CharacterEquipmentPose.ts`、`src/world/PaladinEquipment.ts`、`src/world/WeaponMeshFactory.ts`。
- #408 source：`src/Game.ts`、`src/town/TownMissionSettlement.ts`、`src/town/TownScene.ts`、`src/world/CharacterVisuals.ts`；另有 test input `tests/movement/EagleFlightController.test.ts`。
- #409 source：`src/career/CareerDuelController.ts`、`src/career/CareerDuelState.ts`、`src/career/CareerHealthMigration.ts`、`src/career/CareerMissionState.ts`、`src/career/CareerProfileStore.ts`、`src/world/NPC.ts`；另有 test inputs `tests/missions/CareerDuelState.test.ts`、`tests/persistence/CareerMissionSettlement.test.ts`。

核心表格只量 source execution，不把 changed test files 當作 source lines。額外保留直接改測試檔的全部 identities 後：#408 whole/changed 為 **42/14**，#409 為 **254/196**；#407 無 test inputs。這是診斷分項，未實作 production policy。

GLB、Markdown、asset JSON、offline tools、config 與 Node `.test.cjs` inputs 均另列為 **requires separate policy / outside this PoC**，沒有因它們 unmapped 強制 Full，也沒有把它們宣稱為安全排除。

## Correctness：五個 locations、六次獨立 focused runs

以下 A/B 都是在同一 test file 內，以 exact leaf title 的 escaped regex + `$` 分別執行；unchanged reporter 透過既有 `LOGIC_TEST_TARGETED=1` 只計執行的案例。每次實際執行 1 leaf；其餘是 Vitest `-t` 未選 registrations，並未在 source 加 skip/only 或改 discovery。

| Locations | Test A：baseline selected，單獨重跑也 covered | Test B：baseline rejected，單獨重跑也 uncovered |
| --- | --- | --- |
| `CareerDuelState.ts:19,20` | `maps ordinary Duel identity HP by faction and tier without healing injuries or zero HP` | `accepts a Recruit practice challenge against the actual Captain without unlocking formal tiers or replacing another activity` |
| `memoryStorage.ts:27,28` | `saves T5 progress, original Commander resources and active travel through real storage and settlement` | `maps ordinary Duel identity HP by faction and tier without healing injuries or zero HP` |
| `TownScene.ts:3717` | `saves town_defeated once after retry and only then permits transition` | `automatically requires a newly added formal resident without an objective flag` |

前兩列位於 `tests/missions/CareerDuelState.test.ts`，最後一列位於 `tests/town/TownConquest.test.ts`。每對 B 都 import 到相同 module，卻沒有執行被查的 function。這是 file-level selectors 無法表達的 imported-but-unexecuted sibling distinction。

| Focused run | Run ID | Child exit |
| --- | --- | ---: |
| duel-A | `run_e9413da890a85214` | 0 |
| duel-B | `run_99c7b358d33c851b` | 0 |
| storage-A | `run_d4024fe5b0fad172` | 0 |
| storage-B | `run_cce7ff25b8019041` | 0 |
| town-A | `run_aaa69ca758448258` | 1 |
| town-B | `run_e233eef01e3194c3` | 0 |

Town A 的 assertion 通過，但 149.534ms 觸發原本 100ms gate，因此 child exit 1；保留原始失敗，不重跑選最快結果。其 coverage 方向仍可查，不能視為 green gate。其餘五次 focused child exits 都為 0。

### Setup / hook evidence

- Module/init：`src/rpg/WeaponDatabase.ts:49` 回傳 `setupOnly: true`，82 個 `vitest:<file-id>:setup`，沒有普通 leaf identity。這些 setup 不能偷偷算成零 leaf impact。
- setupFiles：查 `tests/helpers/logicOnly.ts:7` 並限制 `tests/persistence/MountedSaveState.test.ts`，只得到 `vitest:-1243005017:setup`、`setupOnly: true`。
- `beforeEach`：MountedSaveState 的 hook 才建立 `MemoryStorage`；constructor line 16 歸到該檔 **4 個各自執行 hook 的 test identities**，`setupOnly: false`。沒有任意歸給第一個 leaf，但也沒有獨立 hook phase。**「all setup kept separate」在這個組合上不成立**；per-test hooks 被納入對應 leaf 的 execution evidence，module/setupFiles 才獨立。選測解讀需保留這個差異。
- repo 的既有 `.test.ts` 沒有 `beforeAll`，本 PoC 未新增 fixture 假稱已驗證該 hook。未證明的 adapter lifecycle 情境留到下一次設計驗證。

## Performance 與保存

| Measurement | Result |
| --- | ---: |
| Normal `npx vitest run` wall | **24.104s** |
| Supercov + 同 command wall | **76.037s** |
| Added wall / ratio / overhead | **51.933s / 3.1545× / +215.45%** |
| 目標 run 目錄 disk | **340,232 KiB（332.26 MiB）** |
| 量測後 workspace disk | **135,988 KiB（132.80 MiB）** |
| baseline 完成當下 `.supercov` 合計 | **888 MiB**，含兩個 sparse-checkout diagnostic runs |

效能只比較完整 checkout 後的一組連續 normal/instrumented runs；沒有挑三次中最快，也沒有將先前缺檔 run 混入。查詢/export/focused correctness 的後續成本不混入 baseline wall。完整 public CLI export 另耗時約 412s（保留先前已取得的 pages），不當作日後 production selection latency 的 benchmark。Disk 含 instrumented source snapshots；888 MiB 不是 clean single-run footprint，未虛報成單次成本。

完整 stdout/stderr、exit/timing JSON、Vitest per-case reports、CLI public JSON、Git diffs、correctness 與 78-line temporary glue 已另存 evidence archive。`.supercov/` 與 raw coverage database 未 commit。

## Decision 與後續邊界

**GO**，因為 exact identities 完整、A/B source execution 方向通過抽查，且 #408/#409 的 representative changed-lines 在保留直接修改測試後仍 <200。這回答的是 engine 能否提供有用的 individual-test evidence。

仍需另開 production-design PR 決定可信 dev Full evidence、cache/artifact persistence、Git base association、setup/init consumers、changed-line lookup、未覆蓋/新增/刪除/搬移程式碼、assets/config、Node tests、completeness guard 與 stale evidence detection。這次沒有建立任何 production selector，沒有改 CI workflows、Related ownership、500/100ms gates 或 #429，也沒有 merge。當前 baseline/run 不是 all-green；GO 不授權直接接 required CI。
