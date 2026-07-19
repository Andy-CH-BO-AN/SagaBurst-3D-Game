---
name: combat-browser-validation
description: Validate this Three.js combat game through the GPT Chrome extension. Use after changing Player/NPC combat animation, weapons, bows, shields, projectiles, mounts, spawn scenarios, aiming, grounding, or other browser-visible behavior; also use when interpreting CombatTrajectory console logs, screenshots, or user-reported browser errors.
---

# Combat Browser Validation

Validate the actual WebGL result, not only TypeScript state. Reuse the user's running Vite server when available, isolate one visual hypothesis at a time, and distinguish game errors from browser-extension noise.

## Choose the URL

- Use `http://localhost:5173/` for the release scenario: Player plus nine Tier-2 allies versus five Tier-2 Romans.
- Use `http://localhost:5173/?nolock` for the same scenario without pointer lock. Prefer this URL when browser automation must click or inspect the page.
- Use `http://localhost:5173/?devcombat&nolock` for visual combat diagnostics. The current debug scenario is a Tier-3 50v50 cavalry battle, with each side containing 25 ranged riders and 25 lancers.
- Use `http://localhost:5173/?devcombat=all&nolock` only when NPC trajectory logs are necessary. This enables Player and NPC console output and can be very noisy.

Treat query parameters as independent switches: `devcombat` enables trajectory rendering and `nolock` disables pointer lock. Always validate the release URL after the diagnostic URL because their spawn scenarios differ.

## Run the Validation Workflow

1. Read `ai_share/PROGRESS.md` and identify the exact behavior changed.
2. Check whether Vite is already running before starting another server. Reuse the user's `npm run dev` process when it exists.
3. Run `npm test -- --run` and `npm run build` as the code gates.
4. Choose one hypothesis and one reproducible action. Avoid judging a pose from a crowded battle when a single Player action can prove it.
5. Hard-reload after constructor, spawn, scenario, rig, or equipment changes. Vite HMR may preserve old `Game`, `Player`, or `NPC` instances.
6. Capture before, active, and recovery frames when animation timing matters.
7. Inspect relevant Console entries and compare them with the rendered trajectory.
8. Repeat the check on the release URL.
9. Report the tested URL, action, visual result, relevant logs, and any remaining uncertainty.

If the user explicitly says not to open or test the browser, do not use browser control. Ask for or inspect the screenshot and copied log they provide, then run only non-browser checks.

## Control Chrome Through the GPT Extension

Use the installed `$chrome:control-chrome` skill whenever Chrome validation depends on the user's existing tab or GPT extension. Read and follow that skill completely before controlling Chrome; its versioned installation path may change, so do not hardcode it here.

Follow these project-specific rules:

1. Connect through the extension runtime and obtain the current browser object as directed by `$chrome:control-chrome`.
2. Call `browser.user.openTabs()` and choose the game tab by its visible `localhost:5173` URL and title. Never guess a tab ID.
3. Claim the selected tab with `browser.user.claimTab(tabInfo)`.
4. Navigate to a `nolock` URL or reload the claimed tab after code changes.
5. Use screenshots to inspect Three.js output. Canvas objects usually have no useful DOM locator, so use the tab's computer-use/canvas controls for mouse and keyboard input.
6. Read Console output with the tab development-log API. Filter for `CombatTrajectory` when checking animation traces; separately request `error` and `warn` levels for runtime failures.
7. End the session exactly as required by `$chrome:control-chrome`, including its final browser cleanup call. Do not perform another Chrome action afterward.

Typical operations after claiming a tab resemble:

```js
await gameTab.goto("http://localhost:5173/?devcombat&nolock")
await gameTab.reload()
await nodeRepl.emitImage(await gameTab.screenshot())
await gameTab.dev.logs({ levels: ["log", "info"], filter: "CombatTrajectory", limit: 100 })
await gameTab.dev.logs({ levels: ["error", "warn"], limit: 100 })
```

