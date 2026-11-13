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

### Case 責任歸屬與搬移

- Case 依 **Production Decision Owner 與 Failure Mode** 歸屬，不依 Bug 發生場景、Task／PR 編號、第一個 import、使用的資料或檔名判斷。同一場景可由多個 owner 分別保護；共用 owner 也可合理涵蓋多場景輸入。
- 依序確認「行為契約 → 容易出錯的決策與模組 → 真實 caller → 可觀察的失敗 → 最小必要測試層級」，再搜尋既有 owner suite。只有尚未覆蓋的獨立 failure mode 才新增 leaf，沒有適合檔案才新增 suite；跨模組案例只驗證 caller 接線、授權、狀態及 cleanup，不重跑核心 owner 的矩陣。

以下是能力邊界範例，名稱用來辨識責任，不作固定檔案路徑清單：

| Owner／能力 | 應保護的契約 |
| --- | --- |
| `NavigationWorld` | 共用 A*、FIFO、拓樸與 footprint 失效；不收容所有場景入口配置。 |
| `TownLayeredNavigation` | 攻城接牆入口、升降與雙向路線。 |
| `TownCommandWatchtower`／`TownArchitectureSpecs` | 各自建築的通行、入口與室內容量。 |
| `RiverCrossingBattlefield` | 河流、橋樑、岸邊部署與落水；不同 failure mode 仍分開定位。 |
| `TownResidentLayout`／`CareerDuelState` | 前者保護居民與坐騎共同佔位；後者保護 Duel 場地與任務選址。 |
| `PersonalSquadCommandRouting`／`PersonalSquadRuntime` | 前者保護指令選擇、授權與回饋；後者保護已接受招募名冊的部署、Follow／Dismiss、返回 HR、登乘及 restore。 |
| `OnDemandAssets`／`HighTierEquipment` | 前者保護 loader、timeout、abort、retry；後者保護高階裝備預載結果的原子發布。 |
| `InventoryManager`／`NPCEquipmentLifecycle`／`GameInventoryLifecycle` | 分別保護玩家換裝、存檔及需求；NPC 採用裝備、格擋及 demand／dispose；Game 真正的 inventory 替換與退出 caller。 |
| `CareerRetirementPersistence`／`CareerRetirementMobilization`／`CareerRetirementFinale` | 分別保護持久化、集結與結局結算，不因同屬退休功能而混放。 |

### Cross-owner lint warning

