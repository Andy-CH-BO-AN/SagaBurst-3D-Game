# Shield / Lance / Mounted Sword 驗收

此變更沿用現有 Sword Idle 作為 Lance 待機人體基底。攻擊期間才加入小幅右臂 FK 伸展；沒有新增 Lance Ready、IK、掌心朝上校正、雙手支撐或 Lance 手指 morph。盾牌仍使用獨立左臂裝備層。

## 最終行為

- 裝備盾牌時固定持於左手；步戰、騎乘、長槍及剩餘彈藥不再觸發背盾。
- Roman／Viking 近戰步兵與長槍騎兵預設配同階陣營盾；遠程兵預設無盾。配盾會啟用原有被動減傷，公式不變。
- 裝備 UI 可卸盾並沿用 nullable 存檔；持盾瞄準顯示卸盾提示，裝盾取消拉弓而不補發箭。切換近戰武器或盾牌取消未完成動作。
- Lance 使用固定握點，Player／NPC 共用 builder；模型朝角色 +Z、稍微外偏。各 LOD 先還原程序基底、更新 mixer，再套裝備／騎乘姿勢，最後同步 sockets。
- 長槍前刺 20.4–21.1cm，握點全程跟手，側移 < 5cm、與前方夾角 < 8°；收招與取消回復當下 locomotion。軀幹、左臂及腿部不受前刺覆蓋。
- 馬下命中 .38s／完成 .70s；馬上命中 .228s／完成 .42s。上下馬保留已啟動攻擊時序。
- 騎马 Sword 使用 Lance 校準方向與原 Sword 掌內握點；下馬恢復步戰 attachment。劍攻擊維持原 clip 與 .252s 命中。

## 工程與瀏覽器結果

- `rtk npm test -- --run`：28 檔、246 項通過。
- `rtk npm run build`：通過；原 Vite CJS / 大 bundle 警告保留。
- 工作室：兩陣營 × 馬上／馬下 × 有盾／無盾，六階段 96 張圖，加 8 張騎馬劍／槍對照；零應用錯誤。
- 正式 Player／NPC Lance：112 取樣、336 張圖，零失敗／零應用錯誤。含持盾禁弓、卸盾射箭與裝盾取消蓄力。
- 正式 Player／NPC mounted Sword：56 取樣、168 張圖，零失敗／零應用錯誤。
- 戰馬工作室：idle／walk／gallop，各 3 步態時間點 × 有盾／無盾 × Ready／Peak，36 次取樣；pelvis-to-seat gap 均約 2.8cm。
- release (`?nolock`) 與 100 人 cavalry stress (`?devcombat&nolock`) 零應用錯誤；UI 卸盾操作通過。

| 自動化場景 | FPS | draw calls | geometries | textures |
| --- | ---: | ---: | ---: | ---: |
| 戰馬工作室 | 2.4–2.7 | 84 | 184 | 276 |
| release，14 NPC | 0.94–0.98 | 1465 | 395 | 436 |
| stress，100 NPC | 0.58–0.59 | 3318 | 1272 | 1438 |

上述為 headless 自動化環境的診斷數據；**未通過效能驗收**，也未以這些數字推論硬體加速瀏覽器的實際 FPS。戰馬工作室另有 GPU ReadPixels stall 警告。

## 可檢阅證據

- [Roman 騎乘 Ready](final/roman-mounted-no-shield-ready-full.png) / [Peak](final/roman-mounted-no-shield-peak-full.png) / [Return](final/roman-mounted-no-shield-return-full.png)
- [Roman 步戰 Peak 近景](final/roman-foot-no-shield-peak-close.png)
- [Viking 騎馬持盾 Peak 近景](final/viking-mounted-shield-peak-close.png)
- [Roman Player 騎馬劍盾](final/roman-player-mounted-shield-ready-0.250-full.png)
- [Viking NPC 騎馬持劍](final/viking-npc-mounted-no-shield-ready-0.250-full.png)
- [前刺量測](final/lance-thrust-measurements.json) / [正式長槍](final/equipment-gameplay-measurements.json) / [正式劍](final/equipment-gameplay-sword-measurements.json) / [場景資源與 console](final/equipment-scenes-measurements.json)

## 已知範圍與限制

原 Sword Idle 的 Roman 肩部衣物破面與既有手指造型保留。未重烘六份 GLB、未重製肩部蒙皮，也不宣稱人體工學持槍／握指已完善。Viking Bow 低 LOD 差異仍為既有基線。

`minimal-idle/` 是先前最小 Idle 階段的歷史比對；當中 mounted Sword 圖尚未套用本次朝前掛點，最新姿勢以 `final/` 為準。完整原始截圖在忽略的 `output/playwright/`；上方精選圖與完整 JSON 已納入 Git。

## 重跑

啟動或沿用 5173 的 Vite 後：

```sh
rtk npm test -- --run
rtk npm run build
rtk proxy node tools/qa-lance-thrust.mjs
rtk proxy node tools/qa-equipment-gameplay.mjs
rtk proxy node tools/qa-equipment-gameplay.mjs --sword
rtk proxy node tools/qa-equipment-scenes.mjs
```
