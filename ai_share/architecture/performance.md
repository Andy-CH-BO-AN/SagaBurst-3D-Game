# 效能解讀

範圍：Renderer Submit 的意義與 hero benchmark 場景。索引與共通規則見 [ARCHITECTURE.md](../ARCHITECTURE.md)。

`Renderer Submit` 是 `renderer.render()` 的 CPU 側耗時，可能含 driver／GPU back-pressure，不等同純 GPU 時間。預設 `renderer.info` 在 shadow 後 reset，通常只報 main pass；mesh 數也不等於 submissions。完整 pass 歸因及 A/B 方法以 [benchmark skill](../skills/sagaburst-performance-benchmark/SKILL.md) 為準，舊 PR 數據不代替當前 baseline。

`tools/benchmark-hero.mjs` 以 DEV `devcombat=commander` 固定場景分別比較 Roman／Viking 的 100 名 T4 與 T5，近／中／遠相機、相同裝備及正常畫質各跑至少三組配對，門檻附近追加量測。測試用持續近戰 fixture 每次承傷前恢復生命以維持 100 人，仍走原本 AI、動畫與傷害流程；不新增正式 T5 招募或戰役名冊。報告保存平均 FPS、1% Low、P95、main-pass draw calls、JS heap／WebGL 資源數、來源與 runtime LOD 面數、HTTP 資產雜湊及循環載入結果；JS heap 不代表總 RAM／VRAM。基準期間禁止變動程式／資產或降低陰影、解析度與材質設定。
