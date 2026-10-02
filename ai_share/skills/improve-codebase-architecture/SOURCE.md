# 來源、版本與安裝

這份繁體中文版及其三個技能依賴，均來自 [Matt Pocock 的 skills 儲存庫](https://github.com/mattpocock/skills/tree/d81f3a183412e71a5b1e84ca21bc1a35eea03a60)。原始匯入來源固定在提交 `d81f3a183412e71a5b1e84ca21bc1a35eea03a60`。本機後續修訂以 Git 差異為準，不宣稱與該提交逐字相同。

| 技能 | 上游目錄 | 本次處理 |
| --- | --- | --- |
| `improve-codebase-architecture` | `skills/engineering/improve-codebase-architecture` | 新增主技能、HTML 報告範本與介面文字 |
| `codebase-design` | `skills/engineering/codebase-design` | 新增共用設計詞彙、深化指引與平行設計流程 |
| `domain-modeling` | `skills/engineering/domain-modeling` | 更新既有技能及詞彙表、ADR 格式 |
| `grilling` | `skills/productivity/grilling` | 更新既有技能為按決策前緣分回合追問 |

已檢查三個依賴的主檔與參考文件，沒有其他需要安裝的技能依賴。HTML 報告在產生時透過 CDN 載入 Tailwind 與 Mermaid，沒有需加入遊戲專案的套件或可執行腳本。

## 專案整合

- 使用 Codex 的 `skill-installer` 安裝腳本，以固定提交下載完整技能目錄，再翻譯所有說明、範本、註解與介面文字。
- 正本維護於 `ai_share/skills/`；`.codex/skills/` 與 `.agents/skills/` 提供中文探索入口，使用時先閱讀正本。
- 技能名稱、檔名、程式識別字、YAML 欄位與 CDN URL 保持原樣。主技能仍限使用者明確呼叫：保留 `disable-model-invocation: true`，以及 `allow_implicit_invocation: false`。
- `domain-modeling` 同步上游的 `GLOSSARY.md`／`GLOSSARY-MAP.md` 命名。原本的 `CONTEXT-FORMAT.md` 由 `GLOSSARY-FORMAT.md` 取代；更新前已確認專案沒有既存領域上下文資料檔或其他舊格式引用。
- PR 合併後，更新本機專案即可在下一回合探索到新增技能。使用 `$improve-codebase-architecture` 明確啟動架構審查。

## 授權

四個技能目錄各保留一份未修改的 [MIT 授權原文](LICENSE) 與完整[繁體中文譯文](LICENSE.zh-TW.md)。著作權為 `Copyright (c) 2026 Matt Pocock`。中文譯文方便閱讀，原始授權通知仍予保留。
