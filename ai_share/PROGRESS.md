# Warriors: Dedicate Your Heart! — Progress & Handoff Notes

_Last updated: 2026-09-18（最新 main #26；NPC 弓 submission 優化候選分支）_

> This file is a concise handoff, not a changelog or validation archive. Keep only current state, durable decisions, recent milestone outcomes, known limitations, and the next useful investigation. Detailed benchmark runs, screenshot inventories, per-frame evidence, and historical implementation narratives belong in merged PRs / Git history and ignored `output/` diagnostics.

---

## Current Status

- 本輪 baseline：`9c10299`（PR #26，擴大 playable world boundary 與 battle spawn staging）。下列 #19–#23 數字僅為歷史背景，不可直接當作新場景的 Before。
- Phases 0–23 are implemented. Current work is focused on making large 100v100 battles cheaper without changing gameplay semantics or broadly degrading visual quality.
- Apple M1 Pro / Chrome 153 / ANGLE Metal 的最新場景中，100v100 cavalry 仍約 12 FPS；render submission 仍是主要未解成本。
- 目前候選分支檢查：37 Vitest files / 375 tests 與 production build 通過。

### Current performance conclusion

The recent optimization sequence shows two distinct costs:

1. NPC update / animation evaluation can be reduced with distance-aware humanoid work.
2. The larger remaining bottleneck is still render submission, especially the main pass in cavalry-heavy scenes.

| PR | Optimization | Durable result |
| --- | --- | --- |
| #19 | Sword / shield rigid mesh consolidation | Scenario B equipment meshes 4,460→1,700; draw calls −39.6%; Renderer Submit −32.3%. This established scene/renderable count as a major cost. |
| #20 | Humanoid distance animation throttling | Scenario B NPC Update −22.75%, FPS +9.59%; cavalry NPC Update −15.39%, but renderer cost remained dominant. |
| #21 | Skip inactive humanoid LOD mixer / pose evaluation | Reduced mixer/pose work; clear NPC Update benefit in infantry / near-heavy cases. Cavalry overall CPU/FPS improvement was not consistently proven. |
| #22 | NPC Equipment Visual LOD | B/C/D Renderer Submit medians −6.36% / −5.65% / −4.78%; Near-heavy −0.03%, providing a useful negative control. |
| #23 | NPC Equipment Shadow LOD | B/C/D Renderer Submit medians −6.26% / −4.06% / −4.35%; B shadow casters 1,100→0 while visible meshes stayed 1,100. Near-heavy shadow workload was unchanged. |

### 本輪持久結論與下一個調查目標

- DEV 單次實際提交 census 證明 Cavalry 最大來源是 NPC 弓的材質分段：81 個環段 groups 只使用木／皮革兩種材質。近處馬眼角膜的 transmission prepass 又使 opaque 提交重複一次；main-pass 計數包含這個非 shadow 子 pass。
- 候選分支只在 NPC 建弓時合併相鄰同材質 groups（81→3），保留幾何、材質、動畫、attachment 與 Player 路徑。同幀畫面完全一致；最新 baseline 的 Cavalry calls 16,654→8,854，弓 8,300→500。Cavalry Submit 中位數僅 −2.6%，配對結果不一致，尚未證明穩定時間收益；Infantry control 的 calls 不變。
- 下一個合理 target 是 Humanoid renderables／material structure，以及 transmission prepass 放大的 opaque workload。先做 attribution，再選單一低風險改動；不回頭優化 shadow／collision，也不直接進行 crowd instancing。Viking Bow LOD1/2 離手舊問題仍另案處理。

---

## Performance Measurement Notes

