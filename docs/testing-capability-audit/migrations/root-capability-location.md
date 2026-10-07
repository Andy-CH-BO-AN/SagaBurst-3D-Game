# tests 根目錄：整批能力分類

基準 `b8ca01af6ebfdb5cd955f0c9f13534861fdc3bf0`。150 套／2,507 個展開案例整批移至能力目錄，root 的 townCombatFixture 同批移至 helpers。完整 source/hash/path 對照見 [file mapping](root-capability-location.csv)；原盤點 case ID 不改寫。

| 能力目錄 | suites | expanded cases |
| --- | ---: | ---: |
| `actors/` | 4 | 65 |
| `assets/` | 38 | 427 |
| `audio/` | 2 | 57 |
| `camera/` | 3 | 35 |
| `combat/` | 9 | 181 |
| `commands/` | 2 | 88 |
| `equipment/` | 10 | 170 |
| `integration/` | 9 | 174 |
| `missions/` | 17 | 326 |
| `movement/` | 11 | 142 |
| `observability/` | 7 | 34 |
| `persistence/` | 4 | 91 |
| `progression/` | 6 | 124 |
| `town/` | 24 | 567 |
| `ui/` | 4 | 26 |

只校正 module imports、dynamic import/type imports、vi.mock paths、五個 import.meta asset URLs；directory URL 的尾斜線保留，cwd-relative public/artifacts 路徑不動。除明示路徑替換外完整檔案 bytes 相同；assertions、輸入、fixture 行為、hooks、drivers、時間與 frame budgets、skip/timeout 不改。沒有新增／刪除 case、也没有 runtime 語意去重。

主要 owner 依既有責任 map 並修正明顯位置：MountedInitialHeading 放 movement；ProjectilePrewarm 的共享 render resources 放 assets；DefaultMountedLoadout 保留在 equipment，含原有 combat/save/actor 部分，後續逐案分層。真 Game/Town/caller wiring 的 integration 套件按接線能力命名，file mapping 保留舊名稱，case names/參數不改。

17 份原盤點 mixed suites 的 core/policy/integration/storage/placement 全部保留，沒有把多實作 coverage 刪掉或宣稱跨模式接線完成。tests/career 中既有八套 Field suites 仍待能力語意批次；本批只完成根目錄與 root fixture 的責任位置。

TypeScript 原版443 diagnostics／332 identities 已逐筆保存並符合 baseline。只按本批 source→target 映射 file 與相同 import 導致的 snippet/message 路徑；修正 PlayerDirectionalMovement 既有 type-only SoundManager 錯誤路徑後精確刪除一個 TS2307，預期442／331。工具、fingerprint演算法、strict與所有未映射baseline項保留，不全量 regenerate。

現行 skills/tool/shield 文件定位只校正本批路徑；dated Roman/Viking 資產驗收文件保留歷史原命令與舊位置語境。runner/include/exclude/timeout、production、正式資產、helpers 行為與CI不變。原baseline新路徑與actual diagnostics、完整196檔／2,948 cases逐案collection、affected前後2,507與遠端完整CI結果記於PR；依使用者指示，本機只驗改動涵蓋範圍，完整測試/build/release/smoke由CI保護。本文件不代替實際執行證據。
