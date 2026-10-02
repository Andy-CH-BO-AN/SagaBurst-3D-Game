---
name: environment-art
description: 美化 SagaBurst 地形、季節環境、樹木、草地與可破壞營地物件，調整 outpost 佈局並驗證實際畫面、碰撞與繪製成本。不處理人物、坐騎資產或新增戰役規則。
---

# SagaBurst environment art

讀 `ai_share/AGENTS.md`，先看現有場景畫面再改。沿用使用者選定的風格；改色、程序幾何或外部資產都可以，依實際需求選擇，不把本次的低多邊形造型固定成所有任務的要求。

## 修改位置與契約

- 戰役由 `src/Game.ts` 把守方陣營傳給地形及天空；雪地依維京守方選擇，羅馬守方與一般自訂戰鬥沿用草地。Career Town 另由 `TownScene.ts`／`TownWorld.ts`／`TownWartime.ts` 管場景、建物與受攻擊狀態；先確認本次改的是哪條入口。
- `src/world/Terrain.ts` 的 `getTerrainHeight()` 是物件貼地與移動的共同來源。`Meadow.ts` 管地表材質、道路磨損與草叢；`Sky.ts` 管霧、天空及光照。外觀任務不要默默變更物理高度或全域陰影解析度。
- `EnvironmentVisuals.ts` 製作共用物件外觀；`CampaignOutpost.ts` 擁有佈局、碰撞、陣營、HP 與註冊。羅馬營地在 -Z，維京在 +Z；檢查兩邊的完整物件範圍，不能只檢查中心點。拒馬在營內兩翼，保留營門到中央的通道與守軍生成區。
- 保留營牆既有高度與射擊規則。幾何細節必須跟隨可破壞 root、gate hinge；破壞後從 live obstacles 和 hit meshes 移除。裝飾不能留在空中，也不能意外引入導航障礙。
- 布邊、繩樁、木牆橫樑沿地形貼合；帳篷屋頂不隨地面每個起伏一起彎曲。可獨立變形的幾何不要共用同一份可寫資料。

## 外觀與成本

- 優先重用現有 `ProceduralMaterials.ts`。靜態細節按材質合併，重複草叢/木樁使用 instancing；不要為每根草或繩索增加獨立 draw call。
- 草叢按區塊保留剔除能力。shader 淡出只隱藏外觀，仍會提交頂點；遠距離區塊應停止提交。移到 LOD 父節點後，instance 座標與 shader 世界座標必須同時更新。
- 顏色、草密度、枝葉與火焰需在近景及遠景檢查；特別看重複紋理、細草閃爍、木頭過黑、幾何交疊和坡地懸空。用固定種子方便對照。
- 合併模型或減少提交數不能直接宣稱 FPS 改善；真正效能 A/B 使用 [sagaburst-performance-benchmark](../sagaburst-performance-benchmark/SKILL.md)。

## 驗收

使用 [combat-browser-validation](../combat-browser-validation/SKILL.md) 的 Playwright CLI 流程。驗證實際受影響的入口；Career Town 改動需進城鎮，outpost 改動檢查：`?campaignoutpost=roman&nolock`、`?campaignoutpost=viking&nolock`，以及正式入口的相關戰役或自訂戰鬥。兩個 outpost URL 是 DEV 預覽，不能證明正式戰役權限正常。

若修改碰撞或互動，驗證營門開關、有人/馬時拒絕關門、破壞移除，以及陣營鏡像。正式戰役 G 鍵在第一個攻方 NPC 成功生成後解鎖；部署中、死亡與觀戰時不可操作。這是目前產品契約，只有使用者要求時才更動。

執行相關測試與 production build；raw 圖片與探針放 ignored `output/`。PR 說明實際可見結果及測過的場景，明確區分既有失敗與本次回歸。
