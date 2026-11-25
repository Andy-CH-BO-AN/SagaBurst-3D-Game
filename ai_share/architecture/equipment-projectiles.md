# 訓練場、裝備與投射物

範圍：Training Ground、武器 mesh／握持契約、弓與投射物命中、裝備 LOD 與骨架效能節流。索引與共通規則見 [ARCHITECTURE.md](../ARCHITECTURE.md)。

- Training Ground 由主選單或 `?training=1` 直接進入，舊 `freeride` 網址轉入相同模式；不讀取生涯角色／裝備、不建立軍隊、任務或 TownWorld。一般角色與 Ranger 皆可用正式目錄的一般近戰、遠程及盾牌；角色切換沿用正式資產與普通裝備互斥規則。
- `TrainingDummy` 實作 `DamageReceiver`，共用 `WeaponSweep`／`traceCombatSegment`、`ArrowProjectile`、`MountImpact` 及 `DamageRouter`，以 `training` 目標事件保留實際傷害、沒有 HP／死亡或 AI tick。`Game` 額外禁止整個訓練模式的技能 XP（包含停放坐騎與格擋）及 RPG 存讀檔。
- 11 個靶位距離從同一個 0m 假人中心計算水平公尺；玩家出生在旁邊，射擊黃圈放在中心前方 1.5m，以免 0m 靶擋住其他射線。靶場沿用既有地形，125m 跑道與坐騎停放區相互分開；xongkoro 保留正式爪擊與飛行，地面衝撞仍依正式規則排除飛行坐騎。
- 訓練重置保留原有假人／坐騎 identity，安全解除飛行騎乘及墜落狀態、重設坐騎、恢復正式共用箭／標槍彈藥池與盾牌耐久、清除投射物及命中資訊。退出取消事件訂閱、DOM listeners、輸入與場景資源，再載入明確主選單入口，不改 Career 或 Battle session data。

