# Collision core：碰撞與幾何查詢搬檔

本批從已合入 #225、#226 的整合 head `6da4b787b6cca2fff69a0d9dad987f79cf2dd898` 開出，PR base 為 `codex/test-capability-audit`。三個 suite 的 11 個宣告／展開案例全部 MOVE 到 `tests/movement/`，只修改相對 imports。

## 責任與來源對照

| 原位置 | 現在位置 | Cases | 保留的主要責任 |
| --- | --- | ---: | --- |
| `src/world/EntityCollisionBroadPhase.test.ts` | [EntityCollisionBroadPhase](../../../tests/movement/EntityCollisionBroadPhase.test.ts) | 4 | 與原 all-pairs 結果一致、anchored/障礙物推擠、跳過不可能碰撞的 pairs、推擠後更新 grid membership |
| `src/world/ObstacleCollisionSpatialIndex.test.ts` | [ObstacleCollisionSpatialIndex](../../../tests/movement/ObstacleCollisionSpatialIndex.test.ts) | 4 | 近鄰篩選仍保留來源順序、跨 cell 去重、共享陣列長度變動重建、負座標查詢 |
| `src/world/Terrain.test.ts` | [Terrain](../../../tests/movement/Terrain.test.ts) | 3 | 連續 body/nav 障礙與 projectile solids 差異、射線穿隙／命中、300m actor bound 與 640m terrain |

逐 case ID、完整名稱及保留策略見 [collision-core.csv](../inventory/migrations/collision-core.csv)。三個 suite 都使用真實 production 模組和 Three.js 幾何資料，沒有新增 mock 或抽取 fixture；所有 helpers、assertions、expected 及案例名稱原樣保留。

`Terrain` 的兩個 projectile 案例驗證共用障礙幾何，不替代武器命中、傷害、HP 或 event 接線；本次先保留既有 suite 邊界。`EntityCollisionBroadPhase` 的 all-pairs oracle 驗證候選排序／篩選等價，沿用真實 `resolveEntityCollision`；不把它宣稱為獨立碰撞公式證明或效能 A/B。

已讀三個 test body、兩個 index 模組、Terrain 相關幾何／推擠入口及 Game 的 collision caller。Game 如何選擇 Player/NPC/Mount、NPC 如何使用 projectile LOS，屬 caller 責任，沒有以 core coverage 取代。

[TownFortifiedCity](../../../tests/TownFortifiedCity.test.ts) 的真實城門開關、body/projectile 阻擋與同數量障礙物 topology swap 接線保持 byte-identical；Town、NPC、Mount 等其他 integration 也沒有搬移或刪除。Array length 變動的 core case 與同數量 gate swap 不是重複規則。

## 等價與 runner

- 用 TypeScript AST 找出 import specifier，確認新相對路徑指向相同 production 模組；正規化 imports 後，三份檔案的完整內容逐 byte 相同，行號不變。
- 完整 Vitest collection 的 `(file, case name, line, column)` 套用三個路徑 mapping 後逐列相同：194 檔、2,936 cases，沒有漏跑或新增重複。
- 原 audit inventory 及既有 navigation ledger 保留歷史快照；本批新增獨立遷移 ledger，不改寫舊 review counts 或來源 hashes。
- 這三個 src suite 沒有歷史 typecheck baseline entries；baseline bytes、fingerprint 演算法、TS/runner/package/CI 設定均不變。
- 本批後仍有 23 個 src test 檔，繼續保留 src discovery。沒有 MERGE/REMOVE、語意去重、production 或 gameplay 變更。

## 驗證

| 檢查 | 結果 |
| --- | --- |
| 搬移前／後 affected suites | 各 3 檔、11/11 pass |
| 搬移前／後完整 collection | 各 194 檔、2,936 cases；逐列 mapping 一致 |
| 搬移後 full Vitest | 194 檔、2,936/2,936 pass，0 skip/todo |
| `rtk npm run typecheck:test` | 通過；465 個歷史 diagnostics 符合原 baseline |
| `rtk npm run build` | 通過；既有 bundle size warning 保留 |
| `rtk npm run test:release` | 17/17 pass |

本機環境為 macOS arm64、Node v26.0.0、Vitest 4.1.11、TypeScript 5.9.3。原始 collection、runner JSON、命令 logs 及 canonical source proof 存於 ignored `output/test-collision-core/`。本機未執行 web/desktop smoke；本批未改 runner、assets 或封裝入口，遠端 CI 結果另以 PR checks 為準。未執行 mutation 或效能實驗。

```sh
rtk npm test -- tests/movement/EntityCollisionBroadPhase.test.ts tests/movement/ObstacleCollisionSpatialIndex.test.ts tests/movement/Terrain.test.ts
rtk npm test
rtk npm run typecheck:test
rtk npm run build
rtk npm run test:release
```
