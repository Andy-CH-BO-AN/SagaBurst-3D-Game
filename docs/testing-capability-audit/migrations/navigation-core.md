# Navigation core：第一批機械搬檔

分支從整合基底 `0c15438523bd3011bcff36fc745dc092771243d8` 開出，PR base 為 `codex/test-capability-audit`。本批只移動四個導航 suite 並更新相對 imports，保留全部 26 個宣告／展開案例。

## 責任與來源對照

| 原位置 | 現在位置 | Cases | 保留的主要責任 |
| --- | --- | ---: | --- |
| `src/navigation/ChaseTargetCoordinator.test.ts` | [ChaseTargetCoordinator](../../../tests/movement/ChaseTargetCoordinator.test.ts) | 3 | 同 4m 群組共用查詢、不同群組分開、死亡 target 失效；真實 coordinator/SpatialGrid，最小 NPC 資料替身 |
| `src/navigation/NavigationGrid.test.ts` | [NavigationGrid](../../../tests/movement/NavigationGrid.test.ts) | 11 | 網格座標、障礙、A*、blocked start、不可穿角、動態開路、workspace 重用、Uint32 stamp reset、bounds |
| `src/navigation/NavigationPathFollower.test.ts` | [NavigationPathFollower](../../../tests/movement/NavigationPathFollower.test.ts) | 5 | direct/path/unreachable/pending、topology 更新後重新規劃；真實 NavigationWorld/Grid |
| `src/navigation/NavigationWorld.test.ts` | [NavigationWorld](../../../tests/movement/NavigationWorld.test.ts) | 7 | 障礙 topology/revision、connected components、path cache、每 frame A* 預算、breach、blocked-cell projection |

逐 case 的原 ID → 新 ID、完整名稱與保留策略見 [navigation-core.csv](../inventory/migrations/navigation-core.csv)。全部動作為 MOVE，沒有 MERGE/REMOVE。

原 inventory 與 baseline.json 是 SHA `3cc5a2f…` 的歷史快照，不改寫其來源路徑、hash 或當時的 review counts；本 ledger 記錄後續位置與本批 body/production 閱讀。這四個 suite 原本沒有歷史 typecheck baseline entries，因此無 fingerprint 遷移或豁免增加。

## 等價範圍

以 TypeScript AST 找出 imports，確認每個相對路徑仍指向原 production module。將 module specifier 正規化成 repo 路徑後，四份檔案的完整內容逐 byte 相同；測試 body、helpers、assertions、expected、case 名稱及行號都保留。

完整 Vitest collection 的 `(file, case name, line, column)` 套用四個路徑 mapping 後完全一致；不是只比較總數。沒有漏跑、新增重複、skip/todo 或 focused-only cases。

本批未抽 fixture、未改 gameplay、runner、scripts、CI、TS 設定或 typecheck baseline。`tsconfig.test.json` 已涵蓋新目錄；仍保留 src discovery，因為還有 26 個 src test 檔待後續批次處理。Town、Patrol、Campaign 及 mission 接線案例均保留原處；本批 core 測試不能替代這些 caller coverage。

## 驗證

| 檢查 | 結果 |
| --- | --- |
| 搬移前／後 affected suites | 各 4 檔、26/26 pass |
| 搬移前／後完整 collection | 各 194 檔、2,936 cases；逐列 mapping 一致 |
| 搬移後 full Vitest | 194 檔、2,936/2,936 pass，0 skip/todo |
| `rtk npm run typecheck:test` | 通過；465 個既有 diagnostics 符合 baseline，baseline bytes 未變 |
| `rtk npm run build` | 通過；既有 bundle size warning 仍在 |
| `rtk npm run test:release` | 17/17 pass |
| Source/設定差異 | 只變更四個測試的位置與 imports；production、runner、package、TS/baseline 未變 |

環境沿用盤點時的 macOS arm64、Node v26.0.0、Vitest 4.1.11、TypeScript 5.9.3 與已安裝 dependencies。本機未執行 web/desktop smoke；本批沒有修改 browser、asset 或封裝入口。未做效能 A/B，也沒有語意去重或 mutation 主張。

原始 collection、runner JSON、命令 logs 與 canonical-source 比對在 ignored `output/test-navigation-core/`。以下可重現 affected 與完整驗證：

```sh
rtk npm test -- tests/movement/
rtk npm test
rtk npm run typecheck:test
rtk npm run build
rtk npm run test:release
```

提交本批時，既有 CI 的 pull_request base filter 只列 dev/main；整合分支的觸發條件以另一支 CI PR 處理，不混入本次機械搬檔。
