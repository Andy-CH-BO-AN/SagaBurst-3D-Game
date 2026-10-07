# Inventory 方法與欄位契約

本資料固定對應 [baseline.json](baseline.json) 的 dev SHA。路徑與 line 是該 SHA 的來源位置；搬檔後要建立新舊 mapping，不能把 line 視為跨版本永久 ID。

## 收集方式

1. 讀取 tracked `tests/**`、`src/**`、其他 TS/JS 檔案，使用 TypeScript parser/TypeChecker 解析 test/it、describe/suite、chain modifiers、`.each`、template parameters、註冊迴圈及 callback body；區分 runner imports 與同名 fixture 物件。
2. 解析檔案 imports、mock/spy/global calls、before/after hooks。使用 scope symbol 尋找同檔 helper、setup 與 describe.each adapter table 引用，另外抽取 dynamic imports 及資產路徑；解析 tests helper imports 以記錄間接 production 依賴。多行 test 宣告及 helper 內的 expect 都保留。
3. Vitest 使用真正的 `list --json --includeTaskLocation` 收集名稱與展開數，依 `(file, declaration source span)` 對回 AST。所有 collection rows 恰好對到一個宣告；全部 Vitest 宣告都有 collection rows。
4. Full run JSON 的 suite/name 與 collection 一對一對照，保留各展開 case 的實際 status/duration。Report 的 `numTotalTestSuites` 包含 describe blocks，不能拿來當 test files；files 使用 `testResults` 與 AST 檔案集合。
5. Node release 的三個檔案由 AST 識別 17 個宣告，再以 Node TAP 實跑確認 17/17；没有參數註冊展開。未將 Node 檔交給 Vitest。
6. 另外讀 package scripts、Vitest/TS 設定及全部 workflows，核對實際自動驗證入口。對 standalone scripts 記錄 check sites 與使用方式，不能把工具錯誤 guards 都當測試。
7. 每個宣告依 scenario、assertions 和檔案領域提出多能力 tags、candidate group 及責任位置；混合 suites 有逐 case 分流。人工 body/call-path 審阅決策覆蓋自動分類。未審閱的分類只是篩選提案，不能據此刪除或搬走接線 assertions。

早期 parser 曾把 `TownOutskirts` 中名為 `test` 的 fixture 呼叫誤計為宣告；最終資料已更正，並以完整 runtime collection 對照驗證。發布數字只使用最終 1,840 個 Vitest 宣告。

## 單位

- **File**：向 runner 註冊至少一個 case 的來源檔；helpers 與 fixtures 不算。
- **Declaration**：一個來源 test callback；`.each` 或外層迴圈重複註冊時仍是一個來源宣告。
- **Expanded case**：runner 可獨立執行、報告狀態的案例。不同 describe.each/input 的同一宣告各有自己的 row。
- **Check site**：standalone 的 assert/throw source 位置。它可能是工具 guard、條件分支或迴圈中的檢查；本輪沒有把其 runtime 展開猜成 cases。
- **Skip/todo**：收集與實跑結果核對，本基準兩個 runner 均為 0。不能以少跑某套 tests 來降低總數。

## Case inventory 欄位

`case-inventory.jsonl` 每行是一個 declaration；其 `expanded_cases` 包含所有 runner cases。`expanded-cases.csv` 將這些 cases 平鋪，JSON 型欄位在 CSV 中仍以合法 JSON 字串表示，請用 CSV parser 讀取，不要按逗號手動切割。

