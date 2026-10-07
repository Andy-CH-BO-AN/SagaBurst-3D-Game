# SagaBurst 測試能力盤點與集中計畫

盤點階段的最終基準是 `Andy-CH-BO-AN/SagaBurst-3D-Game` 的 dev commit **`3cc5a2f36e7d5ffcb46856819975372f16712b15`**，盤點日期 2026-10-07（Asia/Taipei）。

盤點階段已建立全 repo runner case inventory、能力責任草案、去重矩陣、目錄與 runner 遷移計畫、PR 工作包，以及 `tests/AGENTS.md`。該階段只新增文件與盤點資料；後續實作進度另見下方遷移紀錄。

**完整收集不等於完成所有語意等價審查。** 1,857 個宣告都保留了 body、assertions、參數展開及依賴證據；其中 162 個已有人工 body 審閱，89 個另追過相關 production 接線。其餘 1,695 個的能力標籤與去向是待覆核提案。盤點階段沒有整 case 的等價刪除證明，當時未提出 runtime MERGE/REMOVE。原 inventory 與下方基準計數仍是該 SHA 快照；後續 #224 資產 review 的逐案決定（含 art-only 移除）以 [matrix](deduplication-matrix.md) 為準，不回寫原始 body／baseline 證據。後續依共用能力處理，不依 mission 或歷史 PR 逐檔清理。

## 實作進度與目前路徑

- [Navigation core 遷移](migrations/navigation-core.md)：4 個 suite、26 個 cases 已移到 `tests/movement/`；全部 assertions 保留，full suite/typecheck/build/release 驗證通過。
- [Collision core 遷移](migrations/collision-core.md)：3 個 suite、11 個 cases 已移到 `tests/movement/`；保留碰撞候選順序、幾何與世界邊界 assertions，Town 真實接線維持原處。
- 原始 inventory 保持上述 SHA 的快照；搬移後位置以 [Navigation mapping](inventory/migrations/navigation-core.csv) 與 [Collision mapping](inventory/migrations/collision-core.csv) 為準。兩批共搬 7 個 suite、37 個 cases，目前仍有 23 個 src test 檔待遷移。
- #225 的整合分支 CI 觸發修正與 #226 的 Navigation core 已合入 #224；兩支的 web、Windows/macOS desktop CI 均通過。Collision core 另開 PR review。

## 交付文件

| 文件 | 用途 |
| --- | --- |
| [Case inventory（JSONL）](inventory/case-inventory.jsonl) | 1,857 個宣告，每列含全部展開 case、原 body、主要 assertions、production 引用、mock 接縫、候選群組、動作、理由、目標 suite 與證據層級 |
| [展開 cases（CSV）](inventory/expanded-cases.csv) | 2,953 個 runner cases，各自有名稱、來源宣告、baseline 狀態與責任提案；適合篩選、排序與逐批 review |
| [檔案表（CSV）](inventory/files.csv) | 197 個 runner 檔的宣告／展開數、目標位置、人工 review 數、歷史 typecheck 診斷及來源 SHA-256 |
| [來源與 helper 證據](inventory/source-evidence.json) | 檔案 imports、suite 結構、hooks、mocks 及共用 helper 邊界 |
| [Standalone scripts 清單](inventory/standalone-scripts.csv) / [check sites](inventory/script-checks.jsonl) | smoke、手動 QA、探針、工具 guards 與 Python/shell 的執行關係；不混入 runner case 總數 |
| [Capability map](capability-map.md) | Core、policy、integration 的主要責任，哪些共用 module、哪些仍是獨立實作或政策 |
| [Deduplication matrix](deduplication-matrix.md) | 原 case → 保留／移動位置 → assertions 與模式接線；指出 setup、assertion、parameter matrix 的重用範圍 |
| [目錄與 runner 遷移](runner-migration.md) | 全部 30 個 src 測試、3 個 Node release 測試的去向，以及 discovery、imports、CI、assets、typecheck、reporting 的連動 |
| [Agent 測試規範](../../tests/AGENTS.md) | 118 行可執行規則，約束後續新增、搬檔、fixture、去重與驗證 |
| [PR roadmap](pr-roadmap.md) | 依能力、依賴與風險排序的工作包；機械搬檔、fixture 與語意去重分開 review，不鎖死 PR 數量 |
| [方法與欄位說明](methodology.md) | 宣告／展開計數、AST 與 collection 對照、inventory 欄位的證據限制 |
| [證據與待確認項目](evidence-status.md) / [baseline.json](baseline.json) | 實際執行結果、環境、失敗、review 層級、缺口與資料 hashes |

## 基準與 PR #222

