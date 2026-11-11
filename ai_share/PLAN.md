# SagaBurst — 待辦方向

目前功能與限制見 [PROGRESS.md](PROGRESS.md)，模組契約見 [ARCHITECTURE.md](ARCHITECTURE.md)。已完成階段與舊設計查 Git／PR；不再維護 Phase 0–23 的完成清單。

## 尚未完成

- **大型戰鬥效能**：重新建立目前版本的量測基準，再歸因 humanoid renderables／材質結構與 transmission prepass 成本。保留玩法與必要視覺品質；未量測前不承諾 FPS 收益。
- **人物 LOD 品質**：處理 Viking Bow LOD1/2 握點落差、Maki 低 LOD 衣物破面／交穿，以及 Roman 騎乘服裝接合。各問題分開驗收，避免混入效能修正。
- **生涯軍階指揮能力**：Captain／Commander 的角色外觀與晉升已有實作；新增指揮權限仍待玩法範圍確認。
- **任務隊伍遇敵行軍**：自然互傷已接入；後續補 mission party 整隊暫停原 route、主動處理遭遇，再恢復行軍。
- **Duel 競技場後續**：正式 1v1 已改在獨立競技場進行；NPC 在看台上的完整分層導航（目前以階梯路徑點追擊）、裁判動畫與觀眾仍可再補強，依實機遊玩回饋決定。
- **城鎮建築整合**：Roman／Viking 新建築已以 DEV 展示交付外觀審查；核准後再分 PR 接入正式 Town（市政建築與住宅／廣場，之後城門、城牆、瞭望塔與巨鷹設施），保留位置、ID、互動、HP／廢墟、導航與巨鷹空域契約。招募 NPC 進入 HR 室內另案。
- **Commander V 實機驗收**：正式四門守城整合已建立；仍須在 Roman／Viking Home Town 驗證八車推進、Dock／Crew 登城、獨立破門、空軍、存檔／返回及 GPU 效能。

## 選題原則

以上是待處理方向，不代表已排期或授權全面重構。任務確定後才補目標、限制與驗收條件；完成後移除待辦，必要的交接結論放入 PROGRESS。
