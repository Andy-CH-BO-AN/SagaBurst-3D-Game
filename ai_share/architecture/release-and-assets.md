# 發布與資產網址

範圍：分支／部署、Vite base、Runtime GLB／KTX2 載入與 CI 資產驗證。索引與共通規則見 [ARCHITECTURE.md](../ARCHITECTURE.md)。

開發使用 `dev`，正式部署與 tag 來源使用預設分支 `main`；功能 PR 先進 `dev`，驗證後再以 PR 推進 `main`。Web 與 Electron 共用 `src/`，`vite.config.ts` 分別輸出 Pages 的 `dist/`（`/SagaBurst-3D-Game/`）與桌面版的 `dist-desktop/`（`/`）。Public runtime 資產透過 `src/assets/publicAssetUrl.ts` 使用 Vite base，音效／語音由 `SoundManager` 集中播放：既有錄音使用 Vite URL，尚未錄製的 Dismiss 使用可選的 `public/audio/career/{roman,viking}/dismiss.wav`，缺檔安靜略過，下次命令重試；新增音檔無須修改命令接線，打包版本需重建。Electron 僅以 `sagaburst://game/` 提供打包內容與安全視窗，沿用原本 Web storage 與存檔格式。發版與 GitHub 一次性設定見 [RELEASING.md](../../docs/RELEASING.md)。

所有發布 GLB 由 `src/world/RuntimeGltfLoader.ts` 的 `createRuntimeGltfLoader()` 載入：共用一個 KTX2Loader（`KHR_texture_basisu`，transcoder 沿用 `models/mounts/v1/horse/basis/` 的 Three 隨附版本）與 MeshoptDecoder；外部 `.ktx2` 貼圖用 `sharedKtx2Loader()`。GPU 格式偵測延到第一張 KTX2 貼圖載入時，取自第一個呼叫 `registerTextureRenderer` 的 renderer（`createSceneRenderer`、Town、晉升頭像），建立 loader 本身不需 WebGL。貼圖預算與 LOD 縮減由 `tools/apply-runtime-glb-budget.mjs` 依 `tools/data/runtime-glb-budget.json` 套用：LOD0／坐騎上限 2K、武器盾牌 1K；底色 ETC1S（sRGB），金屬粗糙度／AO／法線 UASTC（linear）並含完整 mip；LOD 只做 index-only、保留 UV 縫線的縮減。人物 manifest 只改 `fileSha256`，實際面數與貼圖記在 audit 列與 `tools/data/runtime-glb-budget-audit.json`。Xongkoro 因 render-bounds 以來源雜湊把關而維持原 PNG。瓦良格隊長 LOD2 合併的稽核雜湊已在證明 accessor 與場景／蒙皮／動畫 JSON 不變後更新；羅馬 LOD2 合併的稽核雜湊在 `dev` 已不符（LOD2 動畫修剪後未重審），此 pass 維持停用。

CI 資產驗證（`tests/tooling/ci-assets.cjs`）接受只經必要 `KHR_texture_basisu` 參照的 `image/ktx2`；除人物與登錄武器外，另驗證坐騎包（`mounts/v2`：manifest 雜湊、clips、LOD 節點、證據 JSON；`sha256`／`metrics`／`modifications` 視為非執行期欄位）、建築裝飾（`ornaments-sources.json` 雜湊）與聖騎士／Maki 弓（單檔 final 雜湊）。舊格式人物包以 `tools/normalize-humanoid-records.mjs` 補齊 CI 紀錄（ATTRIBUTION、JSON 授權證據、bone map、`lod-publication-audit.json`），內容只取自既有 manifest 與證據。