- `Renderer Submit` means CPU-side time inside `renderer.render()` and may include driver overhead / GPU back-pressure. It is **not** pure GPU execution time.
- With the current Three.js renderer behavior, default `renderer.info.render.calls/triangles` observed after a normal render represents the main pass because shadow rendering is followed by an info reset. Do not describe that default number as including shadows.
- When shadow attribution is needed, measure main vs total passes explicitly outside the timed profiler window, then derive shadow work from the difference. Restore renderer info settings immediately after the diagnostic render.
- Visible mesh count is not draw-call count. Material groups and shadow passes can produce multiple submissions per mesh.
- Performance evidence should use paired fresh production runs on the same hardware/camera/settings. Three-run medians are local evidence, not a cross-hardware guarantee.
- Near-heavy scenarios are useful negative controls for distance-based LOD/shadow policies. If a feature is not triggered there, large measured gains should be treated as suspicious until attributed.
- One-off benchmark JSON, scripts, screenshots, montages, builds, and probes belong under ignored `output/local-diagnostics/` or `output/playwright/`, not in tracked documentation.

---

## Current Runtime / Gameplay Contracts

### Equipment and combat

- Equipped shields are the single source of shield state. A shield stays in the left hand on foot and mounted; ranged units can be configured without a shield.
- Bow aiming is blocked while a shield is equipped; the player must unequip the shield first. Equipment changes cancel unfinished attack / bow-charge state without synthesizing pending events.
- T1–T3 one-handed swords share the current sword combat path; tier differences remain visual/stats data. Existing inventory/save IDs remain compatible.
- Current lance idle deliberately reuses the existing Sword Idle body/hand pose. Do **not** revive the older special Ready pose, palm-up correction, two-hand support, lance IK, or lance-specific finger morph in unrelated work.
- Lance attacks use an attack-only right-arm FK extension while retaining the fixed attachment and existing event timing. Mounted sword attachment uses the current forward-facing mounted orientation and restores the foot attachment when dismounted.
- `CharacterCombatAnimator` remains the owner of one-shot combat timing/events. Gameplay damage/projectile logic reacts to those events rather than inventing separate visual timing.

### Equipment visual / shadow LOD

- `EquipmentVisualLODController` follows the existing Humanoid `THREE.LOD` level; it does not own a second distance calculation or threshold set.
- Equipment visual detail uses the existing LOD0/1/2 policy from PR #22. Registration/rebuild traverses once; steady-state level changes write cached detail visibility only.
- Equipment shadow policy from PR #23: LOD0/LOD1 restore each mesh's original `castShadow`; LOD2 sets NPC-held equipment `castShadow=false` while keeping the same visible equipment.
- The controller preserves the first registered original shadow state, including meshes that were already `castShadow=false`. Shield rebuilds must immediately inherit the current visual/shadow LOD state.
- Player equipment, flying arrows/pila, drops/pickups, Humanoid body, Horse, terrain, lighting, and global shadow-map configuration are outside this controller's scope.

### External humanoids

- Release Player/NPC characters use the external Viking/Roman humanoid pipeline; development-only legacy humanoids are not a release fallback.
- Humanoid visual LOD thresholds remain `0 / 28 / 60m`. LOD selection uses Three.js semantics and camera zoom; do not duplicate these thresholds elsewhere.
- Each character keeps its independent skeleton/mixers while geometry/material/texture/clip resources are shared from registry templates.
- LOD0 remains equipment socket authority. Distance animation throttling and inactive-LOD evaluation reduction must preserve attack/projectile event semantics and socket correctness.

### Horse runtime

- New scene mounts and NPC cavalry use the external `HORSE` pipeline; Black Cat / Corgi remain only for old-save compatibility.
- Horse LOD thresholds remain `0 / 18 / 38m`; far horse animation beyond ~35m is throttled around 15 Hz.
- Each horse owns an independent skeleton/mixer while geometry/material/texture/clip resources are shared.
- `Mount` remains gameplay authority for HP, movement, collision, impact, death/dismount, and save behavior. Horse visual work must not silently change those systems.

---

## Known Limitations / Non-Blocking Issues

