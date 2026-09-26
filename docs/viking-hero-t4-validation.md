# 維京英雄 T4：資產、DEV 預覽與人物製作 skill 報告

本次新增可載入的獨立 `viking-hero-t4` 人物資產、DEV 預覽，並把製作時的幾何、蒙皮、材質與驗證卡點整理為 `humanoid-from-reference` skill。T4 只作為英雄資產定位，不是正式 UnitTier。

工作分支 `codex/viking-hero-t4` 從當時最新 origin/main `7ed3860e4125e1a5ca48e4535de9c8d695b07ea8` 建立；原工作樹維持未修改。PR 以 Draft 提供檢視：載入及程式測試通過，但仍有下述美術限制，沒有宣告全部 Phase 1 驗收完成。

## 修改檔案與預覽方式

- `public/models/characters/v2/viking-hero-t4/`：LOD0／1／2 GLB、內嵌貼圖、manifest、骨骼映射、真實量測、audit 與 attribution。
- `tools/build-viking-hero.py`、`retarget-viking-hero.mjs`、`audit-viking-hero.mjs`：可重製 Blender 建模、離線 retarget 與 GLB 驗證；清理 output 後建模腳本會自行重建來源輸出目錄。
- `src/main.ts`、`src/debug/VikingHeroPreview.ts`：DEV-only 動態入口 `?devhero=viking-t4`。中性照明、正交正／側面、自由旋轉、同尺度比較、動畫固定時間、裝備、LOD、黑貓與腿部近看。
- `src/world/HumanoidAssetRegistry.ts`、`src/debug/HumanoidStudioPlayback.ts`：最小 assetId 描述介面及可選的固定時間取樣，保留一般角色的預設呼叫方式。
- `tests/VikingHeroAssets.test.ts`：實際 GLB 載入、獨立 skeleton／mixer、動畫時序、錯誤資產拒絕。
- `ai_share/skills/humanoid-from-reference/SKILL.md`：共用 skill；`.codex/skills/` 和 `.agents/skills/` 提供連到同一來源的入口。
- `docs/viking-hero-t4.md`：操作與重製方式；本文件為 PR description 的完整來源，不以 SKILL.md 取代報告。

在本分支執行 `npm run dev`，開啟該伺服器的 `/?devhero=viking-t4`。本輪實際預覽使用 5174 連接埠。選 `run` 的固定時間 0.25／0.75 可檢查交替抬腿；選 `mounted` 檢查黑貓跨坐；構圖選「腿部與靴筒」可檢查腳踝。

## 最新修改

保留原臉與短鬍鬚；沒有長鬍鬚。移除舊盔頂、內襯、側板。原先貼臉的眼眶／鼻樑護具與量測頭型的新盔殼，已在 Blender 中以額頭過渡面融合、平滑化為一體。頭側鎖子甲以原頭部外表面取樣，使用對應的頭頸蒙皮。

上衣補上封閉胸腹表面並融合交疊層；連續腿部表面跨過膝蓋和腳踝，接回原靴型。靴筒、鞋面改為封閉實體融合，按原鞋口實際中心（非腳部骨骼中心）收窄對齊，重塑腳踝漸縮曲線並修圓，兩側使用同一套腳踝權重。鎖子甲與頭盔共用銀灰金屬底色、金屬度與粗糙度，環紋由法線呈現。鎖子甲下擺改成包覆左右實際大腿的四片表面，腰下沿用對應腿部的變形權重；跑步 0.15／0.45 秒與騎乘的瀏覽器取樣未再出現原先的大面積大腿穿入。藍紫披肩與背部披風焊接，三節輔助骨隨軀幹變形，騎乘另有預先烘焙姿勢。武器、盾牌來自現有裝備系統。

## 真實 GLB 量測

Blender 角色本體設計高度 2.000 m；裸足基準面 0.033560 m，頭皮最高點 2.033560 m；鞋底最低點 0 m。下表是 GLTFLoader 從最終匯出 mesh 重新量測，減面造成的次毫米差異沒有改寫成理想值。Root scale 為 (1,1,1)。肩關節跨度 0.5291 m；外肩量測 0.6998 m（rest pose 肩關節高度 ±25 mm 的上衣截面）；頸長 0.1098 m。

