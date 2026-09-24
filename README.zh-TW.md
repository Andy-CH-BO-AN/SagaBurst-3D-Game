# SagaBurst 3D Game

[English](./README.md) | **繁體中文**

**SagaBurst** 是一個使用 **Three.js**、**TypeScript** 與 **Vite** 製作、可直接在瀏覽器中遊玩的 3D 動作 RPG 原型。

目前正式遊戲包含 **Custom Battle 自訂戰役** 與 **Defense Campaign 防守戰役**。Custom Battle 可自由配置 Viking / Roman 雙方軍隊與玩家裝備；Defense Campaign 則提供 Roman / Viking 各自獨立進度的 9 關守城流程。進入戰場後，玩家也可以透過 **Army Command 軍隊命令**，對指定兵種或全軍下達攻擊、防禦、衝鋒與列陣命令。

## 🏰 Defense Campaign 防守戰役

玩家可選擇 **羅馬防守** 或 **維京防守**，配置該關守軍後防守前哨站。

- 共 **Stage 1–9**，通關後依序解鎖下一關。
- Roman / Viking 的通關進度各自獨立，並保存在瀏覽器。
- 每關具有不同的守軍總上限、Tier 配額、騎兵上限、攻軍數量、攻軍 Tier 組成與援軍 Tier。
- 敵軍全滅會立即勝利；若戰鬥持續，排定的刀騎兵援軍仍會進場。
- Stage 9 為目前 Defense Campaign 最終關。

| 關卡 | 守軍總上限 | 額外名額 | 攻軍 |
| --- | ---: | --- | --- |
| 1 | 80 | +30 T1 | 100 T2 |
| 2 | 85 | +30 T1 | 110 T2 |
| 3 | 90 | +30 T1 | 120 T2 |
| 4 | 90 | +30 T2 | 100 T2 + 30 T3 |
| 5 | 90 | +30 T2 | 70 T2 + 70 T3 |
| 6 | 90 | +30 T2 | 30 T2 + 120 T3 |
| 7 | 90 | +30 T3 | 160 T3 |
| 8 | 90 | +30 T3 | 180 T3 |
| 9 | 90 | +30 T3 | 200 T3 |

## ⚔️ Custom Battle 自訂戰役

Viking 與 Roman 每方都可以配置 **1–200 名 AI 士兵**，雙方兵力不需要相同，也支援像 `1 vs 200`、`200 vs 1` 這種非對稱戰鬥。

每個陣營都有自己的兵種 Preset 目錄。所有 Preset 都支援 **T1 / T2 / T3**；Preset 只決定出生時的起始 Loadout，實際戰鬥行為則由角色當下持有的武器、盾牌、騎乘狀態與 CombatBalance 規則共同決定。

**Viking 兵種**

| 兵種 | 戰場定位 |
| --- | --- |
| Viking Veteran 維京資深戰士 | 持同階 Sword + Viking 圓盾的攻守均衡步兵 |
| Spearman 槍兵 | 徒步 Lance 反騎兵，並攜帶同階 Sword 作為備用近戰武器 |
| Archer 弓兵 | 徒步 Bow 單位，固定使用 T1 匕首作為近戰備援 |
| Sword Cavalry 刀騎兵 | 騎乘 Sword + Viking 圓盾 |
| Lancer 槍騎兵 | 以高速 Lance Charge 為核心的騎兵 |
| Mounted Archer 弓騎兵 | 騎乘 Bow 單位，固定使用 T1 匕首作為近戰備援 |

**Roman 兵種**

| 兵種 | 戰場定位 |
| --- | --- |
| Heavy Infantry 重裝步兵 | Gladius + Scutum 的防禦型正面步兵 |
| Spearman 槍兵 | 徒步 Lance 反騎兵單位 |
| Archer 弓兵 | 徒步 Bow 單位，固定使用 T1 Gladius 作為近戰備援 |
| Javelin Infantry 標槍兵 | Pilum / Javelin 遠程單位，固定使用 T1 Gladius 作為近戰備援 |
| Sword Cavalry 刀騎兵 | 騎乘 Gladius + Scutum |
| Lancer 槍騎兵 | 騎乘 Lance Charge 單位 |
| Mounted Archer 弓騎兵 | 騎乘 Bow 單位，固定使用 T1 Gladius 作為近戰備援 |

Setup UI 內建 **10 vs 10**、**25 vs 25**、**50 vs 50**、**100 vs 100**、**200 vs 200** 快速配置，也可以完全手動建立自己的軍隊組合。

戰鬥部署模式與兵力 Preset 分開設定：