- `npm run lint:test` 會對少量明確列出的 production 入口加上非阻擋 Warning；目前只有同一 Vitest leaf 直接呼叫 `CareerBridgeBattle.careerFieldTacticalOrder` 與 `CareerFieldBattle.resolveFieldDamagedTargetId` 這個試行組合會命中。前者決定小隊戰術命令，後者將傷害事件對應到目標 actor；`tests/missions/CareerFieldBattle.test.ts` 的「supports ambush alerts, squad engagement, and non-respawning legacy checkpoint migration」同時直接驗證兩者，且各自涵蓋不同決策，值得 reviewer 確認是否為同一正式路徑。Warning 只指出入口，請 reviewer 判斷，不自動判定案例放錯檔，也不要求拆 case。
- 舊的任務分類 leaf 同時呼叫 `CareerFieldBattle.isMigratedCareerFieldTemplate`／`isMigratedCareerFieldMission` 與 `CareerBridgeBattle.isCareerFelineBattle`，但這些分類呼叫組成同一條任務路由，現在不會命中 Warning。#490 的 Bridgehead「keeps Bridgehead victory unclaimed after a failed result save and retries it once」則以 `commitCareerBridgeBattleResult` 搭配真正的 `CareerProfileStore` 驗證同一結算交易可重試，也不會命中。跨檔案或跨模組本身不是警告條件。
- 只 import 未呼叫、type-only import、同一 Owner 的多個入口，以及 fixture helper、`beforeEach`／`afterEach` setup／cleanup、巢狀 helper／延遲 callback 或資料轉換 callback 不會觸發。這條規則依既有 callback 與 import binding 辨識實際呼叫，不依目錄或 import 數量推測 Owner，且每個 leaf 最多報一個 Warning。
- Warning 只提供 review 線索。**Owner 歸屬、failure mode 是否獨立、caller 是否真的有覆蓋，仍由 review 判斷**；Warning 不增加 leaf 數、不阻擋 CI，也不改變既有 Error 規則。
- 本次 PR 最新分支 head 的 CI：[test/warn-cross-owner-test-calls Actions runs](https://github.com/Andy-CH-BO-AN/SagaBurst-3D-Game/actions/workflows/ci.yml?query=branch%3Atest%2Fwarn-cross-owner-test-calls)。

- 同一不可分交易可有多個 assertions，同一不變量可使用少量資料變體；部署容量、投射物遮擋、地形切換與落水死亡等不同原因的失敗必須能獨立定位。把 200 行以上的大型 `it` 搬進正確檔案，不代表已完成責任整理。
- 搬移／刪除前核對「原案例與 assertions → 保留案例 → production consumer」，不能只比較名稱或 leaf 數；保留舊版存檔、權限、錯誤恢復與正式 Game call path 的唯一 regression。刪除自建決策流程時，指出真正 owner 的保護位置；沒有等效保護就明列風險，不宣稱已替代。

## Regression 設計與正式呼叫路徑

- 新增測試前先寫出**可觀察的行為契約與失敗模式**，不是照目前實作抄 expected。先查「使用者／事件入口 → 真正決策 owner → 正式 caller → side effects／存檔 → 替換／退出 cleanup」。純函式小改動不必製作流程表；跨模組、非同步或生命週期修改，須簡短盤點這條路徑與責任歸屬。
- **Helper / Service 測試通過，不等於正式遊戲已修好**。改動跨越 caller 邊界時，至少用一個輕量且執行真實 production caller 的案例驗證授權、資料傳遞、儲存或清理確實觸發；可隔離場景／網路等外部依賴，但不自行模擬或代做受測 caller 的決策。
- 不同的失敗模式應有可獨立定位的案例：正常 Save/Load、非法權限、舊版遷移、寫入失敗與非同步取消不是同一個 scenario。**同一不可分交易**可用多個 assertions，**同一契約**少量資料變體可迭代；不要以大型單一 `it` 或迴圈藏多項不相干的失敗模式，也不為了守住 case count 刪除重要斷言。
- 存檔相容性測試使用**真實歷史格式與授權／編組形狀**（可縮小無關 Fixture，不可改變造成 Bug 的關鍵形狀）；驗證首次載入、需要時的持久化、再次載入的冪等性，以及任務、HP、陣亡、指揮權、獎勵等必要不變量。無法安全遷移或寫入失敗時應 fail closed、保留原始資料，不只驗證 parser 有回傳值。

## 成本與邏輯範圍

- 每個保留的邏輯 leaf case 最多 100ms，包含該案例的 beforeEach、body、afterEach、onTestFinished 與案例專屬 cleanup。以不受 fake timers 影響的真實單調時鐘量測；timeout 或 slowTestThreshold 不能取代預算驗證。
- 全庫所有 PR 與 push 一律執行 **Full Test CI**（全庫邏輯測試上限最多 **1,000 unique leaf cases**，包含 Vitest 與 Node tests；優先改善目標為 **500–600 cases**），不得分成多次執行繞過，也不得在 Desktop jobs 重複執行同一批 logic cases。都在單一 `logic / gate` job 內完成。each、動態生成與多實作 contract 的每一列均計入。
- 單一 leaf 通常應低於 70ms，保留 30ms 執行餘裕；每個保留的邏輯 leaf case 最多 100ms（包含 hooks 與 cleanup）。1,000 個與每 case 100ms 都是硬門檻。
- 若任一 case 達 70ms，新增前先盤點該能力 owner 的現有覆蓋，優先採取淨減、去除重複 failure mode、縮小 fixture 與依賴；新案例若不可替代，需在 PR 說明風險與成本，不以硬性淨減要求犧牲關鍵保護。
- Import／collection、setupFiles、beforeAll／afterAll 與整套 wall time 另外記錄；不得將案例成本藏入共用初始化或 cache。
- Unit tests 不生成場景或 3D model，不建立 Scene、Group、Object3D 假場景、Mesh、geometry、material、texture、skeleton、rig 或 AnimationMixer。
- 不呼叫 TownWorld／城牆／地形／戰場 builders，不建立會初始化模型、動畫或場景的 NPC、Player、Mount、TownScene，不解析或 preload 真實 GLB、GLTF、FBX、貼圖或動畫資產。
- 不測 LOD0–2 外觀、骨架握姿、材質、陰影、美觀或需目視判斷的品質；不得用數值姿勢 assertions 或 synthetic skeleton 補回同一批外觀案例。
- 本遊戲不支援小螢幕或低解析度桌面視窗：不為窄 viewport、解析度矩陣、responsive breakpoint、HUD／面板座標、元素間距、遮擋或固定 pixel 位置新增或保留 layout 測試，也不新增另一套模擬解析度的替代測試。仍保護 UI 的正常桌面行為：點擊、分頁、選擇、禁用狀態、輸入傳遞、存檔失敗重試與 dispose 後不再執行過期 callback。
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

## 非同步、資源與生命週期 Regression

- 先區分**唯讀查詢**與**會改變狀態的操作**。查看 UI／狀態不得暗中建立 demand、啟動載入／重試或改變 ownership，除非這就是明示的產品契約；測試要能抓到「僅查看未選裝備卻觸發載入或通知」這類副作用。
- 有 acquire／subscribe／create 的資源，必須找到正式 caller 中對應的 release／unsubscribe／dispose，涵蓋**換裝、替換物件、切換場景、初始化失敗與離場**。測試不能只手動呼叫 Service 的 dispose 就宣稱 Game 會清理；多個有效 owner 共享資源時，一個離開不能誤釋放其他人。
- 對 preload、request、retry、timeout、abort 與 dispose，使用 fake timers、可控制順序的 deferred Promise 和窄 loader double 驗證**延遲完成／亂序完成**：過期結果不能覆寫新結果、誤清新 request 的狀態或在 owner 離開後觸發通知；已 dispose 的實例不可被舊工作復活。非必要預熱失敗不應阻塞場景，未就緒資產不可提前提供戰鬥效果。
- 先定義資源可見性與交易邊界：部分載入失敗不可發布半成品、寫入失敗不可對外暴露半提交狀態；測成功路徑也要測拒絕、重試與失敗回復。用可觀察狀態驗證，而不是只確認 mock 被呼叫。
- **不得為了讓 Test Double 過關而削弱 Production**：不在正式程式吞掉必要錯誤（例如空 `catch`）、加入假 fallback／只供測試的分支，或暴露不完整的 test-only reset API。優先注入狹窄的外部依賴或建立可隔離的 Service 實例；確需抽出純邏輯時，正式 caller 必須真正使用，且只做最低限度重構。

## 時間、隔離、cleanup 與型別

- 冷卻、延遲、倒數與重生用注入時間或 fake timers 驗證臨界前後；不任意 sleep，不改 production cadence 來加速測試。
- 非同步工作須 await，拒絕與取消有清楚結果；不使用無限等待、真實完整巡邏／戰鬥流程或任意放寬 timeout。
- Fixture 明確擁有 globals、timers、mocks、listeners 與排程工作。以 afterEach、onTestFinished 或 try/finally 保證 assertion 失敗及 setup 中途失敗仍 cleanup。
- 清掉 pending jobs、取消 loading、移除 listeners，還原 globals 原 descriptor 及 mock/timer 狀態；借用資源由原 owner 釋放。
- 使用型別清楚的介面；必要 unsafe cast 限縮在單一接縫。不得新增大量 `as any`、`@ts-ignore`、關閉 strict 或擴大 typecheck baseline。
- 刪除／修正案例後同步移除失效 baseline 項目；保留原 ratchet，不重建整份 baseline 或更改 fingerprint 掩蓋新增錯誤。

## Test Authoring Lint

- 執行 `npm run lint:test`；範圍需與 runner 收檔一致，涵蓋 Vitest `.test`／`.spec` 測試檔與遞迴發現的 Node `.test.cjs`，不因 `tests/` 子目錄漏掉案例。CI 會在既有 logic gate 的 `npm ci` 後執行，不會新增測試案例或另一個 Full Test Job。
- ESLint Error 會阻擋 Vitest focused／disabled／重複標題／條件式註冊（含 namespace 與 named/namespace 混用）、Unit Test 重型 3D constructor，以及 Node `test`／`describe` 的 `.only`／`.skip`／`.todo` 和明確啟用的停用 options。
- Test body 超過 120 行、`expect-expect`、真實 timer wait pattern、`any` 與 `@ts-ignore` 僅輸出 Warning；不可為了消除 Warning 刪除重要 assertions 或大規模改寫既有案例。
- Owner 歸屬、failure mode 是否重複、正式 caller 覆蓋、Regression 是否能攔截 Bug、Legacy 格式及跨模組 Import 是否合理，仍須依本文件由人工 Review。

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
- 所有 PR 與 push 一律執行 Full Test CI。廢除 Supercov 與 Related Test Selection；全庫最多 1,000 cases（優先目標 500–600 cases），每 case 最多 100ms。
- 全庫 Full Test 必須驗證所有 discovered files 及 leaves 恰好執行一次，再允許 publish。
- main Full gate 只執行一次：`push → main` 由 `ci.yml` 跑 Full，Pages 與 Release 於同一 workflow run 以 `needs` 共用、不再各自重跑；Pages 與 Release 僅接受綁定同一精確 SHA 的 Full 驗證（`verified-sha`），失敗、取消、SHA 不符或缺少驗證即自行跑 Full 或失敗（Pages 另在部署前確認 `GITHUB_SHA` 仍為最新 `origin/main`，過期則 skip 以免舊 commit 覆蓋新版網站）。手動 `v*` tag 無同 run 證明，必須 Full。
- 嚴格文件／CSS、經證明的 HTML inline style、獨立資產驗證通過的 asset-only 與 SHA 證據完整的真正空 Diff，允許各自明確標記的 empty plan；不可混為 docs-only。保留單檔／指定案例開發能力。
- 開發中可先跑受影響 suite（`rtk npm test -- <file-or-directory>` 或 `-t`，屬局部驗證），再依需要本地跑 `rtk npm test`、`rtk npm run typecheck:test`、`rtk npm run build` 作快速回饋；**不要求本地完整測試執行三次，也不以本地全量重跑作合併必要條件**。
- **PR 驗收以對應最新 PR head 的 GitHub Actions CI 為準**（含該 head 對應的 GitHub PR merge ref）；檢查適用的 web、desktop jobs 結果。CI 必須通過 `logic / gate`（plan、執行、完整性驗證與 1,000 cases 上限）、`npm run typecheck:test`、`npm run build` 及適用的 smoke。PR → dev／main 與合併後 push → dev 不安裝 Chromium 或執行 Web smoke，但保留 Typecheck、Build；push → main、Pages、Release 與手動 Full validation 仍執行 Web smoke。PR 中所有 selected logic cases 只在 logic gate 執行一次；Windows／macOS Desktop PR jobs 只在 PR → main 驗證 package／smoke，不重跑 Node logic；PR → dev 與 push → dev 不跑 Desktop。Windows／macOS Node component 驗證保留在正式 Release、完整測試與發佈閘門。不得用舊 commit、先前綠燈或單一 subset 冒充目前 PR 已驗證。
- 檢視同一次 CI 中的 mode、base/head、selection reasons、case count、max leaf 時間及 **Top 10 slow leaf**（完整名稱、檔案、hooks/cleanup 含入）；有 case 達 70ms 為非阻擋預警，應標記優化方向。每個 case >100ms、Case count >1000 或任一適用 CI job 失敗仍不得宣稱通過；不靠重跑三次、只挑最好的一次或增加 retry 掩蓋不穩定。只有 CI 失敗／平台異常／結果過期或有明確疑慮才重跑或補充診斷。
- 僅在重大核心邏輯變更或新測試難確認有效性時，可對少量關鍵 owner 作受控負向驗證，確認測試真的會失敗再還原；不把 mutation check 當作每 PR 必經步驟，也不引入大型 mutation framework。
- PR 誠實記錄 CI run URL、驗證 commit、結果、保留／刪除的 failure mode、已知失敗與未驗證範圍；一次性量測放 PR 或 ignored `output/`，不寫入長期規範或提交大型永久審計文件。
