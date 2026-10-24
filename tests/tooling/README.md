# Logic test tooling

Local npm tests and CI share this runner/planner; release publication helpers live
under `.github/scripts/release/`. `typecheck.cjs` owns the test diagnostic ratchet.

`ci-plan.cjs` collects leaves without running their bodies and produces a JSON
manifest. Related and Full deliberately have different budgets:

- **Related** (`PR/push → dev`) selects behavior owners/caller contracts and must fit in one
  aggregate set of at most 500 leaves. It never opens a second shard to bypass the
  limit. If selection is unsafe, unmapped, or exceeds 500, planning
  fails with an actionable error instead of silently running repository Full.
- **Full** (`PR/push → main`, Pages, Release, manual Full) runs the complete
  repository and may split sorted whole files into deterministic shards of at most
  500 leaves each. Aggregate may exceed 500 only in Full mode.

The 100ms limit includes each leaf's hooks and cleanup. A single file larger than
500 leaves fails planning: split independent capability suites rather than hiding
or filtering leaves.

```sh
node tests/tooling/ci-plan.cjs --mode related --base BASE_SHA --head HEAD_SHA --event pull_request --out output/test-plan.json
npm test -- --manifest output/test-plan.json --shard logic-related --out output/shard-reports/logic-related.json
node tests/tooling/ci-run.cjs --manifest output/test-plan.json --reports output/shard-reports
```

Use `--mode full` for the complete repository. `npm test` uses the same Full planner
and runs all Full shards locally. `npm run test:release` is a Node component run,
never repository Full evidence. Explicit `.test.ts` and `.test.cjs` development file
lists can be combined in `npm test -- ...`; they remain subset evidence.

PR comparison uses merge-base; push comparison uses exactly before..after. The CI
checkout is the tested merge commit for PRs; the manifest separately records the
PR head/base and binds shard execution to the checkout SHA and unique plan digest.

Related uses Git base/checkout snapshots and the TypeScript Compiler API to compare
runtime declarations, class members and import bindings, not textual hunk envelopes. Runtime imports (including
Vitest related results) supply candidates, not the final union. Test callbacks,
scoped hooks, helpers, symbol references, structural caller signatures, constructor
and prototype provenance determine which collected leaves can reach the behavior.
Type erasure plus identical JavaScript token streams proves type-only edits; those
require typecheck without automatically selecting runtime logic tests.

Direct Owners exercise the changed behavior. Caller Contracts reach it through
production callers. Import-only candidates have no such runtime path and are
excluded. Hoisted replacement module mocks are boundaries only when their factory
cannot reach the real module; partial/original imports stay conservative. Literal
shared data remains one declaration owner: dynamic lookup, enumeration, aliases,
destructuring and namespace escape are retained rather than guessed by item key.
Comments and erased types do not widen another runtime edit in the same file.

Every leaf still includes its module initialization root. Unknown calls/new,
coercion, assignments, static blocks, decorators, computed keys, changed import
module identities and reflective class-shape changes retain that conservative
boundary. An initializer is not presumed pure because its result is assigned.
Existing named-import retargets follow intermediate import/re-export bindings.
Initialization paths are reported separately, never as an empty Direct Owner.
Each precise changed target still needs an owner even beside a module effect.
Unresolved dispatch expands conservatively; eval, missing owners, missing history
or unexplained native-only edges fail closed. No runtime LLM or remote API is involved.

Each manifest retains the complete discovery inventory and identifies Related
leaves by exact file, full runner name and collection ordinal (`selectedCases`).
`each` rows are collected separately. Duplicate/ambiguous names, unknown body
locations and dynamic registration wrappers expand to the complete owner file.
Both runners also record their native ancestor-separated filter names. Partial execution uses
anchored, escaped names in isolated per-file runner invocations; whole files remain
batched. Node file workers run serially so compiler and workflow-fixture startup
cannot compete with another file inside a 100ms leaf budget. Only manifest-unselected leaves may be omitted from execution reports.
Selected skips, extras, missing leaves, duplicates and stale reports fail aggregate.
Full prohibits case filters and still runs every discovered leaf exactly once.

Test tooling, workflow and package changes select dedicated CI/budget contract
tests through explicit owner policy rather than repository Full. Release/Electron
inputs select the Node publication contracts in the same Related logic shard.
Unresolved computed or relative imports/globs, unavailable Git history,
unmapped non-document inputs, an unexplained empty code selection, or a Related selection above
500 fail closed and require an explicit dependency/owner mapping or a smaller
change. They do not convert a dev PR into Full. Empty success requires strictly allowlisted docs, proven type-only edits, or explicit retirement evidence; release notes are publication inputs and are excluded from
that exception.

