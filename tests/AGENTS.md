# 測試工作規範

適用於自動化測試的新增、修改與刪除；沿用 [專案規則](../ai_share/AGENTS.md) 與使用者指示。

## 硬門檻

- 測試只放 `tests/`，不得新增 `src/**/*.test.*`／`*.spec.*`。
- 全庫最多 **1,000 unique leaf cases**（Vitest＋Node 合併，each／動態生成／多實作 contract 每列均計入），優先目標 **500–600**。
- 每個 leaf 最多 **100ms**，含 beforeEach／afterEach／onTestFinished 與案例專屬 cleanup，以不受 fake timers 影響的單調時鐘量測；通常應低於 70ms。timeout 或 slowTestThreshold 不能取代預算驗證。
- Import／collection、setupFiles、beforeAll／afterAll 與整套 wall time 另外記錄；不得把案例成本藏進共用初始化或 cache。

## 新增前：找 owner、決定要不要加

- Case 依 **Production Decision Owner 與 Failure Mode** 歸屬，不依 Bug 場景、Task／PR 編號、第一個 import 或檔名。依序確認「行為契約 → 易錯決策與模組 → 真實 caller → 可觀察的失敗 → 最小必要層級」，再找既有 owner suite；沒有合適檔案才新增 suite。
- 一般 feature 新增 0–2 個既有測試未保護的重要案例，0 是合理結果；超過 2 個須說明各自保護的不同契約，不展開排列組合，不以案例數增加當成果。
- 核心 owner 保護演算法與 failure mode；caller 只驗資料傳遞、授權、失敗處理、副作用順序與 cleanup，不重跑核心矩陣。
- 優先保護：無法遊玩、取消與 rollback、資料損壞、存檔交易、ownership、重複結算、有效命中與死亡、指揮資格、導航可達性、必要容量邊界。

能力邊界範例（辨識責任用，非固定路徑）：

| Owner／能力 | 應保護的契約 |
| --- | --- |
| `NavigationWorld` | 共用 A*、FIFO、拓樸與 footprint 失效；不收容各場景入口配置。 |
| `TownLayeredNavigation` | 攻城接牆入口、升降與雙向路線。 |
| `TownCommandWatchtower`／`TownArchitectureSpecs` | 各自建築的通行、入口與室內容量。 |
| `RiverCrossingBattlefield` | 河流、橋樑、岸邊部署與落水，不同 failure mode 分開定位。 |
| `TownResidentLayout`／`CareerDuelState` | 居民與坐騎共同佔位／Duel 場地與任務選址。 |
| `PersonalSquadCommandRouting`／`PersonalSquadRuntime` | 指令選擇、授權與回饋／已招募名冊的部署、Follow／Dismiss、返回 HR、登乘及 restore。 |
| `OnDemandAssets`／`HighTierEquipment` | loader、timeout、abort、retry／高階裝備預載結果的原子發布。 |
| `InventoryManager`／`NPCEquipmentLifecycle`／`GameInventoryLifecycle` | 玩家換裝、存檔及需求／NPC 採用裝備、格擋及 demand／dispose／Game 的 inventory 替換與退出 caller。 |
| `CareerRetirementPersistence`／`…Mobilization`／`…Finale` | 持久化、集結、結局結算分開放，不因同屬退休功能混放。 |

## Regression 設計

- 先寫**可觀察的行為契約與失敗模式**，不照實作抄 expected。跨模組、非同步或生命週期修改，簡短盤點「入口 → 決策 owner → 正式 caller → side effects／存檔 → 替換／退出 cleanup」；純函式小改動免。
- **Helper／Service 通過不等於遊戲已修好**。跨 caller 邊界的改動至少要一個執行真實 production caller 的輕量案例；可隔離場景／網路，但不代做受測 caller 的決策。
- 不同失敗原因（Save/Load、非法權限、格式拒讀、寫入失敗、非同步取消、部署容量、投射物遮擋、落水死亡…）須能獨立定位。**同一不可分交易**可多個 assertions，**同一契約**可少量資料變體；不用大型 `it` 或迴圈藏多個不相干失敗，也不為守 case count 刪重要斷言。
- 存檔測試只用現行 writer 或完整現行 fixture，驗證往返、任務／HP／傷亡／坐騎／兵權保留、結算不重發與寫入失敗重試。歷史或不支援格式只驗拒讀、保留原始 bytes、不自動重存／刪檔；不保留歷史轉換類案例。空手、未騎乘、無任務、無 checkpoint 都屬現行輸入。
- 可設定預算（A*、scheduler）由測試自訂 n：同 frame 最多 n 筆、第 n+1 筆保留、下一 frame 繼續、重複 timestamp 不重複耗用；不寫死 production 數值。

### 三種壞測試