- **Formation Battle 列陣戰** — Viking 與 Roman 以確定性的陣形出生在戰場兩側。
- **Scattered Battle 散兵大亂戰** — Player、Viking NPC 與 Roman NPC 會以確定性的散布方式分散在整個戰場，但 Viking vs Roman 的敵我關係、友軍傷害規則與勝負條件完全不變。

Player Faction 與兵力、部署模式分開設定：

- **Viking Player** — Viking NPC 為友軍、Roman NPC 為敵軍；Formation Battle 從 Viking 的 +Z 側出生並面向 Roman 軍隊。
- **Roman Player** — Roman NPC 為友軍、Viking NPC 為敵軍；Formation Battle 從 Roman 的 -Z 側出生並面向 Viking 軍隊。

切換 10 vs 10～200 vs 200 等兵力 Preset 只會修改軍隊配置，並保留目前選擇的 **Battle Mode、Player Faction、Player Loadout 與 Spectator** 設定。

Player 是額外加入所選陣營的可操作角色，**不計入該陣營配置的 1–200 名 AI 兵力，也不影響軍隊存活數判定**。Army Setup 可另外設定 **1–9999 HP** 的 Player HP；Player 與 NPC 的預設 HP 都是 **200**。

### 戰鬥流程

1. 開啟遊戲後，在 **軍隊配置 ARMY SETUP** 設定 Viking / Roman 軍隊、Player Faction，以及 **Formation Battle** 或 **Scattered Battle**。
2. 切到 **玩家裝備 PLAYER LOADOUT**，選擇近戰武器、遠程武器、盾牌（或無盾），以及 **騎馬 MOUNTED** / **徒步 ON FOOT**。
3. 若只想看 AI 對戰，可開啟 **Spectator 觀戰模式**；進入戰鬥後會直接使用自由觀戰鏡頭，不生成 Player 與開場戰馬。
4. 點擊 **開始戰鬥 START BATTLE**。
5. 所有 actor 會依模式出生：Formation Battle 讓兩軍在戰場兩側列陣；Scattered Battle 則讓 Player 與雙方 NPC 以確定性位置交錯散布在戰場各處。之後雙方 AI 會自動索敵接戰。
6. 玩家加入所選陣營一方，可使用 Viking / Roman 的劍、Gladius、長槍、弓、Pilum、盾牌與戰馬參與戰鬥。
7. 任一方配置的 AI 軍隊全滅後，戰鬥結束。
8. 使用 **REMATCH** 以相同設定重開，或選擇 **BACK TO SETUP** 返回首頁重新配置。

如果雙方 AI 軍隊在同一時間全滅，結果會判定為 **DRAW 平局**。

## 🧰 Player 裝備與出戰方式

Custom Battle 現在有獨立的 **玩家裝備 PLAYER LOADOUT** 頁面。開始戰鬥前，可以直接選擇一把近戰武器、一把遠程武器、盾牌（或不帶盾），以及要 **騎馬 MOUNTED** 還是 **徒步 ON FOOT** 開場。

Player 裝備與 Player Faction 完全分開，因此 Viking / Roman 裝備可以自由混搭：

- **近戰武器** — Viking 長劍、Roman Gladius，或 T1 / T2 / T3 Lance 長槍。
- **遠程武器** — Viking 弓，或 Roman Pilum 標槍。
- **盾牌** — Viking 圓盾、Roman Scutum，或選擇無盾。
- **出戰方式** — 選擇 **騎馬** 時會建立並騎上既有開場戰馬；選擇 **徒步** 時不會生成這匹特殊開場戰馬。

有明確設定 Player Loadout 時，Player 起始背包只會包含所選裝備，不會另外塞入沒有選到的頂級裝備。切換兵力 Preset 或 Reset 也會保留目前的 Player Loadout。

弓與 Pilum 的操作方式不同：弓沿用既有的拉弓 / 放箭流程；Pilum 則是按住右鍵瞄準，再用左鍵觸發投擲。進入遠程瞄準時，若有裝備盾牌，仍沿用既有邏輯自動卸下盾牌。

為了向後相容，沒有 `playerLoadout` 的舊 BattleConfig 仍維持原本預設：**Steel Lance、Elven Runebow、Round Shield T3，並騎馬開場**。若啟用初始 **Spectator 觀戰模式**，則會忽略騎乘設定，不生成 Player 的開場戰馬。

