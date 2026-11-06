# testpick 0.1.1 coverage impact PoC — NO-GO

## Round 1 — default setup

Measured 2026-11-05 (Asia/Taipei), from clean `origin/dev`
`e927b699110d442827f32c71a30b34cba959bad0`.

**NO-GO for testpick 0.1.1 with the current repository.** Full mapping silently
saves an empty coverage map after its runner attempts fail. All three historical
PR source-only diagnostics select Full (740 current Vitest leaves); none meets
the required `<300` threshold. Stop here; the next evaluation is Datadog Test
Impact Analysis, not a patched testpick or a handwritten selector. These results
do not establish whether a functioning coverage engine would be more precise.

## Scope and reproduction

Only this report is committed. No dependency, lockfile, config, reporter, test
registration, production selector, workflow, budget, or required-CI change.
Neither #411 nor #427 was cherry-picked. No `--ai`, custom ownership map, or
source/dependency analysis was used. The generated `.testpick/map.json` is local
only; logs and temporary diagnostics are under ignored `output/testpick-poc/`.

After `npm ci` succeeded in the clean worktree, the measured commands were:

```sh
npx --yes testpick@0.1.1 map --full
npx --yes testpick@0.1.1 map
# Append a temporary comment to tests/missions/CareerDuelState.test.ts:
npx --yes testpick@0.1.1 map
# Restore the test bytes and original full-map snapshot afterward.
```

The worktree had no `.testpick` directory before the first command. No permanent
local installation was needed. The published npm tarball SHA-1 is
`c0b3d443f7cab2611232509851c57e536c11c78d`.

## Mapping and incremental cost

Host: Apple M1 Pro, arm64 macOS, 8 logical CPUs / 8 available jobs, 16 GiB RAM;
Node 26.0.0, npm 11.12.1, locked Vitest 4.1.10. Default single-pass mode used
8 concurrent shards, then up to 8 per-file fallbacks. Timings include the pinned
npx invocation; CPU is accumulated child user + system time, not utilization.

| Attempt | Wall | User CPU | System CPU | Result |
| --- | ---: | ---: | ---: | --- |
| Full | 10.299s | 43.512s | 6.367s | 0/116 attributed; 116 per-file fallbacks |
| No-op refresh | 0.871s | 0.560s | 0.222s | Claims 116 unchanged; reuses empty map |
| One-test refresh | 1.597s | 1.160s | 0.340s | Reuses 115; 0/1 attributed; 1 fallback |

Full map: **16,719 bytes, 116 listed test files, 0 mapped test files, 0 source
files, 0 edges**. All three commands exit 0. No-op/one-test timings describe
failed-map bookkeeping, not successful incremental coverage maintenance.

Normal Vitest public-API collection found **109 files / 740 leaves**, all in
`run` mode. All 109 are listed in testpick's map, but **none has attribution**.
The other 7 map entries are Node `.test.cjs` files excluded by the Vitest config.
testpick's filesystem discovery does not respect that runner boundary.

Two concrete blockers were independently reproduced without changing settings:

1. testpick's generated single-pass config calls `mergeConfig(user, overrides)`
   with this repository's callback config. Vitest startup fails with
   `Error: Cannot merge config in form of callback`.
2. The unmodified per-file coverage command fails with
   `MISSING DEPENDENCY Cannot find dependency '@vitest/coverage-v8'` under the
   existing locked dependencies. No coverage package was installed to change
   the experiment's baseline.

The published mapper ignores runner exit statuses and hashes files even when
no coverage report exists. It reports success and then treats that state as
up to date. Mapping therefore supplies no successful test execution evidence;
failed/skipped leaf totals are unavailable, not zero. No normal Vitest file
completed coverage attribution. The later direct run below is separate evidence.

## Precision benchmark

All selections came from unmodified `testpick explain`. `F` means its native
**116-file Full selection = 109 Vitest files / 740 Vitest leaves + 7 Node files
whose leaves are outside this PoC's Vitest inventory**. The 740 is not a complete
cross-runner aggregate, and already exceeds the 500 Related limit.

