# Warriors: Dedicate Your Heart! — Progress & Handoff Notes

_Last updated: 2026-09-16 (羅馬盾牌外框與表面貼合修正)_

---

## Current Status

### 2026-09-16：羅馬盾牌外框與表面貼合修正

- 修正 `WeaponMeshFactory` 中盾板基準 Z=.02 與外框基準 Z=.15 不一致造成的分離；T1–T3 外框改由盾板正面深度推導，中央盾臍與交叉飾條一併貼合盾面。飾條沿盾板相同曲率彎曲，原背面握點／角色骨架與裝備掛點保持不變。
- 新增三階級幾何回歸測試：取樣每個外框管環至實際盾板三角形的距離、盾臍與盾面重疊，以及飾條頂點至盾面的距離。
- 29 檔、249 項測試與 production build 通過；建置仍有既有 Vite CJS／chunk 大小提示。
- Chrome 已檢查 T1–T3 正面／斜面／側面 WebGL 對照與 `?devmodels=humans&nolock` 步戰／騎乘持盾展示，外框與正面零件不再懸空。一次性對照頁與截圖保留於忽略的 `output/playwright/scutum-fix/`。
- 正式 `?nolock` 預設 10v10 戰鬥已啟動並運行；工作室及正式場景均無 application console error，擴充套件的 MetaMask liveness／listener 警告另行排除。

### 2026-09-16：清理 artifacts 一次性驗收產物

- 移除整個受追蹤的 `artifacts/equipment_pose/`，包含截圖、量測 JSON 及一次性驗收報告；保留本文件的功能／測試摘要。
- 移除該輪新增的 6 個 equipment／lance 瀏覽器探針與驗收腳本；正式遊戲程式、工作室功能與持續維護的測試保留。
- 一次性檔案僅在已忽略的本機 `output/local-diagnostics/artifacts-cleanup/` 備存。補上舊路徑的 ignore 規則及 agent 規範，後續暫存產物直接放 `output/`。
- 一併移除劍、弓與馬匹的一次性圖片、診斷／驗收報告及 Blender 畫面腳本；`artifacts/` 僅保留 8 份必要來源、授權、locomotion 基準與馬匹 manifest 引用資料，改為預設忽略並逐檔放行。
- 共移除 133 個一次性檔案（105 PNG、14 JSON、7 Markdown、7 腳本），約 29.47 MiB；清理已刪除檔案的連結／命令，不改 Git 歷史。
- 驗證：必要檔案與暫存路徑的 ignore 放行／排除檢查通過；28 檔、246 項測試與 production build 通過。

### 2026-09-16：保留最小 Idle，補向前刺擊與騎馬持劍方向

- 依使用者後續要求，只在 Lance 攻擊期間加入右臂小幅 FK 伸展、維持原手部方向；不恢复新 Ready、IK、掌心朝上、雙手支撐或 Lance morph。收招／取消回到相同 locomotion 基底，固定 weapon attachment 不動。
- 實機 Roman／Viking、步戰／騎乘、有盾／無盾前伸 20.4–21.1cm，槍線與 +Z 夾角 < 8°；左盾、軀幹與腿部保持各自原姿勢。
- 騎馬 Sword 選用 Lance 的固定模型方向，保留 Sword 掌內握點；下馬還原原 Sword attachment。Player／NPC／工作室共用同一入口，原 Sword 攻擊及 .252 秒命中不變。
- 工程測試新增固定 attachment、三 LOD 握點、前伸、非右臂骨骼不變、取消／收招、攻擊途中上下馬時序，以及 mounted Sword 握點／方向與下馬還原。
- 工作室 104 張分階段及持劍對照圖：`output/playwright/lance-thrust/`。正式 Player／NPC Lance 路徑 112 個取樣、336 張圖，零失敗／零應用錯誤；持盾禁弓、卸盾射箭正常。一次性取樣腳本已移出版本控制。
- 騎馬 Sword 正式 Player／NPC、有盾／無盾另驗 56 個取樣、168 張圖，零失敗／零應用錯誤；證據 `output/playwright/equipment-gameplay-sword/`；一次性腳本已移出版本控制。
- 最終 28 檔、246 項測試與 production build 通過。戰馬工作室（含 idle／walk／gallop × Ready／Peak）、正式場景、100 人壓力場景零應用錯誤；Headless FPS 約 2.4–2.7／0.94–0.98／0.58–0.59，僅記錄為診斷，不宣稱效能通過。完整資源數／console 見 `output/playwright/equipment-scenes/measurements.json`；戰馬截圖有 GPU ReadPixels stall 警告。
- 這是原 Sword Idle 上的最小前刺；未恢復原完整人体工學騎槍計畫。靜態基底已有的 Roman 肩部衣物破面與既有手指造型仍保留。