新增或 review 時逐一自問；不成立就改寫或刪除，不以補 assertions 掩蓋。

- **套套邏輯**：expected 抄自實作（常數等於其字面值、同公式重算、只斷言自己的呼叫發生、首次即接受的 snapshot）。自問：**除了「程式碼長這樣」還說了什麼？**
- **對結構過度敏感**：讀 source 斷言文字、斷言私有欄位名、以 `Object.create(X.prototype)` 組裝重型 class、已有可觀察結果仍用 `mock.calls[i][j]`。自問：**只重構不改行為，會紅嗎？**
- **不可能失敗**：double 接受一切（AudioContext 永遠 `running`、module mock 讓相鄰決策恆回 `true`）。外部邊界的 fake 須遵守真實規則、違反時 throw。自問：**正式環境的壞法，這裡可能發生嗎？**

## 非同步、資源與生命週期

- 區分**唯讀查詢**與**改變狀態的操作**：查看 UI／狀態不得暗中建立 demand、啟動載入／重試或改 ownership；測試要抓得到這類副作用。
- acquire／subscribe／create 須在正式 caller 找到對應 release／dispose，涵蓋**換裝、替換物件、切換場景、初始化失敗與離場**；不能只手動呼叫 Service dispose 就宣稱 Game 會清理。共享資源時一個 owner 離開不得誤釋放他人。
- preload／request／retry／timeout／abort／dispose 用 fake timers、可控 deferred Promise 與窄 loader double 驗**延遲與亂序完成**：過期結果不覆寫新結果、不誤清新 request、owner 離開後不通知、已 dispose 不被復活。非必要預熱失敗不阻塞場景，未就緒資產不提前生效。
- 部分載入失敗不發布半成品、寫入失敗不暴露半提交狀態；成功、拒絕、重試、失敗回復都要測，以可觀察狀態驗證。
- **不得為了讓 double 過關而削弱 production**：不吞必要錯誤、不加假 fallback／test-only 分支或 reset API。重要邏輯困在重型 constructor 時先找現有小入口，確實沒有才做保持行為的最小抽取，且正式 caller 必須真的使用。

## 不測的東西（重型內容）

- 不建立 Scene、Group／Object3D 假場景、Mesh、geometry、material、texture、skeleton、rig、AnimationMixer；不呼叫 TownWorld／城牆／地形／戰場 builders；不建立會初始化模型的 NPC、Player、Mount、TownScene；不解析或 preload 真實 GLB／GLTF／FBX／貼圖／動畫。
- 不測 LOD 外觀、握姿、材質、陰影或需目視判斷的品質，也不用數值姿勢或 synthetic skeleton 補回。動畫事件、LOD 選擇、資源狀態只測數值與狀態。
- 不做 layout 測試（窄 viewport、解析度矩陣、breakpoint、HUD 座標、間距、遮擋、固定 pixel）；仍保護桌面 UI 行為：點擊、分頁、選擇、禁用、輸入傳遞、存檔失敗重試、dispose 後不執行過期 callback。
- 可以測：資料 model、Career profile、save/state、IDs、roster、數值、Map／Set、合成導航圖與碰撞資料；Vector3／Quaternion／Box3 可當數學資料。不得全面 mock Three.js 或另造測試引擎假裝合規。
- `integration/`、`assets/` 或其他 runner 不是例外。Web／Desktop release smoke 只做啟動與封裝，不套 100ms，也不收容被刪案例。

## Fixture、隔離與型別

- 直接呼叫真實 production 邏輯並使用獨立 expected；不複製演算法、不從受測輸出讀答案、不 mock 受測決策。
- 用 typed fixture、`Pick` 或命名 adapter，只給 caller 需要的欄位；不建萬用假 Game／TownScene。Fixture 只準備依賴，不暗中完成受測轉換；storage、network、DOM、audio 等外部邊界可用窄 double。
- 每 case 一個行為，名稱說明 scenario 與結果；優先斷言公開狀態與輸出，副作用順序是契約時才驗順序。Regression 必須在錯誤行為下失敗，不能只檢查有呼叫或沒 throw。
- 時間相關用注入時間或 fake timers 驗臨界前後；不 sleep、不改 production cadence、不放寬 timeout、不跑完整巡邏／戰鬥流程。非同步工作須 await。
- Fixture 擁有並還原 globals（原 descriptor）、timers、mocks、listeners 與排程工作；以 afterEach／onTestFinished／try-finally 確保斷言或 setup 失敗仍 cleanup。借用資源由原 owner 釋放。
- unsafe cast 限縮於單一接縫；不新增大量 `as any`、`@ts-ignore`、關閉 strict 或擴大 typecheck baseline。刪改案例後同步移除失效 baseline 項目，不重建 baseline 或改 fingerprint。

## 刪除、搬移與防規避

