# 最小 Idle + 前刺／騎馬持劍

2026-09-16 後續要求已完成：長槍向前戳，騎馬持劍採相同朝前方向。待機人體仍沿用原 Sword Idle；僅在攻擊時右臂 FK 伸展並保持原手部方向。没有 Lance Ready、IK、雙手支撐或新手型。

- Roman／Viking、馬上／馬下、有盾／無盾：前刺前伸 20.4–21.1cm，槍線與 +Z 夾角 < 8°；固定 attachment 不動，三 LOD 握点保持一致。
- 保留 .38／.228 秒單次命中、.70／.42 秒完成；上下馬不中斷當前時序，取消不補發命中。非右臂骨骼與相同情境基底一致。
- 騎馬持劍使用 Lance 校準方向與 Sword 原掌內握點；下馬回復 Sword 原掛點，劍仍沿用既有攻擊。
- Chrome 實機近景已檢查 Roman 持盾騎乘 Peak；批次瀏覽器截圖／數值見下方工具。基底原有 Roman 衣物破面與手指造型保留，未為握法重製資產。

本次可直接檢閱的截圖與量測已納入 [`final/`](final/)；完整驗收摘要見 [acceptance.md](acceptance.md)。下列完整批次圖片留在本機忽略的 `output/`，可用工具重現。

本次證據（路徑由 repository root 起算）：

- `output/playwright/lance-thrust/`：兩陣營八種組合，Ready／Windup／Thrust／Peak／Recovery／Return 近景與全景，以及騎馬 Sword／Lance 對照，共 104 張；`measurements.json` 零應用錯誤。
- `output/playwright/equipment-gameplay/`：本次已重跑正式 Player／NPC，112 個取樣、336 張圖，零失敗／零應用錯誤；包含持盾禁弓與卸盾射箭回歸。
- `output/playwright/equipment-gameplay-sword/`：兩陣營正式 Player／NPC 騎馬持劍，有盾／無盾 56 個取樣、168 張圖，零失敗／零應用錯誤。
- `output/playwright/equipment-scenes/`：戰馬工作室 36 個步態／前刺取樣及 release／stress 場景零應用錯誤。Headless FPS 分別 2.4–2.7／0.94–0.98／0.58–0.59；僅診斷，不視為效能驗收通過。工作室 console 有 GPU ReadPixels stall 警告；資源數及完整記錄保存在 measurements.json。
- 最終工程檢查：28 檔、246 項測試及 production build 通過。
- 原 `equipment-pose` 的人體工學姿勢仍為歷史失敗版本，不是目前證據。

```sh
rtk proxy node tools/qa-lance-thrust.mjs
rtk proxy node tools/qa-equipment-gameplay.mjs
rtk proxy node tools/qa-equipment-gameplay.mjs --sword
rtk proxy node tools/qa-equipment-scenes.mjs
```

---

# 前一階段：Roman Sword Idle + Lance 最小版

2026-09-16，`feature/shield-ready-lance-thrust`。

使用者最新要求已取代先前長槍人體姿勢計畫。本輪只保留既有 Sword Idle 人體，將 Sword 換成朝角色 +Z 的 Lance。不得繼續加入掌心朝上校正、肩臂旋轉、IK、雙手支撐、Lance 手型 morph 或程序 Ready。

## 實作

- Lance 主握點 `(0,.15,0)`，右手掌內握點直接沿用 Sword 的既有校準。
- 載入時取樣既有 idle 的 .25 秒，計算模型在手骨中的固定 rotation；完整還原來源骨架。逐幀不修正人體或武器 pivot。
- Player／NPC／工作室沿用同一固定 attachment；沿用 Sword 的既有手型，沒有新增 Lance morph。
- 移除先前 Lance 專用骨架姿勢與 profile。盾牌裝備功能及獨立盾牌／mounted 層保留；已補驗 Roman 待機持盾／騎乘組合。
- 騎乘使用既有 idle 上身軌道取代空 mounted clip，避免 T-pose；pelvis／mounted 腿姿與鞍座不變。固定模型掛點向外偏 0.14 rad，槍桿在待機時避開馬鬃。
- 原攻擊事件時間軸保留；最小版未製作前刺動作。舊 18cm reach／雙手接回驗收現在不適用。

## 驗證與截圖

- 全部 28 個測試檔、240 項測試與 production build 通過。
- 正式骨架比較 Sword ↔ Lance：兩陣營、三 LOD、idle／walk／run／mounted 的所有骨骼 transforms 相同。
- Roman 無盾 Idle 的瀏覽器比較：LOD0／1／2 全部骨骼與手型 morph 權重相同；握點誤差 < 1mm，槍朝 +Z（步戰夾角約 7.7°，騎乘約 3.4°）；無應用程式錯誤。
- 同角度人體外觀一致，俯視槍線在右側、沒有橫穿身體。原 Sword baseline 自帶的羅馬肩部衣物破面保留，沒有透過修改骨架掩蓋它。

[原 Sword 近景](minimal-idle/roman-sword-lod0-close.png) · [Lance 近景](minimal-idle/roman-lance-lod0-close.png) · [全身](minimal-idle/roman-lance-lod0-full.png) · [俯視](minimal-idle/roman-lance-lod0-top.png) · [完整量測](minimal-idle/measurements.json)

```sh
rtk npm test -- --run
rtk npm run build
rtk proxy node tools/qa-lance-idle-minimal.mjs
rtk proxy node tools/qa-lance-idle-minimal.mjs --combinations
```

畫面來源：`http://127.0.0.1:5173/?devmodels=humans&nolock`，相同 Roman Idle 角色、時間與鏡頭，僅切換武器；三個 LOD 共 18 張圖。

本節僅記錄前一階段 Idle 驗收。最新前刺與正式 gameplay 的重跑結果以上方章節為準。

## 持盾／騎乘補驗

三種情境各驗三個 LOD，全部人體骨骼、既有手型權重與相同情境的 Sword baseline 一致。近景／全身／俯視共 54 張，無應用程式錯誤，盾牌與槍的握點誤差 < 1mm。

- [步戰持盾](minimal-idle/combinations/roman-lance-foot-shield-lod0-full.png)
- [騎乘無盾](minimal-idle/combinations/roman-lance-mounted-no-shield-lod0-full.png)
- [騎乘持盾](minimal-idle/combinations/roman-lance-mounted-shield-lod0-full.png)
- [騎乘持盾俯視](minimal-idle/combinations/roman-lance-mounted-shield-lod0-top.png)
- [量測與姿勢比對](minimal-idle/combinations/measurements.json)

騎乘以槍桿中心線與半徑 .022m 的八條周邊線測試可見馬匹 mesh，固定待機取樣未相交；不等同完整碰撞體或所有步態驗收。先前空 mounted clip 的 T-pose 截圖已由本次結果覆蓋。維持最小版範圍，不製作新的 Lance 人體姿勢或前刺。