### 2026-09-16：補驗最小版持盾／騎乘 Idle

- 補上 Roman 步戰持盾、騎乘無盾、騎乘持盾的三 LOD 對照，Sword ↔ Lance 人體骨骼與手型完全相同。曾保存 54 張近景／全身／俯視圖與量測；一次性產物現僅保留在已忽略的本機 `output/`。
- 發現 mounted 原空 clip 會讓上身回到 T-pose，已改為直接播放既有 idle 上身軌道；回歸測試確認 pelvis／mounted 腿姿不變，未新增肩臂／腕部修正。
- Lance 固定掛點向外偏約 8°，清除騎乘 idle 的馬鬃接觸；槍桿中心及周邊 8 條線取樣未碰到可見馬匹 mesh。僅驗收此固定 idle，未宣稱覆蓋馬匹所有步態或攻擊。
- 四種組合、三 LOD：握點誤差均 < 1mm、無瀏覽器應用錯誤；步戰槍線與前方約 7.7°，騎乘約 3.4°。原無盾步戰截圖也已更新。
- 完整測試 28 檔、240 項通過，production build 通過。一次性截圖腳本已移出版本控制。

### 2026-09-16：Roman 最小版 — 原 Sword Idle 只換 Lance

- 依使用者最新指示縮小範圍，撤下先前長槍專用 Ready／前刺骨架、掌心朝上校正、雙手支撐及 Lance morph；不繼續調整人體工學。
- Lance 只使用固定 attachment rotation／position 與 Sword 原有掌內握點；原 Sword 人體姿勢、手型、locomotion／mounted 基底保持一致。載入時取樣既有 idle 計算模型朝向，來源骨架立即還原。
- 正式骨架測試逐骨比較 Roman／Viking、三個 LOD、idle／walk／run／mounted，換 Sword ↔ Lance 人體 transforms 完全相同。
- Roman 無盾 Idle 瀏覽器驗收：三個 LOD 的所有骨骼與既有手型權重完全相同；握點誤差 < 1mm，槍線與 +Z 約 0.53°，無應用程式錯誤。已查看同角度近景、全身與俯視圖，人體外觀與 Sword baseline 一致。
- `rtk npm test -- --run`：28 檔、238 項通過；production build 通過。舊前刺／掌心朝上測試已被本階段的人體不變契約取代，不能沿用舊測試數或舊 QA 結論。
- 此階段圖片與一次性腳本已移至已忽略的本機 `output/`。**本輪只完成最小 Idle，前刺、雙手支撐及更進一步騎槍姿勢暫停。**

### 2026-09-15：盾牌持握與骨架長槍前刺（歷史嘗試；已由上方最小版取代）

- 已完成卸盾 API／UI、持盾禁弓、裝備切換取消動作、NPC 同階預設盾與既有減傷整合。
- 新增全 LOD 裝備姿勢求值、固定 Lance／Shield attachment、独立手指 morph、雙臂 IK 與無盾左手鬆開／接回。mounted 姿勢與骨架基底還原納入共用 mixer 流程。
- 右手腰際向 +Z 出槍，最大設定前伸 22cm，保留 .38／.228 秒命中與 .70／.42 秒總長。劍／弓資產、既有傷害、衝鋒倍率與耐力規則未重寫。
- 人物／戰馬工作室加入裝備組合操作；當時的一次性矩陣取樣與六階段截圖工具已移出版本控制。
- 最近完整工程檢查為 28 個測試檔、245 項通過，production build 通過；之後仍在校正近景肩肘／手腕。**尚未完成最終視覺、正式場景與壓力回歸，不可宣稱全部驗收通過。**
- 此段為歷史嘗試，現行結果以上方最新驗收摘要為準。舊 Phase 20 背盾／腋下架槍段落為歷史紀錄，現行行為以上述裝備規則為準。


### 2026-09-14：Roman／Viking 單手劍

