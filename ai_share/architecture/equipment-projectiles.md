# 訓練場、裝備與投射物

範圍：Training Ground、武器 mesh／握持契約、弓與投射物命中、裝備 LOD 與骨架效能節流。索引與共通規則見 [ARCHITECTURE.md](../ARCHITECTURE.md)。

射程、靶位距離與彈道容差以程式為準（`src/combat/ProjectileContactQuery.ts`）；本檔只記擁有者、不變條件與禁止事項。

## 訓練場

- Training Ground 由主選單或 `?training=1` 進入，`freeride` 網址轉入相同模式；**不讀取生涯角色、裝備，不建立軍隊、任務或 TownWorld**。
- `TrainingDummy` 實作 `DamageReceiver`，共用 `WeaponSweep`、`traceCombatSegment`、`ArrowProjectile`、`MountImpact` 與 `DamageRouter`；以 `training` 目標事件保留實際傷害，**沒有 HP、死亡或 AI tick**。
- `Game` 禁止整個訓練模式的技能 XP（含停放坐騎與格擋）及 RPG 存讀檔。
- 訓練重置保留假人與坐騎 identity，安全解除飛行騎乘與墜落狀態，恢復共用彈藥池與盾牌耐久，清除投射物與命中資訊。退出時取消事件訂閱與場景資源，**不改 Career 或 Battle session data**。

## 武器與握持

- `WeaponMeshFactory` 共用於 Player、NPC、掉落物與工作室；外觀範圍見 [EQUIPMENT_TIERS.md](../EQUIPMENT_TIERS.md)。合併剛性零件須保留材質與 render flags、幾何、grip／tip metadata 與動態零件。
- `SwordAttachmentContract`／`EquipmentAttachmentContract` 管理握點；固定裝備 attachment **不由 animator idle 或 cancel 覆寫**。調整方向繞掌心握點進行，**不以扭腕掩蓋資產軸向錯誤**。
- Player 沿原有手動裝備規則；NPC 的永久 `shieldId` 與 `hasActiveShield` 分開。遠程與釋放收招期間隱藏盾牌並停用防禦；近戰時恢復同一面盾，**不重建耐久**。
- Lance idle 沿用 Sword Idle 人體與手形，加固定 attachment；攻擊才加右臂 FK 前伸。**不恢復舊 Ready pose、左手支撐或 lance IK**。
- Shadow Warden 使用 `maki-archer-t4` 持久化資產 ID；近戰沿用實際武器的 attachment、動作與 WeaponSweep，**不用弓的 grip／tip 或專屬近戰 hitbox**。
- 箭模型沿 local `-Z`，投射物朝向須顯式對齊速度。飛行箭與 pilum 共用不可變 render resources，**移除實例不能銷毀模板或共用資源**。
- `EquipmentGeometryRegistry` 把剛性 mesh 指向內容相同的共用 geometry（skinned、morph 與非 static attribute 除外）。共用 geometry **不可修改，也不可當作實例資源 dispose**；自行銷毀零件的 owner 先檢查 `isSharedEquipmentGeometry`。
- 人物、戰馬與四足坐騎的 `THREE.Bone` 由 `stopBoneEulerSync` 停止 quaternion→Euler 同步：骨骼只能讀寫 `.quaternion`，整組寫入 `.rotation.set(x, y, z)`（`setRigRotation`），**不可單軸寫入或讀取骨骼 `.rotation`**。
- `hideBoneOnlySubtrees` 把整棵只含 Bone 的子樹設為 `visible = false`；世界矩陣與 `Skeleton.update` 蒙皮不看 visible，姿勢不變。契約：**不可把可繪製物件掛在 Bone 下**，裝備一律經非 Bone 的 socket。

## 弓與高階裝備

