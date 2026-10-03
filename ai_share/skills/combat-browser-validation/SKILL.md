---
name: combat-browser-validation
description: 使用 Playwright CLI 驗證 SagaBurst 的瀏覽器戰鬥畫面、動畫、裝備、投射物、坐騎與接地，並判讀軌跡及應用程式錯誤。
---

# 戰鬥瀏覽器驗證

直接使用已安裝的 `playwright` skill 與 Playwright CLI，不依賴 GPT Chrome 擴充套件。重用對應工作目錄的 Vite；預設使用本機有畫面的 Chrome、獨立 QA session 與 `nolock`。若使用者指定既有瀏覽器分頁，使用可連接該分頁的工具；CLI 的獨立 session 不等同使用者分頁。

## 選擇場景

實際 host／port 以執行中的 Vite 為準。以下 query 加在該 origin 後：

| URL / query | 用途 |
| --- | --- |
| `/?nolock` | 正式主選單與戰鬥流程；有效 Career／session 狀態可能直接恢復 |
| `/?devmodels=humans&nolock` | 人物 LOD、骨架、握點與 controller／raw clip 比較 |
| `/?devmodels=mounts&nolock` | Horse 變體、LOD、騎士與動畫 |
| `/?devmodels=black-cat&nolock`、`/?devmodels=corgi&nolock` | 指定坐騎；可用鍵位以工作室 HUD 為準 |
| `/?devhero=maki-t4&nolock` | Maki 英雄預覽；其餘英雄 ID 見 `HeroAssetCatalog`／`main.ts` |
| `/?devcombat&nolock` | 預設 50v50 騎兵診斷，Player 軌跡 |
| `/?devcombat=a&nolock`、`b`、`c`、`d` | A：50v50 遠程步兵；B：100v100 近戰步兵；C：100v100 混編；D：100v100 騎兵 |
| `/?devcombat=all&nolock` | 同預設診斷，加 NPC 軌跡；只在需要時啟用，輸出量大 |

正式入口由 `src/main.ts` 分流；不要假設 `/` 直接生成戰鬥。可重現 QA 使用獨立 browser session，明確記錄選單、設定與存檔前提，不清除使用者生涯存檔。效能場景與量測改用 [benchmark skill](../sagaburst-performance-benchmark/SKILL.md)。

## Playwright CLI 操作

先讀可用的 `playwright` skill，確認 `npx` 與 CLI help；沿用它的 wrapper，無需建立 Playwright test spec。範例（先把 port 改為實際值）：

```sh
rtk proxy "${CODEX_HOME:-$HOME/.codex}/skills/playwright/scripts/playwright_cli.sh" -s=combat-qa open 'http://localhost:5173/?devmodels=humans&nolock' --headed --browser chrome
rtk proxy "${CODEX_HOME:-$HOME/.codex}/skills/playwright/scripts/playwright_cli.sh" -s=combat-qa snapshot
rtk proxy "${CODEX_HOME:-$HOME/.codex}/skills/playwright/scripts/playwright_cli.sh" -s=combat-qa console
```

- DOM 控制使用最新 snapshot 的 refs；Three.js 畫面以 screenshot 配合鍵鼠操作判讀。導航／UI 更新後重新 snapshot。
- 建構子、資產或 spawn 改動後重新載入頁面以重建場景；HMR 保留的舊實例不能作驗收依據。必要時排除資產 cache。多個 worktree 共用 `node_modules` 時，給各 Vite 獨立 `cacheDir` 與 port，記錄 origin 對應的工作目錄，避免 dependency cache 互相干擾。
- 截圖與 console 證據保存於 ignored `output/playwright/`；CLI 預設日誌目錄亦已忽略。完成後僅關閉本次 QA session。

## 驗收範圍

先驗最小單一假設，再重複相關正式戰鬥流程。動畫捕捉起手／接觸／收招，不只一張靜態姿勢；記錄 URL、設定、操作、畫面與應用程式錯誤。

- **近戰**：握點不滑動，攻擊向角色正前方／目標區，收招恢復。Lance idle 保留 Sword Idle 身體加固定 attachment；攻擊才加右臂 FK。盾以實際裝備為準，持盾不能拉弓。
- **弓**：弓身、弦、nock、拉弦手與箭尾對齊，發射起點／方向符合準星。檢查 Player 與真正持弓 NPC；Roman ranged 的 pilum 不能代替弓測試。側身姿勢另外看站立→移動→停止及騎乘，不能僅以箭飛向正前方判定通過。
- **騎乘**：骨盆座面、膝踝與裝備不穿模；測本次影響的坐騎、LOD、動作與上下馬恢復。新匯出的坐騎 GLB 先依 [mount-from-reference](../mount-from-reference/SKILL.md)／資產流程做 Blender round-trip 檢查，再進瀏覽器。
- **接地**：側面比較 Player/NPC 鞋底與相同地形，不能只看 physics root 高度。

程式檢查沿用專案 AGENTS，不在瀏覽器流程重複強制整套測試。使用者要求不開瀏覽器時遵守，並明確標記視覺未驗證。

## 動畫資產與播放缺陷

匯出／替換資產或修停播問題時，依受影響範圍補以下證據；一般 UI 或純文件工作不套用整組流程。

- 記錄實際 URL、資產 SHA、clip／時刻與視角。單檔 viewer 或 routed 候選可定位缺陷，最終遊戲整合要用正式 public URL 重建 Player／NPC 實例，確認 HTTP 檔與待交付檔相同；候選 fixture 結果不可寫成正式載入成功。
- 「移動但腳停住」記錄一段連續時間內的移速、active clip、action time、effective weight/timeScale、腿骨姿勢，以及 land／hit 等觸發次數。只看 mixer.time 前進不代表腿有動；只看截圖不同也不能排除反覆重啟。
- 腳本直接呼叫跳躍等有接地前提的操作時，讓前提檢查與呼叫在同一次 page task 執行；鍵鼠觸發則記錄輸入與動作是否實際被接受。若 trace 沒有 jump，先區分觸發失敗與落地恢復失敗，不繞過 runtime guard 製造通過。
- 動作修復依實際支援驗證 Player／NPC 的移動、一次性動作恢復與死亡保持；資產／實例改動另查 LOD、獨立 skeleton/mixer 和騎士接點。藝術形變的完整週期與多視角判讀見 [坐騎動畫診斷](../mount-from-reference/references/animation-deformation.md)。

## 軌跡與錯誤判讀

`CombatTrajectoryDebugger`：黃／藍／紅為 Player／友軍／敵軍；短線 grip→tip、保留 trail 為攻擊路徑。弓身 lime、弦 cyan、nock 路徑 magenta、手到 nock 白、搭箭橘、飛行路徑綠、準星引導紅。

- melee 摘要是角色 local 座標，正式前方 `+Z`；arrow flight 是 world 座標。不要跨座標直接比較，飛行後段重力下墜正常。
- nock bounds 只能補充外觀，不能證明弓身朝向正確。idle 沒 moving samples 正常；明明完成動作卻無 samples 才需追查。
- 優先追查 `src/` stack、遺失遊戲資產、未處理例外、NaN／Infinity。擴充套件來源警告或 favicon 404 不等同遊戲故障。
- 失敗回報第一個相關 stack、URL 與觸發操作；原始日誌留本機，不複製整串進 PROGRESS。
