# Warriors: Dedicate Your Heart! — Architecture

## Folder Structure

```
skyrim 3D test/
├── index.html                 Entry point HTML; HUD elements, Enemy HUD, Damage overlay, Quiver UI, Compass, Character Modal, Pickup Prompt
├── package.json
├── tsconfig.json
├── vite.config.ts
├── ai_share/                  Canonical AI documentation; edit files here only
│   ├── AGENTS.md             Project rules and agent guidelines
│   ├── ARCHITECTURE.md       This file
│   ├── PLAN.md               Full phase roadmap (Phases 0~8 & Phase 13)
│   └── PROGRESS.md           Current progress & handoff notes
├── .agents/                   Compatibility entry points; files direct AI to `ai_share/`
├── .codex/                    Codex entry points; files direct AI to `ai_share/`
└── src/
    ├── main.ts                Async Vite entry — preloads humanoid and horse assets before creating Game
    ├── Game.ts                Master orchestrator & combat, AI, heightmap physics, audio, inventory, pickup loop
    ├── debug/
    │   └── CombatTrajectoryDebugger.ts Query-only weapon grip direction, tip trails, and console summaries
    ├── player/
    │   ├── Player.ts          Segmented body, shared tiered melee silhouettes, HP/damage/respawn state, heightmap ground collision
    │   └── PlayerInput.ts     Keyboard & mouse event aggregator (added E key detection)
    ├── world/
    │   ├── Sky.ts             Background, atmospheric fog, direction sun & ambient lighting
    │   ├── Terrain.ts         Procedural 3D heightmap terrain with getTerrainHeight(x, z) & calibrated rocks/trees
    │   ├── DummyEnemy.ts      Training dummy enemy target calibrated with getTerrainHeight(x, z)
    │   ├── NPC.ts             Generic NPC AI unit (Faction, Melee/Ranged, Lancer, Cavalry flags) with FSM AI
    │   ├── Mount.ts           Mount gameplay, horse assets and procedural Black Cat/Corgi visuals
    │   ├── HorseAssetRegistry.ts Licensed horse GLTF cache, KTX2/Meshopt, LOD, variants, sockets and animation
    │   ├── ProceduralMaterials.ts Shared cached PBR textures/materials for skin, cloth, metal, wood, leather and fur
    │   ├── CharacterVisuals.ts Legacy test fixture plus shared CharacterRig/animation contracts
    │   ├── HumanoidAssetRegistry.ts Manifest-gated GLTF cache, SkeletonUtils clones, LOD, mixers and bone/socket adapter
    │   ├── CharacterCombatAnimator.ts Shared allocation-free FK combat timeline and pose sampler
    │   ├── CharacterBowVisual.ts Shared Player/NPC bow mesh, socket aim, string, nock, and launch controller
    │   ├── WeaponPickup.ts    3D world item drop nodes with distinct 3D weapon models (floating animation)
    │   └── ArrowProjectile.ts Arrow entity with parabolic physics and multi-target hit detection
    ├── camera/
    │   └── ThirdPersonCamera.ts  Stable orbit camera with FOV-only aim zoom (58 -> 40) and reticle direction
    ├── rpg/
    │   ├── WeaponDatabase.ts  Centralized config for Tier 1~3 Melee & Ranged weapons & consumables
    │   ├── InventoryManager.ts Manages owned items, inventory grid state, and equipped weapons
    │   └── SkillManager.ts    XP & Level-up progression for One-Handed & Archery skills + LevelUp Toast & damage scaling
    ├── audio/
    │   └── SoundManager.ts    Pure Web Audio API procedural sound synthesizer (swords, bows, hits, level-up chimes)
    ├── save/
    │   └── SaveManager.ts     localStorage save/load (skills + inventory + equipped weapons)
    └── ui/
        ├── StaminaBar.ts      DOM stamina bar controller
        ├── HpBar.ts           DOM HP bar controller
        ├── QuiverUI.ts        DOM arrow counter & Skyrim radial charge reticle controller
        ├── CompassUI.ts       Norse-Rune style top compass direction bar moving with camera yaw
        ├── EquipmentUI.ts     Tab-toggled RPG Character & Inventory Panel Modal (Grid & Tier Badges)
        └── DamageNumbers.ts   Floating damage numbers (3D world -> 2D screen projection)
```

