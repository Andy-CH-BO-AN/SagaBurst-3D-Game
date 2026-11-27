# 角色資產與動畫

範圍：人物資產 registry、普通士兵／英雄職業、LOD、戰鬥動畫事件與裝備姿勢。索引與共通規則見 [ARCHITECTURE.md](../ARCHITECTURE.md)。

LOD 門檻與普通士兵 HP 以程式常數為準（`src/world/HumanoidAssetRegistry.ts` 的 `HUMANOID_LOD_DISTANCES`、`src/combat/OrdinarySoldierProfile.ts`）；本檔只記擁有者、不變條件與禁止事項。

## 人物資產

- 軍用 `viking-hero-t4`／`viking`／`roman` 以交付來源的骨架與動畫接入，靠明確 `selectedSource` 契約；**不冒用 T5 來源骨架**。三個 LOD 沿用 `SelectedLodPose`。
- 同角色、相同 joints 與 inverse bind 的 mesh 共用 Skeleton；**不同角色不共用可變骨骼**。geometry、material、texture 與 clip 為共用模板，每個角色持有獨立 skeleton、mixer、socket 與動作狀態；`CharacterVisuals` 提供共用 `CharacterRig` 契約。
- 居民與商人由 `CharacterVisualConfig.civilian` 與 `civilianStyle ?? faction` 選擇 `roman-civilian`／`viking-civilian` 的獨立來源模型。Town 由實際 roster 推出所需平民 faction，於建立居民前 await；一般 preload 不載平民。
- Fitted civilian 與 Shadow 的 LOD 以 `sharedLodPose` 驗證同一 bind 後共用單角色 pose，**各 LOD 內嵌完整動作**；明確 `bufferCompression: EXT_meshopt_compression` 的資產由既有 Three 隨附 MeshoptDecoder 載入。
- `HumanoidAssetRegistry` 在產生角色前載入 manifest 與 GLB；**正式模式不以程序人物靜默替代失敗資產**。`HeroAssetCatalog` 集中 T4／T5 描述，`SETUP_PLAYER_HERO_IDS` 限制自由模式選角。`HeroCombatProfile` 共用 Player 與 NPC 的英雄數值，NPC **不套玩家技能**。
- 選定 T5 的三個 LOD 驗證相同骨架 bind 與動畫樣本後共用單一骨架與 mixer；來源 raw clips 保留。
- 實例銷毀與 render warmup 結束時只釋放各自的 skeleton bone texture，**保留共享 geometry、material 與 texture**。

## 身分與職業

- `CharacterIdentity` 集中解析正式 `characterTier`、`heroArchetype`、文化陣營與模型／Profile。既有 `tier` 只作舊 roster 轉接；**明確衝突即拒絕**。
- `OrdinarySoldierProfile` 的基礎 HP 依陣營與 Tier 定義；Player 保留一次既有技能加成。Career 的 Recruit／Soldier／Veteran 決定 T1–T3；Captain／Commander 仍是原英雄。武器、護甲與臨時借裝**不改正式身分**。平民與特殊角色不進普通表。
- Roman／Viking T1、T2 使用 `roman-t1`、`roman-t2`、`viking-t1`、`viking-t2` 獨立資產；T3 保留 faction template。重建與來源見 `tools/tiered-faction-soldiers.md`。手指只從原手部權重重新分配，**禁止把衣物權重轉到手指**。
- `CareerProfile.eliteClass` 是獨立於軍階的進階職業（陣營預設為 `eliteClass: null`）。拜占庭只接受 Roman Captain／Commander 的本次服役軍功門檻，**不扣除餘額**；`CareerElitePromotion` 擁有資格與 staged profile，Town 先預載並建立候選角色再保存，失敗保留原角色。`byzantine-cataphract-t5` 目前沿用真實 Roman T5 資產。
- T4／T5 職業為兩條同規則的 `CareerClassRoad`（`classRoadOffer`／`applyClassRoad`；`T4_CLASS_ROAD`、`T5_CLASS_ROAD` 只擁有各陣營職業清單、門檻與存檔欄位）。T4 存 `t4Specialization`／`unlockedT4Classes`，T5 存 `eliteClass`／`unlockedCareerClasses`。第二職業以可用軍功永久解鎖、免費切換；通用 `canAppointCareerRank` 不處理 Veteran→Captain 與 Captain→Commander。
- 任命 writer 必須保存明確職業與永久解鎖紀錄；跨陣營、跨道路、重複或門檻不足的紀錄**被拒**。職業到英雄資產由 `CareerPlayerProfile` 的 `T4_CLASS_HERO`／`CAREER_CLASS_HERO` 對應；重甲職業僅 Career 玩家或明示的 identity 使用，NPC 預設 T4／T5 不變。升 T5 後外觀與數值**完全依 T5**，T4 紀錄只保留為存檔資料。重甲維京（`dragon-oathguard`、`ironblood-warlord`）移速倍率為 1.0，步行與騎乘相同。
- 所有 `*_heavy_cavalry` 的 T4／T5 在各模式固定使用重甲職業（`T4_UNIT_PROFILES`、`getT5ProfileForPreset`）；盾牌依陣營決定。`heavyT4Variant` 供特定 Captain／Commander 隊長取得重甲 T4，Ranger 保留遊俠身體。
- `CareerHeroClasses` 是兩陣營 Captain／Commander 各職業與中文名稱的唯一來源。HR 私兵以 `PersonalHeroVariantAssetId`（`roman-centurion-t4`／`viking-heavy-hero-t4`／`byzantine-cataphract-t5`／`viking-heavy-hero-t5`）明確保存重甲身分，**身分不由裝備推斷**。
- 1v1 Duel 的 T4／T5 在兵種與 Tier 後多一步職業選擇（`CareerDuelClasses`），存為 `activeMission.duelClassId`；缺值或不合法時沿用居民原職業。非原職業由 `CareerDuelController` 以場景 factory 生成暫時對手，原居民隱藏停放且**不被修改**，結算或 cleanup 時銷毀暫時身體。
- Town 士官長 `deployment` 是 T5 重騎兵指揮官（`characterTier: 5`，roster 仍為 T4 紀錄）；士官長武器與盾牌僅在持有預設 token 時以 T5 class kit 覆蓋；坐騎使用現行 native token，**載入時不補發**。

