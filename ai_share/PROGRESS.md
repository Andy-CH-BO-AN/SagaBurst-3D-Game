# SagaBurst — 目前交接

## 普通士兵 T1/T2 與共用 HP

四份 owner-confirmed Meshy 模型已加入獨立 T1/T2 身體及 30 根加權手指骨；局部手部加線／權重校準改善初版尖片，保留原身體蒙皮與低模風格，原 T3 與特殊角色資產不替換。Player／NPC 共用普通士兵基礎 HP，Career 正式軍階、技能、舊存檔比例與自訂 HP 來源分開處理，契約見 ARCHITECTURE。Blender 來源／動畫外觀檢查不等於實際裝備接觸或騎乘驗收；本次雲端瀏覽器未能執行 WebGL 預覽，仍維持 Draft，不宣告完整視覺驗收。未執行效能基準。

## Commander V 四門守城交接

Commander 新正式八隊為 26／26／26／26／25／26／25／26，共 206 人，四門各有步兵／騎兵；HR 本人在西門第 8 隊、Captain 在東門第 6 隊。城鎮 5 名巨鷹與新增 5 名常駐 T3 指揮塔弓兵自主防守，不受 ALL／Preset／小隊命令。新任務使用 rosterVersion 2；進行中的舊版 210 人快照保持至返回，和平授權按 Actor ID 遷移。Roman／Viking 實際塔頂站位、射擊及完整任務回歸仍需實機驗收。

正式 Career 任務已接入 Home Town、既有八車與八隊兵權：守方獨立準備 180 秒後才從邊境生成 230 名攻方與八車、每門獨立事件、完整 ground／air checkpoint、原子結果與正常城鎮重建。正式攻擊後守住15分鐘且守方仍有人存活即可獲勝，提前全滅攻方仍勝；戰鬥計時排除準備／生成／暫停並隨存檔續算，舊存檔缺值從0開始。Roman／Viking 真實 WebGL 的八車移動／Dock／Crew 登城、空戰、遊玩回歸及 GPU 效能尚待驗收；CPU 幾何診斷與 CI 不代表上述通過。模組契約見 ARCHITECTURE，詳細驗證留 PR。

更新：2026-10-19。城外遭遇戰與任務交火的目前契約見 [ARCHITECTURE.md](ARCHITECTURE.md)。

## 目前狀態

- 新增 opt-in 四門攻城 production API 與 DEV `/?fourgatepreview=1&nolock&faction=roman|viking`，共用既有 Campaign 車體／Crew／MovingPlatform／Damage／Convoy，獨立四門事件及 v1 checkpoint。原 Town 120 人 Siege、10 秒準備與 Outpost 雙車入口保持原樣。Commander V 正式整合見上方交接；八車推進、實際登城與 Roman/Viking 接牆尚未完成實機驗收，交付維持 Draft。API 呼叫契約見 ARCHITECTURE。

- 普通戰馬已改用使用者提供的 MAXDESIGN-3D 模型，沿用原 horse／asset／paint IDs。三個 LOD 共用每匹獨立的 70 骨架與一次動畫求值；原生 idle／walk／gallop／death，加上由舊馬重定向的 trot／canter／jump／land／hit。來源與授權見 `public/models/mounts/v1/horse/CREDITS.md`，可重建入口為 `tools/horse/build-lightweight-horse.mjs`；舊 LOD2 工具禁止處理此版資產。
- 馬鞍以新馬背部蒙皮，座位 socket 適配既有騎手偏移；步態依 manifest 的來源步幅速度調整播放頻率，移動數值與跳躍物理不變。land 在主動跳躍或持續騰空且明顯下降後觸地時播放，排除短暫坡面接觸。步態切換保留校準步頻並使用小幅速度容差，避免邊界反覆重啟。貼圖在 loader 內共用，實例銷毀只釋放自己的動畫與骨架資源。

- **T5 選定資產已接入並通過百人效能驗收**：唯一來源為 `Roman_Steppe_Selected_Complete.zip`，入口 `tools/import-selected-t5.mjs`、`tools/t5-commanders.md`。LOD0 保留來源網格、貼圖與權重；使用者另授權修正 Roman 兩段斧擊的手指旋轉，保留原始空握手型。Roman 66 骨與完整四組影響、Steppe 37 骨與 11 段來源動畫保留；兩段斧擊完整映射至既有 0.48 秒基準週期，再套用武器／角色攻速。
- T5 騎乘固定骨盆；揮劍最多保留 45° 來源骨盆轉身，分配至三節腰背並於收招回正。雙手斧將來源骨盆旋轉分散到腰背，保留步戰右上往左下的方向。新 T5 不套舊 Corgi 抬臂／側向揮擊修正，持盾跟隨胸口。黑貓以 `SkinnedSeatContact` 的變形後大腿承重點貼合座面，Player、NPC 與預覽共用；既有 T4 坐姿不變。
- LOD1/2 已換成獨立資產，來源 UV 邊界與手／頭／刀鞘保護限制減面幅度：Roman 10,317／9,739／9,375、Viking 10,389／9,517／9,181 面；貼圖 2K／1K／512。較激進候選破壞裝甲而被捨棄，目前面數高於參考預算；不能宣稱面數目標已達成。三個 LOD 的動作、多視角與騎乘已比較；來源自帶 swordSlash／bowRelease 角度警告仍保留。
- `SelectedLodPose` 驗證相同 bind／動畫資料後，讓同一角色三個 LOD 共用骨架與一次姿勢求值，並略過所有來源 clip 中均等於 bind 的不變屬性。角色間骨架仍獨立，raw source clips 不變。優化後 Roman／Viking 的百人近／中／遠景配對皆通過，畫質與陰影未降低；Roman 近景平均 FPS 比為 90.31%，接近門檻，已追加至五組。完整畫面、手部前後比較、正式流程及原始量測留在本機 ignored `output/t5-acceptance/index.html` 與 `output/playwright/`；各資產 audit 保存驗收摘要。Viking T4 仍有獨立的多 mesh／材質提交成本，未在本次大幅重構。


