---
name: git-change-conventions
description: 當需要建立或命名分支（Branch）、Pull Request（PR）或撰寫 Commit 訊息時使用。遵循本規範所定義的類型前綴與命名慣例。
---

# Git 變更規範 (Git Change Conventions)

當任務包含以下情境時，應遵循此規範：

- 建立 Git 分支 (Branch)
- 更新 README 或文件
- 命名 Pull Request (PR) 標題與撰寫內文
- 撰寫 Commit 訊息
- 制定或確認 Branch / PR / Commit 的命名慣例

## PR 標題格式 (PR Title Format)

Pull Request 標題必須遵循以下格式：

- `<TYPE>: <summary>`

允許使用的 `<TYPE>` 值如下（全大寫並帶冒號）：

- `FEATURE:` 新增功能 (New feature)
- `FIX:` 錯誤修正 (Bug fix)
- `REFACTOR:` 程式碼重構（無行為改變） (Code refactor with no behavior change)
- `DOCS:` 僅文件修改 (Documentation only)
- `TEST:` 僅測試相關修改 (Tests only)
- `STYLE:` 格式調整（如排版、Linter 格式整理，不影響程式邏輯） (Formatting changes)
- `PERF:` 效能改進 (Performance improvement)
- `CHORE:` 維護、設定、相依套件更新或雜項庶務 (Maintenance or housekeeping)
- `CI:` 持續整合設定檔或自動化腳本 (Continuous Integration configuration or scripts)

## 分支命名格式 (Branch Format)

由於 Git 分支名稱不能包含冒號 `:` 或空格，分支必須使用以下格式：

- `<type>/<summary-in-kebab-case>`

範例：
- `feat/add-weekly-fatigue-summary`
- `fix/handle-empty-garmin-heart-rate-payload`
- `chore/setup-test-environment`
- `test/add-smoke-tests`

### 分支與 PR Type 對應表 (Type Mapping)

| PR Type (大寫) | Branch Type (小寫簡寫) | 說明 |
| :--- | :--- | :--- |
| `FEATURE:` | `feat/` | 新增功能 |
| `FIX:` | `fix/` | 錯誤修正 |
| `REFACTOR:` | `refactor/` | 重構 |
| `DOCS:` | `docs/` | 文件 |
| `TEST:` | `test/` | 測試 |
| `STYLE:` | `style/` | 格式整理 |
| `PERF:` | `perf/` | 效能優化 |
| `CHORE:` | `chore/` | 維護雜項與環境建置 |
| `CI:` | `ci/` | CI/CD 設定 |

## 使用規則 (Required Usage Rules)

1. **邏輯一致**：分支類型與 PR 標題類型應保持邏輯一致（除非有明確特殊原因）。
2. **大小寫區別**：分支名稱使用小寫前綴（例如 `feat/`、`chore/`），而 PR 標題使用全大寫類型加冒號（例如 `FEATURE:`、`CHORE:`）。
3. **具體精確**：前綴後的描述文字應具體明確反映該變更的真實內容。
4. **不自創前綴**：嚴禁自創未定義的頂層前綴，除非使用者明確要求調整規範。
5. **主要結果導向**：若變更跨越多個類別，請選擇最能代表主要影響或成果的類型。
6. **Kebab-case**：分支描述一律轉換為全小寫並以連字號分隔（kebab-case）。
7. **PR 內容結構**：PR 內文應包含：
   - **摘要 (Summary)**：本次變更的核心重點。
   - **原因 (Why)**：為何需要此變更。
   - **變更內容 (What Changed)**：具體做了哪些調整。
   - **驗證方式 (Validation / How to Test)**：如何執行與驗證測試結果。
   - **刻意未包含內容 (Intentionally Omitted)**：如有刻意排除的範圍，明確列出。

## Commit 訊息規範 (Commit Message Rules)

Commit 訊息應遵循 Conventional Commits 風格，與分支／PR 語意保持一致：

- 格式：`<type>: <description>` 或 `<type>(<scope>): <description>`
- 常用類型：`feat`, `fix`, `refactor`, `docs`, `test`, `style`, `perf`, `chore`, `ci`
- 保持第一行簡短清楚（建議 50-72 字元內），必要時於空行後補充詳細說明。
