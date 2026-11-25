# 效能解讀

範圍：Renderer Submit 的意義與 hero benchmark 場景。索引與共通規則見 [ARCHITECTURE.md](../ARCHITECTURE.md)。

測試人數、相機距離與取樣次數以 `tools/benchmark-hero.mjs` 為準。

- `Renderer Submit` 是 `renderer.render()` 的 CPU 側耗時，可能含 driver 與 GPU back-pressure，**不等同純 GPU 時間**；預設 `renderer.info` 在 shadow pass 後重設，通常只報 main pass，mesh 數也不等於 submissions。
- 完整 pass 歸因與 A/B 方法以 [benchmark skill](../skills/sagaburst-performance-benchmark/SKILL.md) 為準；歷史數據**不代替當前 baseline**。
- `tools/benchmark-hero.mjs` 以 DEV `/?devcombat=commander` 固定場景比較 Roman 與 Viking 的 T4、T5。測試用 fixture 承傷前恢復生命以維持人數，仍走原本 AI、動畫與傷害流程；**不新增正式 T5 招募或戰役名冊**。
- 報告保存 FPS、P95、main-pass draw calls、JS heap 與 WebGL 資源數等；JS heap **不代表總 RAM 或 VRAM**。基準期間禁止變動程式、資產或降低畫質設定。