Player 的開場戰馬與雙方營地內提供的備用戰馬分開計算。**Player 在單場戰鬥中死亡後不會復活**，而是直接切換為自由觀戰模式；剩餘 Viking 與 Roman NPC 會繼續交戰直到分出勝負。使用 **REMATCH** 才會以相同設定重新開始一場新的戰鬥。存檔 / 讀檔仍會保留騎乘狀態與坐騎實際世界座標，而讀入的存檔背包會覆蓋新戰鬥的起始 Loadout。

## ⚖️ 戰鬥規則與 Balance

戰鬥行為依角色的 **當下裝備與騎乘狀態** 動態決定，而不是永久綁死在某個 runtime 兵種 class。

| 規則 | 目前行為 |
| --- | --- |
| 預設 HP | Player 200 / NPC 200 |
| Lance Tier | T1 30 / T2 45 / T3 60 基礎傷害，攻擊距離 3.9m |
| 徒步 Lance 反騎 | 徒步持 Lance 攻擊「**當下仍在騎乘**」的目標時傷害 ×2；目標落馬後不再有反騎加成 |
| 騎乘 Lance Charge | 騎乘持 Lance 且速度 > 10 m/s 時，命中傷害 ×3 |
| Charge + Horse Impact | Lance Charge 確實命中時，同一幀不再額外疊加 Horse Impact；若 Lance 揮空，馬匹碰撞仍可正常造成 Impact |
| Horse Impact | 所有受控坐騎速度 > 4 m/s 時都可撞擊敵對目標；傷害為 `round(8 + speed × 1.5 × sprintMultiplier)`，Sprint multiplier 為 ×1.5，同一目標冷卻 0.6 秒 |
| Berserker 條件 | Viking + 徒步 + 當下 active combat state 為 Sword + 無盾：移速 ×1.3、近戰傷害 ×1.2、近戰攻擊頻率 ×1.2 |
| Bow | 傷害 ×0.5、攻擊頻率 ×1.3；NPC 徒步接戰距離 50m / 騎乘 15m |
| Javelin | 傷害 ×1.5、攻擊頻率 ×0.7；NPC 徒步接戰距離 30m / 騎乘 15m |
| 盾牌 | T1 10% / T2 15% / T3 20% 減傷；角色騎馬時會先套用盾牌減傷，再把傷害導向戰馬 |

騎乘單位受到戰鬥傷害時，會先由戰馬承受傷害；戰馬死亡後 Rider 下馬，之後所有反騎判定都會依新的徒步狀態重新計算。

### Combat 資料架構

戰鬥數值刻意拆成明確的 Authoritative Single Source of Truth，避免再次把 magic numbers 散落在 Player / NPC / UI：

- `src/rpg/WeaponDatabase.ts` — 武器基礎屬性與 `combatKind`。
- `src/combat/CombatBalance.ts` — HP 預設值、倍率、射程、冷卻、Lance、Berserker 與 Mount Impact 規則。
- `src/battle/UnitPresetCatalog.ts` — 各陣營兵種 Preset 與 T1 / T2 / T3 起始 Loadout。
- `src/combat/DamageRouter.ts` — 共用盾牌減傷、Rider / Mount 傷害導向、死亡與下馬流程。
- `src/combat/MountImpact.ts` — Player 與 NPC 騎兵共用的 swept-path 馬匹撞擊判定與傷害流程。

核心 runtime 模型為：

