# Logic CI — Supercov Native Related

Production Vitest Related selection has one source of truth: **Supercov 4.24.2**
public CLI: supercov runs RUN_ID tests affected --json. There is **no custom
dependency graph, AST/behavior selector, module initialization owner graph,
or gameplay source-to-test mapping**. The previous implementation and its
obsolete selector-only tests were removed in PR #430.

## Trigger semantics — exact PR-base Full evidence

| GitHub event | Logic mode | Evidence |
| --- | --- | --- |
| Pull request → dev | **Related** | Requires an immutable Full seed whose `seed.sha === PR base SHA` |
| Push → dev | **Full** | Normal Full PASS, then publish a NEW Full seed bound to this dev commit SHA |
| Pull request → main | **Full** | Complete logic suite |
| Push → main | **Full** | Complete logic suite + immutable same-SHA Full seed for Pages/Release |
| Release / explicit manual Full | **Full** | Complete logic suite; only canonical dev/main dispatch may publish a seed |

**No automatic Full fallback on PRs**, and no Related shard bypass. Every
PR→dev Related aggregate must be ≤500 individual cases, and 501+ fails.
Each leaf of normal Vitest/Node execution must be ≤100ms, including hooks
and cleanup. Full can shard normally with ≤500 cases **per Full shard**;
it never uses a 500-case aggregate cap.

### Production flow

```text
push dev A → Full(normal 100ms gate) → strict same-source Full merge → seed A
PR B (base=A) → restore verified exact seed A → native Related → normal Vitest
merge PR B
push dev B → Full(normal 100ms gate) → strict same-source Full merge → seed B
PR C (base=B) → restore verified exact seed B → native Related → normal Vitest
```

If a new dev commit is present but its Full job has not successfully
published the **exact** matching seed yet, PR planning fails closed with
`exact dev baseline seed pending`. Re-run PR CI only after that Full
publication. An older canonical seed is NOT accepted, even when it is an
ancestor of PR base: accepting it would over-select A→B + B→C and
potentially produce an incorrect >500 result.

The restored seed must have complete normal Full execution evidence,
complete Supercov attribution, `valid=true`, no corruption, and immutable
recorded source SHA. Artifacts come from successful canonical dev/main
`CI` push/manual workflows with `workflow.head_sha === seed.sha`;
feature-branch seeds, stale branches and unverified caches are rejected.
Only repository-wide GitHub Actions artifacts are used for PR restore:
the filename, extracted metadata and commit are all checked. The seed's
SHA must equal the provided exact `TEST_BASE`; that base must also be in
the PR checkout's ancestry. Missing or mismatched evidence fails closed.

### Full publication and retention

The **normal** Full run first passes the same 100ms test gate and exact
aggregate. `supercov-seed.cjs` then instruments only the **same bounded
Full Vitest shards**, strict-merges runs measured against the **same
source snapshot**, and validates every collected Vitest leaf plus setup
attribution. This strict merge is only among current-SHA Full shards;
it never combines old source versions with new Related runs.

Supercov top-level `complete` can be false when some source branches
remain uncovered. Actual Full-seed admission requires
`valid=true`, `testExitCode=0`, `stale=false`,
`measurement.complete=true` with no limitations or corrupt data,
`testAttribution.exact` equal to all collected Vitest leaves, and
all `testOutcomes` passed (no skips, failures or uncertain identities).
Seed schema v3 records `sha`, `runId`, `tests`, `setups`, three
execution/measurement/attribution completeness flags, and honest
`coverageComplete` separately. No generation counter is needed.

A successful canonical Full publishes
`supercov-seed-<dev-or-main-commit-SHA>` as an immutable repository-scoped
Actions artifact, retaining it for 45 days. Archive limits stay at
**500 MiB packed / 1 GiB unpacked** and fail before publication when
exceeded. Dev pushes use SHA-specific concurrency groups so a later push
does not cancel an in-flight Full seed job.

No `supercov-dev-refresh`, cross-revision strict merge, incremental
Related artifact publisher, generation 0..16 lineage, `--allow-changed`,
legacy selector, or automatic Full fallback is part of production.

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
- tests/tooling/supercov-evidence-policy.cjs: exact baseline trust and immutable Full artifact size caps
- .github/workflows/logic-tests.yml: reusable workflow

Run normal Related locally with:

    node tests/tooling/ci-plan.cjs --mode related --base BASE --head HEAD --event pull_request --out output/test-plan.json
    node tests/tooling/ci-run.cjs --manifest output/test-plan.json --shard logic-related --out output/shard-reports/logic-related.json
    node tests/tooling/ci-run.cjs --manifest output/test-plan.json --reports output/shard-reports

Plain npm test still runs Full with normal Vitest. Supercov version is
strictly pinned to 4.24.2; the migration does not upgrade Vitest/Vite/Node.

## Unsupported inputs and rollout acceptance

Unmeasured, new, deleted, renamed or moved runtime sources, assets,
unknown global inputs and corrupted evidence fail Related until native
safety can be established. Config/dependency changes may select all
leaves and therefore correctly fail the 500 Related aggregate cap.

### #430 migration review and pre-merge evidence

- [Canonical-source bootstrap #42252456644](https://github.com/Andy-CH-BO-AN/SagaBurst-3D-Game/actions/runs/42252456644)
  previously measured a real historical dev checkout: 763 exact Vitest
  leaves + 110 setup records. Its **feature-branch publication is not**
  trusted for production and cannot substitute for a current-SHA
  canonical seed.
- [Actual #430 native gate #42256174278](https://github.com/Andy-CH-BO-AN/SagaBurst-3D-Game/actions/runs/42256174278)
  found 873 affected historical identities, so at least 763 runnable
  leaves. The >500 fail is **intentional**, and Owner will review a
  one-time manual force merge of this CI infrastructure migration.
- [Isolated incremental experiment #42260462775](https://github.com/Andy-CH-BO-AN/SagaBurst-3D-Game/actions/runs/42260462775)
  confirmed that small-source-change Related tests passed, but merging
  their runs into a different-source Full run failed strict with
  `differing domains: source, recorded files`. This **motivated the
  replacement architecture**, which does not require incremental merge.
- Before merge, check new Full/Related workflow routing and exact
  base-match contract, ensure 501+ still fails, verify seed trust,
  no cache/provenance bypass, normal 100ms gate, and unchanged main/release
  behavior. **A full production push→dev seed rollout can only be
  observed once the new workflow is deployed on dev**.

### Post-merge confirmation

After Owner's reviewed force merge, the **first push→dev now runs Full**
and publishes its own same-SHA seed (no separate feature bootstrap).
Check actual Full test outcomes, strict same-source merge, seed SHA,
artifact provenance, and presence of that exact artifact.
A PR targeting that dev base should then restore the **exact** seed,
run native Related and pass ≤500 cases using normal Vitest.
When dev advances, PR CI for the new base must **fail closed until**
the next Full seed is published. Validate the cycle on two consecutive
dev pushes; report any failure instead of using a previous seed or
automatic Full fallback.

## Main publication

The main push gate emits a verified Full SHA for the same checkout, shared
with Pages/Release. Failed, stale or missing SHA cannot publish. Manual
release tags without matching evidence run Full. Dev PRs skip Desktop and
browser smoke, while regular build/typecheck remain.
