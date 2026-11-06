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

Main Full or explicitly dispatched manual Full bootstraps a valid, fully
**measured and executed** Supercov Full seed. Normal uninstrumented Full
must first pass its original 100ms gate. Supercov then records the **same Full manifest's bounded Vitest
file shards**, without using instrumentation timing for the 100ms gate.
All instrumented shards are combined by **strict** native Supercov merge,
with no unsafe override. This avoids trying to push all 740+ tests through
a single 500-leaf reporting process. The resulting seed must include all
discovered Vitest leaves and pass the **public measured evidence contract**
before it is saved under an immutable SHA-keyed cache. Supercov's top-level
`complete` in `coverage.summary` also depends on *code coverage*: it may be
false when application branches remain uncovered, even if every test passes.
Seed admission instead requires `valid=true`, `testExitCode=0`, `stale=false`,
`measurement.complete=true` with zero limitations/corrupt data,
`testAttribution.exact` matching **every** discovered Vitest leaf, and
`testOutcomes.passed` equal to that count, with no failed, skipped, unknown
or partial cases. Missing measured evidence or source-scope integrity still
fails closed. The real `coverage.coverageComplete` is recorded separately
and is **not** falsely relabeled as full coverage. Schema v2 seed metadata
keeps `measurementComplete`, `executionComplete`, and `attributionComplete`
distinct from coverage completion; strict merge and PR-base trust are intact.

Every PR → dev and push → dev restores ancestor evidence, queries native
tests affected, then runs the exact selected tests using ordinary Vitest.

Successful push → dev additionally instruments **only Related Vitest leaves**
and asks Supercov's public **strict** merge to combine that run with the
prior authoritative seed. No permissive merge flag is used: strict merge must reject stale
attribution or missing re-measurement. Only an accepted, valid, complete
merged seed is published for the next dev PR; never hand-edit a private DB.

**Canonical maintenance bootstrap:** Once the Supercov workflow is deployed
to `dev`, a maintainer may explicitly run **CI → Run workflow → dev →
mode=full**. The normal Full planner, 100ms gate, 500-per-Full-shard
limits, instrumented Vitest and strict native merge run on the same
canonical dev SHA. Successful dev/main Full publications create a SHA-bound
repository-scoped seed artifact. Ordinary PR/push to dev **never auto-Full**.

The #430 temporary feature-branch bootstrap produced the historical
`dev 3966b98` measurement and demonstrated archive handling **before
deployment**. Its feature-branch workflow provenance is no longer trusted
by production restoration; this historical artifact is usable only as
read-only evidence for isolated pre-merge acceptance, never as an
automatically accepted production seed. After Owner's force merge, perform
an **explicit canonical dev Full bootstrap** before expecting ordinary
push→dev Related refresh to succeed. A push that arrives before that
canonical publication must fail closed, not silently reuse the feature seed.

PR→dev and push→dev first try a cache keyed to the exact Git comparison base.
On a miss or non-ancestor cache, the planner reads trusted repository-scoped
seed artifacts (with read-only `GH_TOKEN`) and restores the newest one whose
**recorded SHA is an ancestor of both PR/dev TEST_BASE and the tested checkout**.
It rejects feature-branch Full seeds even if they are a HEAD ancestor. Accepted
artifact provenance is restricted to successful canonical dev/main push or
manual Full runs **whose recorded workflow HEAD is exactly the seed SHA**.
It checks the
upload workflow's success, seed metadata, Supercov run directory and archive paths.
A later successful push→dev strict refresh also publishes its next seed as
an artifact; therefore the next PR can restore it **even when its GitHub
cache scope is different**. Artifacts retain evidence for **45 days** (or less if repository policy
restricts it); the latest successful canonical dev artifact is preferred. If none is safe, Related fails
closed; there is still **no automatic Full**.

