# Related-selection replay recovery

This is a recovery recipe for PR #411, **not selection policy or an owner map**.
Do not import these historical scenarios into the planner. Keep generated plans,
logs and identity comparisons under ignored `output/`; do not commit them.

## Current handoff — 2026-10-25 20:18 UTC

**Keep #411 Draft; acceptance is incomplete.** Published checkpoint
`fd598a4b3e1ae08b2bdc3ae8999b4f4aef22d1e7`, tree
`28afb5e2fd40882224c12abdf1c8b637b1e5ec92`, contains the independently
reviewed provider-cycle correction and original-cause diagnostics. Do not merge.

Completed foundations include removal of manual owner maps, immutable comparison
snapshots, scoped runtime/input evidence, conservative open directory domains,
source-byte readers, explicit conservative receiver evidence, and narrow native
mock proofs. The requested small-space two-person placement test remains; game
army capacity is unchanged. Related 500 / per-leaf 100ms and Full gates remain.

The last complete own-plan attempt used head
`bcca8386a8fd7143bfe9f5ce186e0355603aa918`, actual tested merge
`e19605f37cd73a91626f8d5ac483e73fd53dda58`, target parent
`d2220ba74a13202d244477e9237b009b7e9c2381`, and event base
`2ae8a4332ce9c954b204fca8acab20b7add25f3d`.
[Exact-head CI 40228144864](https://github.com/Andy-CH-BO-AN/SagaBurst-3D-Game/actions/runs/40228144864)
failed with a provider-resolution stack overflow. Instrumented capture of that
same clean snapshot confirmed repeated `providerOf` property recursion. Its
serialized selector inputs are an ignored debugging cache, not an acceptance
manifest. Replaying them with the cycle correction removes the RangeError but
still **blocks** on the following real case:

`tests/release/ci-plan.test.cjs`, ordinal 32,
`blocked diagnostics preserve failure evidence separately and cannot execute or relax workflow gates`.

The unresolved operation is `childProcess.spawnSync(process.execPath, args, ... )`
inside `executeShard`, lifted to the test's invalid-manifest call. The real test
rejects before any subprocess, with zero-call assertions. In the full analyzed
program its two native mock calls currently have no proved provider/event;
namespace/ambient binding facts are being investigated. Cache writes must not be
confused with rewriting the callable `require` identity, but mutable cached
exports must not be globally declared safe either. No filename exemption is valid.

### Remaining, in order

1. Resolve that concrete full-program native binding gap with actual graph facts,
   a small positive contract and a genuine mutation negative. Re-run the complete
   actual-merge plan to a terminal result; subset tests are not acceptance.
2. Finish the separate, **unpublished** canonical CommonJS main-guard change:
   track main entry and process context, preserve actual imported initialization,
   and prevent parent test mocks from suppressing a real Node child's consumers.
   Unknown execution and non-lexical scopes remain fail closed.
3. Implement bounded allocation provenance for actual fake versus real receiver
   instances. Current type-derived paths are explicitly conservative, not proved
   concrete-instance execution. Mutation/escape must retain uncertainty.
4. Re-run all four historical fixed snapshots below with one frozen analyzer and
   report exact retained/added/removed identities. All recorded historical runs
   remain blocked; a newer Black Cat-only replay does not validate the others.
5. Verify latest exact-head CI, selected counts/max leaf time, typecheck and build.
   Earlier results cannot be carried forward to a new head.

### Commands and verified results

- `node tests/tooling/run.cjs tests/release/behavior-selection.test.cjs tests/release/ci-plan.test.cjs tests/release/test-budget.test.cjs`:
  native checkpoint 127 passed, max 88.277ms (`run-cExZtx`); isolated cycle
  correction 131 passed, max 86.502ms (`run-bV6B99`). These are development subsets.
- `node tests/tooling/run.cjs tests/release/ci-plan.test.cjs`: isolated cause
  diagnostics 33 passed, max 62.521ms (`run-oocBP7`). The attempt against an
  unrelated uncommitted main-guard patch failed an added trace-field expectation;
  it was not counted as a pass or hidden by retrying the same tree.
- To resume complete latest-merge planning in a new clean worktree:

  ```sh
  git fetch origin refs/pull/411/merge
  git worktree add --detach ../related-acceptance "$(git rev-parse FETCH_HEAD)"
  cd ../related-acceptance
  npm ci
  node tests/tooling/ci-plan.cjs --mode related \
    --base 2ae8a4332ce9c954b204fca8acab20b7add25f3d \
    --head "$(git rev-parse HEAD^2)" --event pull_request \
    --out output/resume-plan.json
  ```

  The planner must verify the actual merge parents and record the event-base
  mismatch; never replace this with event-base-to-head selection. Preserve any
  `.blocked.json` as non-executable evidence. Run `npm run typecheck:test` and
  `npm run build` on the final candidate and inspect its exact-head CI.

## Recorded checkpoint — not completed acceptance

The four original GitHub `logic-plan` artifacts were downloaded and their ZIP
hashes verified on 2026-10-25. They were **original artifacts, not rebuilt plans**.
All four frozen replays used analyzer commit
`1c201fc88f4126c6f49f0deb781976dde35652b0`, with identical start/end tooling digest
`3e2fa8ff34772a75c108ed43837b3975d9f93940bad3fbbc0857250a2dd10b8d`.
That local analyzer tree is publicly recoverable as commit
`25b7c8cdd7c3953d3bf822fd0a53fe7f3a0e33c4`, tree
`10b921886968fd62b4afa14f925951527a286439`; its commit identity differs, but its
source tree and tooling digest are identical. Use the published commit when
restoring outside the original workspace.
They failed closed; **none produced a successful executable after-count**.
The subsequent remote WIP checkpoint
`0397b0023ee137bce862be274a8bc8e1bcf61d13` (null-context and filtered-directory fixes) was replayed for **Black Cat only**, as recorded below.
Do not transfer older results to a newer head or another historical scenario.

| Scenario / original run | Original files / cases | Frozen replay result |
| --- | ---: | --- |
| Duel push / [40209317278](https://github.com/Andy-CH-BO-AN/SagaBurst-3D-Game/actions/runs/40209317278) | 48 / 387 | Blocked: historical `CareerDuelController.createMission` caller-contract gap; architecture document also demanded an input owner |
| Black Cat / [40208621996](https://github.com/Andy-CH-BO-AN/SagaBurst-3D-Game/actions/runs/40208621996) | 46 / 283 | Blocked: `bindings.read` in Town equipment UI treated as a risk for an unrelated offline builder's `read` |
| Axe / [40205728833](https://github.com/Andy-CH-BO-AN/SagaBurst-3D-Game/actions/runs/40205728833) | 60 / 350 | Blocked: loader/registry and asset inputs lacked proven owners; documentation/offline provenance also demanded owners |
| Small **mixed** code/assets control #406 / [40201747033](https://github.com/Andy-CH-BO-AN/SagaBurst-3D-Game/actions/runs/40201747033) | 46 / 283 | Blocked: bow calibration/loader inputs lacked proven owners; attribution/offline provenance also demanded owners |

Original plans: [Duel artifact](https://github.com/Andy-CH-BO-AN/SagaBurst-3D-Game/actions/runs/40209317278/artifacts/12604933889), [Black Cat artifact](https://github.com/Andy-CH-BO-AN/SagaBurst-3D-Game/actions/runs/40208621996/artifacts/12604543326), [Axe artifact](https://github.com/Andy-CH-BO-AN/SagaBurst-3D-Game/actions/runs/40205728833/artifacts/12602999076), [control artifact](https://github.com/Andy-CH-BO-AN/SagaBurst-3D-Game/actions/runs/40201747033/artifacts/12602266075).

Partial graph diagnostics were not executable manifests and could precede the
whole-file union for directly modified tests. They are **not after-counts**.
Distinguish a genuine missing contract, unresolved analysis, unsupported offline
classification and visual validation boundaries; do not turn any into zero logic.

## Later Black Cat replay — still blocked

On 2026-10-25 at 18:22 UTC, the unchanged Black Cat checkout `87c5fc9`
was replayed with local analyzer `6a90e7bfee3a819093413a59a072f6ae5939e878`.
The publicly recoverable equivalent is `0397b0023ee137bce862be274a8bc8e1bcf61d13`,
tree `04739d5d70210b62b0198ad59219dc08fb379943`. Start/end tooling digest:
`44b31eca1589b1ce098833da6ee96cee75df2fb2a384e2f3db8a995ee5cf6f3b`.

The unrelated `bindings.read` versus offline-builder `read` failure is removed.
The replay remains **blocked**. Its 150 unsafe strings represent 10 files, not
150 distinct missing game contracts; its 100 partial cases are **not** an
after-count (directly modified test-file union has not completed).

- 139 entries concern five offline builder/validator/regions files, including
  import/constant/module and file-level duplicates. Their generic offline-input
  classification remains unresolved; this is not proof of zero logic.
- `Game._spawnMountStudio`, `TownScene.initialize` and `TownScene.updateHostile`
  lack historical caller tests, but the changed statements are armor-toggle UI
  and `QuadrupedVisual.setEquipmentVisible` scene visibility. They are unclassified
  presentation boundaries, not missing HP/save/gameplay contracts. No tests should
  construct models merely to manufacture owners for these methods.
- `animation-source.json` is provenance metadata with no identified runtime reader;
  this inspection alone does not prove absence of dynamic readers.
- `manifest.json` and `black-cat.glb` have real runtime boundaries: manifest approval,
  required clips/nodes, clip duration and saddle-derived ride height. Existing
  mocked `/mount` preload cases do not validate changed Black Cat asset content.
  Do not label the complete model logic-free or its appearance unit-validated.

## Immutable recovery inputs

Select one row below. `BASE` is the original event base, not a moving branch.
`TARGET` is the tested merge's first parent (for push, the actual first parent).
The PR merge's second parent must equal `HEAD_SHA`; never substitute the PR head
for the tested checkout. All identifiers below are public repository metadata.

```sh
# Choose exactly one block.
# Duel: plan job 121217043229
EVENT=push
BASE=a7b38f4abbca3fe54d356b9835836a66ddedc49f
HEAD_SHA=2ae8a4332ce9c954b204fca8acab20b7add25f3d
CHECKOUT=2ae8a4332ce9c954b204fca8acab20b7add25f3d
TARGET=a7b38f4abbca3fe54d356b9835836a66ddedc49f
ARTIFACT=12604933889
ZIP_SHA=902c161d61b0b5981b5cea1c93c2a424618b6e7a8de8e7d641a2d60e04af20d3

# Black Cat: plan job 121214856570
EVENT=pull_request
BASE=d94024b9bd1973f63f1642777f07864316d2d06f
HEAD_SHA=179e18aa31367798f4e88fa0b246a78fc7f08e58
CHECKOUT=87c5fc9737c0232882dc6730926e784ad046c42f
TARGET=455284bedf4bfb44d13b6c34423cab2624eaa309
ARTIFACT=12604543326
ZIP_SHA=1ce961476af7bfa511956968fd2133c9031c894a49b7db20b37f6f9249260ea6

# Axe: plan job 121206173986
EVENT=pull_request
BASE=d94024b9bd1973f63f1642777f07864316d2d06f
HEAD_SHA=962a01be24e71b21ac57e98850ab49637d8d58c9
CHECKOUT=de210062af98b3a847ef8d801abdce789ee14c3c
TARGET=d94024b9bd1973f63f1642777f07864316d2d06f
ARTIFACT=12602999076
ZIP_SHA=9af084d32663315937f48134830b6f9206e49b5cf0e127eb3b3baf454f7882d2

# Mixed #406 control: plan job 121194193611
EVENT=pull_request
BASE=6d188dee56be8a9a10895fffdafbfe7a357fcdff
HEAD_SHA=9659ced8aa174ab016ac6f9e49964592c9863bab
CHECKOUT=f3179594cfb1b2b1eb3133a50170df6a788c13b9
TARGET=6d188dee56be8a9a10895fffdafbfe7a357fcdff
ARTIFACT=12602266075
ZIP_SHA=5c8288bb322a16a15e00bfea50cdac548fe55118652f00df66f268f5246a5c26
```

Public artifact URLs use
`https://github.com/Andy-CH-BO-AN/SagaBurst-3D-Game/actions/runs/<run>/artifacts/<ARTIFACT>`.
Artifacts can expire. If unavailable, stop this original-artifact recipe. An old
planner reconstruction must be separately labeled **rebuilt**, never substituted
silently or compared as if it were the original run.

## Restore and replay without polluting historical diffs

Use an authenticated GitHub CLI and a repository clone with complete history.
Set absolute paths explicitly. Freeze a clean analyzer checkout at the exact
commit being evaluated; install its lockfile dependencies. Do not copy updated
planner files into the historical worktree, add missing tests there, or use
`origin/dev` / `HEAD~1` as event baselines. Run replays serially, separately from
case-budget measurements; this performs planning/discovery, **not leaf execution**.

```sh
set -eu
REPO=Andy-CH-BO-AN/SagaBurst-3D-Game
ANALYZER=/absolute/path/to/frozen-analyzer
HISTORICAL=/absolute/path/to/new-detached-history-worktree
EVIDENCE="$ANALYZER/output/replay-$CHECKOUT"
export EVENT BASE HEAD_SHA CHECKOUT TARGET ANALYZER HISTORICAL EVIDENCE
mkdir -p "$EVIDENCE"
gh api "repos/$REPO/actions/artifacts/$ARTIFACT/zip" > "$EVIDENCE/original.zip"
printf '%s  %s\n' "$ZIP_SHA" "$EVIDENCE/original.zip" | sha256sum -c -
unzip -n "$EVIDENCE/original.zip" -d "$EVIDENCE/original"
git -C "$ANALYZER" fetch origin "$BASE" "$HEAD_SHA" "$CHECKOUT"
git -C "$ANALYZER" worktree add --detach "$HISTORICAL" "$CHECKOUT"
# Install historical dependencies without modifying tracked files.
(cd "$HISTORICAL" && npm ci)
export BASELINE="$EVIDENCE/original/test-plan.json"
export OUT="$EVIDENCE/new-attempt" # Must not contain an existing result.json.

node <<'NODE'
const fs = require('node:fs'), path = require('node:path')
const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const env = process.env
for (const key of ['ANALYZER','HISTORICAL','BASELINE','OUT','EVENT','BASE','HEAD_SHA','CHECKOUT','TARGET']) {
  if (!env[key]) throw new Error(`Missing explicit ${key}`)
}
const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
const digest = () => {
  const dir = path.join(env.ANALYZER, 'tests/tooling'), hash = createHash('sha256')
  for (const file of fs.readdirSync(dir).filter(f => /\.[cm]?js$/.test(f)).sort()) {
    hash.update(file + '\0').update(fs.readFileSync(path.join(dir, file))).update('\0')
  }
  return hash.digest('hex')
}
const identities = plan => {
  const inventory = new Map(plan.inventory.map(s => [s.file, s]))
  return Object.entries(plan.selectedCases).flatMap(([file, ordinals]) => ordinals.map(ordinal => {
    const suite = inventory.get(file)
    if (!suite || !Number.isInteger(ordinal) || typeof suite.names[ordinal] !== 'string') throw new Error('Invalid case identity')
    return { file, runner: suite.runner, ordinal, name: suite.names[ordinal] }
  }))
}
const compare = (before, after) => {
  const key = x => JSON.stringify([x.file, x.runner, x.ordinal, x.name])
  const old = new Set(before.map(key)), next = new Set(after.map(key))
  return { retained: after.filter(x => old.has(key(x))), removed: before.filter(x => !next.has(key(x))), added: after.filter(x => !old.has(key(x))) }
}
;(async () => {
  const original = JSON.parse(fs.readFileSync(env.BASELINE, 'utf8'))
  for (const [field, expected] of Object.entries({ event: env.EVENT, baseSha: env.BASE, headSha: env.HEAD_SHA, checkoutSha: env.CHECKOUT })) {
    if (original[field] !== expected) throw new Error(`Baseline mismatch: ${field}`)
  }
  for (const root of [env.ANALYZER, env.HISTORICAL]) {
    if (git(root, 'status', '--porcelain', '--untracked-files=all')) throw new Error(`Unclean snapshot: ${root}`)
  }
  if (git(env.HISTORICAL, 'rev-parse', 'HEAD') !== env.CHECKOUT) throw new Error('Wrong historical checkout')
  const parents = git(env.HISTORICAL, 'show', '-s', '--format=%P', 'HEAD').split(' ')
  if (parents[0] !== env.TARGET || env.EVENT === 'pull_request' && (parents.length !== 2 || parents[1] !== env.HEAD_SHA)) throw new Error('Wrong tested lineage')
  fs.mkdirSync(env.OUT, { recursive: true })
  const output = path.join(env.OUT, 'result.json')
  if (fs.existsSync(output)) throw new Error('Refusing to overwrite an earlier attempt')
  const before = identities(original), start = digest(), analyzerSha = git(env.ANALYZER, 'rev-parse', 'HEAD')
  const result = { baselineProvenance: 'original verified artifact', originalCases: before.length,
    baselineSha256: createHash('sha256').update(fs.readFileSync(env.BASELINE)).digest('hex'),
    analyzerSha, analyzerStartDigest: start, event: env.EVENT, eventBase: env.BASE,
    requestedHead: env.HEAD_SHA, testedCheckout: env.CHECKOUT, parents,
    startedAt: new Date().toISOString(), planProduced: false, newExecutableCases: null }
  let plan
  try {
    const analyzer = require(path.join(env.ANALYZER, 'tests/tooling/ci-plan.cjs'))
    plan = await analyzer.createPlan({ mode: 'related', base: env.BASE, head: env.HEAD_SHA,
      event: env.EVENT, repositoryRoot: env.HISTORICAL })
    const after = identities(plan)
    Object.assign(result, { status: 'planned-not-executed', planProduced: true, newExecutableCases: after.length,
      identityComparison: compare(before, after), comparisonSnapshot: plan.comparison })
  } catch (error) {
    Object.assign(result, { status: 'blocked', error: error.message, diagnostics: error.diagnostics })
    if (error.diagnostics?.selectedCases) {
      result.partialIdentityComparison = compare(before, identities({ ...original, selectedCases: error.diagnostics.selectedCases }))
      result.partialWarning = 'NONEXECUTABLE partial graph coordinates use original inventory; not final exclusions or after-counts; direct-test union may not have run'
    }
    process.exitCode = 1
  }
  result.analyzerEndDigest = digest()
  result.stableAnalyzer = start === result.analyzerEndDigest && analyzerSha === git(env.ANALYZER, 'rev-parse', 'HEAD')
  result.finishedAt = new Date().toISOString()
  if (!result.stableAnalyzer || git(env.HISTORICAL, 'rev-parse', 'HEAD') !== env.CHECKOUT
    || git(env.HISTORICAL, 'status', '--porcelain', '--untracked-files=all')
    || git(env.ANALYZER, 'status', '--porcelain', '--untracked-files=all')) {
    result.status = 'invalid-snapshot-drift'; result.planProduced = false; result.newExecutableCases = null; process.exitCode = 1
  }
  if (plan && result.status === 'planned-not-executed') {
    fs.writeFileSync(path.join(env.OUT, 'plan.json'), JSON.stringify(plan, null, 2) + '\n', { flag: 'wx' })
  }
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ status: result.status, originalCases: before.length, newExecutableCases: result.newExecutableCases, output }))
})().catch(error => { console.error(error); process.exitCode = 1 })
NODE
```

A planner success above is not a passed logic runner, aggregate, build or CI.
Do not change budgets (Related aggregate 500 / each case 100ms), run Full to bypass
failure, or truncate identities to obtain an attractive replay count.

## Identity checks and remaining work

Compare `(runner, file, ordinal, full name)`, not totals alone. These are review
expectations for fixed historical fixtures, **never selection rules**:

- Black Cat: target-parent `455284b` → tested merge `87c5fc9` changes Game only in
  `_spawnMountStudio`. HP/import/`_saveGame`/`_loadGame` changes came from the target
  history and must not be listed as PR changes. Intent merge-base was `ea18eff`.
- Black Cat `tests/movement/EagleFlightController.test.ts`, ordinals 0 and 1, must
  remain because the final snapshot directly edits that file. Names: `Eagle flight
  boarding clearance > keeps one landed eagle flight controller flyable after
  remount and checkpoint reload`; `Eagle flight boarding clearance > still blocks
  takeoff when an explicitly requested heading puts the wings into a wall`.
  Initial run [40207393512](https://github.com/Andy-CH-BO-AN/SagaBurst-3D-Game/actions/runs/40207393512)
  selected this then-unmodified test through the pose caller; final edits cannot
  be erased to make the earlier false positive disappear.
- Duel `tests/missions/CareerDuelState.test.ts` ordinal 0, `Career Duel physical
  travel and preparation > maps ordinary Duel identity HP by faction and tier
  without healing injuries or zero HP`, is a real changed owner. Historical
  controller `createMission` was not invoked by its tests; the current PR's added
  caller contract is separate and must not be injected into the old snapshot.
- Axe `tests/combat/CommanderWeaponSwitching.test.ts` ordinal 0, `Combat animator
  imported melee clock > decays one fixed rotation offset continuously across a
  target hemisphere change without accumulating on repeated samples`, exercises
  unchanged numeric inertial-pose math. Its partial exclusion was meaningful;
  inspect real affected siblings independently. ProjectileBallistics was **not**
  selected in this original Axe run.
- Control #406 `tests/combat/ProjectileBallistics.test.ts` ordinal 0, `projectile
  launch admission > retains ammo on capacity rejection and accepts the next shot
  when a slot is free`, had only manual asset-policy evidence. Removing that
  justification does not prove all assets safe: attachment.json feeds bow nock
  coordinates used by NPC projectile origins. This is mixed code/data/assets,
  not a pure visual zero-logic example.

Before claiming completion: recheck the corrected read/read attribution and
resolve remaining input classification gaps, inspect fixture/default-value paths (a static typed path is
not proof a concrete test exercises it), rerun all four against one frozen new
analyzer, inspect exact retained/added/removed identities, and separately report
latest exact-head CI. Original artifacts may be gone later; retain downloaded
archives externally when authorized, but never invent recovered evidence.