- Soldier Enemy Town Assault 與 Veteran Home Defense 共用四門、120 人 Siege；Recruit／Soldier 舊守城下架。新攻城地圖預先部署後直接開打，主城防守只等存活巡邏騎兵進城便關門開戰，其他單位邊作戰邊完成部署；破門即解除該門步兵與騎兵的部署命令投入戰鬥，同場 reload 保留戰損，詳細契約見 ARCHITECTURE。

- 正式入口提供 Custom Battle、Defense Campaign 與 Career Town；有效存檔／session 可恢復對應流程。人物含 Viking／Roman 與 T4 英雄；Horse、Black Cat、Corgi 均已有模型載入路徑。
- 近期開發集中在 Career Town：剿匪、巡邏、守城、騎兵清剿、Outpost 任務、敵城進攻，以及最新 1v1 Duel。任務結算、恢復與借用駐軍是主要交接區域，入口見 [ARCHITECTURE.md](ARCHITECTURE.md)。
- Captain／Commander 的所有 Town runtime 已接入城外 6 隊 Bandit、3 隊 T2 Horse cavalry。騎兵屬當前城鎮的敵對 faction，進入敵境可能是玩家友軍；自然交火可影響正式任務角色的傷亡及結果，roaming 自身保持獨立名單與歸因。
- Town Patrol 已接入 roaming 整隊交戰與共用 Barracks 整補；交戰期間不可借用，死亡者等本次 engagement 結束才以原 ID 恢復，失馬者繼續步戰並步行回營。回營受擊可整隊重新交戰，保留原 refit slots；Captain 恢復後仍須實際接近 deputy 才接回指揮。
- Roaming 維持全滅才從 map edge 整隊補充；Bandit 每隊獨立冷卻 60 秒，未被 Siege 接管的 cavalry 維持即時替補；不補半隊、不補失馬。舊 NPC／死坐騎完成原有死亡演出後釋放；舊世代活馬無人騎乘時回收，玩家借騎者保留到下馬。Duel 移至訓練區間空地，與完整 Town warfare 共存；任務 actor ownership 優先、Captain 遭敵可還擊後續走原路、NPC 自然就定位，rider／mount 共同遵守友軍保護。Mission party 行軍遭遇沿目前共用 encounter 契約處理。
- `d04aeed`（#166）：新增 Duel 任務，按兵種分別推進擊敗等級；借用城鎮士兵／英雄，支援倒數、戰鬥、結果與返程恢復，不觸發城鎮報復。
- `be5cec1`（#165）：生涯軍馬統一為一份所有權，裝備 tier 隨任命軍階變化；舊購買與任務坐騎存檔相容。
- 柯基已接入目前程式的外部 GLB 路徑；刪除先前「未合併／僅程序模型」的交接標記。來源與重建以 `public/models/mounts/v2/corgi/` 的 manifest／CREDITS 為準。

## 已知限制

下列視覺／效能問題沿用既有交接，**本次未重現確認是否仍存在**：

- Viking Bow LOD1/2 的手臂姿勢與 LOD0 裝備 socket 有落差，可能離手。
- Maki LOD1/2 兜帽／服裝有交穿與破面；整體人物驗收尚未完成。來源姿勢及重建見 [posed-source characters](skills/humanoid-rig-skinning/references/posed-source-characters.md)。
- Roman 衣物簡化接縫、部分手部與騎乘裙擺仍有視覺債務。
- 100v100 騎兵曾有明顯效能瓶頸。歷史優化降低了裝備提交與動畫求值，但沒有證明目前版本的整體 FPS 已解決；舊硬體數字與 PR #19–#27 不作為新工作的 baseline。

## 下一步

依使用者選題處理 [PLAN.md](PLAN.md) 的待辦。效能工作先量測當前版本；生涯修正先檢查任務接受、存檔、恢復、結算及借用角色歸還能否完整走通。
