# Logic CI — Supercov Native Related

Production Vitest Related selection has one source of truth: **Supercov 4.24.2**
public CLI: supercov runs RUN_ID tests affected --json. There is **no custom
dependency graph, AST/behavior selector, module initialization owner graph,
or gameplay source-to-test mapping**. The previous implementation and its
obsolete selector-only tests were removed in PR #430.

## Trigger semantics

| GitHub event | Logic mode | Test execution |
| --- | --- | --- |
| Pull request → dev | Related | Exact Supercov-selected leaves with normal Vitest |
| Push → dev | Related | Exact Supercov-selected leaves with normal Vitest |
| Pull request → main | Full | Complete logic suite |
| Push → main | Full | Complete logic suite, verified for Pages/Release |
| Release / approved manual Full | Full | Complete logic suite |

Related **never automatically becomes Full**. An invalid or missing seed,
unsafe input, invalid identities, failed native query or 501+ selected leaves
fails the plan instead of bypassing governance.

## Evidence bootstrap and incremental updates

Main Full or explicitly dispatched manual Full bootstraps a valid, complete
Supercov Full seed. Normal uninstrumented Full must first pass its original
100ms gate. Supercov then records the **same Full manifest's bounded Vitest
file shards**, without using instrumentation timing for the 100ms gate.
All instrumented shards are combined by **strict** native Supercov merge,
with no unsafe override. This avoids trying to push all 740+ tests through
a single 500-leaf reporting process. The resulting seed must include all
discovered Vitest leaves and be valid/complete/passed before it is saved
under an immutable SHA-keyed cache.

Every PR → dev and push → dev restores ancestor evidence, queries native
tests affected, then runs the exact selected tests using ordinary Vitest.

Successful push → dev additionally instruments **only Related Vitest leaves**
and asks Supercov's public **strict** merge to combine that run with the
prior authoritative seed. No permissive merge flag is used: strict merge must reject stale
attribution or missing re-measurement. Only an accepted, valid, complete
merged seed is published for the next dev PR; never hand-edit a private DB.

**First-seed bootstrap (explicit maintenance only):** Run the existing
GitHub Actions **CI → Run workflow** and select the
`ci/supercov-per-test-impact-poc` branch with the existing `mode=full`
option. This feature-branch-only manual dispatch activates the dev bootstrap,
using the **existing default-branch workflow input**. Other branches retain
their normal manual Full behavior.
The dedicated job checks out the **current origin/dev** in a separate source
directory, then executes the **existing dev Full planner/runner**, including
100ms, Full-shard 500 and complete normal-Vitest aggregation. It separately
collects complete Supercov attribution from the passing Full manifest and
strict-merges these runs. This one-off job does **not** execute on ordinary
PRs or pushes; it does not change the logic gate to Full. The job uploads
`supercov-seed-<dev SHA>` as a **repository-scoped GitHub Actions artifact**,
not a PR-scoped Actions cache.

PR→dev and push→dev first try a cache keyed to the exact Git comparison base.
On a miss or non-ancestor cache, the planner reads trusted repository-scoped
seed artifacts (with read-only `GH_TOKEN`) and restores the newest one whose
**recorded SHA is an ancestor of both PR/dev TEST_BASE and the tested checkout**.
It rejects feature-branch Full seeds even if they are a HEAD ancestor. Accepted
artifact provenance is restricted to successful canonical dev/main push or
manual Full runs, plus the explicit #430 dev-source bootstrap. It checks the
upload workflow's success, seed metadata, Supercov run directory and archive paths.
A later successful push→dev strict refresh also publishes its next seed as
an artifact; therefore the next PR can restore it **even when its GitHub
cache scope is different**. Artifacts retain evidence for **45 days** (or less if repository policy
restricts it); the latest successful canonical dev artifact is preferred. If none is safe, Related fails
closed; there is still **no automatic Full**.

A PR's own Full seed is not silently treated as a dev seed. The bootstrap
measures the actual `origin/dev` Git SHA, preventing ancestor or branch-scope
confusion. Full bootstrap is needed once (or by explicit maintenance action
after expiration/unsafe structural changes), not per PR.

**Evidence compaction policy:** Bootstrap starts at generation 0. Every
successful dev push→dev strict Related refresh increments the generation.
At **16 refreshes**, or if the evidence reaches **500 MiB compressed** or
**1 GiB unpacked run data**, publication fails closed and a maintainer must
explicitly run a fresh Full dev bootstrap to begin a new lineage. There is
no automatic Full on PRs or dev pushes; cap checks run **before** caches and
artifacts are published. Artifact retention is 45 days. These thresholds
bound lineage growth while leaving a useful window for active PRs.

**Zero-native-impact guard:** an empty native affected+undetermined set fails
if any executable/test-impact input changed, including `src/**`,
`tests/helpers/**`, setup/runtime tooling, dependencies, configuration,
and workflow inputs. A directly changed test file may select its own entire
discovered suite with zero historical affected tests. Documentation-only
changes are handled by the planner and need no seed.

## Test identity and governance

