# Logic test CI

`ci-plan.cjs` collects leaves without running their bodies and produces a JSON
manifest. Related and Full deliberately have different budgets:

- **Related** (`PR/push → dev`) selects dependency consumers and must fit in one
  aggregate set of at most 500 leaves. It never opens a second shard to bypass the
  limit. If selection is unsafe, unmapped, removed/renamed, or exceeds 500, planning
  fails with an actionable error instead of silently running repository Full.
- **Full** (`PR/push → main`, Pages, Release, manual Full) runs the complete
  repository and may split sorted whole files into deterministic shards of at most
  500 leaves each. Aggregate may exceed 500 only in Full mode.

The 100ms limit includes each leaf's hooks and cleanup. A single file larger than
500 leaves fails planning: split independent capability suites rather than hiding
or filtering leaves.

```sh
node tools/tests/ci-plan.cjs --mode related --base BASE_SHA --head HEAD_SHA --event pull_request --out output/test-plan.json
npm test -- --manifest output/test-plan.json --shard logic-related --out output/shard-reports/logic-related.json
node tools/tests/ci-run.cjs --manifest output/test-plan.json --reports output/shard-reports
```

Use `--mode full` for the complete repository. `npm test` uses the same Full planner
and runs all Full shards locally. `npm run test:release` is a Node component run,
never repository Full evidence. Explicit `.test.ts` and `.test.cjs` development file
lists can be combined in `npm test -- ...`; they remain subset evidence.

PR comparison uses merge-base; push comparison uses exactly before..after. The CI
checkout is the tested merge commit for PRs; the manifest separately records the
PR head/base and binds shard execution to the checkout SHA and unique plan digest.

Selection uses native Vitest transitive runtime dependencies and a supplemental
TypeScript-erased static/CJS graph. Shared owners such as `Game.ts`, `TownScene.ts`
and `CareerProfileStore.ts` do not force Full by name: their actual consumers are
selected. A helper's consumers can span several capability directories. Type
checking still runs separately for type-only contracts.

Test tooling, workflow and package changes select dedicated CI/budget contract
tests through explicit owner policy rather than repository Full. Release/Electron
inputs select the Node publication contracts. Removed/renamed paths, unresolved
computed imports/globs, unavailable Git history, unmapped non-document inputs, an
empty code selection, or a Related selection above 500 fail closed and require an
explicit dependency/owner mapping or a smaller change. They do not convert a dev PR
into Full. The only empty success is a strictly allowlisted docs change; release
notes are publication inputs and are excluded from that exception.

Node `.test.cjs` files under `tests/` are owned by the Node runner, not Vitest.
`node-collect.cjs` collects actual synchronous registrations in a separate process
without invoking test bodies. It supports generated registrations and synchronous
suites. Async suites fail collection; leaf bodies which create additional subtests
fail post-run completeness. Both runners' actual file/leaf inventories and fresh
reports must match the manifest before aggregate succeeds.

The reusable Actions workflow emits plan, shard and aggregate artifacts plus
selection reasons and the Top 10 slow leaves. Ordinary gameplay and CI-tooling PRs
do not rerun the Node release component on both Desktop hosts. Windows/macOS host
Node checks are reserved for genuinely platform-sensitive inputs such as Electron,
asset-path/smoke, desktop package metadata or the Release workflow; formal Release
jobs always retain them. Build, typecheck, and Web/Desktop packaging/smoke retain
their checks.
