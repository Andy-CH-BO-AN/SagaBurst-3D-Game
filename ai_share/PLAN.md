# SagaBurst — 待辦方向

目前功能與限制見 [PROGRESS.md](PROGRESS.md)，模組契約見 [ARCHITECTURE.md](ARCHITECTURE.md)。已完成階段與舊設計查 Git／PR；不再維護 Phase 0–23 的完成清單。

## 尚未完成

- **大型戰鬥效能**：重新建立目前版本的量測基準，再歸因 humanoid renderables／材質結構與 transmission prepass 成本。保留玩法與必要視覺品質；未量測前不承諾 FPS 收益。
- **人物 LOD 品質**：處理 Viking Bow LOD1/2 握點落差、Maki 低 LOD 衣物破面／交穿，以及 Roman 騎乘服裝接合。各問題分開驗收，避免混入效能修正。
- **生涯軍階指揮能力**：Captain／Commander 的角色外觀與晉升已有實作；新增指揮權限仍待玩法範圍確認。
- **城鎮遭遇後整補**：接完整 Town Patrol／roaming squad 的 `ENGAGING → RETURN_TO_BARRACKS → REFIT → PATROLLING`，一併處理 leader casualty、runtime deputy、失馬、無主馬與補馬生命週期。既有任務結算後的 Patrol 回營整補繼續沿用。
- **任務隊伍遇敵行軍**：自然互傷已接入；後續補 mission party 整隊暫停原 route、主動處理遭遇，再恢復行軍。
- **Duel 場地與遭遇互動**：將 Duel 場地移至步兵／騎兵訓練場之間，再整理 Duel 與 roaming 的互動規則。
- **Town Siege**：四門攻城部署、協同攻門與 breach flow 尚待獨立接入；目前沿用開放城門通行與既有通用障礙物攻擊。

## 選題原則

以上是待處理方向，不代表已排期或授權全面重構。任務確定後才補目標、限制與驗收條件；完成後移除待辦，必要的交接結論放入 PROGRESS。
