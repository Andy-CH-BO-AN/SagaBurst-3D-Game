# Roman / Viking 持弓接手 audit（2026-09-08）

狀態：FAILED；使用者六張截圖取代先前所有視覺 PASS 宣稱。尚未修改 production pose / assets。

## 動畫／transform ownership

```text
Player / NPC / HumanoidStudioPlayback
  → CharacterCombatAnimator（選 state / seek / gameplay event）
    → MixerController
      → imported bow 上半身 tracks → shoulder / forearm / hand
      → imported idle / walk / run 腿 tracks → legs
      → HumanoidBladeGrip（劍 guard；bow 時關閉）
raw hand → imported socket local matrix（固定） → bowPivot
  ↑ applyBowAttachment：位置＋旋轉＋scale
  ↑ CharacterBowVisual.update → updateBowOrientation：再覆寫旋轉
bowPivot → bowGripPivot（identity）→ bow-model（1.22, 1.22, -1.22）
                                 → string / arrow（各自 presentation）
```

bowLoad / bowHold / bowRelease 的 imported path 均由 GLB mixer 控制 shoulder、forearm、hand/wrist；socket 不是 runtime wrist correction。Animator 不會在 imported bow 分支執行 applyBowPose。程序式 fallback 的 shoulder/forearm/wrist 與 bowPivot rotation 由 applyBowPose 控制，bowVisual 隨後仍覆寫 bow rotation。

## 已確認 conflict

- attachment quaternion 被世界瞄準 quaternion 覆寫：固定的掌面中心位置不能保證旋轉後整段 grip 不穿掌。
- Animator.resetWeaponPivots、CharacterBowVisual.rebuild、Player/NPC/studio construction 重複初始化 attachment；程序式 pose 又写 bow rotation。
- HumanoidBladeGrip 有由 guard 淡出的殘餘 weight，進 bow 後仍可能在衰退期間寫右 forearm/hand；不是左腕問題來源。
- Studio 的 sword attachment 在 animator 後另覆寫，屬既有劍問題，本輪不藉此復活 legacy sword。

## Legacy trace

setLegacyBladeGripBypass → module flag + window.__LEGACY_BLADEGRIP_BYPASS__。
isLegacyBladeGripBypass 僅供 HumanoidBladeGrip.update、CharacterCombatAnimator.alignBladeGrip 讀取。
HumanoidAttachmentContract.applyAttachmentContract 與 BowAttachmentContract 不讀取開關。
L 開關不切 bow、GLB、locomotion 或 procedural humanoid。HUD Legacy ON / OFF 命名誤導。

## retarget / calibration / geometry

- build_humanoid_animations.py 的 apply_retarget_pose 實際使用 RsourcePose × inverse(RsourceRest) × RtargetRest；未出現 diagnosis 所宣稱的 source finger landmark → target palm normalization。
- manifest Viking thumbDir=+1，prepareBladeGrip 記錄的 Viking left thumbAxis=-1，互相矛盾，需由 mesh landmarks 重新檢查。
- shared grip 半徑 0.018 m、長 0.27 m；limb 起點 model 0.10 m，粗 tube 加 X 1.18 scaling；長弓全跨度約 2.2 m。連續不能證明比例合理。
- skill reference 的 -Z forward 與 ai_share/AGENTS.md 的 +Z gameplay forward 不同；以實際 asset／gameplay 測量決定，不套用文件猜測。

下一步：固定時間與五視角的 current / legacy bow-only / raw GLB / gameplay 比較。任何資料只能作數值檢查，不可代替視覺判定。


## 2026-09-12 接手續作：拇指與手臂回歸

**目前整體 FAILED。以下為進行中的修復，不是完成驗收。**

已撤下雙臂 IK 位置重排。最新 ownership：

```text
source GLB → 獨立 source mixer（只讀取樣）
             ↓ copy pose 到輸出骨架
             ↓ anatomical forearm pronation（保持 physical joint trajectory）
             ↓ wrist = neutral bind orientation
             ↓ bake bow-only tracks
Player / NPC / Studio → Animator state / timing → 單一 runtime Mixer
raw hand → anatomical palm frame → shared BowAttachmentContract → Bow
thumb / finger mesh → bowGrip / bowDraw morph（不得改寫 arm pose）
```

取樣與輸出不能共用會被 correction 修改的骨架：constant bowHold tracks 的 PropertyMixer cache 不保證下一次 setTime 再覆寫同值。這會把上一次 correction 當作下一次 source pose；新版以獨立 source clone 消除回流。

原 forearm 骨原點不在 mesh shaft 中心，Roman wrist landmark Z=-0.065 m。將 UP roll 直接施加在手腕會扭曲 wrist/thenar；將 roll 移到 forearm 時也必須使用 anatomical shaft 軸線，不能直接繞偏移的 bone origin。現有計算只使用同一 bind/landmark 定義，沒有 Roman/Viking angle branch。

拇指新發現：source 有 thumb vertices 同時受 forearm 與 hand 影響；大幅 wrist correction 與 thumb morph 會扯開虎口。拇指根部不應只用 cylinder distance 選一個旋轉就判定抓握正確。已撤回產生薄片的 hinge/curve 實驗；目前 thumb skin/shape candidate 待完整 visual QA。

L 仍只控制 blade/sword grip，HUD 已改「劍握持修正」。Bow-only reference 是 studio 的獨立比較模式，與 L 不同。Bow radius 0.028 m / length 0.14 m 本輪保持，不靠縮細握把掩蓋接觸。

尚未完成：左右拇指實際包覆、arrow/rest 對齊（恢復 source arm trajectory 後約 5 cm 側差）、兩 faction 三 state 五視角、最新 Player/NPC/walk/run QA。先前數值和舊截圖不構成本版 PASS。
