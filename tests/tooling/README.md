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
100ms gate. The separate instrumented evidence run does not change timing
requirements. A successful seed is stored in an immutable cache keyed by SHA.

Every PR → dev and push → dev restores ancestor evidence, queries native
tests affected, then runs the exact selected tests using ordinary Vitest.

Successful push → dev additionally instruments **only Related Vitest leaves**
and asks Supercov's public merge --allow-changed to combine that run with the
prior authoritative seed. The official merge is expected to reject stale
attribution or missing re-measurement. Only an accepted, valid, complete
merged seed is published for the next dev PR; never hand-edit a private DB.

Restore order: exact prior dev SHA, previous dev evidence, then main Full
evidence. Each seed must be an ancestor of the tested checkout. A cache miss,
a stale branch, incompatibility or rejected merge is a **fail-closed blocker**,
not a request to automatically run Full.

The first seed cannot be produced by an ordinary Related PR. A maintainer
must explicitly bootstrap Full in a suitable cache scope. The historical
Supercov PoC did not produce a passing Full seed.

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

PR #430 still requires proof with a valid Full bootstrap; native affected
benchmarks for CareerDuelState, #407, #408, #409; module initialization and
setup impacts; changed tests; exact runner execution; and two consecutive
dev incremental-refresh scenarios. Do not claim production acceptance without
the matching successful GitHub CI evidence.

## Main publication

The main push gate emits a verified Full SHA for the same checkout, shared
with Pages/Release. Failed, stale or missing SHA cannot publish. Manual
release tags without matching evidence run Full. Dev PRs skip Desktop and
browser smoke, while regular build/typecheck remain.