- `CharacterBowVisual` 共用弓、弦、nock、搭箭與發射座標；Roman pilum 另有外觀。`ThirdPersonCamera` 以 FOV 與前向位移混合至瞄準視角；Player 從 nock 向準星 world ray 命中點發射。
- T5 selected-source 騎乘弓姿由 `CharacterEquipmentPose` 把就座移除的骨盆旋轉轉移到 torso chain，保留肩手與弓握點朝向；`MixerController` 依實際 bow clip 權重維持淡出到 idle 期間的補償。站立、T4、heading、來源 clips 與 projectile direction **不由此 adapter 改寫**。
- `HighTierEquipment` 預載唯一共用 T4 槍與 T5 弓 GLB；槍共享 render resources，弓以 SkeletonUtils 複製每位持有者的骨架與 mixer。`CharacterBowVisual` 保留弦、搭箭與發射座標 ownership；換裝與銷毀只釋放實例骨架。
- Ranger 的正式預設 loadout 經 `resolveT4UnitLoadout` 使用 `maki-ranger-bow-ranged`；缺正常近戰的預設由陣營提供 `viking_axe_t3`／`centurion_blade`，**不覆寫合法既有裝備**。
- 所有 NPC 只要實際持有遠程與近戰武器便依原狀態機雙向切換；舊 `reversibleRangedSwitch` metadata 仍可讀取但**不再是資格限制**。暫時任務裝備結束時恢復永久 loadout。遠程傷害與箭速由 WeaponDatabase 實際裝備決定；**角色 tier 不會自動升級明確指定的低階弓**。
- `EagleRangedCombat` 只覆寫 NPC 騎巨鷹持弓的 3D 開火距離，依武器 tier 決定，**不疊加 Ranger 射程倍率**。
- `ProjectileBallistics` 有界求解重力與移動目標攔截，發射前重驗彈道遮擋；發射後投射物不追蹤。共用箭矢使用 scene 世界界線與獨立 age／travel cap，**不依世界原點球體裁切**。
- `ProjectileContactQuery` 統一 Game 與 Town 的單段 first-contact 幾何、broad phase 與同距順序；場景提供有序目標與當下敵意／任務保護資格，再執行原傷害歸因；actor broad phase 以箭段為軸的膠囊判定（坐騎再加 `combatRadius`）。Town obstacle 候選逐箭讀取當下 bounds，**傷害造成的摧毀或恢復立即影響下一箭**。
- `ArrowProjectile` 以 `{ groups }` 原地依序走訪，**不逐箭建立 generator**。飛行壽命、插地衰退與場景傷害效果仍由原 owner 管理。
- `NPC` 依實際雙武器 loadout 切換，沿用既有 target 結果與 CHASE／ATTACK 狀態，**不擴充搜尋頻率**。巨鷹另尊重飛行 pilot 的近戰窗口，開火仍由原彈道驗證授權。

## 裝備 LOD 與骨架節流

- `EquipmentVisualLODController` 跟隨人物 Three.LOD 的當幀 level，不另算距離；只切已標記的靜態細節，保留 socket、弓弦與搭箭的動態 ownership。
- NPC 持有裝備在 LOD2 關閉 castShadow，LOD0／1 還原第一次登記的原值。Player、飛行物、掉落物、人物與坐騎不屬於此 policy。
- `Lod2EquipmentBatcher` 每幀把 LOD2 剛性 proxy 與 LOD1 剛性裝備（不透明、單一材質、無 skinning／morph、無子節點）依 geometry＋material（LOD1 另加 castShadow／receiveShadow）併成共用 `InstancedMesh`；LOD1 只在同組至少兩件可見時批次化。來源 mesh 只移到 `LOD2_BATCHED_SOURCE_LAYER` 不改 `.visible`，離開 LOD1、隱藏或不再掛在該 actor 下時**必須還原原 layers**。批次 mesh 不 dispose 共用 geometry／material。LOD0 裝備不批次化。
- 遠景 LOD2 只保留輪廓。瓦良格隊長（`viking-hero-t4`）的 LOD2 在 SHA-256 稽核相符時才合併同材質 skinned mesh，任一組驗證失敗就保留原樣。`CharacterBowVisual` 的程序弓弦與搭箭材質為**全實例共用常數，不可逐實例修改或 dispose**。
- 人物與戰馬共享 GLB 模板由 `primeSkinnedTemplateBounds` 在第一次 clone 前算一次 `SkinnedMesh.boundingSphere`；clone 與 `configureMultiInfluenceSkinning` **不逐實例 CPU 蒙皮重算**。
- 人物取樣節奏由 `CharacterLODPolicy.humanoidPoseInterval` 決定；近戰動作**永不降頻**。explicit `seek`（`bowLoad`、`pilumThrow`）共用同一節奏；蓄力與投擲進度仍由 gameplay 計時。
- NPC 實際持有遠程武器（`hasActiveRangedWeapon`）時由拉弓姿勢擁有雙臂，**不每幀套用持槍預備姿勢**；切回近戰由 `_cancelEquipmentCombatState` 結束 `bowAim`。
