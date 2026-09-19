# SagaBurst 3D Game

[English](./README.md) | **繁體中文**

**SagaBurst** 是一個使用 **Three.js**、**TypeScript** 與 **Vite** 製作、可直接在瀏覽器中遊玩的 3D 動作 RPG 原型。

目前正式遊戲入口為 **Custom Battle 自訂戰役**：玩家可以配置 Viking 與 Roman 雙方軍隊、兵種、Tier、戰鬥部署模式、Player Faction，以及 Player 的起始裝備與騎乘狀態；兩邊 AI 軍隊則會在大型戰場上自動接戰。

## ⚔️ Custom Battle 自訂戰役

Viking 與 Roman 每方都可以配置 **1–100 名 AI 士兵**，雙方兵力不需要相同，也支援像 `1 vs 100`、`100 vs 1` 這種非對稱戰鬥。

每個陣營都可以獨立配置四種兵種與三個 Tier：

| 兵種 | 定位 |
| --- | --- |
| Infantry 步兵 | 徒步近戰單位 |
| Archer 遠程步兵 | 徒步遠程單位 |
| Cavalry 騎兵 | 騎乘近戰 / 長槍衝刺單位 |
| Horse Archer 騎射手 | 騎乘遠程單位 |

所有兵種都支援 **T1 / T2 / T3**，不同 Tier 會使用對應強度的裝備與傷害數值。

Setup UI 內建 **10 vs 10**、**25 vs 25**、**50 vs 50**、**100 vs 100** 快速配置，也可以完全手動建立自己的軍隊組合。

戰鬥部署模式與兵力 Preset 分開設定：

- **Formation Battle 列陣戰** — Viking 與 Roman 以確定性的陣形出生在戰場兩側。
- **Scattered Battle 散兵大亂戰** — Player、Viking NPC 與 Roman NPC 會以確定性的散布方式分散在整個戰場，但 Viking vs Roman 的敵我關係、友軍傷害規則與勝負條件完全不變。

Player Faction 與兵力、部署模式分開設定：

- **Viking Player** — Viking NPC 為友軍、Roman NPC 為敵軍；Formation Battle 從 Viking 的 +Z 側出生並面向 Roman 軍隊。
- **Roman Player** — Roman NPC 為友軍、Viking NPC 為敵軍；Formation Battle 從 Roman 的 -Z 側出生並面向 Viking 軍隊。

切換 10 vs 10～100 vs 100 等兵力 Preset 只會修改軍隊配置，並保留目前選擇的 **Battle Mode、Player Faction、Player Loadout 與 Spectator** 設定。

Player 是額外加入所選陣營的可操作角色，**不計入該陣營配置的 1–100 名 AI 兵力，也不影響軍隊存活數判定**。

### 戰鬥流程

1. 開啟遊戲後，在 **軍隊配置 ARMY SETUP** 設定 Viking / Roman 軍隊、Player Faction，以及 **Formation Battle** 或 **Scattered Battle**。
2. 切到 **玩家裝備 PLAYER LOADOUT**，選擇近戰武器、遠程武器、盾牌（或無盾），以及 **騎馬 MOUNTED** / **徒步 ON FOOT**。
3. 點擊 **開始戰鬥 START BATTLE**。
4. 所有 actor 會依模式出生：Formation Battle 讓兩軍在戰場兩側列陣；Scattered Battle 則讓 Player 與雙方 NPC 以確定性位置交錯散布在戰場各處。之後雙方 AI 會自動索敵接戰。
5. 玩家加入所選陣營一方，可使用 Viking / Roman 的劍、Gladius、長槍、弓、Pilum、盾牌與戰馬參與戰鬥。
6. 任一方配置的 AI 軍隊全滅後，戰鬥結束。
7. 使用 **REMATCH** 以相同設定重開，或選擇 **BACK TO SETUP** 返回首頁重新配置。

如果雙方 AI 軍隊在同一時間全滅，結果會判定為 **DRAW 平局**。

## 🧰 Player 裝備與出戰方式

Custom Battle 現在有獨立的 **玩家裝備 PLAYER LOADOUT** 頁面。開始戰鬥前，可以直接選擇一把近戰武器、一把遠程武器、盾牌（或不帶盾），以及要 **騎馬 MOUNTED** 還是 **徒步 ON FOOT** 開場。

Player 裝備與 Player Faction 完全分開，因此 Viking / Roman 裝備可以自由混搭：

- **近戰武器** — Viking 長劍、Roman Gladius，或 Steel Lance 長槍。
- **遠程武器** — Viking 弓，或 Roman Pilum 標槍。
- **盾牌** — Viking 圓盾、Roman Scutum，或選擇無盾。
- **出戰方式** — 選擇 **騎馬** 時會建立並騎上既有開場戰馬；選擇 **徒步** 時不會生成這匹特殊開場戰馬。

有明確設定 Player Loadout 時，Player 起始背包只會包含所選裝備，不會另外塞入沒有選到的頂級裝備。切換兵力 Preset 或 Reset 也會保留目前的 Player Loadout。