- Viking 與 Roman 的 T1／T2／T3 步戰近戰武器已各自統一成 default 單手劍幾何；tier 只改表面花紋與配色。既有武器 ID 保留以相容 inventory/save，傷害仍為 12／25／45，三者共同使用 0.35 基準速度、1.8m 範圍與 `swordSlash`。長槍維持原路徑。
- 移除正式劍路徑的扭腕／前臂 correction、alignBladeGrip 與工作室每幀重套 attachment，HUD 固定 OFF。固定握點與 `swordHand` 手指 morph 已由 Player、NPC、工作室共用。
- Roman 初版誤套 Viking 手臂重定向造成反轉，已撤回。新增原始動作比對測試保護雙臂／手腕；只恢復既有 idle／walk／run 的 LOD 動作資料。Viking 單獨處理其 rest basis 差異。
- 六份 GLB 的 swordSlash 已由原始 `Sword_Regular_A` 重建，維持 0.252 秒單次命中、0.48 秒完成與 NPC 0.35 秒間隔。為遵守 rotation-only，採站姿下半身與來源 pelvis yaw，上身保留來源揮砍；未使用 A_Rec。
- 修正攻擊結束先插入 idle 的過渡，以及 Player 大 dt 同幀命中／完成時清掉命中旗標的問題。
- Phase B 與最終驗收結論保留於此摘要；一次性報告／截圖已移出版本控制。來源取樣、校準、烘焙工具及原始 locomotion 基準保留，網格／蒙皮／材質／貼圖及未選動畫保持原樣。
- 工程驗證：26 個測試檔、224 項測試與 build 通過；六份 GLB 重建結果位元組一致。正式 Player／NPC 與工作室的近景、俯視、攻擊／收招截圖已移至忽略的本機 `output/`；T1–T3 正式場景驗證輸出於 `output/playwright/melee-tier-parity/`。
- 已知限制：既有 Viking Bow LOD1／2 右臂姿勢與 LOD0 不一致，未為劍修改其 Bow 軌道或 normalization。低 LOD 原有衣袖／裙甲簡化外觀仍保留。

**Phases 0 ~ 23 — ✅ IMPLEMENTED**

The 3D Action RPG web game now features detailed character segmented models, realistic textures/factions aesthetics, equipment-driven hand-held shields, and comprehensive combat mechanics (Melee, Archery, Cavalry).

### 2026-09-05：外部騎手膝蓋反折修正（✅ DONE）

- `LegRig.forwardBendSign` 明確記錄骨架的局部 X 軸腿部彎曲慣例；project-humanoid 與舊程序化骨架不再共用錯誤的旋轉符號。
- 外部 Viking／Roman 騎手的髮、膝、踝現在會一致地將膝蓋帶向馬頭，小腿再向下、略往後落至馬腹／馬鐙區域；玩家、NPC 與戰馬工作室沿用同一姿勢入口。
- 新增世界座標回歸測試，覆蓋外部骨架正向彎膝、舊程序化方向相容性，以及下馬後恢復 bind pose。
- Vitest 64/64 與 production build 通過；Chrome 已驗證 `?devmodels=mounts&nolock` idle／gallop 側視圖、`?devcombat&nolock` 50v50 與 `?nolock` 正式場景，無專案來源 console error。

### Phase 23：外部寫實戰馬整合（✅ DONE）

- 正式 runtime 為 `public/models/mounts/v1/horse/horse_runtime.glb`（SHA-256 `097b3d5e4144749b1e4d9d1aaea3cc72393cbd3366d30926c496b485814cde63`），manifest ID 為 `realistic-warhorse-v10`。
- 套件只有一套 80-joint skeleton 與九段 clips；每匹馬擁有獨立 skeleton／mixer，但共用 geometry、material、texture 與 clip。LOD 為 64,986／20,279／5,916 triangles。
- 馬身有三種來源節點花色；鬃尾、蹄、眼睛與鞍具共用來源外觀。Meshopt／KTX2／Basis 完整套件約 6.05 MB。
- 新遊戲、場景馬與 NPC 騎兵全部使用 `HORSE`；花色以穩定 FNV-1a key 分配。舊存檔的 `BLACK_CAT`／`CORGI` 仍會以上一個 commit 的程序外觀載入，本輪外部雕刻成果已清除。
- `?devmodels=mounts&nolock` 已通過三色、1–9 動畫、LOD0／1／2、骨架、騎手與 socket 驗收；騎手膝蓋反折的重複 mounted pose 已移除。鬃髮 card 輪廓與睫毛依使用者決定列為可接受的非阻擋限制。
- 正式 `?nolock` 10v5 及 `?devcombat&nolock` 50v50 都沒有崩潰或應用程式 console error。10v5 首次載入約 25 秒；50v50 約 23–31 FPS，geometry 暖機後穩定於 1,447，texture 在首次上傳時由 3,084 增至 3,085。遠方 NPC 隊形疑似浮空，列入後續 TODO，不阻擋 Phase 23。
- 程式、套件測試共 62/62 通過，production build 通過；一次性最終驗收報告已移至忽略的本機 `output/`，來源授權與 manifest 引用的套件紀錄保留。

