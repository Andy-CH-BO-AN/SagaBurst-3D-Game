# SagaBurst — 架構與契約

本檔是索引：只維護程式入口表與分檔清單。跨模組職責與不易從單一檔案看出的契約寫在 [`architecture/`](architecture/) 的對應分檔；**依任務只讀相關分檔，不必全部載入**。數值、模型清單及操作鍵位以程式／manifest／工作室 UI 為準；驗收流程見 [AGENTS.md](AGENTS.md) 的 skill 索引。

新增或修改契約時寫進最相關的一份分檔，不在本檔展開；跨多區的契約放在擁有決策的模組那一份，其他分檔只留一句連結。

## 程式入口

| 區域 | 入口與職責 |
| --- | --- |
| 啟動 | `src/main.ts`：DEV 路由、有效 session／Career 恢復、主選單與場景啟動 |
| 戰鬥場景 | `src/Game.ts`：資產預載、Player/NPC、主迴圈、碰撞、UI 與場景生命週期 |
| 訓練場 | `src/training/`：共用戰場的靜態假人、場內免費庫存與坐騎配置；`Game` 保留正式移動、攻擊與碰撞 ownership |
| 城鎮場景 | `src/town/CareerTownEntry.ts`、`TownScene.ts`：生涯入口、獨立場景、任務與居民生命週期 |
| 角色 | `src/player/Player.ts`、`PlayerInput.ts`、`src/world/NPC.ts`：玩家輸入與 NPC 行為 |
| 地形／導航 | `src/world/Terrain.ts`、`SpatialGrid.ts`、`src/navigation/`：高度、障礙、鄰近搜尋與路徑 |
| 單挑競技場 | `src/arena/`：羅馬競技場／維京英靈殿的程序化場景、碰撞資料與生命週期；DEV 預覽 `src/debug/DuelArenaPreview.ts` |
| 裝備／成長 | `src/rpg/`、`src/save/SaveManager.ts`：裝備資料、庫存、技能與 RPG 存檔 |
| 戰役／編隊 | `src/campaign/`、`src/battle/`：部署、戰役流程、編隊與指令 |
| 生涯 | `src/career/`：軍功、任命軍階、任務狀態、保存及恢復 |
| 呈現 | `src/ui/`、`src/audio/SoundManager.ts`、`src/debug/`：DOM UI、音效與 DEV 工作室／診斷 |
| 區網合作 | `src/coop/`、`electron/coop-*.cjs`：連線、大廳、任務交接與主機權威鏡像 |

## 分檔索引

| 分檔 | 讀這份的時機 |
| --- | --- |
| [release-and-assets](architecture/release-and-assets.md) | 分支／部署、Vite base、GLB／KTX2 載入、CI 資產驗證 |
| [characters-animation](architecture/characters-animation.md) | 人物資產 registry、普通士兵／T4／T5 職業、人物 LOD、戰鬥動畫事件 |
| [equipment-projectiles](architecture/equipment-projectiles.md) | 訓練場、武器 mesh 與握持、弓與投射物命中、裝備 LOD、骨架節流 |
| [mounts](architecture/mounts.md) | 坐騎行為與資產、馬甲、衝撞、巨鷹、落馬 |
| [formation-damage](architecture/formation-damage.md) | 部署編隊、actor 歸因、DamageRouter、破甲、戰績 |
| [siege](architecture/siege.md) | Standard Defense／四門攻城、移動攻城車、突破口、siege checkpoint |
| [duel-arena](architecture/duel-arena.md) | 單挑競技場場景、競技場軍團試煉、越獄 |
| [career-profile](architecture/career-profile.md) | Career 存檔與提交、教學、劇情事件、軍功、商店、退休、賽馬 |
| [career-command](architecture/career-command.md) | 正式兵權與命令、指揮 HUD、平民指揮、整補、HR 私兵、全城裝備、軍馬 |
| [career-town-world](architecture/career-town-world.md) | TownScene、城鎮建築／佈局／城牆、居民、犯罪、載入 barrier、Town 導航 |
| [career-town-warfare](architecture/career-town-warfare.md) | Town Hostility、城外 roaming、巡邏遭遇、行軍交火、城鎮／敵方空軍 |
| [career-missions](architecture/career-missions.md) | 任務 controller、checkpoint、結算返城、Commander 系列、Duel、Outpost |
| [coop](architecture/coop.md) | 區網合作：連線、任務交接、主機權威鏡像、客機服務與軍功 |
| [performance](architecture/performance.md) | 解讀 Renderer Submit 與 hero benchmark |