| LOD | 三角面 | 本體高度 m | 含盔鞋高度 m |
|---|---:|---:|---:|
| LOD0 | 57,989 | 1.999512 | 2.095998 |
| LOD1 | 19,484 | 1.999576 | 2.095978 |
| LOD2 | 5,888 | 1.999192 | 2.094898 |

貼圖全部內嵌，實際尺寸由 `audit-images-lod*.json` 記錄：LOD0 最大 2048、LOD1 最大 1024、LOD2 最大 512。授權與來源雜湊保留於資產 attribution、manifest。

## 已執行

- 發 PR 前再次執行全套 Vitest：86 個檔案、940 項通過（timeout 20 秒）。一般 5 秒門檻初跑時 EquipmentPose 有一次逾時，單獨及全套 20 秒重跑均通過。
- 最後資產更新後，VikingHeroAssets 8 項通過：三個 GLB 實際載入、骨架與 mixer 獨立、無額外角飾、事件時序／時長一致、缺骨／缺 socket／缺動畫明確拒絕。
- 最終 GLB audit：全部必要骨骼、socket、披風骨骼、4 權重正規化、面數預算、SHA-256、真實身高、每 LOD 12 個 clip × 7 個時間點 CPU 蒙皮包圍盒；failures 空集合。另執行現有 structural audit 與 Blender image audit。
- Chrome 實際 GLB：idle、walk、run、axeAttack1H、axeAttack2H、mounted、death 的代表時間取樣；LOD0/1/2 切換；較低 LOD 另取樣雙手斧與騎乘。已實際擷取瀏覽器畫面，沒有使用 Blender 靜態畫面替代；暫存證據的清理方式見下文。
- 一般首頁及既有 `?devmodels=humans&nolock` 預覽實際載入；一般維京與羅馬顯示、播放，瀏覽器沒有應用程式 error。
- `verify-axe-assets.mjs origin/main`：一般 Viking/Roman 的 3 個 LOD 的 geometry、skeleton、existingClips、manifestHash 均一致。
- `git diff --check` 通過。正式 UnitTier、Game、Player、NPC、戰役、傷害、AI、尋路、坐騎物理沒有修改。DEV 模組從正式 Vite JS bundle 消除；一般入口不呼叫英雄預載，也不改寫戰鬥 sessionStorage。
- `npx vite build` 通過（既有大 chunk 警告）。
- 新 skill 通過 skill-creator 官方 `quick_validate.py`；所有相對參考及 `.codex`／`.agents` 共用入口可正確解析。

## 未通過／尚未覆蓋

`npm run build` 中的 TypeScript 檢查被 origin/main 原有 6 個錯誤阻擋：Game.ts 的 `_saveGame` / `_loadGame` 未使用；NavigationGrid.test.ts 兩處 `.at` 的 target lib；NPC.ts 缺 `_targetReacquireTimer`；SpatialGrid.ts 的 `_getCellKey` 未使用。沒有擴大本次範圍修改正式遊戲來消除它們。

這是簡化蒙皮披風，沒有即時布料或碰撞解算。騎乘披風是預先抬起避開鞍座的姿勢；死亡沿用既有簡化倒地輪廓，鎖子甲裙仍偏硬，沒有布料攤平。領口在大幅揮斧姿勢可看到局部鎖子甲／披肩交疊；不能宣稱全動作逐幀無穿模的美術驗收已完成。LOD2 近看會有明顯稜角，僅適用遠景。

尚未進行所有插值時間的自動碰撞檢查、不同瀏覽器／GPU 視覺測試或正式戰役長時間操作；本次沒有更動那些正式流程。

## 卡點分析與寫入 skill 的規則