### Phase 22：外部寫實人物、骨架與蒙皮重建
- 新增 `HumanoidAssetRegistry`：非同步 manifest gate、GLTFLoader、共享 template、獨立 SkeletonUtils clone／AnimationMixer、LOD、bounds、dispose、遠距動畫降頻與骨架／socket adapter。
- Player／NPC 正式 runtime 已切到外部角色入口；若 Viking 或 Roman manifest 未 ready，`Game.create()` 在出生任何單位前停止並顯示可讀錯誤。只有 Vitest 與 Vite development 的 `?legacyhumanoids` 可使用程序 fixture。
- `CharacterCombatAnimator` 保留 hit／projectile／recovery／completed 時序，同時要求外部 clip cross-fade；一般 FOV 已由 70 改為 58，aim 維持 40。
- 新增 `?devmodels=humans&nolock` 中性格線 studio；自由 Orbit camera 不跟隨 Player，支援旋轉／平移／縮放與 H 鍵骨架切換，方便固定檢查 front／side／動畫與騎乘。
- 建立並驗證 `ai_share/skills/humanoid-rig-skinning/`，包含人體契約、asset manifest 契約與無依賴 GLB 稽核腳本；獨立 forward-test 正確拒絕在沒有實檔時推定比例或蒙皮通過。
- 使用者提供合法下載原檔後，兩份 manifest 均為 `ready`。Viking／Roman 共用 `project-humanoid-v1` 31-joint skeleton、必要 sockets、獨立 skeleton/mixer 與 60k／20k／6k LOD；實測貼圖最大尺寸為 2K／1K／512。
- Viking 高 1.86m、Roman 高 1.78m，肩寬、頸長與膝高比例通過 manifest gate；原始模型沒有 actions，因此 runtime 以共享 deterministic additive clips 驅動 `AnimationMixer`，戰鬥事件時序不變。
- 授權證據記錄 CC BY 4.0、Andy Woodhead 作者聲明；Viking attribution 同時保留 Photodjo。Roman 原始 FBX 為分離網格且無骨架，mounted thigh／裙片已通過 isolated provisional review，仍須以實際鞍座持續檢查。
- 維京短角是 `socket_head` 的 runtime 獨立快取配件，總跨度受 0.44m 測試限制。
- 黑貓／柯基外部重建已延後；保留舊存檔 ID 與上一個 commit 的程序外觀，不在新場景出生。`?devmodels=mounts&nolock` 現為獨立戰馬工作室。
- Player／NPC render heading 統一，W 前進時背部朝 camera、角色面向前進方向；第三人稱起始視角改從主角背後看向敵軍，mounted camera 依座高降低 look target。
- Vitest 49/49 與 production build 通過。最新坐騎改版的 Chrome extension runtime 尚未列出可用瀏覽器，因此本輪沒有宣稱截圖外觀已通過；待連線後只需 hard reload `?devmodels=mounts&nolock`，檢查四個固定視圖與 application console。

### Phase 21：人物、裝備、武器與坐騎程序寫實化
- 新增共享程序 PBR 材質快取，在瀏覽器用 CanvasTexture 生成皮革、木紋、布料、金屬、皮膚與毛髮的顏色／粗糙度／凹凸細節；測試環境使用 DataTexture fallback。
- 人物新增臉部輪廓、鼻、眉、眼、耳、頭髮／鬍鬚，以及髖、膝、踝、腳掌腿部 rig；黑貓與柯基分別有跨坐腿姿。
- 維京與羅馬 Tier-2 護甲改為分層胸甲、環片、毛皮、護腕、裙片、護脛、護頰盔與低調陣營色。
- Tier-2 長劍與 gladius 使用漸尖菱形截面，反曲弓使用連續曲線層壓弓臂，pilum、維京圓盾和羅馬弧面 scutum 皆補足結構細節；拾取物共用正式模型。
- Phase 21 的黑貓／柯基外觀重建未納入最終提交；本次只保留舊程序版本與存檔相容性。活躍坐騎動畫、鞍具與 LOD 皆由 Phase 23 戰馬提供。
- Renderer 改用 ACES filmic tone mapping 並重平衡戶外主光／補光；自動測試增加至 40/40，production build 通過。
- 舊 `?devmodels&nolock` 黑貓測試場已由 Phase 23 的 `?devmodels=mounts&nolock` 戰馬工作室取代。