```text
Unit + Faction + Current Equipment + Current Mount State + CombatBalance
= Current Combat Behavior
```

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
| Viking：`1`–`6` + `` ` `` / Roman：`1`–`7` + `` ` `` | 選擇友軍兵種；`` ` `` 選擇全軍並開啟 Army Command 命令選單 |
| Army Command `1` / `2` / `3` / `4` | 攻擊 / 衝鋒 / 防禦 / 列陣 |
| Army Command `` ` `` | 回到上一層命令選單；在兵種頁同一顆鍵用來選擇全軍 |
| 列陣模式：`E` / 滑鼠左鍵 / 滑鼠中鍵 | 確認中央準星指定的列陣位置 |
| 列陣模式：`` ` `` | 回到命令選單 |
| `Esc` | 關閉 UI / 解除滑鼠鎖定 |

## 📯 Army Command 軍隊命令

Army Command 同時支援鍵盤快捷鍵與滑鼠滾輪操作。HUD 只顯示**實際有進場的友軍兵種**與全軍；第一個進場兵種預設凸起，從第一個兵種往上滾即可選到**全軍 ALL**，再用滾輪上下移動其他可見兵種，中鍵進入目前凸起目標的命令。進入命令後預設凸起 **攻擊 Attack**，滾輪可在攻擊 / 衝鋒 / 防禦 / 列陣之間移動，中鍵確認。列陣位置可使用 `E`、滑鼠左鍵或滑鼠中鍵確認。

先按兵種快捷鍵選擇指揮目標，再從命令選單下達命令。

### 兵種快捷鍵

| Viking | 兵種 | Roman | 兵種 |
| --- | --- | --- | --- |
| `1` | 維京資深戰士 | `1` | 重裝步兵 |
| `2` | 槍兵 | `2` | 槍兵 |
| `3` | 弓兵 | `3` | 弓兵 |
| `4` | 刀騎兵 | `4` | 標槍兵 |
| `5` | 槍騎兵 | `5` | 刀騎兵 |
| `6` | 弓騎兵 | `6` | 槍騎兵 |
| — | — | `7` | 弓騎兵 |
| `` ` `` | 全軍 ALL | `` ` `` | 全軍 ALL |

同一個兵種 Preset 的 T1 / T2 / T3 會一起接受命令。

### 命令

| 按鍵 | 命令 | 戰場行為 |
| --- | --- | --- |
| `1` | **攻擊 Attack** | 使用角色**當下裝備狀態**執行一般積極接戰，主動追擊並攻擊敵人。 |
| `2` | **衝鋒 Charge** | 主動追擊，體力允許時會 Sprint。Charge 本身不額外提供獨立傷害倍率。 |
| `3` | **防禦 Defend** | 原地防守。敵人已進入當前武器有效射程時可以轉向並攻擊，但不主動追擊；騎射手也不會繞圈。 |
| `4` | **列陣 Formation** | 使用畫面中央準星指定目的地，友軍移動到確定性的陣位；目前仍屬於該列陣命令的單位全部到位後，會自動切換為 **Defend**。 |
| `` ` `` | **上一頁 Back** | 回到上一層命令選單，不下達新命令；在兵種頁同一顆鍵選擇全軍 ALL。 |

### 列陣操作

選擇 **Formation 列陣** 後：

1. 滑鼠仍然控制第三人稱鏡頭，使用畫面中央準星指向想要列陣的地面位置。
2. 遊戲會即時顯示陣形 Preview。
3. 按 `E`、滑鼠左鍵或滑鼠中鍵確認。
4. 按 `` ` `` 回到命令選單。列陣模式刻意不使用 `Esc`，避免解除 pointer lock。
5. 若陣位會落在障礙物等無效位置，該位置不能確認。

單一兵種列陣時，每排最多 **10 人**；選擇 **全軍 ALL** 時，每排最多 **50 人**。最後一排會置中，整個陣形會以確認當下的相機水平朝向作為面向。

### Viking 衝鋒裝備狀態

Viking 徒步的 **維京資深戰士、槍兵、弓兵** 在 Charge 時還會切換目前戰鬥裝備：

- **Charge**：改為 Sword-kind 近戰並收起盾牌。
- **Charge → Attack**：Attack 不會自動恢復原本兵種裝備，會保留目前的無盾近戰狀態。
- **Defend**：恢復兵種專職裝備；資深戰士重新持盾、槍兵恢復 Lance、弓兵恢復 Bow。
- **Formation**：列陣完成後會自動進入 Defend，因此也會在到位後恢復上述專職裝備。

Roman 單位與 Viking 騎兵不會套用這組徒步裝備切換規則。

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
| `?devcombat=d` | 100 vs 100 騎兵 / 騎射手壓力場景 |
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
http://localhost:5173/?devmodels=humans&nolock
http://localhost:5173/?devmodels=mounts&nolock
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

## 🗺️ Roadmap

- **T4 Elite 精英兵種 — 尚未實作。** 未來可加入具有陣營特色的 T4 Elite，例如持盾的 Viking **Varangian Captain 瓦良格隊長**，以及 Roman **Centurion 百夫長**。T4 的目標是增加新的精英戰場定位，而不是單純把 T3 數值往上堆。
- 持續改善 200 vs 200 大型戰鬥的 AI 接戰、騎兵互動、角色動畫與 render-path performance。

## 🚧 專案狀態

SagaBurst 目前仍是一個持續開發中的 3D 動作 RPG 原型，核心方向包含大規模 AI 戰鬥、近戰與遠程戰鬥、騎乘系統、裝備成長，以及瀏覽器中的 3D 角色與動畫系統。

目前已支援從 **1 vs 1 到最高 200 vs 200 AI** 的 Custom Battle，包含步兵、遠程單位、騎兵與騎射手，並提供三個裝備 Tier。

目前開發重點會持續放在戰鬥行為、角色動畫、大型戰鬥 render performance，以及 Custom Battle 體驗。
