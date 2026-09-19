---
name: sagaburst-performance-benchmark
description: 用固定的 browser lifecycle、warm-up、20 秒取樣與 JSON 輸出，量測 SagaBurst 100v100 Mount Update；適用於 Mount、NPC、combat scenario 的效能 A/B 與 hotspot 分析。
---

# SagaBurst 效能量測

這個 skill 用於 SagaBurst 的可重複效能量測。它只負責啟動瀏覽器、取樣、輸出 raw JSON 與計算比較，不修改遊戲規則、AI、移動、碰撞或動畫品質。

## 標準規則

- 每個 benchmark 使用一個 browser process 與一個 page，run 之間只重新導向 URL。
- 預設 warm-up 3 秒，之後連續觀察 20 秒；不要用單筆 HUD snapshot 當結果。
- Before Contact 使用 3 runs，取 median；只保留 `Alive=200`、`Dead=0` 且尚未出現 combat evidence 的 profiler windows。
- During Combat 預設做 candidate 或 baseline 的 hotspot observation。Scenario E 一開始就是 melee scrum，不等待「接戰前」狀態；它是有效的 combat scenario。
- Scenario D 以 Active Attack、Arrow Count 或 Dead 作為 combat evidence；timeout 必須輸出 failed run，不得把 timeout 當成數據。
- 每個 run 都輸出完整 Mount subphase、Alive/Dead、Active Attack、sample count、console/page errors 與 raw samples。
- baseline/candidate 比較必須由 compare script 自動計算 delta 與百分比，不要手算。

## 執行方式

在 repo root 執行：

```bash
node .codex/skills/sagaburst-performance-benchmark/scripts/mount-benchmark.mjs \
  --scenario=D --phase=before-contact --runs=3 --tag=candidate
```

Scenario E 的 combat observation：

```bash
node .codex/skills/sagaburst-performance-benchmark/scripts/mount-benchmark.mjs \
  --scenario=E --phase=during-combat --runs=1 --tag=candidate-e-combat
```

預設使用 headless Chromium，避免可見 browser window 的 UI 合成干擾；需要目視驗證時使用 `--headed`。輸出預設放在 `output/local-diagnostics/`，該目錄不應被 commit。

baseline 與 candidate 的結果分開產生後，使用：

```bash
node .codex/skills/sagaburst-performance-benchmark/scripts/compare-benchmark.mjs \
  --scenario=D \
  --baseline=output/local-diagnostics/mount-benchmark-baseline-before-contact.json \
  --candidate=output/local-diagnostics/mount-benchmark-candidate-before-contact.json
```

## 判讀限制

- Before Contact 是正式 A/B performance comparison；如果有效 samples 不足，報告不足，不要補值。
- E 的 combat 數據不是無效數據；它應該用來回答亂戰中的 Mount hotspot。若兩邊 Alive/Dead 進度不同，只把它當 hotspot context，不能宣稱是嚴格的 FPS 因果 A/B。
- exact main 若沒有內部 Mount profiler，必須明確標記 subphase baseline 來自 profiling-only checkpoint，不要假裝 exact main 有該數據。
- benchmark script 的 `performance.now()` 只存在於 DEV browser recorder；不要把這套 recorder 複製進 production runtime。

## 完成前檢查

```bash
node --check .codex/skills/sagaburst-performance-benchmark/scripts/mount-benchmark.mjs
node --check .codex/skills/sagaburst-performance-benchmark/scripts/compare-benchmark.mjs
npm test -- --run
npm run build
git diff --check
```
