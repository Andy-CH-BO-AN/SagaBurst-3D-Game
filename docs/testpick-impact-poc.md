# testpick 0.1.1 coverage impact PoC — NO-GO

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
