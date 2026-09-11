# SagaBurst 3D Game

[English](./README.md) | **繁體中文**

**SagaBurst** 是一個使用 **Three.js**、**TypeScript** 與 **Vite** 製作、可直接在瀏覽器中遊玩的 3D 動作 RPG 原型。

目前正式遊戲入口為 **Custom Battle 自訂戰役**：玩家可以配置 Viking 與 Roman 雙方軍隊、兵種與 Tier，之後以 Viking 陣營玩家角色加入戰場，兩邊 AI 軍隊則會自動接戰。

## ⚔️ Custom Battle 自訂戰役

Viking 與 Roman 每方都可以配置 **1–50 名 AI 士兵**，雙方兵力不需要相同，也支援像 `1 vs 50` 這種非對稱戰鬥。

每個陣營都可以獨立配置四種兵種與三個 Tier：

| 兵種 | 定位 |
| --- | --- |
| Infantry 步兵 | 徒步近戰單位 |
| Archer 遠程步兵 | 徒步遠程單位 |
| Cavalry 騎兵 | 騎乘近戰 / 長槍衝刺單位 |
| Horse Archer 騎射手 | 騎乘遠程單位 |

所有兵種都支援 **T1 / T2 / T3**，不同 Tier 會使用對應強度的裝備與傷害數值。

Setup UI 內建 **10 vs 10**、**25 vs 25**、**50 vs 50** 快速配置，也可以完全手動建立自己的軍隊組合。

Player 是額外加入 Viking 陣營的可操作角色，**不計入 Viking 1–50 名 AI 兵力，也不影響軍隊存活數判定**。

### 戰鬥流程

1. 開啟遊戲後，先在 Custom Battle Setup 配置 Viking 與 Roman 軍隊。
2. 點擊 **START BATTLE**。
3. 雙方 AI 軍隊會按照決定性的陣形出生，並自動往敵軍接戰。
4. 玩家可加入 Viking 一方，使用近戰武器、弓、盾、長槍與戰馬參與戰鬥。
5. 任一方配置的 AI 軍隊全滅後，戰鬥結束。
6. 使用 **REMATCH** 以相同配置重開，或選擇 **BACK TO SETUP** 返回首頁重新配兵。

如果雙方 AI 軍隊在同一時間全滅，結果會判定為 **DRAW 平局**。

## 🐎 Player 預設騎乘與裝備

一般 Custom Battle 現在會讓 Player 以 **Viking 重裝騎兵** 身分開場，直接在 Viking 出生點騎上戰馬，不需要先徒步去找馬。

預設裝備：

- **Steel Lance 精鋼騎槍** — 預設近戰武器，用於馬上戰鬥與高速長槍衝刺。
- **Elven Runebow 精靈符文弓** — 預設 Tier 3 遠程武器。
- **Round Shield T3** — 預設 Viking Tier 3 圓盾。
- **Runic Greatsword 符文大劍** — 額外放在背包中的 Tier 3 近戰武器，不會預設裝備。

下馬後可以按 `Tab` 或 `I` 開啟 Equipment UI，將近戰武器從騎槍切換成 Runic Greatsword。裝備雙手大劍時，既有雙手武器邏輯會自動把目前裝備的盾牌移到背後。

Player 的開場戰馬與 Viking 營地內的五匹備用戰馬是分開計算的。存檔 / 讀檔會保留騎乘狀態與坐騎實際世界座標；舊版本存檔則會保留原本的背包與裝備，不會被自動升級成新的 T3 預設神裝。

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
| 滑鼠左鍵 | 近戰攻擊 |
| 按住滑鼠右鍵 + 滑鼠左鍵 | 瞄準 / 使用弓箭射擊 |
| `E` | 拾取裝備 / 騎馬 / 下馬 |
| `Tab` 或 `I` | 開啟角色與背包介面 |
| `0` | 開啟遊戲選單 |
| `Esc` | 關閉 UI / 解除滑鼠鎖定 |

## 🏹 戰鬥與 RPG 系統

- **近戰戰鬥** — 可使用匕首、劍、大劍與長槍。
- **弓箭戰鬥** — 按住右鍵瞄準，再使用左鍵拉弓與射擊。
- **騎乘戰鬥** — 騎兵可使用長槍衝刺，騎射手則能在馬背上進行遠程攻擊。
- **Tier 裝備** — T1 / T2 / T3 的近戰與遠程裝備具有不同戰鬥數值。
- **盾牌** — Viking 圓盾與 Roman Scutum 都可從營地取得。
- **裝備拾取** — 靠近營地裝備後按 `E` 即可拾取。
- **箭矢補給** — 可從營地補給點補充遠程彈藥。
- **戰馬** — 靠近可騎乘的馬匹後按 `E` 上馬，再按一次 `E` 下馬。
- **角色成長** — Player 戰鬥仍會推進既有 RPG 技能與角色成長系統。
- **存檔 / 讀檔** — 會還原 Player 進度、背包、已裝備盾牌、騎乘狀態、坐騎外觀與坐騎位置。

## 🧪 Developer / QA 模式

正常遊戲網址一律進入 Custom Battle Setup；只有明確指定開發者場景參數時才會繞過首頁。

| Query | 用途 |
| --- | --- |
| `?devcombat` | 固定 50 vs 50 騎乘戰鬥 / 效能 QA 場景，使用同一套 BattleSpawner，不生成營地與額外備用馬 |
| `?devmodels=humans` | Humanoid 模型 / 動畫驗收工作室 |
| `?devmodels=mounts` | 戰馬、馬鞍、騎乘姿勢、步態、跳躍與下馬 QA 工作室 |
| `?legacyhumanoids` | Legacy humanoid rendering modifier，可與正式 Battle 或 dev mode 搭配 |
| `?nolock` | Browser QA 專用，停用一般 pointer-lock 要求 |

範例：

```text
http://localhost:5173/?devcombat&nolock
http://localhost:5173/?devmodels=humans&nolock
http://localhost:5173/?devmodels=mounts&nolock
http://localhost:5173/?devcombat&legacyhumanoids&nolock
```

專案已不再保留硬編碼的 **Standard 9v5 Battle**。正式 gameplay 全部由 Custom Battle configuration 驅動。

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

目前開發重點會持續放在戰鬥品質、AI 行為、角色動畫、效能，以及 Custom Battle 體驗。