| Scenario | Vitest #427 files / leaves | testpick files / leaves | Reduction |
| --- | ---: | --- | --- |
| CareerDuelState | 38 / 347 | F | None; Full |
| Game | 3 / 21 | F | None; Full |
| TownScene | 7 / 77 | F | None; Full |
| memoryStorage | 35 / 310 | F | None; Full |
| Direct CareerDuelState test | 1 / 12 | 1 / 15 | N/A; inventory differs |
| Unrelated TownFourGateSiegePreview | 0 / 0 | F | None; Full |
| PR #407 full input | 80 / 593 | F | None; Full |
| PR #407 source-only diagnostic | 80 / 593 reference | F | None; Full |
| PR #408 full input | 71 / 543 | F | None; Full |
| PR #408 source-only diagnostic | 71 / 543 reference | F | None; Full |
| PR #409 full input | 70 / 539 | F | None; Full |
| PR #409 source-only diagnostic | 70 / 539 reference | F | None; Full |

#427's historical rows were representative replays on its runtime index, not
original PR executions. This PoC replays real historical **filenames** on the
unchanged current dev baseline, not historical code semantics. #427's migrated
inventory was 107 files / 663 leaves; this required baseline is 109 / 740.
No percentage is presented as a controlled precision comparison across these
different inventories, and an empty map cannot establish coverage precision.

GitHub's paginated PR file lists supplied all filenames. Full-input replays
retain every existing changed file (including assets, tools, config and docs):
#407 12/13 (only deleted `mace.glb` absent), #408 19/19, #409 10/10.
Source-only diagnostics apply exactly `src/**`, `tests/**/*.test.ts`, and
`tests/helpers/**`: respectively 4, 5, and 8 inputs. No asset/config input was
silently filtered from full-input results. Full selected filenames and exact
input lists are recorded in the accompanying PR description.

A detached temporary worktree at the same baseline received reversible comment
changes (text) or a final-byte flip (GLB). Only `explain` ran there; no tests,
build, game, or asset audit ran against synthetic binaries. Every file was
restored and the temporary worktree removed. No synthetic commit was pushed.

## Safety and direct execution

| Case | Observation |
| --- | --- |
| New untracked `src/testpick-poc-unmapped.ts` | Unresolved → Full; deleted afterward |
| Temporary `vitest.config.ts` edit | Unresolved → Full; restored afterward |
| Temporary `axe.glb` byte change | Unresolved → Full; restored afterward |
| Existing unrelated preview source | Unresolved → Full; cannot exclude it |
| Imported-but-unexecuted precision | Not validated: zero attributed sources; stopped at incompatibility |
| Dynamic runtime import coverage | Not validated: zero attributed sources; no fixture or patch added |

Source-only also falls back to Full, independently of assets/config. Thus this
run cannot claim “coverage engine useful, drop-in selector insufficient”; the
engine's integration itself failed. Explain exposes `unresolved` and
`safe-fallback`, never a coverage-map selection reason in these runs.

One small valid selection was executed separately on the normal worktree:
temporarily comment-edit `tests/missions/CareerDuelState.test.ts`, then
`npx --yes testpick@0.1.1 run`. Its native `changed-test-file` rule forwards that
file to Vitest: **15/15 passed, 0 skipped, 0 retries, max leaf 12.919ms** including
hooks/cleanup; the unchanged budget reporter ran and the collected names matched
the execution report. This is direct-file routing evidence, not coverage proof.
The 15 leaves fit within 500; no Full fallback was executed through `testpick run`.

## Limitations and decision

File-level selection cannot trim individual leaves. Coverage knows only executed
paths; assets may be absent from JS coverage. Unmapped files conservatively select
Full. Node `.test.cjs` execution is not integrated. Map freshness and trusted
baseline handling remain unresolved; the observed empty-map hashing makes even
the incremental “up to date” message insufficient evidence of validity.

