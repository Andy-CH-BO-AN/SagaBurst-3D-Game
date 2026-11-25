# SagaBurst — 專案開發規則

## 文件入口

`ai_share/` 是文件與專案 skill 的正本；`.agents/`、`.codex/` 的入口或連結不另存副本。依任務讀取，不必每次載入所有文件：

- [ARCHITECTURE.md](ARCHITECTURE.md)：程式入口表與 [`architecture/`](architecture/) 分檔索引；依任務只讀對應分檔的模組職責與跨模組契約。
- [EQUIPMENT_TIERS.md](EQUIPMENT_TIERS.md)：裝備外觀清單。

只在契約實際改變時更新對應文件；被新結論取代的內容直接替換。專案不另存進度、交接或待辦文件：歷史實作、驗收證據與未驗收範圍記在 Git／PR，不複製回以上文件。

## 測試規範入口

- 所有新自動化測試一律放在 `tests/`。
- 新增或修改自動化測試前，Agent 必須先閱讀 [tests/AGENTS.md](../tests/AGENTS.md)。

## 專案約束

- 使用 TypeScript、Vite、原生 Three.js 與 HTML/CSS UI；物理／碰撞由既有數學與地形系統處理，不另引入框架或物理引擎。
- 音效與語音由 `SoundManager` 集中管理，現有音檔與 Web Audio 合成並用；沿用既有載入與播放路徑。
- 正式人物與坐騎以 local `+Z` 為前方；heading 用 `atan2(dx, dz)`。匯出軸向錯誤應修資產，不加個別 runtime 翻轉補丁。
- 保留現役裝備、坐騎與 Actor ID 及所有權契約；存檔只支援現行 schema，不讀取、轉換、補發或覆寫歷史格式，格式不相容時以穩定 key／版本隔離；共享資產的 geometry/material/texture 不可當作實例專屬資源銷毀。
- 一次性截圖、探針、量測 JSON 及驗收腳本放在 ignored `output/`。可重建工具、持續維護的測試與必要授權／來源證據才進版控；不強制加入被忽略的診斷產物。
- 凡涉及 `[0] 平民 / 商人` 的歸屬、避難或狀態恢復，一律使用 `TownRules.isCivilian(role)`（涵蓋 `'civilian'` 與 `'merchant'`），避免只比對 `role === 'civilian'` 而遺漏武器商人。
- 修改正式任務的開局滿狀態／隔離契約時，須同步檢查 `TownScene` 載入順序中的所有城鎮層級 `restore()`（`townCommand`、`civilianCommand`、`eagleGarrison`、`restoreTownCasualties`），避免先前城鎮的死亡或站位在任務控制器接手前被寫回。
- 在不升級存檔版本／key 的前提下增減 `ActiveMissionParser` 的名單檢核（如 `civilianActorIds`）時，必須明確評估對現行進行中存檔的影響，並以 `parseCareerProfile` 測試覆蓋（相容舊名單或明確升級版本隔離）。

## 任務相關流程

| 任務 | 使用的 skill |
| --- | --- |
| 人物資產、骨架或蒙皮 | [humanoid-rig-skinning](skills/humanoid-rig-skinning/SKILL.md) |
| 戰鬥動畫匯入、握持或命中時序 | [add-combat-animation](skills/add-combat-animation/SKILL.md) |
| 坐騎模型與騎姿 | [mount-from-reference](skills/mount-from-reference/SKILL.md) |
| 瀏覽器可見的戰鬥／移動修正 | [combat-browser-validation](skills/combat-browser-validation/SKILL.md) |
| 效能 A/B 或渲染成本歸因 | [sagaburst-performance-benchmark](skills/sagaburst-performance-benchmark/SKILL.md) |
| 分支、PR 標題與 Commit 訊息規範 | [git-change-conventions](skills/git-change-conventions/SKILL.md) |
| 依參考圖製作可動人物（服裝、頭盔、靴筒、披風、LOD） | [humanoid-from-reference](skills/humanoid-from-reference/SKILL.md) |
| 地形、季節環境、樹木、草地與營地物件美化 | [environment-art](skills/environment-art/SKILL.md) |
| 深層模組介面設計與接縫決策 | [codebase-design](skills/codebase-design/SKILL.md) |
| 領域術語、GLOSSARY.md 與 ADR 建立與精煉 | [domain-modeling](skills/domain-modeling/SKILL.md) |

程式變更可先在本地執行受影響測試與 `rtk npm run build` 快速回饋；跨系統變更可視需要先跑本地 `rtk npm test`。PR 最終驗收以對應最新變更的 GitHub Actions CI（含測試、型別、Build、適用的 Smoke）為準，**不要求本地完整測試或同組測試重跑三次**；所有 PR 與 push 一律執行 Full Test CI（全庫最多 1,000 cases，優先精簡至 500–600 cases，單一 leaf 最多 100ms）。細節依 [tests/AGENTS.md](../tests/AGENTS.md)。純文件修改先檢查連結、內容與差異即可。

GitHub 認證操作使用本機 `gh`／`git` 登入環境，不要求在隔離環境重新登入。GPU 效能驗證使用本機有畫面的 Chrome 與實際 GPU；具體量測規則由 benchmark skill 維護。
