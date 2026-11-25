# 坐騎

範圍：Mount 行為、四足坐騎資產、馬甲、衝撞傷害、巨鷹與騎乘落馬。索引與共通規則見 [ARCHITECTURE.md](../ARCHITECTURE.md)。

速度、HP、售價與騎手速度例外以程式資料為準（`src/combat/MountStats.ts` 的 `MOUNT_RIDER_SPEED_EXCEPTIONS`、`src/movement/XongkoroConfig.ts`）；本檔只記擁有者、不變條件與禁止事項。

## 權威與資產

- `Mount` 是 HP、移動、碰撞、跳躍、衝撞、死亡、下馬與存檔的權威；`HorseAssetRegistry`、`BlackCatVisual`、`SnowLeopardVisual`、`CorgiVisual`、`XongkoroVisual` 負責資產與動畫，**保留原 save IDs**。
- `QuadrupedAssetPreload` 集中四足坐騎的 manifest 與 GLB 驗證、並行預載與失敗重試。**全部必要 clips、LOD 與 seat 通過後才發布模板**；失敗後下次預載重新讀取。
- 坐騎實例共享 render resources，各自持有 skeleton 與 mixer。`ARMORED_HORSE`／Career ID `armored-horse` 是獨立重甲戰馬，**不替換普通馬**；加速與轉向限制在既有 `Mount` controlled movement owner 處理。
- 授權、來源雜湊與重建方式保留於各模型目錄的 manifest／CREDITS 與必要 provenance；製作與匯出驗證由資產 skill 維護。

## 動畫、LOD 與座位

- 地面坐騎只有 LOD0 投射陰影：戰馬依 `HorseShadowPolicy` 名單，Black Cat 與 Snow Leopard 由 `QuadrupedVisual` 依 LOD 設定。
- 戰馬與四足坐騎共用 `CharacterLODPolicy.mountAnimationInterval` 推進 mixer；`QuadrupedVisual` **不強制更新整棵世界矩陣**。Horse LOD 與節流由 registry 維護，**不改變 gameplay timer**。
- 遠距騎士在坐騎姿勢未推進時，由 `SkinnedSeatContact.reapply` 沿用上次量得的座位修正。`Game` 主迴圈在算繪前以 `fitMountedSeat(false)` 略過騎士子樹刷新；近距離的 `align` 只更新取樣頂點所用的骨鏈。
- `CharacterEquipmentPose.apply` 結束時整棵刷新，但**從不寫入 rig root 與其祖先**；其 `ArmSolver`、`FittedHumanoidCloth` 的世界查詢經 `AnchoredWorldMatrix` 從 root 往下刷新。`getWorldPosition`、`getWorldQuaternion`、`localToWorld`、`worldToLocal`、`lookAt` 每次都重算到 scene root，熱路徑在祖先未變時改用 `AnchoredWorldMatrix`（或 `refreshWorldChains` 合併共同祖先）；直接讀取子孫 `.matrixWorld` 的分支需先刷新子樹。主 rig 剛整棵刷新後的 `onPoseEvaluated(true)` 讓裝備 socket 略過重走手部父鏈。
- Black Cat 與 Corgi 使用 `idle`、`walk`、`run`、`death`，並保留遊戲會呼叫的 `jump`、`land`、`hit`；`QuadrupedMountAnimation` 定義種類與速度遲滯。死亡單次播放後停在末幀；一次性動作結束後恢復最新請求的步態。
- 騎士骨盆對準解剖 seat socket，腿姿遵循各 rig 的 `forwardBendSign`。座面接觸由 `RiderSeatContactCache` 依騎手 visual child 身分快取；**換裝重建模型時失效，不能沿用已脫離 mesh 的世界高度**。Corgi 由 `CorgiSeatContact` 修正座面貼合；DEV 校準是否適用正式 Player／NPC 必須依實際呼叫端確認。

## 巨鷹（xongkoro）