### Phase 20: 程序角色戰鬥動畫重製
- 玩家與 NPC 共用肩、肘、腕三節 FK rig，所有武器改掛在 hand socket，手與武器不再各自動作。
- 新增資料化小刀、長劍、巨劍、拉弓／放箭、步戰長槍及騎乘架槍時間軸。
- 近戰命中與箭矢生成改由單次動畫事件觸發，並保留傷害、耐力、XP、弓箭蓄力及騎槍三倍傷害規則。
- 巨劍與步戰長槍使用雙手姿勢並將盾牌掛背；騎槍改為右腋架槍、左手保留盾牌。
- NPC 各武器依完整動畫時間加 0.35 秒 AI 間隔進行下次攻擊；羅馬標槍保留獨立投擲姿勢。
- 新增 Vitest 時間軸測試，覆蓋單次命中／放箭事件、大 `dt` 跨幀、收招鎖定與動作完成。
- 實機回報修正：弓箭改用 orbit reticle 方向，不再沿相機看向角色的下斜線發射；FK 正負軸向修正為往角色前方出手。
- 原本固定在角色根節點、會遮住手臂動畫的上臂護甲已改掛肩關節；盾牌材質不再受傷變紅，並會在精確 0.15 秒內回到左手。
- 錄影回報修正：刀劍 pivot 改為由後上方穿越角色前方的實際前劈軌跡，命中事件對齊到刀刃進入前方的接觸幀。
- 右鍵瞄準只改變 FOV，不再縮短相機距離或平移到右肩，原準心下的世界位置保持不動。
- 騎槍 NPC 在 ATTACK 間隔也持續套用腋下架槍姿勢；測試場每個陣營至少保證一名 Tier 3 騎槍兵便於驗收。
- 截圖回報修正：新增 `actionPivot → gripPivot → mesh` 分層；刀劍、巨劍與長槍各自保留固定握持校正，動畫不再把模型 `+Y` 軸翻向地面。
- 長槍待機改為肩／腋下高度，攻擊沿槍桿自身軸前送；步戰雙手、騎乘左手持盾的分流維持不變。
- 固定準心、相機與箭矢使用同一條中心射線；瞄準時先 raycast 解析準心命中點，再由實際 nock 世界座標射向該點。
- 箭頭本地 `-Z` 明確對齊物理速度，修正箭身飛行正確但箭頭朝反方向；搭弓箭也會對準當前準心點。
- 手持盾中心提高到前臂並將盾面轉向角色前方，背盾仍維持獨立 transform 與 0.15 秒過渡。
- `?nolock` 僅供瀏覽器自動化 QA：右鍵與拉弓改用點擊切換，正常網址仍維持 Pointer Lock 與原本按住操作。
- 自動驗證：Vitest 27/27、TypeScript/Vite production build 通過；覆蓋刀尖離地／向上、三種刀劍水平前刺、直線抽回、槍尖沿軸前送、盾面方向、箭頭／速度一致性及含 Sprite 準心 raycast 測試。
- 近戰截圖回報修正：待機刀尖改為明顯微抬；刀劍有效動作反轉為右上起手、穿過身前至左下收尾，移除原本左下往右上的 uppercut 軌跡。
- 新增 `?devcombat` 武器軌跡模式：玩家黃、友軍藍、敵軍紅；場景顯示 grip→tip 方向與攻擊 tip trail，完成時 console 印出角色 local-space 起終點及 XYZ bounds。
- 實機軌跡回報修正：待機刀改為真正 world-up，而非朝前造成俯視投影向下；recovery 改成低位側收後再直立抬刀的 L 型回程，不再倒播左下→右上的斜向砍擊。預設 console 僅印玩家，`?devcombat=all` 才印所有 NPC，且死亡角色不再累積 240-sample 假軌跡。
- 修正右鍵瞄準 raycast：改用 `setFromCamera()` 設定 camera，避免遞迴掃到 NPC Sprite 時觸發 Three.js runtime error。
- 最終取消刀劍揮砍 pose：小刀、長劍與巨劍分別改為短刺、標準刺及雙手重刺；肩肘總俯仰角固定在約 `PI / 2`，有效幀維持水平，收招先沿刺擊線抽回再轉回直立待機。既有 action ID、傷害與命中事件不變，dev mode 顯示名稱改為 `daggerThrust`／`swordThrust`／`greatswordThrust`。
- 測試場改為只生成玩家，不再生成 5 vs 5 NPC；保留木樁、掉落武器及 `?devcombat` 軌跡工具。
- 已透過 Chrome 實際進入 localhost，確認長劍沿角色正前方伸出且待機回到劍尖朝上。
- `?devcombat` 新增弓箭診斷：紫色記錄 nock 拉弦路徑、青色連接弓把與 nock、白色顯示右手與 nock 誤差、橘色顯示搭弓箭方向、綠色記錄實際箭頭飛行拋物線；每次結束會在 console 印出 `bowDraw`／`arrowFlight` 起終點與 XYZ bounds。飛箭採固定空間間距取樣，完整 200m 路徑不受螢幕更新率影響。
- 放箭視覺與事件同步：弓弦及搭弓箭維持滿弓狀態直到 `projectileRelease` 幀，生成飛箭後才回彈並隱藏搭弓箭，避免提早回彈或同時看到兩支箭。
- 弓箭 dev mode 新增紅色 5m 瞄準導引：由玩家上半身沿實際 nock→準心發射方向延伸，末端使用三軸十字標示；只在瞄準及放箭恢復期間顯示。所有 debug 線均標記為 `ignoreAimRaycast`，避免診斷幾何反過來被準心射線命中並污染箭矢方向。
- 修正谷地放箭首幀消失：箭矢地面碰撞由固定世界 `y=0.05` 改為查詢當地 `getTerrainHeight(x,z)+0.05`，並保留離弦前 0.12m 的世界碰撞寬限。針對實機紀錄座標 `(-34,15)` 新增低於零高度谷地回歸測試；Vitest 更新為 28/28。

