# SagaBurst — 專案開發規則

## 文件入口

`ai_share/` 是文件與專案 skill 的正本；`.agents/`、`.codex/` 的入口或連結不另存副本。依任務讀取，不必每次載入所有文件：

- [ARCHITECTURE.md](ARCHITECTURE.md)：目前模組職責、跨模組契約與程式入口。
- [PROGRESS.md](PROGRESS.md)：目前交接狀態與已知限制。
- [PLAN.md](PLAN.md)：尚未完成的方向；不是已完成階段的歷史表。
- [EQUIPMENT_TIERS.md](EQUIPMENT_TIERS.md)：裝備外觀清單。

只在契約、交接或方向實際改變時更新對應文件；被新結論取代的內容直接替換。歷史實作與驗收證據查 Git／PR，不複製回以上文件。

## 測試規範入口

- 所有新自動化測試一律放在 `tests/`。
- 新增或修改自動化測試前，Agent 必須先閱讀 [tests/AGENTS.md](../tests/AGENTS.md)。

## 專案約束

- 使用 TypeScript、Vite、原生 Three.js 與 HTML/CSS UI；物理／碰撞由既有數學與地形系統處理，不另引入框架或物理引擎。
- 音效與語音由 `SoundManager` 集中管理，現有音檔與 Web Audio 合成並用；沿用既有載入與播放路徑。
- 正式人物與坐騎以 local `+Z` 為前方；heading 用 `atan2(dx, dz)`。匯出軸向錯誤應修資產，不加個別 runtime 翻轉補丁。
- 保留裝備、坐騎與存檔 ID 相容性；共享資產的 geometry/material/texture 不可當作實例專屬資源銷毀。
- 一次性截圖、探針、量測 JSON 及驗收腳本放在 ignored `output/`。可重建工具、持續維護的測試與必要授權／來源證據才進版控；不強制加入被忽略的診斷產物。

## 任務相關流程

| 任務 | 使用的 skill |
| --- | --- |
| 人物資產、骨架或蒙皮 | [humanoid-rig-skinning](skills/humanoid-rig-skinning/SKILL.md) |
| 戰鬥動畫匯入、握持或命中時序 | [add-combat-animation](skills/add-combat-animation/SKILL.md) |
| 坐騎模型與騎姿 | [mount-from-reference](skills/mount-from-reference/SKILL.md) |
| 瀏覽器可見的戰鬥／移動修正 | [combat-browser-validation](skills/combat-browser-validation/SKILL.md) |
| 效能 A/B 或渲染成本歸因 | [sagaburst-performance-benchmark](skills/sagaburst-performance-benchmark/SKILL.md) |

程式變更執行相關測試及 `rtk npm run build`（含 TypeScript 檢查）；跨系統變更執行 `rtk npm test`。純文件修改檢查連結、內容與差異即可。

GitHub 認證操作使用本機 `gh`／`git` 登入環境，不要求在隔離環境重新登入。GPU 效能驗證使用本機有畫面的 Chrome 與實際 GPU；具體量測規則由 benchmark skill 維護。