- **Viking Bow LOD1/2 attachment mismatch:** the low-LOD arm pose differs from LOD0 socket authority and can visibly separate the bow/hand. It reproduces on main and predates PRs #21–#23. Treat it as a separate asset/pose issue; do not claim unrelated performance work fixes it.
- Roman clothing / low-LOD simplification seams and some existing hand geometry limitations remain accepted visual debt unless a task explicitly targets them.
- 100v100 cavalry performance is still poor despite the recent optimization series; do not describe large-battle performance as solved.
- `renderer.info` main/shadow accounting is a known instrumentation trap; use the measurement note above rather than copying older documentation that said default calls included the shadow pass.

---

## Recent Milestones

### 2026-09-18 — PR #23: NPC Equipment Shadow LOD

- Distant NPC equipment remains visible at Humanoid LOD2 but stops casting dynamic shadows. LOD0/1 preserve original shadow state; Player/gameplay are unchanged.
- Same-frame shadow-policy toggles confirmed that the removed equipment shadow submissions match the total-pass reduction while main-pass geometry stays unchanged.
- Near-heavy scenes with no LOD2 NPCs showed no shadow-work change, supporting the distance-based attribution.

### 2026-09-18 — PR #22: NPC Equipment Visual LOD

- NPC equipment now follows Humanoid LOD and hides only marked static detail at LOD1/2. It does not swap geometry, change attachments, or alter gameplay roots.
- This reduced visible equipment meshes by roughly one-third in far-heavy 100v100 scenarios and reproducibly reduced Renderer Submit.

### 2026-09-17 — PRs #20–#21: Humanoid animation work

- PR #20 connected camera distance into the humanoid animation controller and enabled the existing far-distance throttling path.
- PR #21 stopped evaluating inactive non-authority LOD mixers/poses in steady state while retaining conservative catch-up/fade/seek behavior.
- These changes reduced NPC-side evaluation work without changing gameplay timers/events, but did not remove the renderer bottleneck.

### 2026-09-17 — PR #19: Rigid equipment consolidation

- Viking/Roman sword and shield detail was consolidated into far fewer rigid renderables while retaining attachment metadata and silhouette.
- This produced the largest single render-submission reduction in the current optimization sequence and motivated the later equipment LOD work.

### 2026-09-16 — Current shield / lance behavior established

- The earlier complex lance-ready / two-hand-support experiment was superseded by the current minimal approach: Sword Idle body pose + fixed lance attachment + attack-only forward FK.
- Shield equip/unequip, shield-blocks-bow behavior, mounted sword orientation, and shared Player/NPC attachment contracts were stabilized.

### 2026-09-14 — Current one-handed sword pipeline

- Viking/Roman T1–T3 melee defaults were unified around one-handed sword geometry/attachment behavior with stable combat event timing and dedicated sword-hand shape.

---

## Major Historical Milestones

- **Phase 20 — Combat rig:** shared FK arm rig, hand sockets, combat event timing, bow visual/launch alignment, mounted/foot combat foundations.
- **Phase 21 — Visual realism:** procedural PBR material system, richer anatomy/armor/weapons, ACES tone mapping.
- **Phase 22 — External humanoids:** manifest-gated Viking/Roman GLB pipeline, shared templates, independent skeletons/mixers, 3-level LOD and studio tooling.
- **Phase 23 — External horse:** licensed horse runtime, one shared rig asset with independent instance skeletons/mixers, 3-level LOD, multiple coat variants and mount studio.
- Earlier phases established RPG inventory, weapon tiers, mounts/cavalry, custom physics/collision, UI/save systems, faction visuals, and the battle framework. Use Git history / merged PRs when detailed historical implementation information is needed.

---

## Documentation Boundary

- `ai_share/ARCHITECTURE.md`: durable current architecture/contracts only.
- `ai_share/PLAN.md`: roadmap and future work.
- `ai_share/PROGRESS.md`: concise current handoff, recent outcomes, known limitations, and next investigation only.
- Merged PR descriptions / Git history: detailed implementation narrative, test matrices, benchmark tables, and historical evidence.
- Ignored `output/`: one-off local screenshots, raw JSON, scripts, probes, builds, and diagnostic artifacts.

Do not copy full PR descriptions or raw benchmark reports back into this file. When a new milestone supersedes an old one, condense or replace the old entry instead of appending another full report.