| 欄位 | 意義與限制 |
| --- | --- |
| `id`, `file`, `line`, `end_line` | 原始 `file:declaration-start-line`；同檔每個宣告唯一 |
| `declaration_name`, `suites`, `modifiers` | 原標題及 describe/each context；不是人工補寫的測試結果 |
| `parameter_source`, `generation_loops`, `expanded_cases` | 來源參數、註冊方式，以及真實 collection 的展開名稱／位置／執行結果 |
| `observable_behavior` | scenario + 原始 assertions + 可追到的同檔 helper assertions；人工解讀見決策矩陣。並非只看檔名推斷 |
| `production_entrypoints` | 直接 production symbols、經 helper 的引用、body 中 act calls、resource references 與入口限制 assessment；setup/cast/spied instance 也可能產生引用，靜態依賴不證明方法真的執行。資產 bytes contract 不必有 src 入口，toy arithmetic 也不應假裝有 |
| `real_modules` | `candidates` 是靜態候選；`verified_call_paths` 是已閱讀的相關來源。不能將整個 imported module 標成每個 case 都使用的真實實作 |
| `mock_seams` | module mock、case/hook spy/global、helper mocks。結構化物件、依賴注入 factory 等 doubles 另由 `test_body`、`referenced_helpers` 判讀；不假設不存在 vi.mock 就完全真實 |
| `capabilities` | 可多標籤，scenario/assertion 關鍵詞先協助篩選；不是已批准的 module ownership |
| `mode_or_mission_conditions` | suite context、原始參數及所有展開名稱；特殊 policy 是否能合併須讀 body/call path |
| `candidate_duplicate_groups` | 候選入口而非等價證明；群組前綴對應 matrix 能力族，可能跨多個子群。空陣列表示尚未分派候選，並非已證明沒有重複 |
| `action`, `reason`, `target_suite` | 保守分類／已讀 body 的具體提案。路徑尚未建立，禁止自動搬檔或刪除 |
| `replacement_case`, `retained_assertions` | 本輪 replacement 指向原 case，所有原 assertions/inputs 保留；PARAMETERIZE 也保留全部 adapter，沒有假設新 suite 已存在 |
| `review` | body 審閱、call-path 閱讀、replacement 驗證分開；全綠與 AST extraction 均不提升為語意等價證明 |
| `test_body`, `referenced_helpers`, `helper_modules` | 原始 callback 與所用 helper 定位，供下一輪直接查證，不需憑標題重找 |

## Review 分級

| `review.level` | 宣告數 | 能做／不能做的判斷 |
| --- | ---: | --- |
| `AST-body-extracted; semantic-review-pending` | 1,695 | 已抽原 body/assertions/依賴、比對展開；分類可覆核，尚未逐 case 人工解讀，禁止視為已證明去重 |
| `body-reviewed` | 73 | 已讀主要 scenario 與 assertions；production call path 或跨案等價仍待確認 |
| `body-and-call-path-reviewed` | 89 | 已讀 body 與相關 production 接線；不代表每條分支或每個 assertion 都做過 mutation |
| replacement equivalence proven | 0 | 本輪沒有 MERGE/REMOVE 可依賴的等價實驗 |

人工 body 閱讀總數為 73 + 89 = 162。各級數字按 declaration 統計，不能與 expanded cases 相加。162 裡包含 17 個 Node cases。Body/production 詳讀的代表群組列在 matrix；其餘逐 case 的 `review` 是準確狀態來源。

## 重現命令與證據位置

從基準 checkout 執行（本輪用已安裝且 lockfile 一致的 dependencies；未聲稱全新安裝）：

```sh
rtk proxy node node_modules/vitest/vitest.mjs list --json=output/test-capability-audit/vitest-list.json --includeTaskLocation
rtk proxy node node_modules/vitest/vitest.mjs run --reporter=json --outputFile=output/test-capability-audit/vitest-run.json --includeTaskLocation
rtk proxy node node_modules/vitest/vitest.mjs run tests/TownPatrolRefit.test.ts --reporter=json --outputFile=output/test-capability-audit/patrol-refit-rerun.json --includeTaskLocation
rtk npm run typecheck:test
rtk npm run build
rtk proxy node --test --test-reporter=tap tools/release/asset-path.test.cjs tools/release/publish.test.cjs tools/release/validate-tag.test.cjs
```

最後一項與 `test:release` 的三檔 glob 同集合，只另外指定 TAP reporter。執行前需存在 `output/test-capability-audit/`。這些命令重現收集／執行，不會自動重建人工 matrix。

原始 logs、runner JSON、AST 及暫時 extractor 留在本次工作的 ignored `output/test-capability-audit/` 與暫存區；沒有把一次性工具加入 production 或 package scripts。交付的 inventory 是固定 SHA 快照，hashes 存於 baseline.json。重新盤點其他 SHA 時應重跑收集、重建 source mapping，再逐項覆核人工決策，不能只把本檔 counts 改掉。
