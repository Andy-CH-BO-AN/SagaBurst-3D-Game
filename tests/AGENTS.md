# 測試工作規範

適用於自動化測試新增、修改與刪除；沿用 [專案規則](../ai_share/AGENTS.md) 與使用者指示。

## 新功能與測試責任

- 新自動化測試放在 `tests/`，不得新增 `src/**/*.test.*` 或 `src/**/*.spec.*`。
- 先閱讀既有 case body、helpers 與 production call path，找出真正擁有行為的能力 suite。
- 一個 feature 只增加重要且既有測試尚未保護的邏輯；既有案例足夠時允許新增 0 case。
- 一般 feature 優先新增 0–2 個真正缺少的重要案例；0 是合理結果，不設最低配額。涉及多個獨立且高風險的 failure mode 才可超過 2 個，必須說明每個案例保護的不同契約，不展開排列組合。
- 優先擴充既有 owner，不依 PR、任務 ID、兵種或模式另建整套 regression；不以測試數量增加作為品質成果。
- 核心 owner 保護重要演算法與 failure mode；caller 只保護必要資料傳遞、權限、失敗處理及副作用順序，不重跑完整核心矩陣。
- 優先保護無法遊玩、取消與 rollback、資料損壞、存檔交易、ownership、重複結算、戰鬥有效命中與死亡、指揮資格、導航可達性和必要容量邊界。

## 成本與邏輯範圍

- 每個保留的邏輯 leaf case 最多 100ms，包含該案例的 beforeEach、body、afterEach、onTestFinished 與案例專屬 cleanup。以不受 fake timers 影響的真實單調時鐘量測；timeout 或 slowTestThreshold 不能取代預算驗證。
- 單一 CI shard／test runner invocation 的 Vitest + Node 邏輯 leaf cases 合計最多 500；each、動態生成與多實作 contract 的每一列均計入。這是 per-shard 硬上限，repository 全量合計可以超過 500。Related／Full 都依 collection deterministic 分 shard，不截斷、不遺漏、不重複。單檔超過 500 時須拆分獨立能力 suite，planner fail closed。
- 單一 leaf 通常應低於 70ms，保留 30ms 執行餘裕；這是**非阻擋的預警目標**，不得靠隱藏案例或刪掉必要回歸達標。每 shard 500 個／每 case 100ms 的硬門檻仍由 CI 守門，不設 repository 案例配額。
- 若任一 case 達 70ms，新增前先盤點該能力 owner 的現有覆蓋，優先採取淨減、去除重複 failure mode、縮小 fixture 與依賴；新案例若不可替代，需在 PR 說明風險與成本，不以硬性淨減要求犧牲關鍵保護。
- Import／collection、setupFiles、beforeAll／afterAll 與整套 wall time 另外記錄；不得將案例成本藏入共用初始化或 cache。
- Unit tests 不生成場景或 3D model，不建立 Scene、Group、Object3D 假場景、Mesh、geometry、material、texture、skeleton、rig 或 AnimationMixer。
- 不呼叫 TownWorld／城牆／地形／戰場 builders，不建立會初始化模型、動畫或場景的 NPC、Player、Mount、TownScene，不解析或 preload 真實 GLB、GLTF、FBX、貼圖或動畫資產。
- 不測 LOD0–2 外觀、骨架握姿、材質、陰影、美觀或需目視判斷的品質；不得用數值姿勢 assertions 或 synthetic skeleton 補回同一批外觀案例。
- 普通資料、Career profile、save/state model、IDs、roster、數值、Map／Set、合成導航圖及碰撞資料可以測；資料 model 不等於 3D model。Vector3、Quaternion、Box3 可作數學資料使用。
- 重要動畫事件、LOD 選擇或資源狀態僅測數值與狀態，不載入模型。不得全面 mock Three.js 或另造測試引擎來讓重型測試假裝合規。
- `integration/`、`assets/` 或其他 runner 不能成為重型測試例外。既有 Web／Desktop release smoke 維持啟動與封裝用途，不套用 unit 100ms，也不得收容被刪案例。

## Fixture、expected 與 production 重用

- 直接呼叫真實 production 邏輯，使用獨立 expected；不複製演算法到 tests、不從受測輸出讀回答案、不 mock 受測決策。
- 選擇能抓到重要錯誤的最小層；使用 typed fixture、Pick 或命名 adapter，僅提供 caller 所需欄位，不建立萬用假 Game／TownScene。
- Fixture 只準備依賴，不暗中完成受測狀態轉換；storage、network、DOM、audio 等外部邊界可用窄 double。
- 如重要邏輯困在重型 constructor，先找現有小入口；確實沒有才作保持行為的最小 production 抽取。正式 caller 必須真的使用抽出的 owner，不新增 test-only production 分支。
- 每 case 圍繞一個行為，名稱清楚描述 scenario 與結果；同一交易或狀態轉換可以有多個必要 assertions，集合不變條件可迭代檢查。
- 優先斷言公開狀態與輸出；副作用順序本身是契約時明確驗證。Regression 必須在對應錯誤行為下失敗，不能只檢查呼叫或沒有 throw。
- 可設定 A*、scheduler 預算由測試自行指定 n，驗證同 frame 最多 n 筆、第 n + 1 筆保留、合法下一 frame 繼續及重複 timestamp 不重複耗用預算；不寫死 production 當前數值。

## 時間、隔離、cleanup 與型別