A PR's own Full seed is never silently treated as canonical dev evidence.
A trusted Full bootstrap is required on dev/main once (or on explicit
maintenance after expiry, lineage cap or unsafe structural changes), not
per PR.

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
(file, test name) identity, counts, uniqueness and truncation. Supercov
`coverage.summary` distinguishes **763 runnable Vitest leaves** from **110
setup lifecycle records** in the confirmed canonical baseline. Its native
`runs tests affected --json` inventory correctly counts **873 historical
records**. This is not 873 executable Vitest testcases. `unaffected` is
deliberately **count-only**, returned as `unaffectedCount: 873` with
`truncated: ["unaffected tests are counted, not listed"]` on an unchanged
checkout. The adapter accepts this *specific* unaffected-only truncation
while requiring untruncated exact `affected` and `undetermined` identities,
correct sums, and an inventory matching `seed.tests + seed.setups`.
Supercov's public `tests affected --json` gives ranked preview arrays
and authoritative summary counts; the pinned 4.24.2 command did not accept
a generic `--limit` parameter in real CI. The adapter therefore **never
guesses missing affected/undetermined identities**. A genuinely incomplete
preview with potentially runnable leaves fails closed. A future verified
public identity pagination/export protocol can improve smaller Related
plans without changing this invariant. Reason-only truncation is harmless
when every affected/undetermined identity is present. If the native summary already proves that the
minimum impacted runnable tests, `affected + undetermined - seed.setups`,
exceeds 500, selection fails **before** trying to use a preview list;
full reruns and shard bypass are not permitted. This caught #430's
real 873/873 affected historical records (at least **763 runnable cases**),
which is a governance blocker rather than a malformed seed.
Optional `affectedCount` and `undeterminedCount` are accepted only
when each equals its corresponding **complete** identity array length and
summary count; they never authorize count-only affected selection.
Unknown affected setup lifecycle names within a recognized test file
conservatively select **every leaf in that file**, still subject to the 500
aggregate gate; unknown source files or inconsistent counts fail closed.
Directly changed tests include every discovered current leaf, including
newly added or renamed rows.
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

### #430 migration acceptance (before Owner force merge)

1. **Historical canonical-source Full proof achieved:** the special
   bootstrap job checked out real dev SHA `3966b98` and published
   `supercov-seed-3966b98...`, containing 763 exact test leaves plus
   110 setup records. This is a measurement proof, **not trusted
   production artifact provenance** after feature trust removal.
2. **Expected #430 policy failure:** real native Supercov on #430
   identified 873 affected records, so at least 763 runnable leaves.
   The normal PR→dev **500 hard limit must fail**, and Owner will later
   force merge this one-time CI infrastructure migration after review.
   Do not make this PR green by sharding, automatic Full fallback, or
   suppressing affected tests.
3. **Still required before force merge:** reproduce with an **isolated
   worktree/acceptance harness** and real Supercov 4.24.2 CLI:
   `valid Full seed → small runtime edit A → native affected →
   exact normal Vitest PASS → strict merge → small runtime edit B →
   next native affected → exact normal Vitest PASS`.
   Preserve actual SHAs, native response, selected identities,
   run IDs, normal Vitest reports, public strict merge output and exit
   statuses. No `--allow-changed`. An unexecuted plan is not proof.
4. Verify setup/module-init changes, changed tests, unsupported inputs,
   and representative earlier CareerDuelState/#407/#408/#409
   scenarios. The previous selector and Full fallback stay removed.

### Post-merge rollout confirmation

Production `supercov-refresh.cjs` remains gated strictly to
`GITHUB_EVENT_NAME=push` + `GITHUB_REF=refs/heads/dev`.
**First perform explicit canonical dev Full bootstrap after merge** so
the replacement artifact has allowed publisher provenance. Then verify
two consecutive real push→dev Related refreshes with exact normal Vitest
PASS, native selection, strict merge, valid next-generation artifacts
and next-change native selection. If a change exceeds 500 or evidence
is missing, fail and require a separate corrective/maintenance action;
never auto-switch to Full, disable the 100ms/500 limits or reuse a
feature-branch seed. No pre-merge harness output may be described as a
real post-merge push→dev acceptance.

## Main publication

The main push gate emits a verified Full SHA for the same checkout, shared
with Pages/Release. Failed, stale or missing SHA cannot publish. Manual
release tags without matching evidence run Full. Dev PRs skip Desktop and
browser smoke, while regular build/typecheck remain.