弓與 Pilum 的操作方式不同：弓沿用既有的拉弓 / 放箭流程；Pilum 則是按住右鍵瞄準，再用左鍵觸發投擲。進入遠程瞄準時，若有裝備盾牌，仍沿用既有邏輯自動卸下盾牌。

為了向後相容，沒有 `playerLoadout` 的舊 BattleConfig 仍維持原本預設：**Steel Lance、Elven Runebow、Round Shield T3，並騎馬開場**。若啟用初始 **Spectator 觀戰模式**，則會忽略騎乘設定，不生成 Player 的開場戰馬。

Player 的開場戰馬與雙方營地內提供的備用戰馬分開計算。**Player 在單場戰鬥中死亡後不會復活**，而是直接切換為自由觀戰模式；剩餘 Viking 與 Roman NPC 會繼續交戰直到分出勝負。使用 **REMATCH** 才會以相同設定重新開始一場新的戰鬥。存檔 / 讀檔仍會保留騎乘狀態與坐騎實際世界座標，而讀入的存檔背包會覆蓋新戰鬥的起始 Loadout。

## 🏕️ 雙方營地

一般 Custom Battle 會在 Viking 與 Roman 後方各生成一個支援營地。

每個營地都會提供 Player 可使用的裝備：

- T1 / T2 / T3 近戰武器
- T1 / T2 / T3 遠程武器
- T1 / T2 / T3 盾牌
- 一把長槍
- 箭矢補給
- 五匹備用戰馬

騎兵與騎射手本身會有自己的軍用坐騎，不會消耗營地提供給 Player 的五匹備用戰馬。

## 🎮 怎麼玩

### 安裝與啟動

你需要先安裝 **Node.js** 與 **npm**。

```bash
git clone https://github.com/Andy-CH-BO-AN/SagaBurst-3D-Game.git
cd SagaBurst-3D-Game
npm ci
npm run dev
```

接著使用桌面瀏覽器開啟 Vite 顯示的本機網址。Custom Battle Setup 會先顯示，重量較大的 3D 資產會等到玩家開始戰鬥後才載入。

點擊 **START BATTLE** 後，遊戲會嘗試鎖定滑鼠來控制鏡頭。按 `Esc` 可以釋放游標，需要繼續操作時再點擊戰鬥畫面即可重新進入 pointer lock。

> 遊戲目前以桌面版鍵盤 + 滑鼠操作為主。

## 🕹️ 操作方式

| 按鍵 / 操作 | 功能 |
| --- | --- |
| `W` `A` `S` `D` | 移動 |
| 滑鼠 | 視角 / 鏡頭控制 |
| `Shift` | 衝刺 |
| `Space` | 跳躍 |
| 滑鼠左鍵 | 未瞄準時進行近戰攻擊 |
| 按住滑鼠右鍵 + 按住 / 放開左鍵 | 弓箭瞄準 / 拉弓 / 放箭 |
| 按住滑鼠右鍵 + 點擊左鍵 | 瞄準 / 投擲 Pilum 標槍 |
| `E` | 拾取裝備 / 騎馬 / 下馬 |
| `Tab` 或 `I` | 開啟角色與背包介面 |
| `0` | 開啟遊戲選單 |
| `Esc` | 關閉 UI / 解除滑鼠鎖定 |

## 🏹 戰鬥與 RPG 系統

- **近戰戰鬥** — 可使用匕首、劍、大劍與長槍。
- **弓箭戰鬥** — 按住右鍵瞄準，按住左鍵拉弓，再放開左鍵射擊。
- **Pilum 標槍** — 按住右鍵瞄準，點擊左鍵觸發 Roman Pilum 投擲。
- **騎乘戰鬥** — 騎兵可使用長槍衝刺，騎射手則能在馬背上進行遠程攻擊。
- **Tier 裝備** — Viking / Roman 的 T1 / T2 / T3 裝備具有不同戰鬥數值。
- **盾牌** — Viking 圓盾與 Roman Scutum 都可在 Player Loadout 選擇，也能於戰場中取得。
- **裝備拾取** — 靠近營地裝備後按 `E` 即可拾取。
- **箭矢補給** — 可從營地補給點補充遠程彈藥。
- **戰馬** — 靠近可騎乘的馬匹後按 `E` 上馬，再按一次 `E` 下馬。
- **角色成長** — Player 戰鬥仍會推進既有 RPG 技能與角色成長系統。
- **存檔 / 讀檔** — 會還原 Player 進度、背包、已裝備盾牌、騎乘狀態、坐騎外觀與坐騎位置。

## 🧪 Developer / QA 模式

正常遊戲網址一律進入 Custom Battle Setup；只有明確指定開發者場景參數時才會繞過首頁。

### 大型戰鬥 Profiling 場景

`devcombat` 目前提供可重現的大型戰鬥效能測試場景：

