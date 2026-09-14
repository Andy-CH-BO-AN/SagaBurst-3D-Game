# Roman／Viking 單手劍修正與驗收

2026-09-14。Phase A／B 完成後才重建 swordSlash；前置驗收記錄見 [phase-b-acceptance.md](phase-b-acceptance.md)。

## 最終行為

- Roman 的 idle／walk／run 雙臂已恢復原有 LOD1 動畫。初版誤套 Viking 手臂重定向造成的反轉已撤回；測試逐時間點保護原有六條肩臂／手腕軌道。
- Sword Grip Correction 固定 OFF。裝備層依角色 manifest 的右手 frame 與武器實際 gripCenterLocal 計算一次 attachment；idle、移動、cancel、攻擊完成不再覆寫武器 transform，也不扭轉 wrist 追劍。
- Roman／Viking 三個 LOD 使用獨立的右手 `swordHand` morph。只有裝備狀態切換會設定 influence，持劍動作期間保持固定；Bow morph 保留。
- 六份 GLB 的 idle／walk／run 與 swordSlash 都有有效動作。Roman locomotion 保留原有手臂；Viking 按其獨立 bind frame 重定向。
- `Sword_Regular_A → swordSlash` 保留 0.48 秒、0.252 秒單次命中、NPC 完成後 0.35 秒間隔。完成直接 blend 回最新要求的 idle／walk／run。
- Viking／Roman T1–T3 步戰近戰武器各自共用 default 單手劍形狀、握點與 `swordSlash`；只以表面花紋區分 tier。既有 ID 保留，傷害仍為 12／25／45。
- 攻擊使用來源 A 的上身揮砍，以及目標骨架的站姿下半身／來源骨盆朝向。來源蹲身依賴 pelvis translation，直接去掉位移會令腳浮起；因此本版採上述站姿適配，不宣稱完整保留來源下身動作。輸出仍是 rotation-only、in-place，沒有 weapon／socket correction tracks，未接 A_Rec。

## 驗證結果

| 檢查 | 結果 |
| --- | --- |
| 工程 | `npm test -- --run`：26 個檔案、224 項測試通過；`npm run build` 通過 |
| T1–T3 parity | 正式 3v3 infantry 場景：兩陣營六把劍均為 `swordSlash`、固定 attachment／手形啟用；同陣營三把世界尺寸相同且材質花紋各異 |
| Roman 原始雙臂 | 三 LOD、六軌道、61 個時間點，與版本化原始 locomotion 角差 < 0.00001 rad |
| 固定握點 | idle／walk／run 1,098 次工作室取樣；最大誤差 0.000377 mm |
| 攻擊握點 | 兩角色、三 LOD、61 個時間點，共 366 次；最大誤差 0.000518 mm |
| 攻擊過渡 | 實際 animator 從 walk 攻擊，中途要求 run，0.48 秒直接回 run；命中／完成各一次，attachment 不變 |
| 下身 | 六份 swordSlash、61 個時間點，兩腳 sole 高度相對站姿差 < 1 mm |
| 正式 NPC | idle→walk→run→walk→idle，共 900 次跨 LOD 取樣；dt = 1/120、1/60、0.252、0.48、0.8 秒均命中／完成一次，保留完整 0.35 秒間隔 |
| 正式 Player | walk／run、攻擊／收招、bow→sword；劍形狀 1→0→1，Bow 0→1→0，放箭一次，attachment 不變 |
| 資產保留 | 六份 GLB 的骨架、蒙皮、inverse bind、網格、材質、貼圖及未選動畫與原始 commit 相符；所有 manifest SHA-256 相符 |
| 可重現性 | 連續重跑 locomotion 與 attack 建構工具，六份 GLB 的 SHA-256 完全相同 |

使用 Playwright fallback 檢查實際 WebGL。隔離場景為 `http://127.0.0.1:5173/?devmodels=humans&nolock`，正式場景為 `http://127.0.0.1:5173/?nolock`；每個腳本均建立新頁面，避免 HMR 保留舊角色。正式 Player 腳本使用 3v3 Tier-2 編成，NPC 腳本使用 1v1 Tier-2 編成，便於觀察。檢查畫面包括手部近景、全身、俯視、LOD 與攻擊時間序列；相關執行均無 pageerror。