---

## 3D Weapon & Armor Geometries

1. **Viking T1–T3 單手劍**: All tiers use the default Steel Sword geometry, 1.18m profiled double-edged blade, wrapped 0.29m grip and curved crossguard. T1 uses weathered iron/leather, T2 standard steel, and T3 blue-gold runic surface patterns.
2. **Roman T1–T3 Gladius**: All tiers use the default Gladius geometry, 0.68m profiled blade, wrapped 0.16m grip and oval guard. T1 uses weathered iron, T2 legion steel, and T3 centurion gold patterns.
3. **木製短弓 (Wooden Shortbow - Tier 1)**: 0.18m crude grip + 2 straight 0.45m limbs inclined at 0.2rad.
4. **反曲長弓 (Recurve Longbow - Tier 2)**: 2-segment S-curve limbs (0.55m inner + 0.35m outer).
5. **符文精靈弓 (Elven Runebow - Tier 3)**: 3-segment elven crescent limbs (0.65m + 0.45m + 0.35m) + 2 `OctahedronGeometry` cyan crystal gems + 2 `TorusGeometry` moon crescent spikes + glowing arrow.
6. **羅馬方盾 (Roman Scutum)**: Rectangle body curved defensively (Tier 1 wood, Tier 2 iron rim, Tier 3 gold boss). Provides passive damage reduction.
   - T1–T3 盾板、外框與正面裝飾共用寬度、曲率及盾面深度；外框中心貼住盾板正面，盾臍嵌入中央盾面，交叉飾條先旋轉再沿盾面彎曲，避免零件懸空。背面握點維持 `(0,0,.085)`；工作室／Player／NPC 共用 `WeaponMeshFactory.buildShield`。
7. **維京圓盾 (Viking Round Shield)**: Wide cylinder radius (Tier 1 wood, Tier 2 iron rim, Tier 3 gold boss). Provides passive damage reduction.

### 劍盾 rigid renderable consolidation
- `WeaponMeshFactory` 只以 builder 明確列出的同材質、同 render flags 剛性零件合併；內部 `mergeRigidGeometryParts` 複製 geometry、烘焙 child local matrix、補齊順序 index，再以 `mergeGeometries(..., false)` 建立 identity-transform Mesh。保留 normal／UV／原三角形，不置中、不焊接頂點；清理暫存及已移除零件的 geometry。
- Viking Sword 固定 4 Mesh（握柄、金屬握柄零件、劍身、雙面 fuller）；Gladius 固定 3 Mesh。Viking Shield 固定 5 Mesh（seams＋後 straps 合併、T3 rivets 併入盾臍）；Scutum 只合併左右飾條，固定 5 Mesh，保留獨立外框與盾臍供貼合驗證。
- root／pivot／socket、grip／tip metadata、材質快取與既有 `polishWeaponMaterials` 陰影行為保持不變。helper 不掃描 root，不處理弓弦、搭箭或其他動態零件；該次合併未涉及裝備 LOD、陰影優化或動畫 runtime 變更。
- `EquipmentConsolidation` 測試以 `cf04fd3` 的逐材質／渲染旗標三角形指紋鎖定 position、normal、UV、winding 與 attachment，並驗證 Mesh 上限及材質共用。

