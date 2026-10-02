---
name: add-combat-animation
description: 匯入或重定向 SagaBurst 戰鬥動畫，串接裝備選擇與命中事件，修正步戰／騎乘握持、軌跡及動作恢復。
---

# 戰鬥動畫

使用正式 registry／controller 完成動作。Playwright CLI 負責瀏覽器驗證；來源取樣、重定向與 GLB 重建仍由資產工具處理。

## 資產與動作

- 先定位 `CharacterCombatAnimator`、Player/NPC 動作選擇、`CharacterEquipmentPose` 與 attachment 契約。確認武器、盾、坐騎及需覆蓋的 LOD；未要求時保留傷害、射程、攻速與其他動作。
- 匯入／改骨架時讀 [humanoid-rig-skinning](../humanoid-rig-skinning/SKILL.md)。保留授權、來源 hash、完整 take 的 frame/FPS 與可重建步驟；來源原檔不放 runtime bundle。
- 正式前方是 local `+Z`。依解剖／掌心座標重定向，不能只匹配骨名。位移由 gameplay 管理，移除來源 root translation/scale 與非預期位移。
- 只替換指定 clips，覆蓋所有必要 LOD；比對基準，保留 mesh、skin、bind、material、texture、socket 及其他 clips，同步 manifest 名稱。
- 斧頭流程可參考 [tools/axe-attacks.md](../../../tools/axe-attacks.md)，但接觸幀與握點須依本次資產量測。Maki 的側身弓姿與已烘焙握點見 [posed-source characters](../humanoid-rig-skinning/references/posed-source-characters.md)。

## Runtime 契約

- 攻擊開始時從實際裝備選定 action，該次固定、下次反映換裝；不由 preset 名稱或預覽 mesh 推斷持盾。Player/NPC 都走一致規則。
- 命中由 animator 單一時鐘／事件驅動。依重定向後的實際接觸幀設 hit time；正常前進、跨門檻大步長、距離節流皆只命中一次，取消不補發。
- 完成／取消恢復最新 idle、walk、run 或 mounted 狀態及 attachment；切 LOD 不重啟動作。預覽 normalized phase `[0,1]` 與秒數不可重複換算。
- 骨架姿勢與武器 attachment 分開控制；旋轉 attachment 時重算繞掌心的位置以防滑手。來源拿斧頭不代表可換掉角色現在拿的弓。
- mixer 後套 pose correction、下次 sample 前還原；每項關節修正只有一個 owner。已烘焙握點以 `bakedEquipmentActions` 排除相同 runtime solve，不移除其他裝備姿勢。
- 持盾保留左手盾姿；雙手動作檢查副手實際握持。騎乘以正式骨盆 seat 校準，從側面／正面檢查整把武器、盾、騎士與坐騎；劈砍接觸前後的世界軌跡須穿過預期目標區。

## 驗證

- 依 [combat-browser-validation](../combat-browser-validation/SKILL.md) 直接用 Playwright CLI：先正式 controller 的工作室，後相關戰鬥流程；檢查起手、接觸、收招、換裝、上下馬與必要 LOD。
- 針對本次改動驗證一次性事件、取消／恢復、Player/NPC 一致性、握點與 LOD 連續性。軌跡數字或中心線 ray 不能代替完整外觀與穿模檢查。
- 執行相關測試及 build；共用動畫／資產管線變更再跑完整測試。資產改動另驗證 finite transforms 與未修改資料的保留。一次性證據放 ignored `output/`。
- 回報實際行為、來源、驗證範圍與未解限制；不將單次驗收步驟追加成永久專案規則。
