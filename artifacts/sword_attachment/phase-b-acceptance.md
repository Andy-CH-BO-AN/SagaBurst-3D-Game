# Sword attachment：Phase A／B 驗收（2026-09-14）

Roman 的初版手臂重定向造成雙臂／手腕反轉，已撤回。最終 Roman 的 idle／walk／run 使用既有 LOD1 動作；六條雙臂／手腕軌道在三個 LOD、61 個時間點均與原有動作相符（角差 < 0.00001 rad）。Viking 的骨架座標差異單獨處理，不再套用到 Roman。

## 固定握劍

- 已移除劍的逐幀扭腕、前臂 correction 與 alignBladeGrip；HUD 固定 OFF。保留 Bow normalization。
- Player steel sword、NPC 單手劍與工作室共用 `applySwordAttachment`；模型子節點為 identity。cancel／idle／移動不改寫固定 attachment。
- 手指使用獨立 `swordHand` morph，裝備狀態改變時才寫 influence。舊 bladeGrip 保持零；Bow morph 名稱與索引保留。
- 工作室：2 角色 × 3 動作 × 3 LOD × 61 時間點，共 1,098 次，最大握點誤差 0.000377 mm。
- 正式 NPC：idle→walk→run→walk→idle，共 900 次跨 LOD 取樣，最大誤差 0.000334 mm；所有固定 attachment matrix 保持相同。
- 手背、斜向指節、全身與俯視已檢查：握柄位於手掌、四指彎曲包覆；Roman 雙臂保持原有方向，移動無劍柄漂移。部分早期掌側／指尖視角被身體遮擋，已排除，改用可見的斜向指節視角。

## Bow 保留／工程驗證

- 正式 `?nolock`：Player 步行、奔跑、拉弓、放箭、回劍；劍 morph 1→0→1、Bow morph 0→1→0，箭數 30→29，attachment matrix 不變。
- Bow 三段、兩角色、三 LOD 已拍攝，所有劍 morph 為零。Viking 原有 Bow LOD1／2 的右臂姿勢與 LOD0 不一致；其原始 Bow 軌道、骨架 rest 與 normalization 未被本輪改寫，列為既有 Bow 問題，不宣稱已修復。
- `verify-sword-asset-preservation.mjs` 證實六份 GLB 的網格、蒙皮、inverse bind、材質、貼圖位元組與所有未選動畫（含 swordSlash、Bow）保持原樣，manifest SHA-256 相符。
- 動畫修復使用版本化的原始 LOD1 動作快照，不取前次輸出作為輸入。連續重跑的六份 GLB SHA-256 完全一致。
- 217 項既有／新測試全過後，另新增 Roman 原始手臂保護測試；相關 8 項測試及 build 通過。

## 可重跑證據

- `output/playwright/sword-restored/gallery.html`、`measurements.json`：工作室固定握點與畫面。
- `output/playwright/sword-npc/`：正式 NPC 動作、過渡、全身／俯視。
- `output/playwright/sword-release/`：正式 Player 裝備與 Bow 切換。
- `output/playwright/sword-bow-regression/`：Bow 三段、三 LOD。
- `output/sword/preservation.json`：資產保留檢查。

以上為劍 idle／walk／run 的 Phase B gate；攻擊資產尚未修改。低 LOD 的既有 Bow 問題保留列示。
