---
name: sagaburst-performance-benchmark
description: 用固定瀏覽器、warm-up、取樣窗口與 JSON 輸出，量測 SagaBurst 大型戰鬥的 Mount/NPC Update、Renderer Submit 與陰影成本；適用效能 A/B 與 hotspot 歸因。
---

# SagaBurst 效能量測

一般戰鬥場景使用本 skill 的既有 Playwright runner 量測；指定物種樣本見下方專節。一般畫面操作另用 [combat-browser-validation](../combat-browser-validation/SKILL.md) 的 Playwright CLI。不要以單張 HUD 或手動取樣代替效能 runner，也不為量測默默改遊戲規則、動畫品質或 AI。

## 執行環境

- 使用本機有畫面的 Google Chrome、display 與 GPU/WebGL；不以 headless、軟體渲染或 in-app browser 數據宣稱正式效能。
- macOS 預設 Chrome 路徑為 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`；其他位置以 `SAGABURST_CHROME_PATH` 指定。不靜默改用 bundled Chromium。
- 從 repo root 執行，先確認既有 Vite 位址；需要時傳 `--host=HOST:PORT`。runner 預設 `127.0.0.1:5173`，使用 DEV profiler／census hooks，不能把其結果稱為未插樁 production build 量測。
- 每次執行一個 browser process／page，run 間重新導向；baseline/candidate 使用相同硬體、瀏覽器、場景、相機、畫面尺寸與取樣設定，記錄 commit 及插樁差異。配對量測依序跑，不同時跑 Blender bake、測試／build 或其他 browser QA。JSON、截圖與臨時 builds 放 ignored `output/`。
- 多個 worktree server 共用 `node_modules` 時使用獨立 Vite `cacheDir` 與 port；確認 origin／source commit／資產一致，不能把原 checkout 的 public 目錄誤用成 candidate。

## 選場景與窗口

| Scenario | 配置 | NPC／Horse 總數 |
| --- | --- | --- |
| D | 100v100 混合騎兵，Formation | 200／200 |
| E | 100v100 全近戰騎兵，Scattered | 200／200 |
| F | 100v100 混合騎兵，Scattered | 200／200 |
| G | 200v200 步兵，Formation | 400／0 |
| H | 200v200 混編，Formation；每方 60 步兵、60 遠程、40 近戰騎兵、40 騎射 | 400／160 |
| I | 200v200 混合騎兵，Scattered | 400／400 |

E/F/G/H/I 使用 initial spectator；D–I 均 no respawn、no camps。配置以 `src/battle/BattleConfig.ts` 的 `PRESET_SCENARIO_*` 與 runner 的 scenario 表為準。J 已有遊戲診斷場景，但目前此 runner 未支援，不直接傳 `--scenario=J`。

- 一般窗口預設 warm-up 3 秒、觀察 20 秒。注意：目前 before-contact 從 recorder 啟動後收集所有接戰前合格樣本，含 warm-up；during-combat 才按 observationStart 過濾。比較必須使用相同 runner 版本與實際樣本範圍，不能把 before-contact 說成純 warm-up 後 20 秒。
- **before-contact**：預設 3 runs 取 median。只採 `Alive=該場景 NPC 總數`、`Dead=0` 且未出現攻擊／投射物證據的 samples。解析端保留 spawn-plan provisional 標記，但目前啟動 gate 仍要求初始 Alive/Dead 及 Horse 數正確；缺這些 HUD 的舊版會失敗，不可宣稱自動相容。歷史 provisional 報表不能等同存活數驗證。
- **during-combat**：預設 1 run 作 hotspot 探索。E 開場即混戰，其餘依 HUD 的 Active Attack／Arrow Count／Dead 等待戰鬥證據；逾時屬失敗，不能當量測值。
- 明確指定 scenario 與 phase。不要直接使用預設 `all`／before-contact 把開場即混戰的 E 混進比較。
- 保留成功／失敗狀態、sample count、Alive/Dead、Active Attack、errors 及 raw samples。缺內部 Mount profiler 的 baseline 使用 `--no-subphase`，缺值不得補成 0。

## 一般量測與比較

```sh
rtk proxy node ai_share/skills/sagaburst-performance-benchmark/scripts/mount-benchmark.mjs --help
rtk proxy node ai_share/skills/sagaburst-performance-benchmark/scripts/mount-benchmark.mjs --scenario=D --phase=before-contact --runs=3 --tag=baseline --out=output/local-diagnostics/d-baseline.json
# 切到待比較版本、確認同樣設定後執行：
rtk proxy node ai_share/skills/sagaburst-performance-benchmark/scripts/mount-benchmark.mjs --scenario=D --phase=before-contact --runs=3 --tag=candidate --out=output/local-diagnostics/d-candidate.json
rtk proxy node ai_share/skills/sagaburst-performance-benchmark/scripts/compare-benchmark.mjs --scenario=D --baseline=output/local-diagnostics/d-baseline.json --candidate=output/local-diagnostics/d-candidate.json
```

compare script 計算 median、delta 與百分比，但不驗證兩份輸入的硬體、phase 或場景配置是否可比較；執行前先核對。比較必須同為 baseline/candidate 的配對窗口，不能把舊 PR 報表當當前 baseline。

## 指定物種的動態坐騎樣本

黑貓／柯基等少量混合物種動畫驗收，若既有 scenario 無法覆蓋，可在 ignored `output/` 建任務 fixture，依目前正式 API 配置坐騎與路線；保留真正的 Game／NPC／Mount update、LOD、shadow 及騎士連結，不用只有裸模 mixer 的 viewer 推論遊戲成本。物種、數量、tier 與持續移動門檻依任務決定，這種樣本不代替大型戰鬥 benchmark。

- 保存 baseline／candidate 的 commit、資產 hash、場景種子、相機、品質設定及插樁方法。確認人口／死亡／物種分布、實際移動數、騎士連結與有限數值在取樣期間符合條件；違反條件的 run 標成失敗並保留原始紀錄，不能只刪掉違例 samples 再宣稱通過。
- 明確 reset warm-up 後的計數器；低頻 profiler snapshot 以 generation 或更新時間去重，輪詢次數不是獨立樣本數。記錄實際取樣窗口和 raw samples。
- 用同一 fixture 依序量測配對版本，依多次 run 的結果比較；維持相機固定並記錄自然 LOD 分布。報告每幀 CPU 的絕對增量及 FPS，避免把很小耗時的百分比變化稱為重大退步或收益。

## Renderer 成本歸因

`mount-benchmark.mjs` 支援 `--render-probe=normal|no-shadow|half-resolution|simple-material`，對應 DEV 的 `perfNoShadow`／`perfHalfResolution`／`perfSimpleMaterial`。先各跑 1 次 F 的 during-combat，1280×720、3 秒 warm-up、20 秒取樣；再針對明顯方向追加驗證。

```sh
rtk proxy node ai_share/skills/sagaburst-performance-benchmark/scripts/mount-benchmark.mjs --scenario=F --phase=during-combat --runs=1 --render-probe=normal --out=output/local-diagnostics/f-normal.json
# 依序換 probe 與 out 檔名後，比較已完成的四份報表：
rtk proxy node ai_share/skills/sagaburst-performance-benchmark/scripts/compare-benchmark.mjs --scenario=F --normal=output/local-diagnostics/f-normal.json --no-shadow=output/local-diagnostics/f-no-shadow.json --half-resolution=output/local-diagnostics/f-half-resolution.json --simple-material=output/local-diagnostics/f-simple-material.json
```

## 固定場景陰影診斷

`fixed-scene-shadow-benchmark.mjs` 在戰鬥開始後預設展開 4 秒，freeze 遊戲狀態但保留 render，再測 Shadow ON → OFF → ON。每窗穩定 1 秒、量測 4 秒，計時窗外取 main/shadow census。

目前 runner 隨後還執行 shadow-map resolution sequence，預設 `2048,1024,512,256,2048`；`--resolution-only` 可只測此序列。`--shadow-map-size` 與 `--shadow-map-sizes` 擇一，不能同時傳。

```sh
rtk proxy node ai_share/skills/sagaburst-performance-benchmark/scripts/fixed-scene-shadow-benchmark.mjs --help
rtk proxy node ai_share/skills/sagaburst-performance-benchmark/scripts/fixed-scene-shadow-benchmark.mjs --scenario=F --out=output/local-diagnostics/f-shadow.json
```

驗證 Alive/Dead、Arrow、Horse、camera、非 shadow submissions／triangles 在同場景切換前後不變，並檢查返回原設定時的 drift。這是成本歸因，不等同一般動態戰鬥 FPS。

## 結果與工具驗證

- `Renderer Submit` 是 `renderer.render()` 的 CPU 側耗時，可含 driver／GPU back-pressure，不是純 GPU 時間。預設 `renderer.info` 通常只含 main pass；mesh 數不等於 submissions。
- 動態戰況若 Alive/Dead 或 LOD 分布不同，只能作 hotspot context，不能據此宣稱 FPS 因果收益。舊版缺 profiler／hook 時明確報告限制或 profiling-only checkpoint。
- 修改 runner 後做 `node --check`、離線解析／比較案例及受影響的本機 browser smoke check；遊戲程式變更才依 AGENTS 跑相關測試與 build。純文件修正不啟動長時間 benchmark。