### NPC Equipment Visual / Shadow LOD
- `NPC.equipmentVisualLOD` 只持有單一裝備 hierarchy。builder 以 `equipmentLastVisibleLOD` 標記靜態細節；標記本身不改 visibility，因此共用 builder 的 Player、掉落物、投射物維持完整外觀。
- 建構時註冊 sword/lance、bow/pilum 與 shield roots；換盾時替換快取並立即套用當前 LOD。gameplay roots、sockets、transforms、grip/tip/support metadata、弓弦與搭箭 visibility 仍由原系統管理。
- NPC 接續原有 `LOD.update(camera)` 與 animation hook，讀取 Three 當幀 `getCurrentLevel()`。裝備 proxies 是位於 body LOD 之後的兄弟節點，因此主 render traversal 與 shadow pass 都使用當幀 detail visibility。`HUMANOID_LOD_DISTANCES` 仍為唯一門檻來源（0/28/60m），沿用 Three zoom 語義；不另算距離、不新增 hysteresis。沒有 Three.LOD 的舊程序測試模型保持 full detail。
- LOD 改變才寫入已快取的細節 visibility；不逐幀 traverse、不換 geometry、不複製 hierarchy、不改 attachment。Viking sword 4/3/3、Gladius 3/3/3、圓盾 5/3/2、Scutum 5/4/3、含搭箭的 bow 8/6/6、lance 2/2/2；Pilum T1 3/3/2、T2 4/4/3、T3 5/4/3。已合併的護手／金屬握柄、盾臍／鉚釘保持完整以保留剪影。
- Shadow policy 共用同一 controller level：LOD0／LOD1 恢復各 Mesh 的 `originalCastShadow`，LOD2 設為 false；visual detail policy 與 `receiveShadow` 均不變。建構／重建的既有 traversal 同時快取 Mesh；切換只遍歷快取，same-level 直接 return、零 shadow writes。`WeakMap` 保留第一次註冊的原值，避免 LOD2 重複註冊把暫時 false 當原值，也不強留已替換的 shield meshes。
- Shadow 範圍僅 NPC 持有的 sword／shield／bow（含搭箭）／lance／pilum。Player、飛行箭與標槍、掉落物、Humanoid、Horse、全域 lighting／shadowMap config 不變；nocked arrow 的動態 visibility 仍由弓系統管理。換盾先沿用原 polish，再註冊立即套用目前 visual／shadow LOD，返回 LOD0／1 恢復新盾原始陰影。
- DEV-only `window.__collectEquipmentCensus(window.game.npcs)` 供手動低頻 snapshot：NPC 數、裝備 LOD 分布、五種裝備可見 mesh 數、總數及可見 shadow caster 總數／按種類的 `visibleShadowCastersByKind`。考慮所有祖先 visibility，未做 frustum filter，也不等於 submission 數；多材質 geometry 可能有多個 draw calls。沒有 frame-loop 採樣；production benchmark 另由 harness 在計時窗後單次收集。目前 Three.WebGLRenderer 在 shadowMap.render 後才重設 `renderer.info`，預設 calls／triangles 僅含主 pass；若需完整提交數，須在計時窗外暫停自動 reset、手動 reset 後 render，再恢復，不能把原預設數值當作含陰影。

### 裝備盾牌與長槍姿勢
- 盾牌裝備狀態是唯一持盾來源，固定於左手，不再依彈藥、長槍或騎乘狀態背盾。`InventoryManager.unequipShield()` 與裝備 UI 支援卸盾，沿用 nullable 存檔。
- 持盾按瞄準顯示「請先卸下盾牌才能使用弓箭」，不進入拉弓或 FOV 瞄準；拉弓途中裝盾取消蓄力。換盾／近戰武器取消未完成動作，不補發事件。
- 兩陣營近戰步兵與長槍騎兵由 `getUnitCombatProfile` 配同階陣營盾；遠程兵無盾。配盾沿用既有被動減傷公式。
- `EquipmentAttachmentContract` 共用 Player／NPC／工作室固定握點。長槍主握點 `(0,.15,0)`、支撐點 `(0,.33,0)`、尖端 `(0,2.6,0)`；Roman／Viking 盾背握把為 `(0,0,.085)`。
- **2026-09-16 最小版：Lance 完全沿用 Sword Idle 人體姿勢。** `CharacterEquipmentPose` 在待機不對 Lance 旋轉軀幹、鎖骨、雙臂或手腕，也沒有左手支撐。Lance 不建立新 morph，沿用 Sword 已有手型。盾牌左臂與 mounted 腿姿仍維持原獨立流程。
- `MixerController` 先還原程序覆蓋，再更新 mixer，各 LOD 套 mounted 腿姿與裝備上身姿勢，最後更新矩陣與 socket proxies。play／seek／update(0)／stop 都還原基底，死亡停用姿勢覆蓋。
- `calibrateLanceIdleAttachment` 僅在載入時取樣既有 idle，計算右手局部的固定 Lance rotation，然後還原來源 transforms。主握點直接沿用 Sword 掌內握點，槍模型 +Y 朝向角色 +Z；逐幀只跟隨手部 socket。舊腰際 Ready／IK 前刺已撤下；最新前刺僅在攻擊時套用右臂小幅 FK 伸展與原手部方向補償，武器掛點固定，收招還原當下 Idle／locomotion。保持 .38／.228 秒命中與 .70／.42 秒總長，軀幹、左臂與腿部不歸前刺所有。
- 騎乘 `mounted` 以既有 idle 的上身軌道取代空 clip，避免卸除 Lance 程序姿勢後回到 T-pose；不取 hips／pelvis／腿軌道，鞍座與 mounted 腿姿保持原值。Lance 固定模型掛點向外偏 0.14 rad，讓待機槍桿避開馬鬃；不旋轉手骨。
- 騎馬 Sword 使用與 Lance 相同的固定模型方向及原掌內握點；`applySwordAttachment` 預先計算步戰／騎乘兩份掛點，`setLocomotion` 僅在上下馬 context 改變時選取，下馬還原步戰掛點。既有 Sword 動作與 .252 秒命中不變。
- 人物工作室 L 切劍／槍、Q 切盾；新增 lanceThrust／mountedLance 展示。戰馬工作室另支援 F 攻擊。驗收摘要保留於 `PROGRESS.md`；一次性截圖、量測與診斷腳本只存放在已忽略的 `output/`。