---

## What Was Done in Phase 7 & Phase 8 (Supplement: 6 Distinct 3D Weapon Models)

> **Note**: An attempt was made to integrate a realistic FBX character model (`KnightCharacter.fbx`). However, due to complex issues with bone mounting, animation scales, and material rendering inconsistencies, the decision was made to roll back to the stable procedural capsule geometry version. The downloaded FBX assets remain in `public/models/characters/` for future reference, but are currently not active in the codebase.

### Files Created/Modified
| File | Action | Purpose |
|------|--------|---------|
| `src/player/Player.ts` | Modify | Implemented 6 distinct 3D weapon builders (`rebuildMeleeWeapon` & `rebuildRangedWeapon`) for Tier 1~3 Dagger, Sword, Greatsword, Shortbow, Longbow, and Elvenbow. |
| `src/world/WeaponPickup.ts` | Modify | Rendered 6 distinct 3D weapon geometries for ground drop nodes. |
| `src/rpg/WeaponDatabase.ts` | Modify | Centralized weapon config defining Tier 1~3 Melee & Ranged stats and badges. |
| `src/rpg/InventoryManager.ts` | Modify | Manages inventory grid, equipped weapons, and save/load state. |
| `src/player/PlayerInput.ts` | Modify | Added `KeyE` listener and `consumeKeyE()` method. |
| `index.html` | Modify | Added `#pickup-prompt` HUD, custom scrollbar CSS, and Inventory Grid in Tab modal. |
| `src/ui/EquipmentUI.ts` | Modify | Rendered Inventory Grid, Tier badges (灰/藍/金), damage stats, and equip buttons. |
| `src/save/SaveManager.ts` | Modify | Persisted inventory owned items and equipped weapon IDs to localStorage. |
| `src/Game.ts` | Modify | Spawned 6 weapon pickups + arrow packs, connected E key pickup interaction, and handled smooth pointer lock re-engagement. |

### 6 Distinct 3D Weapon Geometries Implemented
- ✅ **近戰武器 (Melee 3 把)**:
  1. **Tier 1 生鏽小刀 (Rusty Dagger)**: 短刃 (0.55m)、無護手、小木柄，長度僅長劍的一半，暗灰色。
  2. **Tier 2 鋼鐵長劍 (Steel Sword)**: 1.1m 標準雙刃劍，經典比例。
  3. **Tier 3 精鋼戰刃 (Runic Greatsword)**: 1.55m 雙手巨劍 (寬度為長劍的 2.2 倍)，加長 0.45m 柄身上附 3 個皮革/金環、柄頭帶 `OctahedronGeometry` 符文藍水晶寶石、0.58m 翼型護手、劍身中央流線型晶藍發光血槽凹槽。
- ✅ **遠程弓箭 (Ranged 3 把)**:
  1. **Tier 1 木製短弓 (Wooden Shortbow)**: 0.9m 簡易短弧直弓，2 段直線斜向木臂，原木色。
  2. **Tier 2 反曲長弓 (Recurve Longbow)**: 1.3m 雙段 S 型反曲弧度弓臂，經典質感。
  3. **Tier 3 符文精靈弓 (Elven Runebow)**: 1.7m 巨大雙反曲精靈弧度弓臂 (上下各 3 段)，弓臂頂端加裝 `OctahedronGeometry` 藍白螢光精靈符文水晶與月牙刺裝飾，配置發光箭矢。

---

## Final Project Summary

All 8 base phases in `PLAN.md` + Phase 13 are completed.

### Phase 13 Summary: Cavalry NPCs & Mount Interactions
- **Cavalry Architecture**: NPCs are spawned with a `generatedAsCavalry` flag. They bind to a `Mount` instance and their movement controls the mount.
- **Damage Routing**: Arrow and Melee damage are perfectly routed to the `currentMount`'s HP pool while riding.
- **Dismount on Death**: When a mount's HP zeroes out, the rider gracefully dismounts to resume combat.
- **Impact Damage**: A robust line-segment horizontal collision checks for high-speed mounts trampling targets.
- **E Key Filter**: Players can only steal unridden, alive mounts.