- `WeaponMeshFactory` 共用於 Player、NPC、掉落物與工作室；[EQUIPMENT_TIERS.md](../EQUIPMENT_TIERS.md) 維護外觀範圍。合併剛性零件須保留材質／render flags、幾何、grip/tip metadata 與動態零件。
- `SwordAttachmentContract`／`EquipmentAttachmentContract` 管理握點；固定裝備 attachment 不由 animator idle／cancel 覆寫。調整武器方向繞掌心握點進行，不以扭腕掩蓋資產軸向錯誤。
- Player 沿原有手動裝備規則；NPC 的永久 `shieldId` 與 `hasActiveShield` 分開。遠程及釋放收招期間隱藏盾牌、停用盾牌碰撞／減傷與防禦姿勢；近戰在左手恢復同一面盾，不重建耐久。一般 T1–T3 劍走單手劍動作。
- Lance idle 沿用 Sword Idle 人體／手形，加固定 attachment；攻擊才加右臂 FK 前伸。不在無關工作恢復舊 Ready pose、左手支撐或 lance IK。
- Shadow Warden 以 `maki-archer-t4` 持久化資產 ID 取代舊 Maki；Ranger 保留原 Hero Combat Profile，近戰沿用實際 Sword／Axe／Lance／Mace 的 attachment、動作及 WeaponSweep，不用弓的 grip／tip 或專屬近戰 hitbox。
- `CharacterBowVisual` 共用弓、弦、nock、搭箭及發射座標；Roman pilum 另有外觀。`ThirdPersonCamera` 以 FOV 與安全前向位移混合至瞄準視角；T5 Roman／Viking 騎巨鷹時使用 22° FOV 與 1.5m 前向淨空，沿用相機碰撞限制；Player 從 nock 向準星 world ray 命中點發射。
- T5 selected-source 騎乘弓姿由 `CharacterEquipmentPose` 將就座移除的來源骨盆 world rotation 等分轉移到 torso chain，保留肩手與固定弓握點的朝向；`MixerController` 依實際 bow clip 權重維持淡出到 idle 期間的補償。巨鷹衝刺仍保留下胸俯身，但瞄準時維持上胸 world orientation。站立、T4、actor／mount heading、來源 clips 與 projectile direction 不由此 adapter 改寫。
- T4 Ranger 的正式預設 loadout 經 `resolveT4UnitLoadout` 使用 `maki-ranger-bow-ranged`；缺少正常近戰的預設配置由陣營提供 `viking_axe_t3`／`centurion_blade`，不覆寫合法既有裝備。所有 NPC 只要實際持有遠程與近戰武器便使用原 NPC 狀態機雙向切換，舊 `reversibleRangedSwitch` metadata 仍可讀取但不再是資格限制；暫時任務裝備結束時恢復永久 loadout。遠程傷害／箭速由 WeaponDatabase 實際裝備決定；角色 tier 不會自動升級明確指定的低階弓。
- `EagleRangedCombat` 只覆寫 NPC + xongkoro + bow 的 3D 開火距離，依當前武器 tier 為 200／300／400／500m，不再疊加 Ranger 射程倍率。`ProjectileBallistics` 有界求解真實重力與移動目標攔截，發射前重驗彈道遮擋；發射後投射物不追蹤。NPC 驗證過的空軍射擊及 Player 自由瞄準空軍弓各自產生有界 flight budget，Game／Town 都傳入 ArrowProjectile。Town 非空軍保留五秒政策；共用箭矢使用 scene 方形世界界線與獨立 age／travel cap，不再依世界原點 400m 球體裁切。
- `ProjectileContactQuery` 統一 Game／Town 的單段 first-contact 幾何、broad phase 與同距順序；場景提供有序目標及當下敵意／任務保護資格，再依結果執行原傷害歸因。Battle 保留 0.12m 出弦世界碰撞清距，Town 保留攻城 mesh 的 1mm 接觸優先容差及靶球超出箭段末端 1cm 的原判定；Town obstacle 候選逐箭讀取當下 bounds，傷害造成的摧毀／恢復立即影響下一箭。actor broad phase 以箭段為軸的膠囊判定（目標原點距整段 ≤4m，坐騎再加 `combatRadius`），可命中部位（身體、肢體、盾、座騎）都在此範圍內；`ArrowProjectile` 以 `{ groups }` 原地依序走訪 Player→NPC→Mount→Receiver，不逐箭建立 generator。飛行壽命、Town 五秒上限、battle 插地衰退與場景傷害效果仍由原 owner 管理。
- 箭模型沿 local `-Z`，投射物朝向須顯式對齊速度。飛行箭／pilum 共用不可變 render resources，移除實例不能銷毀模板或每發遺留資源。
- `HighTierEquipment` 預載唯一共用 T4 槍與 T5 弓 GLB；槍共享 render resources，弓以 SkeletonUtils 複製每位持有者的骨架／mixer。來源拉弓 take 的前半段映射至既有 normalized charge，`CharacterBowVisual` 保留弦、搭箭與發射座標 ownership，換裝／銷毀只釋放實例骨架。`NPC` 依實際雙武器 loadout 使用現有 target／nearby 結果、6m／9m 遲滯及原 CHASE／ATTACK 狀態，不擴充搜尋頻率；模式切換保留箭矢與永久裝備。城牆沿原 threat boundary，巨鷹另尊重飛行 pilot 的近戰窗口及可接觸高度，開火仍由原彈道驗證授權。
- `EquipmentVisualLODController` 跟隨人物 Three.LOD 的當幀 level，不另算距離。只切已標记的靜態細節，保留 socket、弓弦與搭箭的動態 ownership。
- NPC 持有裝備在 LOD2 關閉 castShadow，LOD0/1 還原第一次登記的原值；重建盾牌立即沿用目前 level。Player、飛行物、掉落物、人物與坐騎不屬於此 policy。
- `WeaponMeshFactory` 的公開 builder 與 `CharacterBowVisual` 完成後由 `EquipmentGeometryRegistry` 把剛性 mesh 指向內容逐位元相同的共用 geometry（skinned、morph、interleaved 與非 static attribute 除外）。共用 geometry 不可修改，也不可當作實例資源 dispose；自行銷毀零件的 owner 先檢查 `isSharedEquipmentGeometry`。
- 遠景 LOD2 只保留輪廓：瓦良格隊長（`viking-hero-t4`）的 LOD2 在 SHA-256 稽核相符時，於共用 LOD0 骨架後合併兩組同材質 skinned mesh（鎖甲＋外衣、左右手掌；任一組驗證失敗就保留原樣），並隱藏三個少於 100 面的填補零件；戰馬 LOD2 隱藏韁繩、半透明鬃尾與馬鞍；NPC 弓弦與搭箭的箭頭／箭羽標為 LOD≤1 的裝備細節，由 `EquipmentVisualLODController` 在 LOD2 隱藏（箭桿保留）。`CharacterBowVisual` 的程序弓弦與搭箭材質為全實例共用常數，不可逐實例修改或 dispose。
- 人物與戰馬的共享 GLB 模板在第一次 clone 前由 `primeSkinnedTemplateBounds` 以完整蒙皮算一次 `SkinnedMesh.boundingSphere`（rest pose，半徑 ×1.2），實例與 Roman LOD2 合併 mesh 沿用；clone 與 `configureMultiInfluenceSkinning` 不再逐實例 CPU 蒙皮重算。四足坐騎與巨鷹仍用各自的固定 bounds。
- 人物取樣節奏由 `CharacterLODPolicy.humanoidPoseInterval` 決定：≤28m 每幀、>28m 12Hz、>55m 6Hz；近戰動作傳入距離 0，永不降頻。explicit `seek`（拉弓 `bowLoad`、`pilumThrow`）共用同一節奏：同一 state 仍綁定時沿用上次全 level 取樣；蓄力／投擲進度仍由 gameplay 計時。
- 人物、戰馬與四足坐騎實例的 `THREE.Bone` 由 `stopBoneEulerSync` 停止 quaternion→Euler 同步：骨骼只能讀寫 `.quaternion`；整組寫入 `.rotation.set(x, y, z)`（`setRigRotation`）仍會更新 quaternion，但不可單軸寫入或讀取骨骼 `.rotation`。
- 同一批實例建立點再由 `hideBoneOnlySubtrees` 把「整棵只含 Bone」的子樹設為 `visible = false`：Three 的 main 投影與 shadow pass 在不可見節點停止下探，而世界矩陣、`Skeleton.update` 蒙皮與 world 查詢不看 visible，因此姿勢與畫面不變、只省下每幀走訪數萬根骨骼。契約：不可直接把可繪製物件掛在 Bone 下；裝備一律經非 Bone 的 socket，socket 會讓其所有 Bone 祖先保持可見。
- NPC 實際持有遠程武器（`hasActiveRangedWeapon`）時由拉弓姿勢擁有雙臂，不再每幀套用持槍預備姿勢；否則持槍 Ranger 會每幀取消 `bowAim` 並重新淡入 `bowLoad`。切回近戰由 `_cancelEquipmentCombatState` 結束 `bowAim`。
