# 測試工作規範

適用於 `tests/`；沿用 [專案規則](../ai_share/AGENTS.md) 與使用者指示。
能力責任與搬遷依據見 [測試盤點](../docs/testing-capability-audit/README.md)。

## 放置與命名

1. 新自動化測試只放 `tests/`，不得新增 `src/**/*.test.*` 或 `src/**/*.spec.*`。
2. 新增 case 前，先搜尋既有 capability suite、相同 production 入口與 assertion。
3. 依 observable behavior 和責任分類，不依任務代號、歷史 PR 或作者分類。
4. 使用 combat、commands、equipment、actors、movement、camera 等能力目錄。
5. missions 放任務定義與 outcome/travel policy；不要把所有 Career tests 堆進同一目錄。
6. persistence、progression、town、assets、integration、release 各有自己的責任。
7. 需要時可新增 audio、ui、observability 子目錄；先說明現有目錄不能表達的責任。
8. 測試名稱寫 scenario + expected behavior，參數展開後必須能辨認輸入。
9. 混合 suite 按 case 判斷責任，不把整份檔案都視為同一能力。
10. 拆出合理大小的 suite；不得建立新的巨大 `SharedSystems.test.ts`。

## Core、policy、integration

11. Core suite 擁有共用演算法、狀態機與錯誤處理的完整輸入矩陣。
12. Policy suite 驗證模式特有的人數、tier、權限、unlock 與勝敗規則。
13. Integration suite 驗證 caller 提供的參數、phase gate、訂閱、ownership 與副作用順序。
14. 不因新增 mission ID，就複製整套傷害、導航、換武器或 scheduler 測試。
15. 不因 core 已測過，就刪除不同 caller 的接線、集合選擇或 readiness 案例。
16. 相同名稱或欄位不足以證明同一規則；先追 production module 與 call path。
17. Player、NPC、Mount 的不同 HP/死亡實作都需要對應 coverage。
18. Damage routing、event emission、XP consumer、HUD 是不同測試責任。
19. 保留從真實傷害到 consumer 的代表接線，避免未 emit/未 subscribe 仍全綠。
20. 開場 spectator、死亡 observer、各 mission outcome 分別保留初始化與切換保障。
21. Patrol 回營、Personal Dismiss 回 HR、任務回城不得共用錯誤的完成/整補政策。
22. 不同 save schema 各保留 serialization、parser、migration 與特殊欄位案例。
23. Controller 間傳遞 in-memory profile 不能標成 storage round-trip。
24. Definition tests 保留獨立 expected；不要全部從 production constants 抄出答案。

## Fixture、adapter、contract

25. 先重用小型 typed fixture，再考慮新增 helper；名稱必須表達提供的能力。
26. Fixture 只準備依賴與資源，不暗中完成受測的狀態轉移。
27. 不 mock 正在驗證的 domain behavior；在 storage、render、audio 等接縫替換依賴。
28. Movement double 接受位置輸入時，明確標示它沒有驗證真實 locomotion。
29. Prototype fixture 只提供該入口需要的欄位，不擴大成萬用 Game/TownScene。
30. 不在 fixture import 時自動註冊 hooks、改 globals 或啟動 scheduler。
31. Fixture 返回明確 dispose；setup 中途失敗時也必須釋放已建立的資源。
32. Adapter 表達各實作的輸入/觀察介面，不複製 production 演算法。
33. 共用 contract suite 必須對每個獨立 implementation 執行。
34. 不可只跑一個 implementation，就刪其他實作的 coverage。
35. 共用 assertion 要有清楚名稱、輸入與含 actor/phase/parameter 的失敗訊息。
36. 不為 DRY 把 Arrange、Act、Assert 隱藏成不透明的一次呼叫。
37. 通用 GLB loader 不可吞掉材質/紋理檢查所需的資料。
38. 共用資產 contract 仍保留各模型的骨架、seat、socket、animation、LOD regression。
39. 優先使用 public seam；既有 private spy 改寫前先確定等價的 observable assertion。
40. 避免 `mock.calls[index]` 依賴偶然順序；順序本身是規格時應明確斷言。

## 時間、simulation 與成本