### Phase 14 Summary: Cavalry Weapon Extensions
- **Lancer (長槍騎兵)**: Uses a new Lance weapon (`steel_lance`). When charging at high speed (`movementSpeed > 10`), they deal **3x** melee damage, and their successful hit replaces the mount's impact damage for that frame.
- **Mounted Archer (騎射手)**: Armed with bows, they can aim and shoot while their mount is moving, maintaining a distance of 6~15 meters from the target without stopping.
- **Player Support**: Players can also pick up the `steel_lance` which has an extended attack range (3.0) and enjoys the same 3x damage charge bonus and impact-skip rule as NPCs.

### Phase 15: 程式碼與效能健檢
- 統一武器建構邏輯 (`WeaponMeshFactory`)
- 坐騎傷害路由重構
- 修正坐騎名稱顯示
- 空間分割優化 (SpatialGrid)
- 索敵機制改為全場掃描 (O(N)，拔除開根號)
- 已移除LOD分層機制，實測200人規模效能足夠，不需要此優化，避免衍生行為異常的風險。
- **坐騎視覺優化**：為黑貓與柯基分別加上專屬幾何體馬鞍，並抽出 `rideHeightOffset` 與 `ridePitch`，讓玩家與NPC騎乘時能精準呈現前傾跨坐姿態。
- 騎射手AI優化：當敵人進入極近距離 (<6m) 時，騎射手會主動收起弓箭拔劍發起近戰衝鋒。
- Agent 文件重構：將所有的 Agent 規則與進度文件 (`AGENTS.md`, `ARCHITECTURE.md`, `PLAN.md`, `PROGRESS.md`) 移入系統標準的 `.agents/` 目錄中，並新增「每次做完事皆需檢查並更新 ARCHITECTURE.md」的強制規則。

### Phase 16: 動態背盾機制 (Dynamic Back Shield)
- 玩家與 NPC 在切換為弓箭模式時，左手的盾牌會自動改掛在背後。
- 切換回近戰武器時，盾牌會自動掛回左手。

### Phase 17: 角色剪影與陣營識別重製 (Realistic Aesthetics)
- 移除原本整身染成紅/藍色的「玩具兵人」感，改為寫實的金屬鐵灰與皮革棕色。
- 維京陣營保留木製圓盾、牛角盔、以及胸前的藍色符文印記作為辨識。
- 羅馬陣營則裝備鐵片盔甲（環形 Lorica Segmentata）、羅馬方盾、以及頭盔上的紅色羽冠。

### Phase 18: 角色肢體結構細節化 (Anatomical Segmentation)
- 軀幹分節：將原本的單一巨大圓柱膠囊體拆分為「胸甲 (Chest)」與「腹部 (Abdomen)」。
- 四肢分節：新增「大腿」與「小腿」的幾何體分段結構，告別純圓柱四肢。
- 比例修正：修復因頭部球體弧度造成的斷頸空隙（加長加粗脖子），並確保玩家與 NPC 擁有完全一致的腿長與整體身高比例（修正 NPC 蹲姿問題）。
- 移除披風以防與箭筒及動態背盾發生嚴重的視覺穿模。

### Phase 19: 實體碰撞與穿模卡死 Bug 修復 (Physical Collision Fixes)
- 實作「方向 A (Reactive Push-Out)」：將 `resolveObstacleCollision` 的邏輯改為「事後推出」，若實體座標進入障礙物內，會自動瞬間擠出至最近的安全邊緣，徹底解決退回上一幀導致的死鎖卡死。
- 實作「方向 B (Predictive Entity Push)」：在 `resolveEntityCollision` 進行實體推擠前，會預判目標位置是否有障礙物。若背後有牆，該實體將獲得臨時 Anchored (不可推動) 屬性，使得衝撞的另一方承受全部推力，增加了被逼到牆角的物理真實感。
- 坐騎防卡死設計：若玩家被不可推動的坐騎推向牆壁（兩者皆視為 Anchored），則取消推擠動作，允許短暫重疊，確保玩家能隨時透過走位滑出，而不會被夾死。
- 在 `Game.ts` 的每一幀最後，增加對所有實體的 `resolveObstacleCollision` 保底驗證。