**NO-GO.** Successful attribution and incremental-cost criteria are unmet, and
0/3 source-only scenarios are below 300 leaves. No tool patch, migration, hybrid
policy, or Datadog integration is included. The report is the only permanent
change, so the code/config-change regression condition does not apply; full
`npm test`, test typecheck, web build and desktop build were not run locally for
this documentation-only branch. PR CI status is tracked in the PR description.

## Round 2 — with matching @vitest/coverage-v8

Measured 2026-11-06 (Asia/Taipei), same latest origin/dev `e927b699110d442827f32c71a30b34cba959bad0`; dev did not advance. Round 1 is retained above. Only the exact devDependency `@vitest/coverage-v8: 4.1.10` and its lockfile entries were added. `npm ls` confirms Vitest and the provider both resolve to 4.1.10. All original locked package versions, including Vite/Vitest, are unchanged. No testpick, Vitest config, reporter, workflow or gameplay change.

**Final recommendation: NO-GO — move next to Datadog Test Impact Analysis.** Installing the matching provider makes native fallback attribution work, but the source-only results remain too broad and the map silently omits tests which execute mapped sources. This supersedes Round 1's integration-only inference; it is not evidence that coverage-based TIA in general cannot work.

### Attribution gate

Round 1 scratch output was archived locally before creating a clean `output/testpick-poc/`; `.testpick` was absent before rebuilding. `npm ci` passed. The unmodified `npx --yes testpick@0.1.1 map --full` exited 0 in **66.480s** (user CPU 290.543s, system CPU 50.695s; same M1 Pro / 8 jobs). Its complete visible stdout/stderr was saved locally. The original callback config still prevents single-pass attribution: **0/116 single-pass, 116 per-file fallbacks**. No tool or config patch was applied.

| Metric | Round 1 | Round 2 |
|---|---:|---:|
| Listed test files | 116 | 116 |
| Normal Vitest inventory | 109 / 740 leaves | 109 / 740 leaves |
| Attributed Vitest files | 0 | **105 / 109** |
| Mapped source files (all map keys, including helpers) | 0 | **322** |
| Coverage edges | 0 | **10,385** |
| Map bytes | 16,719 | **582,549** |
| Fallbacks with zero source results | 116 | **11** (4 Vitest + 7 excluded Node files) |

The numerical attribution gate passes. This is not a clean mapping run. Missing Vitest attribution:

- `tests/combat/CombatAttribution.test.ts`
- `tests/equipment/CareerTownEquipment.test.ts`
- `tests/missions/CommanderMission.test.ts`
- `tests/movement/NavigationWorld.test.ts`

Seven `.test.cjs` files remain outside Vitest, as in Round 1. The mapper suppresses child stdout/stderr and ignores child exit statuses, so its full-run child-failure count is **not observable from native output**, not zero. All 8 single-pass shards encounter the unchanged callback merge blocker. Four isolated diagnostic invocations of the exact fallback command were therefore logged separately, without replacing or repairing the measured map:

- CombatAttribution: exit 1, 8 passed / 1 failed; existing expected label `敵方巨鷹弓兵 · T3` differs from actual `敵方巨鷹弓兵`. Budget reporter also rejects the failed run.
- CareerTownEquipment, CommanderMission and NavigationWorld: exit 0 when diagnosed separately; actual `coverage-final.json` files were generated. Their original zero-source outcomes are retained as missing attribution, rather than replaced by these subsequent successful measurements. The cause of those original outcomes cannot be established from testpick's suppressed diagnostics.

### Precision

| Scenario | #427 Vitest files/leaves | Round 2 testpick files/leaves |
|---|---:|---:|
| CareerDuelState | 38 / 347 | 37 / 333 |
| Game | 3 / 21 | 3 / 21 |
| TownScene | 7 / 77 | 6 / 71 |
| memoryStorage | 35 / 310 | 34 / 296 |
| PR #407 full | 80 / 593 | 116 listed / 740 Vitest leaves (Full; +7 Node files) |
| PR #407 source-only | 80 / 593 reference | 116 listed / 740 Vitest leaves (Full; +7 Node files) |
| PR #408 full | 71 / 543 | 116 listed / 740 Vitest leaves (Full; +7 Node files) |
| PR #408 source-only | 71 / 543 reference | 70 / 542 |
| PR #409 full | 70 / 539 | 116 listed / 740 Vitest leaves (Full; +7 Node files) |
| PR #409 source-only | 70 / 539 reference | 69 / 538 |

