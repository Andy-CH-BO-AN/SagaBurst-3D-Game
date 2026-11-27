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
| D | 100v100 混合騎兵，Formation | 200／201（Horse Count＝200 隻 NPC 坐騎＋玩家預設起始馬；D 非 spectator。加 `&mount=black-cat` 則為 200） |
| E | 100v100 全近戰騎兵，Scattered | 200／200 |
| F | 100v100 混合騎兵，Scattered | 200／200 |
| G | 200v200 步兵，Formation | 400／0 |
| H | 200v200 混編，Formation；每方 60 步兵、60 遠程、40 近戰騎兵、40 騎射 | 400／160 |
| I | 200v200 混合騎兵，Scattered | 400／400 |
| K | 300v300 重騎兵（羅馬鎧甲戰馬 vs 維京雪豹），Formation，雙方 Charge | 600／300（Horse Count 只計 horse registry 的鎧甲戰馬） |
| L | 300v300 六貓遊俠弓騎兵（雙方皆為 Commander VI 遊俠 ×1.5：caracal 90、serval 90、黑／白／橘貓各 30、雪豹 30），Formation，雙方 Charge | 600／0（坐騎全為貓科，不計入 Horse Count） |
| M | 300v300 雪豹遊俠弓騎兵（同 L 的遊俠、陣型與裝備；每方坐騎改為雪豹 150、黑／白／橘貓、serval、caracal 各 30），Formation，雙方 Charge | 600／0（不計入 Horse Count） |

E/F/G/H/I/K/L/M 使用 initial spectator；D–M（不含 J）均 no respawn、no camps。其他 devcombat 場景的 NPC 預設 Defend，Formation 場景兩軍不會自行接戰；K／L／M 例外，雙方一開場即 Charge，before-contact 量衝鋒接近、during-combat 量混戰。K／L／M 有 600 名角色，只在明確指定時執行（不含於 `all`），生成較久，需加 `--initial-timeout-ms=120000`。配置以 `src/battle/BattleConfig.ts` 的 `PRESET_SCENARIO_*` 與 runner 的 scenario 表為準。J 已有遊戲診斷場景，但目前此 runner 未支援，不直接傳 `--scenario=J`。

- 一般窗口預設 warm-up 3 秒、觀察 20 秒。注意：目前 before-contact 從 recorder 啟動後收集所有接戰前合格樣本，含 warm-up；during-combat 才按 observationStart 過濾。比較必須使用相同 runner 版本與實際樣本範圍，不能把 before-contact 說成純 warm-up 後 20 秒。
- **before-contact**：預設 3 runs 取 median。只採 `Alive=該場景 NPC 總數`、`Dead=0` 且尚未發生實際命中的 samples。接戰以 `game.combatEvents` 的 `damage_applied`／`hit_blocked`／`actor_killed` 或死亡判定；HUD 的 Active Attack 只代表 NPC 進入 `AIState.ATTACK`（已鎖定目標），飛行中的箭也不算接戰。解析端保留 spawn-plan provisional 標記，但目前啟動 gate 仍要求初始 Alive/Dead 及 Horse 數正確；缺這些 HUD 的舊版會失敗，不可宣稱自動相容。歷史 provisional 報表不能等同存活數驗證。
- **版本 A/B 以 before-contact 為準**。during-combat 的戰況與鏡頭內人數每 run 不同，即使多 runs 也只能作 hotspot context，不能據此判定版本快慢或退步。
- **before-contact 最低樣本數**：`sampleCount` 是 RuntimeProfiler 的 1 秒 snapshot 數。每 run 至少 5 個，且三份以上 run 的合計至少 15 個，才可作版本比較。K／L／M 一開場就衝鋒，接戰前常只剩 1–6 個；單 run 不足 5 個時增加 runs，直到合計達 15，並在報告標 `low-sample`、列出每 run 的 `sampleCount`／`frameSampleCount`。合計仍不足的場景只報數值，不下 A/B 結論。baseline 與 candidate 的樣本規則必須一致。
- **during-combat**：預設 1 run 作 hotspot 探索。E 開場即混戰，其餘等待第一次實際命中（或死亡）；逾時屬失敗，不能當量測值。
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