- 冷卻、延遲、倒數與重生用注入時間或 fake timers 驗證臨界前後；不任意 sleep，不改 production cadence 來加速測試。
- 非同步工作須 await，拒絕與取消有清楚結果；不使用無限等待、真實完整巡邏／戰鬥流程或任意放寬 timeout。
- Fixture 明確擁有 globals、timers、mocks、listeners 與排程工作。以 afterEach、onTestFinished 或 try/finally 保證 assertion 失敗及 setup 中途失敗仍 cleanup。
- 清掉 pending jobs、取消 loading、移除 listeners，還原 globals 原 descriptor 及 mock/timer 狀態；借用資源由原 owner 釋放。
- 使用型別清楚的介面；必要 unsafe cast 限縮在單一接縫。不得新增大量 `as any`、`@ts-ignore`、關閉 strict 或擴大 typecheck baseline。
- 刪除／修正案例後同步移除失效 baseline 項目；保留原 ratchet，不重建整份 baseline 或更改 fingerprint 掩蓋新增錯誤。

## 刪除政策與防規避

- 低價值 getter／常數、文案／樣式、純外觀、淘汰功能與同 failure mode 重複案例可以直接刪，不必逐一補回，也不要求 test-only 清理新增人工 QA 場景。
- 刪減前先以「production owner → 重要 failure mode → 保留案例」核對：同一交易的相同失敗路徑只留最有辨識力的驗證，正例、真正不同的權限／原子性／重試／存檔損壞與臨界邊界不得因名稱相似就刪。尤其不要只為省數量而刪除近期修復的 regression。
- 效能優化優先刪除重複昂貴的 setup／大量資料生成、縮小真實計算的輸入、共用輕量且無狀態的 pure fixture；不得把案例成本移至 beforeAll 或 setupFiles，也不得僅為求快而 mock 受測邏輯。
- 重要邏輯刪除或改寫需指出保留的 production owner 與對應測試；一般低風險重複案例以 suite／能力說明取捨即可。
- 不為每 faction、tier、方向、武器或任務重跑相同流程。大量資料只有在容量本身是必要風險時保留，仍不得生成實體 actors，仍受 100ms 約束。
- 禁止 skip／todo／only、縮小 discovery、改副檔名、搬至 hidden／legacy／slow／manual 或其他 runner／smoke 規避數量或時間。
- 禁止把多個獨立 scenario 塞進單一 it 或大型迴圈隱藏 leaf count；不得用 retry、平均值、百分位、慢案例 allowlist 或最快一次結果宣稱達標。
- 清理失去 consumer 的 helpers／fixtures、無用 imports、舊 timeout 理由與矛盾註解；不得刪 production 資產或改 gameplay 平衡、IDs、規則與導航／spawn 預算。

## Runner 與誠實驗證

- Runner 實際 collection 是數量依據；Node release leaf cases 與 Vitest 合併，避免漏跑或重算。報告缺失、過期、collection error 或空 suite 均不能通過。
- CI 與 npm test 必須經由相同 planner／manifest 與預算守門；任何超過 100ms 的邏輯 case 輸出檔案、完整名稱、耗時並失敗。不得吞掉 runner 的原始失敗退出碼。
- 普通 PR → dev 與 push → dev 使用 dependency-aware Related Test CI；PR 使用 merge-base，push 使用 before..after。直接修改測試、跨目錄 helper consumers、間接 production 依賴都要選入；Node release tests 不能漏跑或重複。
- PR → main、push → main、正式 tag／release／Pages 發佈前與手動 Full mode 必須跑 Full Test gate。Full 可以分 shard，aggregate 必須驗證所有 discovered files 及 leaves 恰好執行一次，再允許 publish。
- Selector 以 Vitest runtime dependency graph 加上靜態 runtime／CJS graph 選取，runtime registry／高風險 owner、runner/config、移除/搬移、Git history 不足或無法確定依賴時 Full fallback；collection error 直接失敗。不得透過搬移檔案、dynamic import 或不登記依賴規避 selection。
- 僅嚴格文件變更允許明確 docs-only empty plan；code change 得到零測試一律 Full fallback／failure。保留單檔／指定案例開發能力，但 Related／subset 通過不能代表 Full Suite 通過。
- 開發中可先跑受影響 suite（`rtk npm test -- <file-or-directory>` 或 `-t`，屬局部驗證），再依需要本地跑 `rtk npm test`、`rtk npm run typecheck:test`、`rtk npm run build` 作快速回饋；**不要求本地完整測試執行三次，也不以本地全量重跑作合併必要條件**。
- **PR 驗收以對應最新 PR head 的 GitHub Actions CI 為準**（含該 head 對應的 GitHub PR merge ref）；檢查適用的 web、desktop jobs 結果。CI 必須通過 logic plan／matrix／aggregate（Vitest + Node 合併 per-shard leaf 預算）、`npm run typecheck:test`、`npm run build` 及 Web smoke；PR 的 Desktop packaging／smoke jobs 若適用也須通過。不得用舊 commit、先前綠燈或單一 subset 冒充目前 PR 已驗證。
- 檢視同一次 CI 中的 mode、base/head、selection reasons、fallback、每 shard 與 aggregate case count、max leaf 時間及 **Top 10 slow leaf**（完整名稱、檔案、hooks/cleanup 含入）；有 case 達 70ms 為非阻擋預警，應標記優化方向。每個 case >100ms、任一 shard >500 或任一適用 CI job 失敗仍不得宣稱通過；不靠重跑三次、只挑最好的一次或增加 retry 掩蓋不穩定。只有 CI 失敗／平台異常／結果過期或有明確疑慮才重跑或補充診斷。
- 僅在重大核心邏輯變更或新測試難確認有效性時，可對少量關鍵 owner 作受控負向驗證，確認測試真的會失敗再還原；不把 mutation check 當作每 PR 必經步驟，也不引入大型 mutation framework。
- PR 誠實記錄 CI run URL、驗證 commit、結果、保留／刪除的 failure mode、已知失敗與未驗證範圍；一次性量測放 PR 或 ignored `output/`，不寫入長期規範或提交大型永久審計文件。