### Phase 20 FK Combat Rig
- `CharacterVisuals` exposes a shared `CharacterRig`; each arm is a `shoulder -> elbow -> wrist -> handSocket` hierarchy.
- Melee weapons attach to the right hand socket, bows to the left hand socket, and equipped shields remain attached to the left hand socket.
- `CharacterCombatAnimator` owns the shared T1–T3 one-handed `swordSlash`, bow release, foot-lance, and mounted-lance timelines. Player and NPC damage/projectile code reacts to its one-shot animation events; legacy dagger/greatsword states remain available only for compatibility.
- `CharacterBowVisual` is the single implementation for Player and bow-equipped NPC bow geometry, vertical target alignment, string draw, nocked-arrow placement, and projectile launch origin/direction. Allied NPC tiers map to the same shortbow/longbow/runebow models used by the Player; Roman pilum remains separate.
- T1–T3 swords remain one-handed so the left hand can retain its shield. Lances currently reuse the existing Sword Idle body and hand pose with a fixed forward-facing model attachment; no lance-specific Ready or left-hand support is active. An attack-only FK extension moves the right hand forward while keeping the fixed weapon attachment and the base hand direction.
- `ThirdPersonCamera` keeps its optical axis and fixed reticle on one world ray. While aiming, `Game` raycasts that ray to a visible world hit (falling back to a distant point), and player arrows travel from the hand's nock socket toward that resolved point.
- Entering aim mode changes FOV only; camera distance and lateral position remain fixed so the world point beneath the original reticle does not jump.
- Melee meshes are authored along local `+Y`. Modern one-handed swords use an equipment-owned fixed attachment; lances use an attachment calibrated against the existing Sword Idle, without an arm solver. Legacy dagger/greatsword fixtures retain the procedural action pivot.
- Arrow geometry uses local `-Z` as visual forward for both nocked and flying arrows; projectile quaternions explicitly align that axis with physical velocity instead of relying on generic `Object3D.lookAt()`.
- Arrow and pilum instances share immutable shaft, tip, fin/socket/neck/wrap geometries and materials. Removing a transient projectile therefore cannot leave one new GPU resource allocation per shot during the 50v50 stress scenario.
- Equipped shields face character-forward in a low ready pose and retain their fixed left-hand attachment, including during death.
- Weapon and shield meshes retain `originalMat` for flash restoration, while shields are excluded from character damage-flash traversal.

### 2026-09-14：單手劍 attachment 與動畫所有權