41. 新增高成本 simulation 前，寫明純規則/小型 integration 未保護的 failure mode。
42. 只有受測行為需要時，才建立完整場景、NPC 群或讀取真實資產。
43. 狀態完成等待用 bounded deterministic driver，指定 maxFrames 或 maxSimulationSeconds。
44. 為未達成條件提供 phase、actor 與目標的錯誤訊息。
45. 禁用 arbitrary sleeps、無限迴圈與以放寬 timeout 掩蓋失敗。
46. 區分 simulated time 與 wall-clock test timeout，報告時分欄記錄。
47. 時間/逐 frame 本身是規格時，保留臨界前後的精確檢查。
48. NPC scheduler 預算是每 render frame 最多一個；不得改成每秒一個。
49. 相同 RAF timestamp、background pause、cancel、rollback 的 core 契約要保留。
50. Caller suite 保留各 enqueue/materialization 路徑與 full-roster readiness。
51. 不用 drain 一次跑完來宣稱已驗證逐 frame 預算。
52. `advanceUntil` 不保證加速或消除 flaky；修改前後須在相同條件量測。
53. 不把單次全綠或 coverage 百分比當作替代案例的等價證明。

## 隔離、cleanup 與型別

54. 優先使用 instance scheduler；只有跨 caller 預算測試使用 production singleton。
55. 每個 fixture 明確擁有 globals、mocks、timers、事件訂閱及排程工作。
56. 清除 pending jobs、取消 loading、移除 listeners 並還原 globals 的原 descriptor。
57. 以 afterEach/onTestFinished 或 try/finally 保證 assertion 失敗時仍 cleanup。
58. 不把 cleanup 只寫在最後一個 expect 後面。
59. 部分 spawn 或 failed-save 必須驗證沒有提前 side effects，且資源可重試/釋放。
60. 借用的 resident/player/mount 由原 owner dispose，不由 reload fixture 重複銷毀。
61. 不 dispose 共用 immutable geometry、material 或 texture。
62. 使用 typed builder、Pick 或已命名 adapter，不新增大量 `as any`。
63. 必要 unsafe cast 限縮在單一接縫並說明缺失介面；不得關 strict。
64. 不新增 @ts-ignore 或放寬 typecheck 豁免來使測試通過。

## 搬檔、合併與 runner

65. 機械搬檔、fixture 整理、語意去重分開 review；避免同一 PR 大量混改。
66. 搬檔核對 relative imports、mock paths、asset URLs 與工作目錄假設。
67. 同步規劃 discovery/include/exclude、scripts、CI、typecheck、coverage/filter/docs 路徑。
68. Node release tests 不交給 Vitest；相同 case 不得漏跑或跑兩次。
69. Production 不得反向 import `tests/helpers` 或任何測試檔。
70. 搬檔前後比較 collection 的 case 名称/參數/runner，不能只比較總數。
71. 每個候選標示 KEEP、MOVE、SHARE FIXTURE、PARAMETERIZE、MERGE、REMOVE 或 NEEDS RUNTIME REFACTOR。
72. MERGE/REMOVE 必須附原 case → replacement case → retained assertions 的 mapping。
73. Mapping 逐項保留各 mode 的接線、失敗、cleanup、順序與特殊輸入。
74. 尚未有可執行 replacement 與等價證據時，保留原 case。
75. Contract parameterization 可以減少程式碼而不減少 expanded cases。
76. Production 尚未共用時，保留多實作 coverage；runtime consolidation 另開 PR。
77. 純測試重構不得順手改 gameplay、cadence、資產或 release 行為。
78. 不以改 expected、skip/todo、刪 assertion、任意增 timeout 讓 CI 過。

## 型別 ratchet 與驗證交付

79. 搬到新路徑前先檢查該檔歷史 typecheck diagnostics，優先修掉。
80. 修不完時附一對一 old/new fingerprint 表與數量，不整份 regenerate baseline。
81. 不改 fingerprint 演算法、baseline version 或放寬 ratchet。
82. 修掉的診斷從 baseline 刪除；新增/不同原因的診斷必須修正。
83. 測試變更執行 affected suites，再跑 full suite、typecheck、build 與 release tests。
84. Runner/資產/封裝接線變更額外驗證 web smoke 與所影響平台的 desktop smoke。
85. 純文件修改只檢查內容、連結及 diff；宣稱 baseline 結果時仍需提供實際執行紀錄。
86. 記錄 SHA、runner/version、命令、執行環境、結果與 skipped/todo。
87. 既有 baseline 失敗與本次引入的失敗分開；單檔重跑成功不覆寫全套失敗。
88. 發布前確認未遺留 focused-only case、global 污染或不可重現的本機依賴。
89. 完成標準是責任清楚、保留 failure modes、可 review/回退；不是 case 更多或更少。
90. 僅在使用者授權範圍內改動；不得自行 merge。
91. 本計畫整合分支是 `codex/test-capability-audit`；其主 PR 指向 `dev`，暫不合併。
92. 後續能力 PR 從整合分支建立，base 設為該分支並合回該分支，不直接進 `dev`。
93. 整合 PR 合併到 `dev` 前須有使用者明確指示；不得啟用 auto-merge。