Use the exact APIs documented by the currently installed Chrome skill if they differ from this example.

## Read the Debug Overlay

`?devcombat` creates the overlay implemented in `src/debug/CombatTrajectoryDebugger.ts`:

- yellow: Player
- blue: ally
- red: enemy
- short line: weapon grip to tip
- retained trail: attack path
- lime: full bow body
- cyan: full bow string
- magenta: nock draw path
- thin cyan: grip to nock
- white: hand to nock
- orange: nocked arrow
- green: launched-arrow flight path
- red: five-metre aim guide and target marker

The overlay logs only the Player by default. Use `?devcombat=all` for NPCs, reproduce the smallest useful action, and filter the Console because a large battle can generate thousands of entries.

## Interpret CombatTrajectory Logs

Expect messages such as:

```text
[CombatTrajectory] Player swordThrust — 57 samples
[CombatTrajectory] Player bowDraw — 180 moving samples
[CombatTrajectory] Player arrowFlight — 87 samples
```

The following `console.table` reports `start`, `end`, `min`, and `max` bounds:

- Melee action summaries use character-local coordinates. Character forward is normally local `-Z`; a thrust should therefore extend clearly toward more-negative Z without a large drop in Y or excessive sideways X travel.
- Bow draw summaries describe the moving nock path. Judge them with the lime bow body, cyan string, white hand-to-nock line, and actual pose; bounds alone cannot prove the bow faces correctly.
- Arrow flight summaries use world-space positions. The beginning of the green path should match the arrow at the bow's centre and align with the red aim guide. Y may arc downward later because gravity is expected.
- Repeated identical tables usually mean the action was repeated. They are not a leak by themselves.
- Zero moving samples while idle is expected. Zero samples during a visibly completed requested action is suspicious.
- `NaN`, infinite coordinates, a large unexplained vertical range, or an action path behind the actor indicates a real defect.

## Check Each Combat Family

For melee weapons:

- Confirm the idle weapon does not point into or penetrate the ground.
- Confirm a thrust travels from guard toward character-forward and returns cleanly.
- Confirm the hand remains on the grip throughout the action.
- Confirm a shield stays on the left hand for one-handed combat and mounted lance use, and moves to the back for bows, greatswords, and foot lances.

For bows:

- Confirm the upper limb reaches near the forehead.
- Confirm the bow body curves toward the target while the string and nock sit toward the archer.
- Confirm the drawing hand meets the centre nock and the arrow tail begins at that same point.
- Confirm the launched arrow begins at the bow centre and its initial green path agrees with the red aim guide.
- Check both Player and a true bow-equipped NPC because they share `CharacterBowVisual`; Roman ranged units use pilums instead.

For mounted combat:

- Confirm the rider is seated on the saddle.
- Confirm a mounted lance is couched under the right arm and points forward, rather than running from the shoulder into the ground.
- Confirm the left hand retains the shield.

For grounding:

- Hard-reload before judging changes to visual offsets.
- Inspect Player and NPCs from the side on comparable terrain.
- Confirm boot soles meet the terrain without sinking or floating; do not infer grounding only from the physics-root position.

## Separate Game Errors from Extension Noise

Normally ignore these when they originate from `contentscript.js` or another extension bundle:

- `MaxListenersExceededWarning`
- `ObjectMultiplex - orphaned data for stream ...`
- MetaMask, GPT extension, or extension liveness warnings
- `favicon.ico 404`

Investigate these as game failures:

- errors referencing `src/`, a Vite module, `Game.ts`, `Player.ts`, `NPC.ts`, `CharacterBowVisual.ts`, or `CharacterCombatAnimator.ts`
- unhandled `TypeError`, rejected promises, or repeated application exceptions
- missing project assets other than the favicon
- `NaN` or infinite values in trajectory output
- no action samples despite a visibly completed attack

When reporting a failure, copy the first relevant application stack trace, its source file and line, the exact URL, and the action that triggered it. Do not paste the entire extension-warning stream.