| 卡點 | 原因與本次處理 | 可重用經驗 |
| --- | --- | --- |
| 身高與普通人契約衝突 | 英雄使用獨立 descriptor；本體頭頂與裸足面量測分開記錄盔鞋高度 | 保持一般 Viking 1.86 m 規範；不改全域限制或偽造 manifest |
| 臉頸缺面、舊頭盔殘留 | 同一來源 mesh 混有皮膚、盔頂、內襯及護眼件，需逐 island 分類 | 不按單一高度或物件名稱粗刪；保留原臉與必要接合 |
| 新頭盔太大、頭罩懸空 | 初始外殼沒有取原頭部截面；改從體表量測貼合 | 護具跟隨真實皮膚，不用整體放大代替厚度 |
| 護眼、鼻樑與盔殼有接線 | 沿用已貼臉零件，建立額頭過渡面後融合和平滑 | 保留眼孔及鼻形，不能把舊盔整頂包進新盔 |
| 肩、腹層疊與洞 | 原背心開口、多層衣服相交；補閉合體表並清理交疊 | 遮住缺陷或開雙面材質不等於拓撲修好 |
| 膝、靴筒、鞋面斷開 | 獨立表面與不同權重，靜止能接上但彎曲會分離 | 連續表面加相容權重，驗證兩側動作極值 |
| 靴筒有台階、彎腳出現方形折痕 | 截面不一致，空心筒融合仍留內壁 | 先封閉實體並清內層，再重塑連續過渡，不只平滑法線 |
| 腳踝修圓後像腫起來 | 包覆半徑過大；腳骨中心比原鞋口偏外 | 按實際鞋口中心收窄對齊；不要把整隻鞋放大 |
| 鎖子甲比頭盔黑 | 暗色環紋 albedo 改變底色觀感 | 統一金屬底色、metalness、roughness，環紋用 normal |
| 披風側面斷口、跑步穿背 | 披肩／背片曲線與權重不一致；輔助骨缺少胸部世界變換 | 焊接相同邊界與權重，離線姿勢包含父骨 world-rest delta |
| 跑步、騎乘下擺穿大腿 | 下襬殘留 hips 權重而落後腿部 | 按左右大腿表面分片、使用相容腿部變形；再次檢查鑲邊與鞍座 |
| 命名相同但動畫不等價 | 體型、骨長和 rest pose 已改變 | 離線 retarget；不改普通人物 clips／事件來補救 |
| 固定時間仍看到上一姿勢 | action fade／初始化及取樣控制未完全一致 | 初始化後 seek、重設狀態，明確更新所選 LOD mixer |
| 已修改卻看到舊材質 | 匯出／retarget 尚未完成就刷新或截圖 | 串行等待產物完整，再重載 instance、對齊 hash 和證據 |
| 減面破壞其他部位 | remesh 局部過密，吃掉全身預算 | 控制局部來源面數，再產出每個 LOD 並量實際 GLB |
| 型別與測試結果混淆 | main 既有型別錯誤；一次 EquipmentPose 逾時 | 分開報告基線與新增問題，保留真實重跑條件 |
| output 清理後不可重製 | 建模來源目錄原本依賴既有暫存目錄 | Builder 自行建目錄；保留版本化腳本與授權來源 |

Skill 不把本英雄的頂點編號、2 m 身高、偏移量、披風選項與衣襬權重當通用常數；也不授予未來任務自動發 PR 或刪其他任務檔案的權限。

## 證據與 output 清理

本輪已擷取英雄空手正／側面、普通維京比較、頭盔近照、單／雙手斧、騎黑貓正／側面、三個 LOD、走跑、倒地與靴筒／衣襬局部畫面，也已在本次對話展示代表畫面。這是實際 Chrome 中載入 GLB 的取樣，不是生成示意圖。

依使用者要求，PR 建立並核對描述後清理本次 ignored output：工作樹的 `output/hero/`、`output/axe/`，以及原 checkout 的 `output/viking-hero-t4/`。包含暫存 PNG、日誌、探針 JSON 與可重建的 `.blend`／備份；不把它們搬進版控，也不留下 PR 中無法使用的本機圖片連結。原 checkout 的其他任務 output 不在本次清理範圍。

版本化 GLB、asset audit／hash、授權、來源腳本、測試、操作文件和 skill 保留；清理後仍可從版本化來源重建。PR 報告保留執行過的驗證紀錄，但不把已清除的暫存截圖描述為可下載附件。
