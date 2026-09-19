---
name: sagaburst-performance-benchmark
description: 用固定的 browser lifecycle、warm-up、20 秒取樣與 JSON 輸出，量測 SagaBurst 100v100 Mount Update 與 Renderer Submit；適用於 Mount、NPC、combat scenario 的效能 A/B、hotspot 分析與 Renderer Cost Isolation。
---

# SagaBurst 效能量測

這個 skill 用於 SagaBurst 的可重複效能量測。它只負責啟動瀏覽器、取樣、輸出 raw JSON 與計算比較，不修改遊戲規則、AI、移動、碰撞或動畫品質。

## 執行環境

- Benchmark 必須在 local repo terminal 執行，使用 local headed Google Chrome、local display 與 local GPU/WebGL context。不要使用 Codex sandbox browser、in-app browser、headless browser 或 software-rendered fallback。
- macOS 預設使用 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`；若 Chrome 不在該位置，設定 `SAGABURST_CHROME_PATH` 指向本機 Chrome executable。找不到 local Chrome 時應停止並回報，不要靜默改用 Playwright bundled Chromium。
- GitHub PR、push、issue 或其他需要登入的操作使用 local terminal 的 `gh` / `git` credentials；不要要求使用者在 sandbox 內登入 GitHub。這些操作不屬於 benchmark runner 本身，但同一輪任務若需要發 PR，必須遵守此環境界線。

## 標準規則

- 每個 benchmark 使用一個 browser process 與一個 page，run 之間只重新導向 URL。
- 預設 warm-up 3 秒，之後連續觀察 20 秒；不要用單筆 HUD snapshot 當結果。
- Before Contact 使用 3 runs，取 median；優先只保留 battle HUD 證明的 `Alive=200`、`Dead=0` windows。舊版沒有 Alive/Dead HUD 時，只有在 `NPC Count=200` 且尚未出現第一次 combat evidence 前，才可標記為 provisional spawn-plan window；第一次 evidence 之後的窗口全部排除。
- During Combat 預設做 candidate 或 baseline 的 hotspot observation。Scenario E 一開始就是 melee scrum，不等待「接戰前」狀態；它是有效的 combat scenario。
- Scenario D / F 以 Active Attack、Arrow Count 或 Dead 作為 combat evidence；timeout 必須輸出 failed run，不得把 timeout 當成數據。
- 每個 run 都輸出完整 Mount subphase、Alive/Dead、Active Attack、sample count、console/page errors 與 raw samples。
- baseline/candidate 比較必須由 compare script 自動計算 delta 與百分比，不要手算。

## Scenario 清單

- **Scenario D**：100v100 Cavalry / Horse Archer（Formation, 每方 50 Cavalry + 50 Horse Archer, 200 NPC, 200 horses）。
- **Scenario E**：100v100 All-Melee Cavalry（Scattered, Initial Spectator, No respawn, No camps, 200 NPC, 200 horses）。
- **Scenario F**：100v100 Mixed Cavalry Stress（Scattered, Initial Spectator, No respawn, No camps, 200 NPC, 200 horses）。
  每方：
  - 50 melee cavalry
  - 50 horse archers
  全場包含多材質、多骨架、弓箭發射與飛行軌跡，是理想的複合騎兵與渲染壓力場景。

## Renderer Cost Isolation 模式

用於快速拆解 `Renderer Submit` 時間的真正瓶頸來源（Shadow vs Pixel/Fill vs Shader/Material complexity vs CPU submission）。

可選 probe（對應 DEV diagnostic switch）：
- `normal` → `?devcombat=f&nolock`
- `no-shadow` → `?devcombat=f&nolock&perfNoShadow`
- `half-resolution` → `?devcombat=f&nolock&perfHalfResolution`
- `simple-material` → `?devcombat=f&nolock&perfSimpleMaterial`

### Isolation 使用原則

- 第一輪預設 **1 run / probe**，1280x720 headed Chrome，3s warm-up，20s observation。
- 目的在於找 **magnitude / bottleneck direction**，不要一開始就跑 `4 probes × 3 runs`。
- 若某個 probe 出現巨大差異（如 Submit 40ms → 25ms），後續才針對該方向做進一步驗證與拆解。

## 執行方式

在 repo root 執行：

### 1. 標準 Mount / NPC Benchmark
```bash
node .agents/skills/sagaburst-performance-benchmark/scripts/mount-benchmark.mjs \
  --scenario=D --phase=before-contact --runs=3 --tag=candidate
```

Scenario E 的 combat observation：
```bash
node .agents/skills/sagaburst-performance-benchmark/scripts/mount-benchmark.mjs \
  --scenario=E --phase=during-combat --runs=1 --tag=candidate-e-combat
```

### 2. Scenario F Renderer Isolation Probes
```bash
# Probe A: Normal
node .agents/skills/sagaburst-performance-benchmark/scripts/mount-benchmark.mjs \
  --scenario=F --phase=during-combat --runs=1 --render-probe=normal \
  --tag=f-probe-normal --out=output/local-diagnostics/f-probe-normal.json

# Probe B: Shadow OFF
node .agents/skills/sagaburst-performance-benchmark/scripts/mount-benchmark.mjs \
  --scenario=F --phase=during-combat --runs=1 --render-probe=no-shadow \
  --tag=f-probe-no-shadow --out=output/local-diagnostics/f-probe-no-shadow.json

# Probe C: Half Resolution
node .agents/skills/sagaburst-performance-benchmark/scripts/mount-benchmark.mjs \
  --scenario=F --phase=during-combat --runs=1 --render-probe=half-resolution \
  --tag=f-probe-half-resolution --out=output/local-diagnostics/f-probe-half-resolution.json

# Probe D: Simple Material
node .agents/skills/sagaburst-performance-benchmark/scripts/mount-benchmark.mjs \
  --scenario=F --phase=during-combat --runs=1 --render-probe=simple-material \
  --tag=f-probe-simple-material --out=output/local-diagnostics/f-probe-simple-material.json
```

### 3. 多 Probe 結果對比
```bash
node .agents/skills/sagaburst-performance-benchmark/scripts/compare-benchmark.mjs \
  --scenario=F \
  --normal=output/local-diagnostics/f-probe-normal.json \
  --no-shadow=output/local-diagnostics/f-probe-no-shadow.json \
  --half-resolution=output/local-diagnostics/f-probe-half-resolution.json \
  --simple-material=output/local-diagnostics/f-probe-simple-material.json
```

## 判讀限制

- Before Contact 是正式 A/B performance comparison；如果沒有可靠 Alive/Dead，或 provisional window 不足，報告不足，不要把 `NPC Count` 當成戰場存活數，也不要補值。
- E 與 F 的 combat 數據不是無效數據；它應該用來回答亂戰中的 Hotspot 與 Submit 特徵。若兩邊 Alive/Dead 進度不同，只把它當 hotspot context，不能宣稱是嚴格的 FPS 因果 A/B。
- exact main 若沒有內部 Mount profiler，必須明確標記 subphase baseline 來自 profiling-only checkpoint，不要假裝 exact main 有該數據。
- benchmark script 的 `performance.now()` 只存在於 DEV browser recorder；不要把這套 recorder 複製進 production runtime。

## 完成前檢查

```bash
node --check .agents/skills/sagaburst-performance-benchmark/scripts/mount-benchmark.mjs
node --check .agents/skills/sagaburst-performance-benchmark/scripts/compare-benchmark.mjs
npm test -- --run
npm run build
git diff --check
```
