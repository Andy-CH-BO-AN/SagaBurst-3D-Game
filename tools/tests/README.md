# Logic test CI

`ci-plan.cjs` collects leaves without running their bodies, produces a JSON manifest,
and assigns whole files in sorted order to shards of at most 500 leaves. The 100ms
limit includes each leaf's hooks and cleanup. A file larger than 500 leaves fails
planning: split independent capability suites rather than hiding or filtering leaves.

```sh
node tools/tests/ci-plan.cjs --mode related --base BASE_SHA --head HEAD_SHA --event pull_request --out output/test-plan.json
npm test -- --manifest output/test-plan.json --shard logic-1 --out output/shard-reports/logic-1.json
node tools/tests/ci-run.cjs --manifest output/test-plan.json --reports output/shard-reports
```

Use `--mode full` for the complete repository. `npm test` uses the same Full planner
and runs all shards locally. `npm run test:release` is a Node component run, never
repository Full evidence. Explicit `.test.ts` and `.test.cjs` development file lists
can be combined in `npm test -- ...`; they remain subset evidence.

PR comparison uses merge-base; push comparison uses exactly before..after. The CI
checkout is the tested merge commit for PRs; the manifest separately records the
PR head/base and binds shard execution to the checkout SHA and unique plan digest.

Selection uses native Vitest transitive runtime dependencies and a supplemental
TypeScript-erased static/CJS graph. A helper's consumers can span several test
capabilities. Shared production imports may make a seemingly small change select
many suites; directory names never override dependency edges. Type checking still
runs separately for type-only contracts.

Global config, test tooling, CI, package scripts/lockfile, runtime registries and
high-risk owners force Full. So do deleted/renamed paths, unresolved computed
imports/globs, unavailable Git history, unmapped non-document inputs, and an empty
code selection. Collection errors fail the gate. Extend the small `globalChange`
policy when introducing a new string-based runtime registry; do not hide dependencies
behind dynamic imports. The only empty success is a strictly allowlisted docs change;
release notes are publication inputs and are excluded from that exception.

Node `.test.cjs` files under `tests/` are owned by the Node runner, not Vitest.
`node-collect.cjs` collects actual synchronous registrations in a separate process
without invoking test bodies. It supports generated registrations and synchronous
suites. Async suites fail collection; leaf bodies which create additional subtests
fail post-run completeness. Never move work into module initialization to affect
budget timing. Both runners' actual file/leaf inventories and fresh reports must
match the manifest before aggregate succeeds. No shard failure can be masked by a
later successful shard.

The reusable Actions workflow emits plan, per-shard, and aggregate artifacts plus
selection reasons and the Top 10 slow leaves in Job Summary. Main, Pages, and Release
use Full; Pages upload/deploy and release packaging/publication require the gate.
Desktop PRs retain platform Node checks when the same-commit gate did not cover the
whole Node inventory. Build, typecheck, and Web/Desktop smoke retain their checks.