Renames/deletions use independent complete base and checkout source snapshots,
including non-source dependency existence. Base test consumers map to current
discovery by identity or Git rename lineage, never a fixed migration table. Both
old/new runtime consumers and policy owners select surviving whole owner suites;
ordinary production edits retain behavior-level filtering. Removed tests are not
executed. Missing owners or dangling dependencies fail closed. An orphan deletion
is retired only when no surviving source dependency or runtime/config reference
remains, and the manifest records that evidence explicitly.

Vitest's watch-mode force-rerun triggers remain enabled. The native-related query
omits only inputs proven byte-identical to base after simultaneous, boundary-aware
Git-derived replacements in known path-bearing fields (Node script entry operands
and Vitest include/exclude/setupFiles/reporters). Arbitrary env/name/data strings
never qualify. Directory/glob replacements additionally require an
exact two-sided descendant mapping with no extra destination or old-path occupants.
Explicit owner policy still selects those inputs. Dependency, argument or config
behavior edits do not qualify and retain normal conservative candidate validation.

The static graph includes `.github/scripts/` and scans release helpers for computed
imports. `tests/tooling/` remains inside dependency validation: only the collector's
specific `require(resolve(file))` crosses the explicit tooling owner boundary,
because it loads the discovered Node test list in an isolated process. Computed
loads elsewhere (including other tooling and ordinary tests) still fail closed.

Node `.test.cjs` files under `tests/` are owned by the Node runner, not Vitest.
`node-collect.cjs` collects actual synchronous registrations in a separate process
without invoking test bodies. It supports generated registrations and synchronous
suites. Async suites fail collection; leaf bodies which create additional subtests
fail post-run completeness. Both runners' actual file/leaf inventories and fresh
reports must match the manifest before aggregate succeeds.

The reusable Actions workflow emits plan, shard and aggregate artifacts plus
selection reasons and the Top 10 slow leaves. A PR executes each selected logic case
once in the logic gate; Desktop PR jobs validate packaging and smoke only, so they
cannot duplicate cases past the Related 500 limit. Formal Release jobs retain the
Windows/macOS Node component checks before publication. Build, typecheck, and
Web/Desktop packaging/smoke retain their checks.

## Main Full gate sharing

`ci.yml` is the only workflow that runs on `push → main`. It runs one Full logic gate
(plan, shards, aggregate integrity, missing/duplicate checks), then `web`, then calls
`deploy-pages.yml` and `release.yml` as reusable workflows in the same run with
`needs: [logic, web]`. Pages and Release therefore never start without a successful
Full gate for the same SHA and never run Full again.

The aggregate job emits `verified-sha` only for a Full manifest whose checked-out
commit equals the requested head (`ci-run.cjs --verified-sha`). `ci.yml` hands it to
both `deploy-pages.yml` and `release.yml`. Pages requires a non-empty `verified-sha`
equal to `GITHUB_SHA` on a `push` to `refs/heads/main`, and checks under the
`production-pages` concurrency lock that `GITHUB_SHA` is still the current
`origin/main` head (skipping stale out-of-order commits instead of overwriting a
newer deployment). Release's `gate` job accepts `verified-sha` only if it equals
`GITHUB_SHA`, the event is a `push` to `refs/heads/main`, and its own `logic` job was
skipped. An empty or mismatching value makes Release run its own Full gate. A
manually pushed `v*` tag has no same-run proof and always runs Full. Tags created by
Release with `GITHUB_TOKEN` do not trigger another workflow run. Failed, cancelled,
stale or incomplete gates never publish; cross-run artifacts are not reused.

## Reading the selection summary

The summary prints mode, base/head, changed behaviors, selected files/cases, owners,
import-only candidate count, unsafe count and the actual budget. The manifest and
fresh runner reports retain detailed evidence under ignored `output/`; summary
does not print hundreds of import chains. Aggregate retains the Top 10 slow leaves.

PRs retain Web smoke and Desktop packaging/smoke. Post-merge `push → dev` keeps
logic, typecheck and build but skips browser installation and Web smoke. Main,
manual Full and publication Web checks keep Web smoke and exact-SHA Full proof.