### AI 共用文件架構
- 新增 `ai_share/` 作為 `AGENTS.md`、`ARCHITECTURE.md`、`PLAN.md` 與 `PROGRESS.md` 的唯一真實來源。
- `.agents/` 與 `.codex/` 保留同名指引檔，內容明確指向 `ai_share/` 的對應檔案，讓不同 AI 工具都能找到最新內容。
- 後續只需編輯 `ai_share/`，不需複製或同步其他目錄。

### Phase 20: 拉弓姿勢外移修正

- 修正拉弓 pose 的肩膀側向旋轉符號：持弓左手固定伸到身體左前方，弓、弦與搭箭軌跡不再埋入胸口。
- 拉弦右手會隨充能比例由箭尾附近向後上方移動至臉側，形成可讀的滿弓姿勢。
- 新增 FK 空間回歸測試，鎖定持弓手外移、拉弦手高度、前後距離與雙手間距。
- 已使用 `?devcombat&nolock` 實機檢查 0% 與 100% 拉弓姿勢及軌跡線。
- 玩家三種弓的弓身獨立放大 22%，短弓、長弓與精靈弓維持不同尺寸，箭矢與 socket 不跟著縮放。
- 統一搭箭與發射座標：弓弦中央 nock 改為箭尾接觸點，視覺箭身與 `ArrowProjectile` 均由同一點沿瞄準方向前移半支箭長，不再從弓身旁跳出。
- 新增弓跨度與箭尾／nock 對齊測試，並以 dev mode 實機檢查滿弓及離弦起點。
- `?devcombat` 新增完整弓形診斷：綠色九點中心線覆蓋上弓梢至下弓梢，青色三點折線顯示完整弓弦（上弓梢 → nock → 下弓梢）。
- 修正弓 socket 繼承手腕旋轉後向前倒下的問題：每幀抵消 parent twist，使弓身本地 Y 維持世界垂直、箭軸維持指向準心；同步降低持弓手，讓上弓梢位於額頭附近。
- dev mode 的洋紅 nock 軌跡只記錄實際拉弦，不再包含抬弓過渡，且回到待機後隱藏，避免把殘留弧線誤認為弓身或射擊方向。
- 玩家與 NPC 的靴子改為明確沿角色本地 `-Z` 延伸的前長後短剪影，不再看起來雙腳朝後。
- 盾牌手持姿勢改為左肩、肘將手掌與盾一起送到胸前；手掌 socket 對齊盾背握把，並抵消手臂旋轉使盾面維持朝前。
- 單手近戰與騎乘架槍保持盾牌 guard pose；弓、巨劍與步戰長槍仍沿用掛背狀態。
- 新增 `CharacterBowVisual`：玩家與真正持弓的 NPC 共用弓模型、垂直目標對齊、弓弦、搭箭與發射起點，移除 NPC 舊的獨立小弓更新邏輯。
- 維京遠程 NPC 依階級改用與玩家相同的短弓、長弓、精靈弓；羅馬遠程兵保留獨立的 pilum 投擲行為。
- `?devcombat` 改為 Tier 3 的 50v50 全騎兵大會戰：雙方各 25 名遠程騎兵與 25 名長槍騎兵，所有 NPC 皆強制騎乘。
- 校正弓身與弓弦的前後關係：只鏡射實體弓身，使弧面朝射擊前方 `-Z` 凸出；弓弦 nock 恢復在靠近射手的 `+Z` 側，箭與發射座標不隨弓身翻轉。
- 羅馬遠程 NPC 的飛行投射物由箭矢改為完整 pilum 標槍模型（長木杆、鐵頸與槍尖），命中、傷害與陸地碰撞仍共用 `ArrowProjectile` 管線。
- 50v50 騎兵兩軍向外移：前排由玩家約 ±35m 開始，遠程後排由約 ±55m 開始。
- 正式版一般網址改為固定 10v5 新手友善戰鬥：玩家＋5 名我方近戰＋4 名我方弓兵，對戰 3 名羅馬近戰＋2 名羅馬投槍兵；全部 Tier 2 且關閉隨機騎兵。
- NPC 射手最大交戰距離由 15m 提高到 22m，弓兵與投槍兵共用根據水平距離平方增加的拋物線抬高瞄準點，並將 NPC 投射速度提高為 20m/s。
- 修正玩家腳底懸空 15cm：保留玩家 0.95m 膠囊半高與物理根節點，只將程序角色視覺 rig 下移 0.15m，使玩家與 NPC 靴底都精確貼合地形。
- 新增 `ai_share/skills/combat-browser-validation/` 作為 GPT Chrome extension 戰鬥驗證流程的唯一真實來源，統一正式版／devcombat 網址、畫面檢查、軌跡 log 判讀與瀏覽器擴充噪音排除規則；`.agents` 與 `.codex` 只保留指向此 skill 的連結。