- 可直接刪：低價值 getter／常數、文案／樣式、純外觀、淘汰功能、同 failure mode 重複案例、純歷史格式遷移、已退役 owner 的案例。
- 搬移／刪除前核對「原案例與 assertions → 保留案例 → production consumer」，不只比名稱或 leaf 數。保留正例及真正不同的權限、原子性、重試、存檔損壞、臨界邊界與正式 Game call path 的唯一 regression；不要為省數量刪近期修復的 regression。把 200 行的 `it` 搬到正確檔案不等於整理完成。
- 重要邏輯刪改需指出保留的 owner 與測試，沒有等效保護就明列風險；低風險重複以 suite／能力說明取捨即可。
- 加速優先刪重複昂貴 setup、縮小輸入、共用無狀態 pure fixture；不把成本移到 beforeAll／setupFiles，不為求快 mock 受測邏輯。不為每個 faction、tier、方向、武器或任務重跑同流程；大量資料只在容量本身是風險時保留，且不生成實體 actors。
- 有 case 達 70ms 時，新增前先盤點該 owner 覆蓋，優先淨減與縮小 fixture；不可替代的新案例在 PR 說明成本與風險。
- **禁止**：skip／todo／only、縮小 discovery、改副檔名、搬到 hidden／legacy／slow／manual 或其他 runner／smoke、拆多次執行、把多個 scenario 塞進一個 `it` 或迴圈；不得用 retry、平均、百分位、慢案例 allowlist 或最快一次宣稱達標。
- 清掉失去 consumer 的 helpers／fixtures、無用 imports 與矛盾註解；不得刪 production 資產或改 gameplay 平衡、IDs、規則與導航／spawn 預算。

## Test Authoring Lint

- `npm run lint:test` 範圍與 runner 收檔一致（Vitest `.test`／`.spec` 與遞迴發現的 Node `.test.cjs`），CI 在 logic gate 的 `npm ci` 後執行。
- **Error（阻擋）**：Vitest focused／disabled／重複標題／條件式註冊、Unit Test 重型 3D constructor、Node `test`／`describe` 的 `.only`／`.skip`／`.todo` 與停用 options。
- **Warning（不阻擋）**：body 超過 120 行、`expect-expect`、真實 timer wait、`any`、`@ts-ignore`，以及三種壞測試的可辨識樣式 `no-constant-literal-assert`、`no-prototype-harness`、`no-production-source-read`。`no-prototype-harness` 既有用法由 `eslint.config.mjs` 的 `PROTOTYPE_HARNESS_BASELINE` 逐檔 ratchet，只減不增。
- **Cross-owner Warning**（`warn-cross-owner-test-calls`）：同一 leaf 直接呼叫 `eslint.config.mjs` 列出的不同 owner 入口組合時提示 reviewer 確認是否為同一正式路徑；type-only／未呼叫 import、同 Owner 多入口、hooks 與 helper／callback 不觸發，每 leaf 最多一個。不自動判定放錯檔、不要求拆 case。
- 不為消除 Warning 刪重要 assertions 或大改既有案例。Owner 歸屬、failure mode 是否重複、caller 覆蓋與 regression 有效性仍由人工 review 判斷。

## CI 與誠實驗證

- 所有 PR 與 push 執行 **Full Test CI**，全部 logic cases 在單一 `logic / gate` job 執行恰好一次並驗證完整性；Desktop jobs 不重跑。Runner 實際 collection 為數量依據，報告缺失、過期、collection error 或空 suite 都不通過；超過 100ms 的 case 輸出檔案、名稱、耗時並失敗，不吞 runner 退出碼。workflow 細節見 `.github/workflows/ci.yml`。
- 開發中以指定檔案／目錄跑受影響 suite（`npx vitest run <files...>`）；**不可用 `vitest -t`**，被跳過的案例會使 `BudgetReporter` 失敗。本地量測 100ms 預算時單獨執行 vitest，不與 eslint／build 併行搶 CPU。視需要再跑 `rtk npm test`、`rtk npm run typecheck:test`、`rtk npm run build`；**不要求本地全量或重跑三次**。
- **PR 驗收以最新 PR head 的 GitHub Actions CI 為準**：`logic / gate`、typecheck:test、build 與適用 smoke 皆通過；不得用舊 commit、先前綠燈或 subset 冒充。檢視 case count、max leaf 與 Top 10 slow leaf；達 70ms 標記優化方向。只在 CI 失敗、平台異常或有明確疑慮時重跑。
- 重大核心邏輯或難確認有效性的新測試，可對少量關鍵 owner 做受控負向驗證後還原；不當每 PR 必經步驟。
- PR 記錄 CI run URL、驗證 commit、結果、保留／刪除的 failure mode、已知失敗與未驗證範圍；一次性量測放 PR 或 ignored `output/`。
