# 坐騎動畫與形變診斷

用於既有坐騎的動畫重定向、蒙皮修復與播放異常。保留使用者已接受的體型、前半身、背部等選定部分；局部缺陷不等於需要重做外觀或整副骨架。

## 固定基準與重現

- 分開記錄不可變來源、使用者選定版本、目前候選與正式載入檔，包含 SHA、clip、秒數或 normalized phase、視角及 LOD。需要重建時套用不可變來源與已接受的修正，不把歷次候選輪流當新基準而累積變形。
- 用固定相機對照 REST、缺陷姿勢與相鄰時刻；必要時暫時隱藏鞍甲並顯示骨架。單張側面陰影不能證明關節位置錯誤。
- 多代理共用 GUI Blender scene 時只有一個 mutation owner；其他人可查 runtime 或 review，不同時改場景。交接保存工作檔、候選 hash、失敗姿勢、量測、嘗試結果與下一個待驗假設，待未完成的 MCP call 結束後轉交。

## 先區分是哪一層

| 現象 | 先取得的證據 | 修正方向 |
| --- | --- | --- |
| REST 就有錯位；肘、腕或飛節繞錯位置 | 關節世界座標、rest matrix、inverse bind matrix，疊骨架看正／側面 | 有解剖證據才修 pivot／rest basis；更新 bind compensation，檢查 rest 表面未改形 |
| 腿根成薄片、胸腹凹陷、背部隨後腿下陷 | 缺陷頂點及相鄰邊的權重、posed 座標／邊長，與來源比較 | 修局部 influence 分區及過渡，查背部／鞍墊是否誤受腿或尾骨牽動 |
| 整數幀正常，兩幀之間突然翻折或接地抬高 | 半幀姿勢、相鄰 quaternion dot、實際插值曲線 | 查 `q`／`-q` 等價表示與 scalar curve 插值，先修旋轉連續性再算接地 |
| REST 與權重連續，但抬腿時根部擠進腹部 | 目標實際腿長、外露肢段、腹底空間與足部軌跡 | 按目標活動範圍調 stride、lift、crouch，保留 donor 接觸順序；不以改整體尺寸或放寬蒙皮掩蓋 |
| 身體在移動、腳卻停住 | 移速、active clip、action time、effective weight/timeScale、一次性事件次數與骨骼姿勢 | 先查反覆 reset／land／hit、中斷後恢復與 mixer 更新，不直接重綁權重 |

## Rig 與蒙皮

- 骨名只供定位；以目標 rest basis、關節中心和彎曲方向做 mapping。pivot 改動後，原本的 jump／land／hit 等保留動作也可能需要轉換 basis。若任務限定只改一個 clip，先找 clip 局部解法，不以連帶修復為由擴改共用 rig；無法在範圍內解決時明確回報衝突。
- 以連通表面和實際足部區域判定肢體，不只按左右中心線或 AABB 切分；不對稱腳掌可能跨過中心線。腳掌／腿幹可保留剛性核心，肘腕、髖膝與腿根仍需局部混合。
- 處理腿根權重時包含邊界兩側；只修改已有腿權重的點、把相鄰零權重點鎖死，可能形成拉長的薄片。可用局部平滑或 harmonic 過渡，固定已確認的軀幹與肢段核心，不把某個演算法當所有資產的必要條件。
- 移除錯誤 influence 後不要直接把微小殘餘 head／neck 權重放大成主權重。依解剖重建 axial remainder，重新檢查胸口、頭頸、下背與鞍具。
- 「四肢不變形」應轉成可驗收的局部條件：腳掌及腿幹不拉長、不壓扁、不新增薄片；關節附近正常彎曲。量測去除所屬骨骼剛體變換後的核心形狀，另看接縫，不能只用骨長未變或整體 bounding box 判定。
- 調整後比對原始 geometry、normal、UV、index、material、texture 及未涉及的骨骼／接點；只允許本次範圍內有根據的 skin、bind 或 animation 變動。逐個檢查受影響的 LOD。

## Retarget、插值與接地

先查現有 donor 與授權，記錄 take／frame／FPS、身體與足部 mapping；把結果 bake 到目標自身 Actions，匯出不依賴 donor rig。保留遊戲的水平位移所有權、+Z 前向與單位，依目前 loader 核對 clip 名稱與 loop／once 行為。

- 若 Blender 以四條 scalar curve 插值 quaternion，連續樣本先 normalize 並選一致半球，再檢查循環接點；改符號不能改掉 keyed orientation。不要假設 glTF 的 shortest-path 插值能修掉 Blender 已烘焙的錯誤中間姿勢。
- 對快速轉折與異常接地在 key 之間加密取樣。先排除翻折、扭曲，再依變形後的 mesh 算 ground correction；不要讓一個壞半幀把整個 clip 抬高。
- 檢查身體各 LOD 與可能觸地的硬質鞍具。最低點可能是馬鐙，不代表側躺身體已接地。依支撐／騰空階段處理，不能把每幀所有腳都釘在地面。
- 保留初始未接地修正的 bake，接地與 loop closure 從確定階段執行一次。局部重做 death 時比對其他 clips，避免再套整輪 finalize 意外改變已驗收的 walk／run。

現有黑貓／柯基工具入口是 [tools/blender/README.md](../../../../tools/blender/README.md)：`build_animations.py`、`animal_glb.mjs`、`animal_quaternion.py` 與各物種 skin／rig helper。先確認其來源 hash 與適用資產；不要把案例的骨數、步幅、死亡角度或接地量套成新物種常數。若任務要求 Blender MCP，依該文件做實際建立／修改／讀回／刪除 smoke，不能把 process 啟動或 background export 當成 MCP 成功；每次 mutation 確認工具回傳的執行結果再做依賴操作。

## Runtime、驗收與輸出

- 依實際事件查動畫優先序：一般坡面接觸抖動不等於主動跳躍落地。修正時同時保留真正 jump → land → locomotion、hit 恢復、death hold 及還原流程；沿用既有 state/mixer，而非另造一套動畫框架。
- 先看受影響動作的完整週期與極值，再看切換／恢復；下背或尾根缺陷加正後方，前掌與腿根加正面／側面。取樣密度由缺陷決定，不強制每次同一張數。連接區沒有裂縫、薄片、凹陷或孤立凸塊，才算通過；不能只確認播放了 clip。
- 重新匯入最終待交付檔並依 [browser validation](../../combat-browser-validation/SKILL.md) 驗證；壓縮、merge、重烘焙或 skin 改動後，舊檔截圖不能替新檔背書。若只變一個 clip，用資料差異證明其他 clips 未變，再補受影響的視覺與遊戲檢查。
- 保留可重建工具、mapping、來源與驗收紀錄；候選、截圖與一次性探針留 ignored `output/`。SHA 對得上才能將證據連到正式 manifest／audit。現有 promotion 工具需分階段區分本機資產驗證與正式 Game 驗證，完成哪一階段就記錄哪一階段，不提前標記全數通過。
