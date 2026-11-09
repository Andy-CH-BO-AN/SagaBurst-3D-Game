# 已蒙皮來源角色與選用裝備 GLB 整合

來源已附骨架與動畫（例如 Mixamo 綁定的 Meshy 模型），要接進正式人物管線，或新增只有部分場景才需要的裝備 GLB 時使用。沒有骨架的靜態模型改看 [posed-source characters](posed-source-characters.md)。範例實作：`tools/build-byzantine-cataphract.mjs`、`tools/lib/byzantine-bake.mjs`、`tools/lib/mixamo-direction-retarget.mjs`、`tools/build-byzantine-equipment.py`。

## 先烘掉 Armature 縮放

- 檢查 armature 節點是否帶非 1 縮放（常見 0.01）。runtime 只能接受 uniform 的最終尺寸，不要把補償留給個別角色。
- 烘焙時同時改三處：joint translation、position track、inverse bind matrix。IBM 只有平移欄要乘 S，等同 `IBM_new = S · IBM_old` 作用在每欄前三列。只改其中兩處時，靜態看起來可能正確，動起來才爆開。
- 用蒙皮後頂點驗證，不要看骨骼位置：比較烘焙前後同一姿勢的頂點世界座標，差異應接近浮點誤差。

## 骨名與動畫

- 來源骨名用 `selectedSource.rig` 宣告，由 `prepareSelectedHumanoidSource` 轉成專案名稱；不在 runtime 新增個別角色分支。
- `HumanoidAssetRegistry.loadTemplate` 要求完整的內嵌 clip 組。缺少的動作要真的重定向進去，不要用 alias 指到另一個角色。
- 重定向依方向，不抄 local rotation：四肢對齊骨骼方向，twist 取 donor，軀幹套世界差值，手依解剖座標；前臂吸收大部分旋前，避免全部集中在手腕。
- 來源的待機常像展示姿勢。站姿與騎姿可取體型相近的 donor；walk／run 的 `nominalSpeed` 用實際步幅量測，否則會滑步。

## 握點與手

- Manifest 的 grip frame 可能只是預設值，手指方向也可能不符實際。從骨骼量測手指方向，再用同一基底的 donor 交叉驗證；不要憑目視猜 roll。
- 無手指網格的手無法靠骨骼握拳：用 morph 彎曲（`MittenHandShape`），握武器與空握分開做，並確認每個 LOD 都有。其他 rig 只有在網格撐得住時才套用。
- 只有這個 rig 需要的修正，以 `selectedSource.rig` 限定範圍。修一個角色時，其他角色的輸出必須不變。

## 量測後才下結論

騎乘或大動作變形時，先量截面寬度再猜原因：腰部塌陷可能來自大腿骨權重滲入腰部，而不是 twist。修權重後再比較站姿與騎姿的截面。

需要跟隨重力的布料（如軍旗）可在 render 前依世界方向計算 roll（`onBeforeRender`），不要烘死在握持姿勢裡。

## 選用裝備 GLB

只有部分場景需要的裝備不放進共用預載，並遵守以下契約（`src/assets/OnDemandAssets.ts`、`src/world/HighTierEquipment.ts`）：

- **選擇與實際持有分開。** 模型未就緒時，選擇照常保存，但數值、攻擊、格擋與模型都不生效；手上原有的裝備保留到新模型就緒。不可顯示替代模型，也不可只隱藏 mesh 卻保留戰鬥效果。
- **模型與戰鬥效果同時切換。** Player 由 `InventoryManager` 的 getter 取得實際裝備，NPC 由 `meleeWeaponId`／`shieldId` 取得；讀到的都是實際持有，呼叫端不用各自判斷。
- **失敗要能真的重試。** 請求有上限時間，逾時後中止傳輸；晚到的舊結果不得覆蓋新請求。自動重試要控制頻率，玩家重新裝備則立即重試。
- **不要用 `GLTFLoader.loadAsync` 載入可重試的資產。** three.js 的 `FileLoader` 會把相同 URL 排在進行中的請求後面，舊請求卡住時新請求也跟著卡住，而且不會出現新的網路請求。改用 `fetch(url, { signal })` 加 `parseAsync`。
- **場景要先備妥實際會生成的裝備。** 由真正的 spawn spec 或軍隊設定算出需求；用不到的場景不發任何請求。
- **選單與清單要有契約測試。** 手寫的選單卡片會漏掉新項目；測試選單內容與 selection ID 清單完全相符，刻意隱藏的項目明確列為例外。

失敗路徑要實機驗證：單元測試用假 loader 抓不到上面的 `FileLoader` 問題。做法見 [combat-browser-validation](../../combat-browser-validation/SKILL.md)。
