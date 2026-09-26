# Project Rules & Agent Guidelines

Welcome to the **3D Web Action RPG (A Tribute to Skyrim)** project!
If you are an AI agent picking up this project, please read these guidelines carefully to quickly get up to speed.

## 1. Core Architecture & Design Philosophy
- **Licensed External Characters and Mounts**: External GLB/FBX people and mounts are allowed only after source/license, proportions, skeleton/socket, LOD, skinning/deformation, compression, performance, and browser validation. Read `skills/humanoid-rig-skinning/SKILL.md` before changing character assets or their runtime adapter. The Phase-23 horse additionally requires source-derived PBR/groom evidence, one shared rig with independent instance skeletons/mixers, KTX2/Meshopt, three audited LODs, and the isolated mount studio. Procedural weapons/shields and the legacy Black Cat/Corgi save-compatible visuals remain supported.
- **Vanilla Three.js**: No React Three Fiber. Everything is handled via direct DOM manipulation and vanilla Three.js scene graphs.
- **Custom Physics Engine**: We do not use Ammo.js, Cannon.js, or Rapier. All physics (gravity, collision, Raycasting, heightmap matching) are handled manually using pure Math and line-segment / sphere intersection tests. See `Terrain.ts` (`getTerrainHeight`, `resolveObstacleCollision`) and `Game.ts`.
- **Pure Web Audio API**: No external sound files. All audio (swords, bows, hit impacts, UI chimes) are procedurally synthesized using `AudioContext` oscillators and noise buffers. See `SoundManager.ts`.

## 2. Key Systems to Understand
- **Game.ts**: The master orchestrator. Handles the main game loop (`requestAnimationFrame`), entity updates, global collision detection, and UI integration.
- **NPC.ts**: Universal entity class for both enemies (Bandits, Romans) and allies (Vikings). Driven by a Finite State Machine (IDLE, ALERT, CHASE, ATTACK). They can generate as Cavalry.
- **Mount.ts / HorseAssetRegistry.ts**: `Mount` owns gameplay state, HP, collision and movement. The registry asynchronously preloads the licensed horse runtime package, shares geometry/material/texture/clip resources, and creates an independent skeleton plus one mixer per horse. Legacy Black Cat/Corgi types retain the previous committed procedural appearance for save compatibility and are not used for new scene spawns; do not restart their external rebuild inside horse work.
- **Player.ts & PlayerInput.ts**: Handles the capsule avatar, pointer lock camera rotation, jumping, attacking, and drawing bow strings.
- **RPG Systems**: Look at `WeaponDatabase.ts` for all weapon configurations, `InventoryManager.ts` for items owned, and `SkillManager.ts` for XP and level-ups.

## 3. Important Implementation Rules
- **Maintain Naming Conventions**: Keep consistent naming for HTML DOM IDs (kebab-case) and TypeScript classes/variables (PascalCase/camelCase).
- **Local +Z is Gameplay Forward**: Imported humanoids and the Phase-23 horse are normalized to local `+Z`; movement headings use `Math.atan2(dx, dz)`. Do not add per-model runtime flips to compensate for a wrongly exported asset.
- **DOM Overlay over WebGL**: All UI (Health bars, Stamina bars, Inventory Grid) is purely HTML/CSS overlaid on top of the `<canvas>`. Do NOT try to build UI using `three-mesh-ui` or 3D text unless specifically requested. Update DOM elements inside `Game.ts` or dedicated UI classes.
- **Temporary Validation Files**: 一次性的截圖、量測 JSON、探針及驗收腳本一律放在已忽略的 `output/`（例如 `output/playwright/`、`output/local-diagnostics/`）。不要複製到受版本控制的 `artifacts/` 或 `tools/`，也不要用 `git add -f` 提交；持續維護的程式測試與必要資產另依其用途管理。
- **Document Only Durable Changes**: 不要機械式地在每個任務結束後同時擴寫 `ARCHITECTURE.md` 與 `PROGRESS.md`。
  - 只有 durable architecture / contract 改變時才更新 `ARCHITECTURE.md`；一次性驗證流程、raw benchmark、截圖清單與 PR 細節不要放進去。
  - 只有新的 merged/current milestone 會實質影響後續 handoff、已知限制或下一步方向時才更新 `PROGRESS.md`。
  - `PROGRESS.md` 必須保持精簡：以 current status、最近成果、已知限制與 next investigation 為主；新內容若取代舊結論，應壓縮或替換舊段落，而不是永久追加完整歷史。
  - 不要把完整 PR description、逐輪 benchmark table、逐幀比對、截圖數量/清單、暫存路徑或一次性 diagnostic report 複製進 `PROGRESS.md`。詳細證據留在 merged PR / Git history；本機一次性產物留在 ignored `output/`。

## 4. How to Start a New Task
1. Read `PLAN.md` to see the roadmap context.
2. Read `PROGRESS.md` to know what was recently implemented.
3. If the task changes or diagnoses browser-visible combat behavior, read and follow `skills/combat-browser-validation/SKILL.md` before validating it.
4. Before loading a newly exported horse asset in a browser, import its raw GLB into a clean Blender scene and compare true orthographic front/side REST and representative-animation renders against the working source. Reject collapsed, exploded, intersecting, or mismatched anatomy before compression or browser validation.
5. Use `?devmodels=mounts&nolock` for isolated horse variant, LOD, skeleton, rider, socket, and animation review before release/stress scenarios.
6. Use `grep_search` to find relevant methods (e.g., `takeDamage`, `rebuildWeapon`).
7. Apply surgical edits to existing files using the provided tools.
8. If the logic gets too complex, add debug logging (`console.log`) or use visual debug meshes (e.g., drawing a sphere at the collision point) to verify math.

### Local GitHub and browser workflows

- GitHub PR, issue, review, push, and other authenticated repository operations must use the host machine's local terminal `gh` / `git` credential context. Never create or update a PR from the Codex sandbox: the user cannot access that environment or log in there.
- If `gh auth status` fails inside the sandbox, do not ask the user to sign in there; rerun the authenticated GitHub operation in the host's local terminal. A successful `git push` does not imply that sandbox `gh` authentication is available.
- Performance benchmarks that depend on WebGL, GPU timing, headed UI, or local credentials must run in the local environment with the user's installed browser and display. Do not substitute a sandbox browser, in-app browser, headless browser, or software-rendered environment unless the task explicitly requests a non-production diagnostic.

## 5. Think Before Coding

Don't assume. Don't hide confusion. Surface tradeoffs.

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them—don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 6. Simplicity First

Minimum code that solves the problem. Nothing speculative.

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.
- Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 7. Surgical Changes

Touch only what you must. Clean up only your own mess.

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it—don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.
- The test: Every changed line should trace directly to the user's request.

## 8. Goal-Driven Execution

Define success criteria. Loop until verified.

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

1. `[Step]` → verify: `[check]`
2. `[Step]` → verify: `[check]`
3. `[Step]` → verify: `[check]`

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

These guidelines are working if: fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

*Dedicate your heart, and happy coding!*
