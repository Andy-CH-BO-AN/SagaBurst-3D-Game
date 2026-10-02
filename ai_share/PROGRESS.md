# SagaBurst — 目前交接

更新：2026-10-02。文件核對基準：`d04aeed`；本次僅文件稽核，未重新驗證遊戲畫面或效能。

## 目前狀態

- 正式入口提供 Custom Battle、Defense Campaign 與 Career Town；有效存檔／session 可恢復對應流程。人物含 Viking／Roman 與 T4 英雄；Horse、Black Cat、Corgi 均已有模型載入路徑。
- 近期開發集中在 Career Town：剿匪、巡邏、守城、騎兵清剿、Outpost 任務、敵城進攻，以及最新 1v1 Duel。任務結算、恢復與借用駐軍是主要交接區域，入口見 [ARCHITECTURE.md](ARCHITECTURE.md)。
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