| Query | 場景 |
| --- | --- |
| `?devcombat=a` | 50 vs 50 純步兵控制組 |
| `?devcombat=b` | 100 vs 100 純步兵 scaling 場景 |
| `?devcombat=c` | 100 vs 100 混合兵種場景 |
| `?devcombat=d` | 100 vs 100 列陣騎兵 / 騎射手壓力場景 |
| `?devcombat=e` | 100 vs 100 全近戰騎兵、Scattered Battle、初始觀戰、無營地 / 復活 |
| `?devcombat=f` | 100 vs 100 混合騎兵（每方 50 近戰騎兵 + 50 騎射手）、Scattered Battle、初始觀戰、無營地 / 復活 |
| `?devcombat` | 舊版固定 50 vs 50 mounted 開發場景 |

`devcombat` 會顯示 runtime profiling HUD，包含 wall-clock FPS、CPU Frame Work、NPC Update、Entity Collision、Projectile / Impact、Renderer Submit、Draw Calls、Triangles、Horse Count 與 LOD 統計。

目前 profiling 顯示，大型戰鬥的主要效能壓力集中在 **render path / draw-call pressure**；Entity Collision 的實際耗時相對很小。Profiling instrumentation 只會在 developer combat mode 啟用，不會加入一般正式 gameplay hot path。

其他 QA 模式：

| Query | 用途 |
| --- | --- |
| `?devmodels=humans` | Humanoid 模型 / 動畫驗收工作室 |
| `?devmodels=mounts` | 戰馬、馬鞍、騎乘姿勢、步態、跳躍與下馬 QA 工作室 |
| `?legacyhumanoids` | Legacy humanoid rendering modifier，可與正式 Battle 或 dev mode 搭配 |
| `?nolock` | Browser QA 專用，停用一般 pointer-lock 要求 |

範例：

```text
http://localhost:5173/?devcombat=b&nolock
http://localhost:5173/?devcombat=c&nolock
http://localhost:5173/?devcombat=d&nolock
http://localhost:5173/?devcombat=f&nolock
http://localhost:5173/?devmodels=humans&nolock
http://localhost:5173/?devmodels=mounts&nolock
```

專案已不再保留硬編碼的 **Standard 9v5 Battle**。正式 gameplay 全部由 Custom Battle configuration 驅動。

## 📊 效能 Profiling

大型戰鬥效能評估以真實 headed browser 為基準，不使用 software-rendered headless FPS 當作 gameplay baseline。

Benchmark runner 會記錄 Browser / WebGL 環境，並檢查是否為硬體加速 renderer，再決定該次執行能否視為可信的 gameplay baseline。

```bash
node tools/profile-large-battles.mjs
```

大型綜合 Benchmark 會依序執行 A–D 場景，並記錄接戰前與接戰中的 FPS、CPU Work、Renderer Submit、NPC Update、Collision、Draw Calls 與 Triangles 等資訊。

針對 Shadow Path，目前以 **Scenario F** 作為混合騎兵隔離場景。Fixed-scene runner 會凍結 simulation、維持 render loop 運作、驗證場景 invariant，並執行 Shadow ON / OFF / ON 對照；Renderer Submit 不會被誤稱為純 GPU time：

```bash
node ai_share/skills/sagaburst-performance-benchmark/scripts/fixed-scene-shadow-benchmark.mjs
```

目前已進入 `main` 的結構性 Shadow 優化包含：

- **Roman Humanoid** — LOD0 / LOD1 每名角色的 shadow caster 從 17 個精簡為 5 個；LOD2 維持零陰影。
- **NPC Equipment** — Scenario F 裝備 Shadow Submissions 從 127 降至 68，只保留真正影響 silhouette 的 caster；Equipment LOD2 維持零陰影。
- **NPC Projectile** — NPC 飛行中的 Arrow / Pilum 不再投射陰影，結構成本由每個 active projectile 1 submission 降為 0；Player 自己發射的 projectile shadow 保持不變。

效能結論以 Shadow Census 的結構性 submissions / triangles 為主要因果證據。不同 commit 間的 FPS / Renderer Submit 只視為方向性 timing evidence，除非能完整重播完全相同的 scene state。

## 🧰 開發指令

```bash
# 啟動開發伺服器
npm run dev

# 執行測試
npm test

# TypeScript 檢查並建立 production bundle
npm run build

# 預覽 production build
npm run preview
```

## 🛠️ 技術棧

- Three.js
- TypeScript
- Vite
- Vitest
- Playwright

## 🚧 專案狀態

SagaBurst 目前仍是一個持續開發中的 3D 動作 RPG 原型，核心方向包含大規模 AI 戰鬥、近戰與遠程戰鬥、騎乘系統、裝備成長，以及瀏覽器中的 3D 角色與動畫系統。

目前已支援最高 **100 vs 100 AI** 的戰鬥，包含步兵、遠程單位、騎兵與騎射手，並提供三個裝備 Tier。

目前開發重點會持續放在戰鬥行為、角色動畫、大型戰鬥 render performance，以及 Custom Battle 體驗。