These are the original map's native `explain` selections, not repaired estimates. Full includes 109 Vitest files / 740 leaves and 7 Node files not counted in that Vitest leaf inventory. Current leaves were collected via unchanged Vitest public API; there were no skipped registrations. #427 used its own migrated 107/663 inventory, so its reference rows are not a controlled apples-to-apples precision comparison.

The exact historical input lists from Round 1 were reused: every still-existing input in the full replay (12/19/10 inputs), and exactly the prescribed source-only filter (4/5/8 inputs). No input list was handwritten or altered. The detached replay ran only explain against reversible byte/comment edits; it was restored and removed.

Narrow sources use `coverage-map` reasons; `memoryStorage` selects 34 files / 296 leaves. PR #407 source-only falls back because `src/world/WeaponMeshFactory.ts` is unmapped, even without assets. PR #408/#409 source-only return 542/538 leaves. Full-input replays remain Full due to unmapped assets/tools/config/docs. **0/3 source-only scenarios are below 300 leaves.**

### Safety and incremental behavior

The missing attribution is a concrete safety problem: separate successful fallback coverage reports for CareerTownEquipment and CommanderMission contain positive statement hits for `src/career/CareerDuelState.ts` (4 each) and `tests/helpers/memoryStorage.ts` (234/153). Neither test is in the original map's selected sets for those changed files. An apparently smaller selection therefore excludes tests that actually execute the changed source. These files also execute `src/world/NPC.ts` (173 statement hits each); NavigationWorld does too (173). Diagnostics establish executed-file coverage, not a claim that every function in that file executed.

No new imported-but-unexecuted or dynamic-import fixture was added after the explicit NO-GO threshold was met. Those precision proofs remain **unvalidated**, and no claimed improvement is attributed to excluding import-only tests. New source, config, asset and unrelated preview probes all conservatively select Full in this round too.

| Refresh | Wall | Attributed Vitest files | Sources | Edges |
|---|---:|---:|---:|---:|
| Full | 66.480s | 105 | 322 | 10,385 |
| No-op | 1.009s | 105 | 322 | 10,385 |
| One comment-edited CareerDuelState test | 3.693s | 105 | 322 | 10,385 |

The one-test refresh reuses 115 hashes and remeasures only that file. The original test bytes and full-map snapshot were restored. Hash-based refresh functions mechanically, but no-op also reuses the four missing Vitest attributions; successful timing alone is not evidence of safe completeness or reproducibility. No second full-map repair/retry was used to improve results after NO-GO.

### Required local regression

All requested commands ran; no gate or baseline was relaxed:

- `npm ci`: passed.
- `npm test`: failed; the first shard executed 483 leaves (482 passed / 1 failed), then stopped. CombatAttribution has the same label assertion failure as the coverage diagnostic. This is not a Full pass; later shards did not run. Observed first-shard maximum was 38.616ms including hooks/cleanup.
- `npm run typecheck:test`: failed with existing `src/Game.ts:6:184` TS6133 for unused `createCareerFieldPersonalOrphanMountPlan`.
- `npm run build` and `npm run build:desktop`: both failed at that same TypeScript error, before Vite bundling.

`src/Game.ts`, `tests/combat/CombatAttribution.test.ts`, and all gameplay/test source blobs are identical to origin/dev; the only branch changes are this report, package.json and package-lock.json. Thus these are pre-existing source/assertion problems on this baseline, not silently fixed by the PoC. The earlier Round 1 CI also recorded the same Game.ts diagnostic. Node integration, required CI, hybrid rules, caches, 100ms/500-leaf gates and Datadog integration remain outside this change. Latest-head CI is reported in the PR description.