## 畫面與量測證據

- [Roman 復原後 idle](evidence/roman-idle-full.png)、[右手近景](evidence/roman-idle-lod0-fingers.png)。
- [Viking 右手近景](evidence/viking-idle-lod0-fingers.png)。
- [Roman 正式 NPC 攻擊](evidence/roman-swordSlash-full.png)、[俯視](evidence/roman-swordSlash-top.png)。
- [Viking 正式 NPC 攻擊](evidence/viking-swordSlash-full.png)、[俯視](evidence/viking-swordSlash-top.png)。
- [兩角色攻擊與回 run 時間序列](evidence/attack-timeline.png)。
- [正式 Player 接觸時刻](evidence/player-attack-0.252.png)、[回到移動](evidence/player-attack-0.600.png)。
- [量測摘要](evidence/summary.json)、[Player 裝備與事件](evidence/player-measurements.json)、[資產保留](evidence/preservation.json)、[重建一致性](evidence/idempotency.json)。

完整畫面與逐幀資料由以下 QA 工具輸出至 `output/playwright/`；本目錄保存代表畫面，避免驗收證據只留在忽略版控的 output。

## 已知限制

Viking 原有 Bow LOD1／2 的右臂姿勢與 LOD0 不一致。本輪保留原始 Bow clips、正規化與放箭路徑，沒有修復此既有問題，也不宣稱 Bow 所有 LOD 的視覺驗收已通過。修正 `BowGripLOD` 時僅處理共用手部拓樸複製中右手誤用左手 bind transform 的問題，左手處理保持原樣。

## 重跑方式

在 repository 根目錄執行。需安裝專案依賴、Blender（驗證版本 5.2）以及 Playwright Chromium。原始 ZIP 保存在 `artifacts/animation_sources/incoming/`，不修改或重新下載來源；原始 LOD1 locomotion 快照及來源 commit 記錄在 `artifacts/animation_sources/sword_baselines/`。

```sh
rtk proxy /Applications/Blender.app/Contents/MacOS/Blender --background --python tools/sample-sword-sources.py -- --mode locomotion --output output/sword/source-locomotion.json
rtk proxy node tools/calibrate-sword-grips.mjs
rtk proxy node tools/repair-sword-locomotion.mjs
```

先驗收兩角色的 idle／walk／run，再建構攻擊：

```sh
rtk proxy /Applications/Blender.app/Contents/MacOS/Blender --background --python tools/sample-sword-sources.py -- --mode attack --output output/sword/source-attack.json
rtk proxy node tools/rebuild-sword-attack.mjs
rtk proxy node tools/verify-sword-asset-preservation.mjs --attack
rtk npm test -- --run
rtk npm run build
```

取樣來源與目標輸出骨架分離；攻擊 30 FPS 並保留精確 0.252 秒及 0.48 秒 key。連續時間映射將來源接觸階段對齊既有命中事件。保留檢查使用快照內的固定原始 commit，後續提交不會把比較基準移到新輸出。

重建後更新每個 LOD 的 audit JSON（使用既有 `ai_share/skills/humanoid-rig-skinning/scripts/audit_glb.py` 的 `audit(path)`，序列化為 `audit-lodN.json`）。建構工具自動更新 manifest/hash。

重用 port 5173 的 Vite server（未啟動時執行 `rtk npm run dev -- --host 127.0.0.1`），再執行：

```sh
rtk proxy node tools/qa-sword-browser.mjs output/playwright/sword-restored --review --fingers
rtk proxy node tools/qa-sword-browser.mjs output/playwright/sword-attack --attack --review --fingers
rtk proxy node tools/qa-sword-attack-timeline.mjs
rtk proxy node tools/qa-sword-npc.mjs
rtk proxy node tools/qa-sword-release.mjs
rtk proxy node tools/qa-sword-bow.mjs
rtk proxy node tools/sword-evidence-gallery.mjs output/playwright/sword-attack-timeline
```

各腳本在超出握點誤差、事件次數錯誤或 browser pageerror 時失敗；數值通過後仍需檢查輸出畫面的手指包覆、手臂方向及自然過渡。
