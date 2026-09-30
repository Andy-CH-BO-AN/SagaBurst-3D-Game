# Roman T4 頭盔與鞋護脛替換驗收（2026-09-28）

T4 的三層資產已移除 `Helmet3` 和 `Praetorian_face_mask` 的節點、網格及專用材質／貼圖，僅使用 `Praetorian_Roman_helmet`。未改動 `src/`、其他羅馬層級或其他陣營。

來源是 stratovarius1980 的 [An ancient Roman helmet](https://sketchfab.com/3d-models/an-ancient-roman-helmet-00be37c8062c430daad5686d4f17916f)，授權 CC BY 4.0。原檔與雜湊／授權資訊保存在 `artifacts/character_sources/roman-helmet/`。來源 API 與 GLB 內嵌授權一致。**使用者已明確確認保留此新資產原有的一體式護面／護頰**；沒有沿用舊面罩，也沒有新增面罩、鬍鬚、皇冠或裝飾幾何。

## 貼合與材質

- 人物頭部位置、比例、頂點、UV、權重與皮膚貼圖保持原樣。頭盔以離線尺度、朝向與位置調整，剛性掛在既有 `head`，人物 runtime scale 仍為 `(1,1,1)`。
- 來源以 +X 為前方；旋轉至遊戲 +Z，來源世界軸比例為 `(0.43, 0.30, 0.375)`，中心位移 `(0, 1.84, 0.004)` 公尺。未增加任何幾何零件。
- 額頭及後腦截面各 LOD 約 1,140 次射線取樣，最小外表面間距約 19 mm。這是特定截面的量測，不代表全表面或逐幀碰撞證明；眼孔、鼻部、耳側與護頰另外以近照檢查。
- 主鋼色與金色從 T4 `Armour_top_TXTR` 取樣，sRGB 中位數分別為 `(0.133,0.145,0.161)`、`(0.584,0.447,0.231)`。Metallic 0.62、roughness 0.48 與胸甲完全相同。
- 現有身甲是深鋼、金邊與深藍布料；頭盔沒有原有紅色部件，因此未另畫新的紅色區塊。紅色盾牌與所有身體材質保持原樣。
- 只對來源網格減面，再將原始色彩重新烘焙至各 LOD 的 UV，避免原 atlas 的大量小島在減面後產生方塊色斑。保留原有羅馬輪廓、眼孔、護頰和紋飾。

| LOD | 全角色三角面 | 頭盔三角面 | 頭盔貼圖 |
| --- | ---: | ---: | ---: |
| 0 | 61,007 | 11,000 | 2048² |
| 1 | 20,599 | 3,800 | 1024² |
| 2 | 6,431 | 950 | 512² |

## 已完成驗證

- `tools/audit-roman-hero.mjs`：三層通過，未發現舊頭盔／舊面罩、缺骨、異常權重或超出既有預算；每個 clip 取七個時間點。
- 與修改前 T4 GLB 逐項比對：所有保留的身體／頭部 attributes、indices、inverse bind matrices、骨骼 rest transforms、動畫 input/output bytes，以及未被替換的身體貼圖相同（鞋護脛另行替換）。武器、事件、戰鬥與 AI 程式未修改。
- 可見的本機 Chrome，由 Playwright CLI 控制；既有 Chrome DevTools 連線被使用中的 profile 阻擋，因此採獨立瀏覽器。沿用既有 Vite 伺服器。
- `http://localhost:5173/?devhero=roman-t4&nolock`：最終匯出後重新載入，逐層檢查正面、嚴格側面及 3/4 頭部近照；walk、run、swordSlash 各取 0.15、0.50、0.85 normalized time，另檢查全身與普通羅馬人並排。未觀察到額頭／後腦穿出、臉穿護頰、盔體懸浮或動作中脫離。耳朵位於原頭盔側開口，未被新增幾何覆蓋。
- `http://localhost:5173/?nolock`：標準 10v10、羅馬 T4 玩家、步戰、Centurion Blade。以鍵盤移動與滑鼠揮劍，檢查活動幀及收招；runtime 確認有新頭盔、沒有 `Helmet3`／舊面罩。沒有應用程式錯誤；僅 favicon 404。
- 專項測試 `tests/RomanHeroAssets.test.ts`：9/9 通過，包括三層附件隔離、來源雜湊、材質對齊、舊網格移除和既有動畫契約。
- 完整測試：1,020 通過、2 失敗。兩項皆是未修改的 `BattleStatsView.test.ts` 千分位格式預期（`1,284`／`5,820`），原因是現有 `BattleStatsView.ts` 正則表達式的雙重跳脫；本次不擴大修復。
- 最終 `npm run build` 通過。既有大型 bundle／Maki 動態匯入提示仍在。

低 LOD 既有肩部／衣物接縫及皮膚露出仍可見，未列為此次頭盔修復成果。沒有聲稱完成逐幀布料碰撞或全動作無穿模。原始截圖、接觸表、結構量測及比對結果位於 ignored `output/roman-helmet/`。

## 重製

需 Blender，以及含 Pillow／numpy 的 Python；以 `ROMAN_HERO_BLENDER`、`ROMAN_HERO_PYTHON` 指定。

- 只替換既有 T4：執行 `node tools/replace-roman-helmet.mjs`，接著執行 `node tools/replace-roman-greaves.mjs`，再執行 `node tools/audit-roman-hero.mjs`。這條路徑保留現有動畫二進位資料，是本次交付使用的流程。
- 完整人物重建：既有 `build-roman-hero.mjs` 已移除面罩生成，並在身體建立後呼叫頭盔與鞋護脛替換；之後沿用 `retarget-roman-hero.mjs`、`audit-roman-hero.mjs`。完整 contact bake 並非本次交付流程，因為本次保留原動畫資料。
- `prepare-roman-helmet.py` 僅從保留的原始 GLB 產生 LOD／貼圖烘焙；`roman-helmet-textures.py` 從当前 T4 身甲取色。`--prepared` 可重用已完成的本機烘焙，不依賴一次性網路下載。

## 追加：涼鞋與護脛

使用 Tactical_Beard（GLB 內署名 Tactical_Gamer）的 [Roman Centurion Armor](https://sketchfab.com/3d-models/roman-centurion-armor-d0c6de99f16c49f386a9f8d7c3120dec)，CC BY 4.0。來源原檔及 SHA-256 保存在 `artifacts/character_sources/roman-centurion/`。僅使用原有成對鞋／護脛與四枚扣件，未使用其上身盔甲。

- 移除 T4 原 `Boots` 網格，替換為 `Praetorian_centurion_footwear`。人物足部、小腿、骨架與動畫資料保持原樣。
- 分別校正左右腳站距、鞋楦、腳背、小腿中心與護脛高度；以皮膚表面投射補足腳踝包覆，使用實際足部表面的重心插值轉移骨骼權重。鞋底前緣做小幅弧度調整，維持既有動作的接地誤差檢查。
- **依使用者最後澄清保留涼鞋原有露趾開口；腳踝需要包覆。** 未封閉鞋頭，未縮小或改造人物雙腳。護脛鋼色取自胸甲，皮革取自現有腰帶（與舊鞋使用相同深棕處理），保留來源 UV、正常貼圖及原有紋飾。
- 三層鞋護脛三角面：5,590 / 1,830 / 942；全角色仍在 64,000 / 22,000 / 7,000 預算內。LOD0 相較替換前整體少 1,070 面。
- 最終 GLB 再次通過資產 audit、9 項專項測試與 production build。逐位元比對修改前 T4：各 LOD 13 個保留身體網格、244 個動畫通道、骨骼 rest transforms 與 inverse bind matrices 未改動。
- 最終匯出已檢查正面、側面、背面及 3/4 視角，以及 walk/run/swordSlash/mounted/death 取樣；另進入標準 10v10 以 T4 玩家實際移動、揮劍和收招。近距離腳踝包覆改善，來源露趾開口仍可見。最後一次使用者指示不再細修遠距離模型，因此不承諾低 LOD 所有細小接縫完全消失。
- 結構報告與完整截圖位於 ignored `output/roman-greaves/`。完整測試的兩項既有千分位失敗同上，未修改其程式。
