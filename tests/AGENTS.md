# 測試工作規範

適用於自動化測試的新增與維護；沿用 [專案規則](../ai_share/AGENTS.md) 與使用者指示。

## 新增測試的順序

- 新自動化測試一律放在 `tests/`，不得新增 `src/**/*.test.*` 或 `src/**/*.spec.*`。
- 先搜尋相同 production 入口、行為與 assertions，閱讀既有 case body 及實際 call path。
- 說清楚新增案例保護的行為、輸入條件與 failure mode，確認現有測試尚未涵蓋。
- 優先擴充既有能力 suite；新增 suite 時明確界定它負責的規則。
- 選擇能抓到該錯誤的最小測試層；純規則不需要建立完整場景、NPC 群或載入資產。
- 每個案例圍繞一個行為；Arrange、Act、Assert 要能直接看懂。
- 名稱描述 scenario + expected behavior；參數化名稱必須能辨認失敗的輸入或實作。
- Regression case 要能在錯誤行為下失敗，不能只驗證函式有呼叫或沒有 throw。

## 目錄與依賴

- 依共用能力與責任分類，跨模式使用同一主責 suite；不依任務 ID、作者或 PR 編號分類。
- `combat/`、`commands/`、`equipment/`、`actors/`、`movement/`、`camera/` 放各能力核心規則。
- `persistence/`、`progression/` 放儲存契約與成長規則；`missions/`、`town/` 放任務／城鎮特有政策。
- `integration/` 依接線能力命名，驗證不同 caller、mode、phase 如何使用共用模組。
- `assets/`、`audio/`、`ui/`、`observability/`、`release/` 各自負責資產、介面與工具契約。
- `helpers/` 放具體 consumer 使用的 typed fixtures；`contracts/` 放多實作契約；`fixtures/` 放必要固定資料。
- 單一 suite 保持可理解的責任範圍；不得堆成巨大的 `SharedSystems.test.ts` 或通用模式檔。
- Production 不得反向 import `tests/`；測試可以透過公開入口使用 production 模組。

## Core、policy、integration 的責任

- Core suite 擁有共用演算法、狀態機、邊界輸入與錯誤處理的完整矩陣。
- Policy suite 驗證模式特有的人數、tier、權限、unlock、勝敗與返回條件。
- Integration suite 驗證真實 caller 提供的參數、phase gate、訂閱、ownership 與副作用順序。
- 新模式優先補自己的 policy 與接線，不複製整套傷害、導航、換武器或 scheduler 核心測試。
- 不同 caller 的敵我集合、可指揮對象、readiness 與 cleanup 都是獨立接線風險。
- 多份獨立實作必須各有 coverage；不能只測其中一份就假定其他實作正確。
- Player、NPC、Mount 若有不同 HP、死亡或裝備邏輯，分別驗證對應實作。
- Damage routing、event emission、XP/HUD consumer 分層驗證，保留真實 producer 到 consumer 的代表接線。
- 同名 Follow、return、spectator 等行為可能有不同政策；以輸入、輸出與不變條件界定責任。
- 儲存測試要涵蓋 serialization、parser、舊版相容與特殊欄位；不同 schema 各有保障。
- Controller 間傳遞 in-memory object 不能當作 storage round-trip；持久化接線需經過真實序列化邊界。

## 避免重複與共用契約

- 判斷重複前，先核對 production 模組、輸入、可觀察結果及 failure mode；名稱相似不足以判定。
- 同一實作只有輸入不同時，優先擴充 `it.each` 等參數矩陣，保留每組獨立 expected。
- 同一契約有多個獨立實作時，提供薄 adapter，對每個實作執行同一 contract suite。
- Adapter 只轉接輸入與觀察介面，不複製 production 演算法，也不代替實作完成行為。
- Setup 相同但 assertions 不同時共用 fixture，保留各案例的獨立責任與失敗訊息。
- 現有案例已完整保護的規則，不再新增同義案例；補測應指向具體未保護的差異。
- 共用 assertion 要有清楚名稱、輸入及 actor/phase/parameter 訊息，不隱藏 Act 或整個測試流程。
- 必要 integration 不能因 core 已測過而省略；同樣也不在每個 integration 重跑完整 core 矩陣。
- 若調整既有重複案例，說明每個 assertion、特殊輸入與接線由哪個測試承接；證據不足就保留。
- 成功指標是行為責任清楚、能抓到錯誤且容易維護，不是 test count 更多或更少。

## Fixture、mock 與 assertions