compare script 計算 median、delta 與百分比。兩份輸入的 phase、renderProbe、viewport（四門另含 faction、skipPreparation、warmup／observation 長度）不一致時直接失敗；`--allow-mismatch` 只供探索，不能作為驗收結論。硬體、瀏覽器、電源狀態與 commit 不會被檢核，執行前自行核對並記錄。比較必須同為 baseline/candidate 的配對窗口，不能把舊 PR 報表當當前 baseline。

## 指標與判讀

D–M runner 與四門 runner 都輸出以下欄位：

| 欄位 | 定義 | 用途 |
| --- | --- | --- |
| `fps`／`cpuFrameMs`／`renderSubmitMs` | 取樣窗口內的 median | 版本比較的主指標 |
| `frameIntervalP95Ms`／`frameIntervalP99Ms` | rAF frame interval 百分位 | 尾端延遲 |
| `fps1PercentLow` | 最慢 1% frame interval 的平均換算 FPS | 頓挫感；樣本少時誤差大 |
| `cpuFrameP95Ms`／`P99`、`renderSubmitP95Ms`／`P99` | 每幀 CPU 與 submit 的百分位 | 區分尖峰來自模擬或提交 |
| `gpuRenderMedianMs`／`gpuRenderP95Ms`、`gpuRender` | `EXT_disjoint_timer_query_webgl2` 量到的 GPU 時間 | CPU／GPU bound 歸因 |
| `frameSampleCount` | 參與百分位計算的幀數 | 尾端指標可信度 |

- **CPU／GPU 歸因**：先看 `gpuRender.supported` 與 `reason`。不支援、`no-completed-queries` 或大量 `disjointSamples`／`droppedSamples` 時，GPU 欄位為 null，不得補 0 或改用 Renderer Submit 代替。GPU median 明顯低於 Renderer Submit 時屬 CPU 提交成本；接近或超過幀時間時才是 GPU bound。
- **D–M 分段**：HUD 另有 NPC Grid／NPC Update／Mount／Impact／Collision／Arrow／Render Submit 等分段；新增分段的 runner 與缺分段的舊 baseline 比較時，缺值視為不可用。
- **逐幀指標的取樣窗口**（`frameWindow`）：P95／P99／1% Low、CPU／submit 百分位與 GPU 欄位都只取 warm-up 結束後的幀；before-contact 另截止於最後一個尚未命中的 1 秒 snapshot（該 snapshot 涵蓋截至當時的幀，之後的幀可能已接戰）。GPU 樣本依 render 開始時間截到同一窗口；舊 build 的 GPU probe 沒有樣本時間戳時，before-contact 的 GPU 值為 null、`reason=no-sample-timestamps`。1 秒 snapshot 的 median 欄位仍沿用上述「含 warm-up」範圍。
- K／L／M 接戰快，warm-up 後可能只剩很少幀甚至 0 幀，此時尾端欄位為 null；需要時配對兩邊同樣縮短 `--warmup-ms`，並記錄 `frameSampleCount`。不同 runner 版本的 before-contact 尾端指標不可互相比較；以 Active Attack／Arrow Count 判定接戰的舊版窗口較短，不能與命中判定版比較。
- **報告**：記錄 commit、硬體、瀏覽器、電源狀態、viewport、run 數、每 run 的 `sampleCount`／`frameSampleCount`、GPU 支援狀態及失敗 run。各 run 數值差異大時列出每 run 值，不只報 median。

## 四門總守城戰（Town Commander V）

Town 沒有 `#dev-combat-status` profiler，改用 `four-gate-benchmark.mjs`：每 run 以全新 browser context 載入 DEV `?careerQa=commander-v`，量 preparation（守軍與平民已部署、攻方未生成）與 siege（按 H 跳過準備、攻方全員生成後）兩窗；指標為 rAF callback JS CPU、`renderer.render` 耗時（Renderer Submit）、frame interval FPS、上節的尾端與 GPU 欄位、`renderer.info` draw calls／triangles，並記錄雙方存活、任務守軍、平民在大廳數與平民最大位移。攻方生成與否以 `enemiesAlive === enemiesExpected` 驗證；任何 console／page error 即標成失敗。