## 戰鬥動畫與事件

- `CharacterCombatAnimator` 擁有一次性攻擊與釋放事件；Player 與 NPC 在事件到達時造成傷害或產生投射物。完成或取消後回到最新 locomotion；換裝取消未完成動作，**不補發事件**。
- 徒步單手斧與戰槌由實際裝備的 `animationKind` 選擇共用 `axeAttack1HFoot`，**不以斧頭 mesh 判斷**；騎乘與雙手仍走原 action。Roman hero 在預載時由 `BanditFootAttack` 從同一 Bandit 來源產生共用模板。
- 三套新模型的完整長斧來源動作透過 manifest 的 `meleeCycleSeconds` 與 events 轉換到 gameplay clock，**不截短來源片段**。
- Roman 動態雙手斧 socket 與來源校準的斧頭握點在 mixer 後同步到正式武器 pivot，物理握點與刀尖使用相同 transform。受擊 overlay 不取消攻擊事件或修改傷害。
- NPC 非戰鬥時使用一般 locomotion，**不自動套用持弓準備姿勢**；失去瞄準時解除搭箭與蓄力。
- `CharacterEquipmentPose` 在 mixer 後套姿勢，下一次求值前還原；`bakedEquipmentActions` 標示已烘焙握點的動作，**資產與 runtime 不能同時擁有同一關節修正**。
- 拳擊為獨立 `punchCombo`／`punchRight` action，由 Animator 單一時鐘發出接觸事件。`UnarmedCombat` 以實際掌部軌跡追蹤目標，接既有傷害歸屬與獨立技能 `unarmed`，**且不呼叫結構破壞**。徒手 XP 只由權威傷害事件發放；讀檔**不轉換 `archery`**，也不補齊歷史技能。有效拳頭傷害以 `attackSource: unarmed`／`weaponId: unarmed` 識別，`SoundManager.playPunchHit` 缺檔時安靜略過。
- `InventoryManager.activeMelee` 只回傳實際取出的近戰武器，**空裝備不 fallback 長槍**。
- `HUMANOID_LOD_DISTANCES` 是人物 LOD 門檻的唯一來源。LOD0 是裝備 socket authority；切換、fade、seek 必須補齊姿勢與時間，**不能重播 gameplay 事件**。
- 陰影 pass 中，LOD1 NPC 人物改以同一人物的 LOD2 網格投影（畫面仍畫 LOD1）：`Lod1ShadowProxy` 只在 LOD1／LOD2 蒙皮網格**共用同一 Skeleton、bind matrix 與 bind mode**（姿勢必然相同）且兩層不含剛性或多材質網格時採用，否則維持 LOD1 投影；LOD0 不變、LOD2 不投影。由 `ShadowCasterCulling` 在 `shadowMap.render` 期間暫時切換並於結束（含例外）還原；`Game` 與 `TownScene`（含四門）的 NPC 都傳入 `characterVisualGroup` 加入此政策；坐騎不適用。
- 距離節流只減少視覺求值；AI、移動、攻擊事件與 gameplay timer 每幀推進。

## 存檔與互動

- 一般 RPG 存檔使用 `sagaburst_game_v2`（version 2），保存 HP、最大 HP、正式身分、自訂 HP 來源、背包、技能、坐騎位置與飛行／未決墜落。只按保存的現行最大 HP 還原資源，**不換算歷史 Career HP、不由舊武器清單補背包、不由騎士座標補坐騎**。
- 自訂戰鬥與防衛戰役分別使用 `sagaburst_battle_config_v2`／`sagaburst_campaign_config_v2`，只存正式 preset IDs 與明確 HP 來源。獨立防衛關卡進度保留 `sagaburst_defense_campaign_progress_v1` 原 key 與格式。**不雙讀、刪除、覆寫或遷移舊 key**。
- `InteractionFocus` 與 `PickupPrompt` 讓 Game 與越獄共用地面互動選擇；E 只作用於先前顯示且仍在距離內的同一目標；`PlayerInput` 只接受實體按下邊緣。只有正式自訂戰鬥可在配置槽為空時自動裝備，其他 Game 模式收入背包。越獄拾劍**先保存再裝備**；開門、倒下、倒數或保存重試期間不提供拾劍提示。