- `SwordAttachmentContract` 使用 manifest 的 `swordGripFrames.lod0/lod1/lod2` 與 builder 的 `gripCenterLocal`。固定矩陣為 `inverse(socket) × handGripFrame × inverse(weaponGripFrame) × inverse(model)`；Player 換劍／重建角色、NPC 建立與工作室建立共用入口。
- 裝備代理仍每次姿勢求值後跟隨 LOD0 的 `hand_r`；這是骨架同步，不是追劍 correction。`swordAttachmentOwned` 阻止 animator 的 idle／cancel／完成流程覆寫劍。模型 grip 子節點維持 identity。
- `SwordHandShape` 只新增右手指 `swordHand` morph；`MixerController.setSwordHandShape` 在裝備狀態改變時寫 influence。`HumanoidBladeGrip` 的舊 morph 僅保留索引結構，influence 為零；逐幀扭腕／前臂 layer、alignBladeGrip 與工作室重套 attachment 已移除。HUD 固定 correction OFF。
- Roman idle／walk／run 保留原有雙臂／手腕動作；LOD0 恢復既有 LOD1 動作。Viking 的 A/T rest basis 差異使用來源解剖座標離線處理，不能套用到 Roman。`artifacts/animation_sources/sword_baselines` 保存原始 LOD1 動作與來源 SHA，避免把修正後輸出當成下一次輸入。
- `swordSlash` 以 Quaternius `Sword_Regular_A` 唯讀取樣、30 FPS 加精確命中／結束點，烘焙六份 GLB。rotation-only 版本採目標站姿下半身與來源 pelvis yaw，避免移除骨盆平移後蹲姿雙腳懸空；上身保留 A 的揮砍。時間映射使正前方掃擊落在 0.252 秒，0.48 秒完成，0.10 秒進入 blend，0.12 秒直接回最新 idle／walk／run。
- Player 保留同幀「命中＋完成」的待消費命中；NPC 完成後保留完整 0.35 秒間隔。攻擊不寫武器／socket 動畫軌道，其他 melee 家族保持原程序路徑。
- Bow 左手 frame、手形與 normalization 保留。`BowGripLOD` 複製右手網格時使用其 mesh bind 空間，避免把左手轉換套到右手。既有 Viking Bow LOD1／2 右臂與 LOD0 不一致仍列為未解的 Bow 資料問題。
- `?devcombat` enables `CombatTrajectoryDebugger` and a fixed Tier-3 50v50 cavalry battle: each faction receives 25 ranged riders and 25 lancers, with front lines starting about 35m from the player. Viking ranged projectiles use arrow visuals while Roman ranged projectiles use full pilum visuals through the same collision pipeline. Grip-to-tip direction lines stay visible and melee actions retain world-space tip trails; completion logs local-space start/end/bounds for Player and NPCs. The debugger is not instantiated on normal URLs.
- The normal release URL uses a deterministic beginner-friendly 10v5 battle: the Player plus nine allied Tier-2 infantry (five melee, four archers) face five Tier-2 Roman infantry (three melee, two pilum), with cavalry randomness disabled for those units.
- NPC ranged units engage out to 22m. Their shared aim point adds distance-squared vertical compensation before both visual aiming and projectile launch, while NPC arrows/pilums use a 20m/s launch speed for readable longer arcs.
- Player physics keeps its 0.95m capsule half-height, while the procedural render rig has a fixed -0.15m visual offset so its -0.8m boot soles meet the terrain exactly like NPC soles without altering collision, jump, or camera roots.
- The procedural terrain is 400×400m. Player, NPC, controlled mounts, and wandering mount targets share `PLAYABLE_WORLD_BOUND = 180`, leaving a 20m safety margin inside the rendered terrain instead of duplicating per-class boundary constants. Battle front lines start around `|Z| = 125`, the Viking Player starts at `Z = 145`, camp pickups at `|Z| = 151`, and camp horses at `|Z| = 158`, keeping the opening formation in the outer map band while preserving edge clearance.