- Fixture 只準備明確依賴與資源，不暗中完成受測的狀態轉移。
- 不 mock 正在驗證的 domain behavior；可在 storage、network、render、audio 等外部邊界替換依賴。
- Prototype fixture 只提供該入口需要的欄位；避免萬用 Game/TownScene fixture。
- Movement double 若只接受位置輸入，明確標示它沒有驗證真實 locomotion。
- Helper import 不自動註冊 hooks、修改 globals、建立 singleton 或啟動 scheduler。
- Expected 來自獨立規格、明確輸入與已知結果，不直接讀受測 production constants 或重算同一演算法當答案。
- 優先斷言公開輸出與狀態；避免 private spy 或 `mock.calls[index]` 綁住偶然的實作順序。
- 順序本身是契約時，明確驗證事件或副作用順序及其意義。
- 自動化資產測試驗證 runtime 契約：parse/preload、必要 LOD、runtime 查找的 bone/socket/seat、gameplay 所需 clip/event、instance 建立與 mutable state 隔離、失敗處理及 manifest/package/path。
- 純外觀、精確 duration/pose/quaternion、weights、材質數值、未被 runtime 查找的 mesh/name、clearance/silhouette、rotation-only/payload size，逐案確認無 runtime 依賴後列為移除或人工 visual QA 候選；PR 記錄理由與剩餘契約／QA 場景。
- 非資產 gameplay 測試使用所需欄位最少的 typed visual fixture，保留真實 actor、AI、移動與傷害行為；真實 GLB 留在少量資產契約與必要 integration。
- 共用 GLB loader 明示是否省略 image/material payload；只有契約不依賴這些內容時可省略，材質與紋理契約使用可保留內容的載入方式。

## 非同步、時間與 simulation

- 狀態等待使用 bounded deterministic driver，指定 maxFrames 或 maxSimulationSeconds。
- 未達成條件時回報 phase、actor、目標與已前進的時間／frame，讓失敗可定位。
- 禁用 arbitrary sleeps、無限迴圈與任意放寬 timeout；非同步工作需 await 並驗證拒絕／失敗路徑。
- 區分 simulated time 與 runner 的 wall-clock timeout；不能用 timeout 大小代表遊戲時間。
- 時間或逐 frame 本身是規格時，保留臨界前後檢查，不能以一次 drain 取代 frame budget 驗證。
- Scheduler core 驗證預算、cancel、rollback；caller 驗證 enqueue、materialization 與 readiness。
- Simulation 的動作要驅動真實受測 runtime；不要直接寫入結果狀態讓流程通過。
- 新增高成本 simulation 前，說明純規則或小型 integration 無法保護的缺口。
- Driver 或 fixture 共用不代表更快或不會 flaky；效能與穩定性主張需要實際量測。

## 隔離、cleanup 與型別

- 每個 fixture 明確擁有 globals、mocks、timers、listeners、資源與排程工作。
- 優先使用 instance scheduler；只有跨 caller 的共享契約使用 production singleton。
- Setup 中途失敗也要釋放已建立資源；成功建立的 fixture 提供明確 dispose。
- 以 afterEach/onTestFinished 或 try/finally 保證 assertion 失敗時仍 cleanup，不只放在最後一個 expect 後。
- 清除 pending jobs、取消 loading、移除 listeners，還原 globals 的原 descriptor 與 mock/timer 狀態。
- 借用資源由原 owner dispose；不可重複銷毀共享 geometry、material、texture 或 borrowed actor。
- Partial spawn、failed-save 等失敗案例要驗證副作用順序、資源釋放及重試能力。
- 使用 typed builder、Pick 或命名 adapter；必要 unsafe cast 限縮在單一接縫並說明缺失介面。
- 不新增大量 `as any`、`@ts-ignore` 或關 strict；新增型別錯誤要修正，不擴大 typecheck baseline 豁免。
- 修掉的診斷同步移除 baseline 項目；保留原有 ratchet，不以全量重建或變更 fingerprint 演算法掩蓋錯誤。

## Runner 與驗證

- 新案例必須由正確 runner 實際收集；核對檔案、完整 case 名稱與參數，不能只看總數。
- Node release tests 使用 Node runner，並納入 release script、排除 Vitest discovery，避免漏跑或跑兩次。
- 測試變更先執行 affected suites，再跑 `rtk npm test`、`rtk npm run typecheck:test`、`rtk npm run build`、`rtk npm run test:release`。
- Browser、資產或封裝接線變更，加驗 web smoke 與所影響平台的 desktop smoke；畫面行為依專案 skill 驗證。
- 不以改 expected、刪 assertion、skip 或增 timeout 讓檢查通過；交付前移除 focused-only case 與非必要 skip/todo。
- 驗證結果寫在 PR：命令、環境、結果與未驗證範圍；不要新增只記錄一次執行結果的常駐測試文件。
- 既有失敗與本次新增失敗分開記錄；單檔重跑成功不能取代完整執行的失敗紀錄。
- 純測試修改維持 gameplay、cadence、資產與 release 行為；確有功能變更時明示範圍並測其行為。
- 純文件修改檢查內容、連結與 diff，不宣稱執行了未跑的測試。
