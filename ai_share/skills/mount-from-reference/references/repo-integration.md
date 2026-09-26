# Repo 接入與診斷索引

這份文件是目前專案的定位索引與經驗，不是固定 API 規格。接手時先確認程式仍如此，各坐騎分支是定位範例，其數值與外觀不是其他動物的預設。

## 依賴定位

| 檔案 | 應檢查的契約 |
| --- | --- |
| `src/world/BlackCatVisual.ts`、`src/world/CorgiVisual.ts` | 程序體表、毛、皮甲、鞍座、共享 template、各實例動畫節點 |
| `src/world/Mount.ts` | MountType、存檔反序列化、visual 選擇、物理狀態、座位世界座標與朝向 |
| `src/world/HorseAssetRegistry.ts` | 外部戰馬的資產／動畫實例與鞍座；不要改壞戰馬分支 |
| `src/world/CharacterVisuals.ts` 及呼叫 mounted pose 的 animator | 種類對應的騎士姿勢、髖腿與裝備；搜尋 `MountedPoseKind`、`mountKind` |
| `src/world/CharacterEquipmentPose.ts`、`src/world/CharacterCombatAnimator.ts` | 動畫後的姿勢層、掛點所有權、攻擊時間、取消與下馬還原；避免每幀累加修正 |
| `src/world/EquipmentAttachmentContract.ts`、`src/world/SwordAttachmentContract.ts` | 手掌與模型握點校準、步戰／騎乘掛點；修穿模時不要破壞固定握持 |
| `src/debug/HumanoidStudioPlayback.ts` | 實際 mountKind、武器模型與正式動畫路徑；預覽切換不能替代 Player／NPC 的共享修正 |
| `src/Game.ts`、`src/main.ts`、`src/ui/MainMenuUI.ts` | 模型 studio、URL 解析、試騎入口與騎士同步；只改新增種類需要的入口 |
| `tests/BlackCatMount.test.ts`、`tests/CorgiMount.test.ts`、`tests/EquipmentPose.test.ts` | 接點世界座標、地面、實例互不影響、studio 播放、倒地重播與跳躍狀態 |

新增物種時，追蹤完整的種類流程：輸入／選單 → MountType → 具體 visual → rider pose → studio／實際遊戲。檢查存檔與 fallback 的顯式映射。不要只加入 enum 就讓未辨識種類落入柯基或馬的預設分支，也不要為此無關地改速度、HP、戰鬥或物理。

## 模型與實例

目前 BlackCatVisual 使用公尺、+Z 前向，模板幾何與材質共用，root 與活動節點各實例獨立。靜態零件按材質在各活動節點內合併，以減少 draw calls。

- 合併前完成幾何、毛色、覆蓋裁剪；保留 head、torso、tail、上下肢等需要獨立動作的階層，不可把所有零件焊成無法活動的單一 mesh。
- 移除單隻 mount 時不能 dispose 其他實例還在使用的共用 geometry/material。
- 外部蒙皮模型使用獨立 skeleton/mixer，遵守既有資產流程；程序節點動畫不應假裝有骨架或 GLB。
- 建模／毛束生成放在模板建立階段，不在逐幀 update 重新建立；新增複雜毛皮或皮甲後檢查面數、材質數與載入成本。需要大量坐騎性能驗收時使用 repo 的性能 skill，而不是以單隻 studio FPS 推論百隻效果。

## 鞍座與騎士

以 [rider-equipment-fit.md](rider-equipment-fit.md) 區分座面、骨盆與手掌接點。查清 `getSaddleSeatLocal/World` 與 `getRiderPelvisSeatLocal/World` 的語意及呼叫端，不假設二者回傳同一位置；必要的骨盆間距由實際騎士接觸面量測。驗證平移、轉向、縮放、鞍座俯仰，以及存檔還原、Player／NPC／studio 使用相同契約。

現有入口範例：`?devmodels=black-cat&nolock`、`?devmodels=corgi&nolock`、`?devmodels=mounts&nolock`；試騎參數從 `Game.ts`／`main.ts` 確認。新動物必須實際接好入口後才能使用新 URL，不要把 fallback 顯示出的動物當作成功。

## 常見表現與診斷方向

| 表現 | 原因與修法 |
| --- | --- |
| 正面像人類光頭、臉寬 | 比對顱寬、顴骨、下頜及眼距，不用增加毛量掩蓋 |
| 側面頭過長、眼耳距大 | 調整局部頭深度和耳根位置，重看正面；不要縮整隻動物 |
| 額頭凸包變平板 | 消除獨立疊球，保留平滑凸弧；參考圖決定曲率 |
| 耳朵懸空或側面像直柱 | 耳根嵌合顱骨、耳廓有厚度和彎曲；耳尖相對耳根的前後方向依物種與圖片決定 |
| 胸口像一顆球，脖子到肚子有折線 | 合併真正的體表再生毛，平滑法線；不要只蓋一層長毛 |
| 鞍墊被新身體頂穿 | 體表修改後鞍墊仍取樣舊橢球；讓兩者讀取同一表面 |
| 正面看似正常、上方甲片長毛 | 甲片只避開單一球體，未包含肩胛／腿根；修曲面及精確覆蓋裁剪 |
| 靜止乾淨、跑動禿斑或穿甲 | 裁剪只考慮 rest pose 或護片掛錯節點；檢查活動範圍與重新露出的毛皮 |
| 騎士腿穿身體／屁股浮空 | 鞍寬、座高、騎姿與 mountKind 不一致；先分清骨盆中心與臀部接觸面，再核對預覽與遊戲使用的姿勢 |
| 尾根有空隙 | 需要封口、嵌入與擺動時足夠重疊；不能只靠靜止相切 |

騎士與武器的接觸診斷見上述貼合參考文件；案例的尺寸、毛色與裝備選擇只屬於各自需求，不作預設模板。