### Phase 21 Procedural Realism Pass
- `ProceduralMaterials` creates deterministic cached albedo, roughness and bump textures with a browser `CanvasTexture` path and a headless `DataTexture` fallback for tests.
- `CharacterVisuals` now builds higher-resolution anatomical bodies, faces, hair/beards, layered Viking/Roman Tier-2 armor and articulated hip/knee/ankle rigs. Mounted poses spread and bend the legs for each saddle width without changing combat hand sockets.
- Tier-2 swords and gladii use tapered diamond-section blade geometry; the recurve bow uses continuous tube curves and laminated limbs; Roman and Viking shields contain curved/planked bodies, rims, bosses and rear grips.
- Black Cat and Corgi retain their save IDs and use separate procedural visuals. `CorgiVisual` is authored in metres facing +Z, shares immutable mesh/material resources, and owns independent articulated joints and an animated saddle surface socket. A child rider-pelvis socket sits 0.17 m above that surface so the posed rider’s buttocks rest on the saddle; gameplay, studio and save restoration use this anatomical socket. Its armor samples the same smooth body surface. `?devmodels=corgi&nolock` opens the armored Corgi studio; `?freeride=1&mount=corgi&nolock` starts a ride. The CORGI mounted pose clears its wider barrel and carries the weapon hand above the thighs; melee FK clearance preserves fixed hand attachments and attack timing. Its studio offers lance/axe/sword switching and defaults to the axe rider. Default battle cavalry remains Horse.
- The renderer uses ACES filmic tone mapping and rebalanced outdoor key/fill lighting so procedural metal, leather, wood and fur retain readable material separation.
- `?devmodels=mounts&nolock` is the isolated horse studio with a Player-independent Orbit camera, three variants, all nine clips, rider/skeleton toggles, LOD inspection and render-resource counters.
- `ai_share/skills/combat-browser-validation/` is the canonical browser QA workflow for combat work. It documents release/debug URLs, GPT Chrome extension operation, trajectory-overlay semantics, console-log interpretation, visual acceptance checks, and extension-noise filtering; `.agents/skills` and `.codex/skills` expose the same skill through links instead of duplicated copies.

### Phase 22 External Humanoid Pipeline
- `main.ts` calls `Game.create()`, which waits for both faction manifests and all LOD GLBs before any Player or NPC is born. A blocked/missing manifest produces a readable overlay and prevents mixed external/procedural release characters.
- `HumanoidAssetRegistry` loads one immutable GLTF template set per faction and uses `SkeletonUtils.clone` for independent skeletons. Geometry, PBR materials, textures and clips remain shared; each instance owns mixers, socket objects, bounds and lifecycle control.
- The bone adapter preserves Phase-20 right/left arm, leg and hand-socket semantics while exposing pelvis, spine, head and foot sockets. `CharacterCombatAnimator` preserves action timing and one-shot gameplay events while requesting matching mixer clips and retaining procedural bone overlays for weapon alignment.
- The registry refuses `blocked` assets and validates measured height, shoulder width and neck length before loading. LOD0/1/2 switch at 0/28/60m.
- `Game` computes camera-to-NPC-root distance once per frame (the camera is unparented and NPC roots are scene children, as for mounts), then forwards it through `NPC.update(..., cameraDistance = 0)` and `CharacterCombatAnimator.update(dt, cameraDistance = 0)` to `MixerController.update(dt, cameraDistance = 0)`. Only visual evaluation uses the existing strict `>28m` / 12 Hz policy; AI, movement, combat events and gameplay timers still run every frame.
- Each humanoid retains all three independent mixers/actions and equipment pose layers. Steady-state evaluation runs LOD0 (equipment socket authority) plus the selected visible LOD: `[0]`, `[0,1]`, or `[0,2]`. Primary hand world transforms depend on pelvis/spine/chest/shoulder/elbow/wrist ancestry and mounted/shield/lance overlays; evaluating just hand bones would require a separate dependency/track system, so this change retains the full primary mixer.
- The instance wraps Three's existing `LOD.update(camera)` and reads `getCurrentLevel()` after selection, before mesh traversal. A newly visible level settles its retained visual-time debt once and applies the authority's last evaluated equipment state. `CharacterEquipmentPose.apply()` updates world matrices before skinning. No per-frame humanoid traversal or duplicate distance thresholds are introduced; switch-time catch-up is part of Renderer Submit, not NPC Update.
- Hidden mixers accumulate only evaluated visual dt, excluding the shared far accumulator. Their own Three actions consume that debt before becoming visible or before clip/loop/rate/seek commands change semantics. This preserves native loop/clamp/paused state without copying skeletons, cloning private action state, replaying clips, or invoking gameplay events. Clip fades temporarily evaluate all three levels until their grace interval ends; explicit `seek()` (including bow draw and studio scrubbing) conservatively samples all three.
- Transition, seek, and repeated LOD crossings can reduce or eliminate work savings; a crossing may add an equipment apply even between far ticks. Bow morph and sword hand-shape state changes still reach all meshes. The existing Viking Bow LOD1/2 attachment discrepancy also reproduces with all mixers enabled and on main; it remains a separate asset/pose issue, explicitly accepted as non-blocking for this performance PR on 2026-09-17.
- Pending far dt is consumed exactly once on the next evaluation, including return to near; `seek()` and zero-dt pose refresh semantics remain unchanged.
- A newly bound clip reapplies the equipment overlay and synchronizes its socket followers immediately, preventing restored bare hands from separating from retained equipment when the next visual tick is skipped (without advancing any mixer). The interval uses simulation dt (the game retains its existing 0.05s frame clamp), not wall-clock time.
- `?devmodels=humans&nolock` is the neutral-grid external-character studio with a Player-independent Orbit camera and toggleable `SkeletonHelper`. `?legacyhumanoids&nolock` remains a Vite-development-only regression fixture and is not a release fallback.
- Canonical asset preparation instructions live at `ai_share/skills/humanoid-rig-skinning/`; both Viking and Roman manifests are ready and include source hashes, CC BY attribution, bone maps, LOD/image audits and deformation evidence.