- `xongkoro` 是 Tier 4 英雄坐騎。`XongkoroConfig` 集中 HP、速度、起降、高度、射界與攻擊參數；`EagleFlightController` 接收 Player 與 `EagleFlightAI` 共用意圖，執行有限轉向、連續位移碰撞與完整起降淨空。
- `ThirdPersonCamera` 單獨消費滑鼠 delta，由 `EagleFlightAim` 同時產生準星與飛行意圖；瞄準維持巡航。
- `XongkoroVisual` 使用本地 CC BY 4.0 GLB，以獨立 skeleton、mixer 與程序化頭爪 pose 運作。落地以來源腿鏈建立雙腳支撐；低空依淨高限制拍翼幅度。
- 拍翼聲由 `WingbeatPhaseTracker` 追蹤下拍，`EagleWingbeatAudio` 接到既有 SoundManager；**音效不控制動畫或 gameplay**。
- `StandingRider` 在飛行 transform 與姿態後對齊 standing socket，**不把坐騎縮放傳給騎手**；騎手保持 mounted。
- `EagleAttack` 只在主動窗口掃掠頭與爪，按 attack instance 去重，先判盾、人體與坐騎的實際 contact；飛行坐騎排除被動 `MountImpact`。攻擊 method 為 melee，來源 metadata 為 `xongkoro`，技能歸屬 mountedImpact，**與手持武器無關**。
- 巨鷹 render bounds 由 `tools/build-xongkoro-bounds.mjs` 離線推導並保存於 `render-bounds.json`；`XongkoroVisual` 在 LOD 重掛後轉為各實例私有的 `SkinnedMesh.boundingSphere`。資料缺失或過期時**保留不裁切**並提供警告。此邊界只決定繪製，**不控制模擬、socket 或受擊範圍**。
- `AerialViewPolicy` 只在騎乘 xongkoro 或高空 observer 時放大 camera far 與 fog，**不擴大 LOD 高精度距離**。
- `FallingRider` 共用腳底最高點、繼承速度、重力與支撐面落地規則；解除綁定冪等，死亡角色仍完成墜落。`fall` 環境傷害繞過戰鬥減傷，依墜落高度與騎手最大 HP 結算一次，致死高度必死；經正式 HP、死亡回呼與歸因事件，**不給武器 XP**。`CareerAerialState` 與 `SaveManager` 保存未決墜落與飛行狀態。

## 馬甲與撞擊

- `MountArmor` 以獨立 `ShieldState` 重用 `absorb()` 與 `weaponShieldImpact()`，吸收量以 `MountStats` 為準。`DamageRouter.damageMount` 只對武器 melee 與 projectile 消耗護甲；自然鷹擊、墜落、地形與 mount-impact 沿原 HP 路徑。騎士 body 與盾接觸**不消耗馬甲，也不受馬甲保護**。
- 玩家馬甲耐久保存於 `CareerProfile.mountArmor`、任務 `mountState.armorImpact` 與 mounted RPG save；NPC 與借用角色在 mount resource checkpoint 保存 `armorImpactRemaining`。**已存為 0 的耐久必須保留**；只有 respawn、正式 refit 與 rest 重設。
- `calculateMountImpactDamage` 先保留原四捨五入基礎公式，再套重甲馬與雪豹的倍率；Player 的 Mounted Impact skill 由原 caller 加成；`skipImpact` 與冷卻不改。Game 與 Town 成功撞擊步兵後共用擊退檢查，**不對騎士或坐騎重複結算**。
- `CombatContact.mount` 指向真正命中的坐騎。body 與盾牌 overflow 只傷人物，mount 只傷坐騎；兩者死亡獨立，正常 release rider。`mount-impact` 是明確例外：目標騎乘存活坐騎時傷坐騎，否則傷人物，**不吃盾**。未帶 contact 的 scripted damage 傷指定人物。
- 戰場坐騎 HP 傷害與 NPC HP 傷害皆沿用 CombatEvent offensive XP；傷害數字只顯示實際 `appliedDamage`。Player 的 mount HUD 由仍 mounted 且 `currentMount` 存活決定，**不由上一擊 `isMountHit` 決定**。
- Game 玩家武器、徒手近戰與騎乘衝撞（`resolveMountImpacts` 玩家坐騎分支）的 NPC 目標共用 `isPlayerHostileNpc`；友軍與死亡目標排除。
- 近戰與投射物沿用 `WeaponSweep`／`traceCombatSegment`，比較盾、人物 body 與坐騎的 first contact。坐騎 collider 使用 aim proxy 的 local box，隨 world transform 旋轉與縮放。所有存活坐騎都是獨立 physical target；**NPC 不主動選無騎士坐騎為目標**。攻擊者自己的坐騎排除於自己的武器查詢。

## 數值與比較

- `MountStats`（`src/combat/`）是各坐騎基礎速度與最大 HP 的唯一資料來源，並組合 `MountArmor` 與 `XONGKORO` 的護甲、撞擊與飛行數值；騎手速度例外以 `heroAssetId` 區分。
- `MountComparison`（`src/rpg/`）以純函式產生能力比較：基準為目前騎乘，否則目前分配；無基準或候選即基準時**不宣稱強弱**。巨鷹與地面坐騎一律「各有取捨」，**不以飛行速度排名**；比較只用最大 HP 與護甲上限，**不建立 `Mount` 或模型**。
- Custom Battle 與 Defense Campaign 的 Player 可選坐騎；Career 的駐軍、英雄與商人坐騎由城鎮規則決定。