- `segments` 來自 DEV-only `TownDevProfiler`：`frameTotalMs`、`missionFlowMs`、`gridBuildMs`、`siegeMs`、`actorUpdateMs`、`collisionMs`、`shotsMs`、`persistMs`、`hudMs`，各含 median、P95 與 max。用來歸因 siege 窗非 render 的 CPU 成本。
- `saves` 記錄取樣窗內每次存檔的 parse／clone／stringify／setItem 耗時與位元組（count、median、max）。判斷存檔是否造成尖峰時，比對 save 次數與 `persistMs` max。
- 守城人口不固定時（守方戰損、攻方部署進度），比較前先核對兩邊 siege 開始時的雙方存活數。

```sh
rtk proxy node ai_share/skills/sagaburst-performance-benchmark/scripts/four-gate-benchmark.mjs --host=localhost:PORT --runs=3 --tag=baseline --out=output/local-diagnostics/four-gate-baseline.json
```

`--skip-preparation` 只量 siege 窗；配對比較兩邊須同設定。插樁不同於 devcombat profiler，數據不可與 D–M 報表直接比較。

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

## 凍結場景 LOD A/B

只在特定距離生效的 render 改動（例如 LOD1 裝備批次化），接戰前鏡頭內常沒有對應 LOD 的角色，before-contact A/B 只能證明沒有退步。此時用 `frozen-lod-ab-benchmark.mjs` 在同一凍結狀態取證：第一次實際命中後展開 `--settle-ms`、freeze 模擬，`--force-lod=N` 以 DEV `__forceHumanoidLod(N)` 暫改人物 `THREE.LOD` 距離門檻，讓所有繪製中的人物經正式 LOD 更新路徑選到該 level；再依序 `__perfToggle(name)` OFF→ON→OFF→ON，每窗取 RuntimeProfiler、GPU timer、Main／Shadow census、CPU profile 與截圖，最後 `__forceHumanoidLod(null)` 恢復並核對 Alive/Dead、相機、位置與 LOD 分布回到強制前。

```sh
rtk proxy node ai_share/skills/sagaburst-performance-benchmark/scripts/frozen-lod-ab-benchmark.mjs --host=localhost:PORT --scenario=k --settle-ms=2000 --force-lod=1 --toggle=lod1EquipmentBatch --out=output/local-diagnostics/k-lod1-ab.json
```

- 鏡頭外角色受 off-frustum 視覺休眠隱藏 `characterVisualGroup`，任何 LOD 下都不繪製，不計入強制數。
- 兩個 OFF 窗（或兩個 ON 窗）之間的差異就是噪聲基準；截圖逐像素比較 OFF 與 ON，草地 shader 擺動與 HUD 數字的差異不算畫面改變。
- 強制 LOD 是成本歸因，不等於自然距離分布下的動態 FPS。

## 結果與工具驗證

- `?devcombat=a–k` 不再畫每名 NPC 的 `CombatTrajectoryDebugger` 線（只有 `devcombat=all` 會畫）；與更早版本的報表比較 Draw Calls／Renderer Submit 時，視為插樁差異。
- `Renderer Submit` 是 `renderer.render()` 的 CPU 側耗時，可含 driver／GPU back-pressure，不是純 GPU 時間。預設 `renderer.info` 通常只含 main pass；mesh 數不等於 submissions。
- 動態戰況若 Alive/Dead 或 LOD 分布不同，只能作 hotspot context，不能據此宣稱 FPS 因果收益。舊版缺 profiler／hook 時明確報告限制或 profiling-only checkpoint。
- 修改 runner 後做 `node --check`、離線解析／比較案例及受影響的本機 browser smoke check；遊戲程式變更才依 AGENTS 跑相關測試與 build。純文件修正不啟動長時間 benchmark。