### Phase 23 External Horse Pipeline
- `Game.create()` preloads `HorseAssetRegistry` before spawning any mount. `realistic-warhorse-v10` uses local `+Z`, one 80-joint skin, nine clips and saddle/stirrup/camera sockets.
- Each horse receives an independent `SkeletonUtils` clone and `AnimationMixer`; geometry, materials, KTX2 textures and clips are shared. LOD distances are 0/18/38m and animation updates beyond 35m are throttled near 15 Hz.
- `Mount` remains authoritative for HP, movement, collision, jumping, impact and save timing. Horse animation chooses idle/walk/trot/canter/gallop from movement speed and plays jump/land/hit/death once without an extra group-level death roll.
- New scene horses and NPC cavalry use `HORSE`. Stable FNV-1a keys assign the three coat variants; saves accept an optional `appearanceVariant` and default invalid/missing values to 0 without a schema bump.
- `LegRig.forwardBendSign` declares the local-X forward-bend convention for each humanoid rig. The external project-humanoid adapter and legacy procedural fixture provide their own sign, and `applyCharacterMountedPose` applies that convention consistently to hip, knee and ankle rotations so Player, NPC and studio riders share an anatomically forward knee bend.
- Public assets live in `public/models/mounts/v1/horse/`; source hashes and licensing are recorded in its manifest/CREDITS and the retained source/package provenance reports under `artifacts/mount_horse_pipeline/`. One-off renders, probes and acceptance captures live only in ignored `output/`; `artifacts/` ignores new files by default and explicitly allows required provenance and locomotion baselines.

---

## Data Flow (per frame)

```
Game Loop
  │
  ├─► WeaponPickup.update() ──► Distance ≤ 2.5m ──► Show [E] 拾取 Prompt ──► (Press E) ──► inventoryManager.addWeapon()
  │
  ├─► Tab / I Key Press ──► equipmentUI.open(skillManager, inventoryManager) ──► Click 【裝備】 ──► player.rebuildWeapon()
  │
  ├─► Player Melee Swing ──► Combat animation hit event ──► Read equipped melee damage/range ──► One hit check
  │
  ├─► Player Bow Fire ────► Charge pose ──► Bow release event ──► Spawn ArrowProjectile
  │
  └─► Mount Impact Damage ─► Horizontal line-segment collision vs Dummy/NPC/Player radii -> deals speed-based damage
  
### Cavalry & Mount Data Flow
- **Spawn**: Default cavalry and scene mounts use the external Horse. Black Cat/Corgi are available through saved IDs and their explicit studio/free-ride entries.
- **Visuals**: The Horse provides saddle/stirrup sockets, `rideHeightOffset`, `ridePitch`, LOD and animation; riders align their pelvis and mounted leg pose to those landmarks.
- **Roles**: Cavalry can be **Lancers** (3.0 reach, 3x charge damage that suppresses mount impact) or **Mounted Archers** (can shoot while moving, maintaining 6~15m distance. Will drop bows and auto-switch to melee sword charge if enemy enters <6m range).
- **Damage Routing**: Melee/Arrow attacks against a Mounted entity route 100% of damage to `mount.takeDamage()`.
- **Dismount**: If Mount HP drops to 0, `mount.dead = true`, and the entity resets rotation and resumes foot AI / movement.