[PR #222](https://github.com/Andy-CH-BO-AN/SagaBurst-3D-Game/pull/222) 已於 **2026-10-07 13:06:01 +08:00** 合併，merge SHA 為 `a61a984d953ba3b4b1d27fec209e5fe3f0b134aa`，已包含在最終基準。其 head 為 `83d3914e6c27289ba99ffd0b746f326522e05efa`。

盤點期間 [PR #223](https://github.com/Andy-CH-BO-AN/SagaBurst-3D-Game/pull/223) 又合併至 dev（13:33:27 +08:00），新增 `HeroMountTrialUI` 的 6 個測試。本輪已更新到 `3cc5a2f…`，重新收集 AST/展開案例並完整驗證。下列 totals 只使用最終 SHA，舊基準結果另列歷史紀錄。

原 `src/career/VeteranFieldController.test.ts` 已不存在；現有 `tests/career/` 的七個拆分 suites，加上搬入並重新命名的 survival outcome suite，共 **8 個檔案、54 個展開 cases**。它們只計一次。本輪接受拆分結果，不要求 #222 追加全面去重；後續按 actors、missions、persistence/integration 等責任規劃。

`tests/veteran-field-test-inventory.md` 與 PR 歷史描述中的全套通過数字，只是當時的紀錄。本次獨立執行結果如下。

## 可重現的計數

| Runner | Test files | Test declarations | Expanded cases | Skipped | Todo |
| --- | ---: | ---: | ---: | ---: | ---: |
| Vitest | 194 | 1,840 | 2,936 | 0 | 0 |
| Node `node:test` | 3 | 17 | 17 | 0 | 0 |
| 合計 | **197** | **1,857** | **2,953** | **0** | **0** |

| 原始位置 | Files | Declarations | Expanded cases |
| --- | ---: | ---: | ---: |
| `tests/**` | 164 | 1,591 | 2,626 |
| `src/**` | 30 | 249 | 310 |
| `tools/release/**` | 3 | 17 | 17 |

- `it/test.each`：271 個宣告，1,225 個展開 cases。
- `describe.each`：9 個 suite 宣告，其下 172 個 cases。
- 註冊迴圈：49 個 test 宣告，其下 213 個 cases。
- 上述軸有重疊；聯集為 **338 個參數化／動態宣告、1,434 個展開 cases**，不能將三列相加。Case body 內的 assertion 迴圈不另算 cases。
- 1,840 個 Vitest 宣告全部與 runtime collection 對上；沒有未解析的 runner 宣告或 unmatched case。Node TAP 執行確認其 17 個 cases。
- Standalone census 有 78 個 scripts，其中 46 個 JS/tool 檔抽出 243 個 assert/throw check sites；另 32 個 Python/shell 檔記錄執行關係。Smoke 的 12 個 check sites 不等於 12 個 tests。動態資產、迴圈及平台分支展開數未知，明列 unknown，沒有猜成 0 或混進 2,953。

## 實際 baseline

| 項目 | 本輪結果 |
| --- | --- |
| Vitest collection | 194 檔 / 2,936 cases，成功 |
| Full Vitest run | **2,936 pass / 0 fail**；0 skip / 0 todo，約 56.54 秒 |
| Patrol 原設定單檔確認 | `TownPatrolRefit.test.ts` 10/10 pass；作為舊失敗的追蹤紀錄 |
| `typecheck:test` | 通過；465 個歷史 diagnostics、349 fingerprints、70 檔；baseline 未改 |
| `build` | 通過；仍有 Vite bundle size warning |
| Node release tests | 17/17 pass；0 skip / 0 todo |
| Web / desktop smoke | 本輪未執行；已讀 scripts 與 workflow 接線 |
| Replacement mutation / equivalence | 未執行，0 項已證明可整 case 刪除 |

**歷史紀錄**：先前在 `a61a984…` 執行的 full run 為 2,929 pass / 1 fail；失敗是 `TownPatrolRefit` 的 Roman Captains mount death/refit/reload，約 5,964.6 ms，原設定單檔重跑通過。JSON 僅有 `STACK_TRACE_ERROR`，原因未確診。最新 SHA 的完整重跑通過不等於已找出或修復該失敗原因。詳情、環境差異與重現命令見 [證據狀態](evidence-status.md)。

## PR 整合分支

本輪主 PR：`codex/test-capability-audit` → `dev`，暫不合併。後續本計畫的能力 PR 一律以 `codex/test-capability-audit` 為 base 並合回該分支；最後整合進 `dev` 須另有使用者明確指示。詳見 [roadmap](pr-roadmap.md)。

整輪結束後另開最後一支清理 PR：撤回 #225 的暫時 CI filter，刪除本目錄及本輪一次性 script/doc/audit，保留長期測試規範與持續使用的工具，清掉失效引用，再驗證 #224 的最終版本。完整範圍見 roadmap 的「最後一支清理 PR」。

## 先做什麼

先用本 inventory 確認受影響能力的 ownership，挑小批 src core 做機械搬檔，並整理有實際 consumer 的 typed fixture。Command、Combat、Spawn 是高重用起點；March、Checkpoint、Town ownership 再沿依賴展開。

底層完整邊界矩陣集中到 core；模式 policy 保留獨立 expected；integration 保留不同 caller、phase、owner、storage、event 訂閱的接線。共享 contract 必須對各獨立 implementation 執行，expanded case 數不必下降。