The thin adapter validates the public JSON envelope, run identity, full
(file, test name) identity, count, uniqueness and truncation. It includes both
affected and undetermined individual tests. Directly changed tests include
every discovered current leaf, including newly added or renamed rows.
A small fixed Node tooling/release suite runs without a second selector.

Related aggregate counts are validated **before** any sharding:
- 0–100: Excellent
- 101–200: Normal
- 201–300: Broad
- 301–500: Very broad
- 501+: FAIL; split or reduce coupling, never auto Full/shard bypass

Full may use multiple <=500-leaf shards. The existing ordinary Vitest
100ms cap includes hooks and cleanup and remains unchanged. Reports must
exactly match selected leaf identities. Missing/extra/duplicate leaves,
skips, retries, timeouts and failures block the aggregate.

The plan reports total suite leaves, selected leaves, percentage, health tier,
run ID and native affected/undetermined counts.

## Scripts

- tests/tooling/ci-plan.cjs: discovery, manifest and 500 aggregate gate
- tests/tooling/supercov-related.cjs: native public JSON adapter
- tests/tooling/ci-run.cjs: normal Vitest / Node execution and exact aggregate
- tests/tooling/supercov-seed.cjs: Full-only authoritative seed validation
- tests/tooling/supercov-bootstrap-dev.cjs: explicit dev-source maintenance bootstrap
- tests/tooling/supercov-evidence.cjs: cross-ref Actions artifact restore
- tests/tooling/supercov-evidence-policy.cjs: canonical seed trust and bounded evidence generations
- tests/tooling/supercov-refresh.cjs: push-dev Related-only evidence refresh
- .github/workflows/logic-tests.yml: reusable workflow

Run normal Related locally with:

    node tests/tooling/ci-plan.cjs --mode related --base BASE --head HEAD --event pull_request --out output/test-plan.json
    node tests/tooling/ci-run.cjs --manifest output/test-plan.json --shard logic-related --out output/shard-reports/logic-related.json
    node tests/tooling/ci-run.cjs --manifest output/test-plan.json --reports output/shard-reports

Plain npm test still runs Full with normal Vitest. Supercov version is
strictly pinned to 4.24.2; the migration does not upgrade Vitest/Vite/Node.

## Unsupported inputs and rollout acceptance

Unmeasured/new/deleted/renamed/moved source, assets, unknown global inputs
and corrupted evidence fail Related until native safety is demonstrated.
Config/dependency changes may select all leaves, which will exceed the 500
Related limit and must be handled through an explicit maintenance workflow.

### Pre-merge acceptance (PR #430, without writing to dev)

1. Complete the [#433 fixture fix](https://github.com/Andy-CH-BO-AN/SagaBurst-3D-Game/pull/433)
   through normal review into dev, then explicitly dispatch a **canonical dev
   Full bootstrap** and verify successful normal Full, exact Supercov identities,
   `valid=true` / `complete=true`, and a SHA-bound seed artifact.
2. On #430, restore that seed with **PR-base ancestry enforced**, run the
   actual Supercov native affected query, ensure per-leaf selection respects
   the aggregate 500 cap (501+ fails), run the selected cases with normal
   Vitest, and verify a complete passing aggregate with the 100ms gate intact.
3. Verify at least **one strict merge and subsequent native selection**
   against the resulting evidence using an **isolated worktree/acceptance
   harness** with real runtime edits and genuine public Supercov CLI data.
   Preserve command lines, Git SHAs, run IDs, source snapshots, exit statuses
   and exact selected testcase identities. If this cannot be demonstrated
   safely before merge, **block merge** rather than treating contract-only
   tests or unexecuted scenarios as evidence.
4. Review setup/module-init changes, changed tests, unsupported inputs and
   representative CareerDuelState/#407/#408/#409 scenarios against the native
   CLI. Preserve the current branch's conservative guards. Do not claim the
   historical manual-union diagnostics as native production results.

### Post-merge rollout confirmation (only after all pre-merge gates pass)

The `supercov-refresh.cjs` production guard **must remain** restricted to
`GITHUB_EVENT_NAME=push` and `GITHUB_REF=refs/heads/dev`.
After #430 is merged, monitor **two consecutive actual push→dev Related
refreshes**, both with exact normal-Vitest aggregate PASS, native affected,
strict public merge, valid next-generation seed/artifact, and successful
next-change native selection. A failure halts rollout and requires an
explicit corrective PR or maintenance/bootstrap action, **never** silently
falls back to Full, restores the old selector, or disables 100ms/500 limits.

**Do not demand real push→dev production refreshes before merging #430**:
that would be a circular requirement because the workflow is not yet deployed
on dev. Likewise, a pre-merge rehearsal cannot be misreported as a successful
production push→dev refresh.

Until the pre-merge acceptance actually passes, the production migration
is blocked and #430 should remain open.

## Main publication

The main push gate emits a verified Full SHA for the same checkout, shared
with Pages/Release. Failed, stale or missing SHA cannot publish. Manual
release tags without matching evidence run Full. Dev PRs skip Desktop and
browser smoke, while regular build/typecheck remain.
