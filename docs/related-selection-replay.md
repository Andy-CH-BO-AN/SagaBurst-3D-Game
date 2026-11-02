# Related-selection replay recovery

This is the handoff for PR #411, not selection policy or an owner map. Generated
plans, logs, profiles and identity comparisons belong in ignored `output/`.

## Current handoff — 2026-11-02

**Draft; acceptance incomplete.** This checkpoint publishes the current analyzer
work so it can be continued. It does not establish an executable own-plan,
historical replay acceptance, or latest-head CI success. Record the exact commit
and tooling digest when freezing the next analyzer; keep it separate from the
historical repository snapshot.

### Changes in this checkpoint

- `callback-effects.cjs` separates actual callback invocation effects from mock
  identity and returned values. Scoped primitive/control-flow summaries retain
  unknown getter, coercion, iterator, toJSON, escape and native-provider frontiers.
- `behavior.cjs` carries receiver/allocation/capture facts, actual mock values and
  invocation ordering, collection mutations, recursive value domains, actual
  record getter reads and unbound source-prototype descriptors. Captured scalar
  data reads can reuse runtime heap evidence without rerunning their producers.
- `input-dependencies.cjs` and `shell-effects.cjs` distinguish script-byte origin
  from finite shell effects, using actual arguments, environment, cwd and native
  executable identity. Unsupported shell syntax/operations remain unresolved.
- Existing regression suites cover these boundaries. No production gameplay
  files, army capacity, or the requested small-space Player + one-HR fixture were
  changed in this checkpoint. Manual owner maps remain prohibited.

### Validation and known gaps

The final development subset at this checkpoint passed **408 leaves**, max
**63.699ms** including hooks/cleanup, wall **4.75s** (`run-hfsoTU`):

```sh
rtk npm test -- tests/release/behavior-selection.test.cjs \
  tests/release/ci-plan.test.cjs tests/release/input-dependencies.test.cjs \
  tests/release/test-budget.test.cjs
```

This is a subset, not selected-runner/aggregate acceptance. Earlier candidates
had timing failures (including 116.029ms and 121.541ms); retain those reports.
A diagnostic CPU profile showed garbage-collection cost but did not reproduce
those spikes or establish stable performance. Typecheck/build and official CI
have not been verified for this checkpoint.

The latest completed fixed-snapshot planning attempt used frozen local
`output/analyzer-103/tests/tooling`, finishing **blocked in 248.846s**. It reached
`tests/actors/VeteranCavalryReserve.test.ts`, ordinal 0, through module
initialization → `TOWN_CAVALRY` → `townRoster` → `assignTownGarrison` →
`TownGroundStations.allocate`. At `candidates[remaining] = entry`, reconstructing
`remaining` lost the receiver for `this.candidates` (`TownGroundStation.ts:82`).
No executable manifest was produced. **This result predates the final captured
scalar-read and indexed compound-write edits; it is not a result for the newly
published head.**

The captured class-cache micro-reproduction now selects its actual callback,
but the complete plan must be rerun. Another deterministic unfinished selector
fixture remains:

```js
export function changed() { return 1 }
export function run() {
  const values = [1, 1]
  const key = Math.floor(0)
  values[key] += 1
  if (values[0] !== 1) changed()
}
```

Selecting after changing `changed` to return 2 still blocks on `Assignment
coercion may execute user code`. Investigate nonliteral numeric-key projection
and compound-result provenance; do not replace the result with the RHS literal,
remove coercion checks, or treat this checkpoint's compound-write support as
complete.

### Fixed own-plan inputs

The reviewed failed [CI 40245006877](https://github.com/Andy-CH-BO-AN/SagaBurst-3D-Game/actions/runs/40245006877)
used the following immutable inputs:

- Requested PR head: `bd2f8cf23b0990fbd54a7549fa31905f1f0a4f13`.
- Tested merge: `b0fb4d8ab56101ca3e36ace084026a70255e7911`.
- Actual target parent: `a4579ac3cea9152fc6d891c2e87043db0c0ca821`.
- Event base: `2ae8a4332ce9c954b204fca8acab20b7add25f3d`.
- Plan job: `121324622208`; original blocked artifact: `12618825590`.
- Original ZIP SHA256: `d821f5882293414f644f56df6e3e999d694560ae31a4d19c7ecfed67775caf2d`.

Keep a clean detached worktree at the tested merge and invoke the frozen
analyzer from a separate clean checkout:

```sh
rtk proxy node "$ANALYZER/tests/tooling/ci-plan.cjs" --mode related \
  --base 2ae8a4332ce9c954b204fca8acab20b7add25f3d \
  --head bd2f8cf23b0990fbd54a7549fa31905f1f0a4f13 \
  --event pull_request --repository-root "$HISTORICAL" \
  --out "$ANALYZER/output/own-plan.json"
```

`HISTORICAL` here must be at `b0fb4d8`, with the target/head parents verified.
The original CI blocker was ci-plan ordinal 30, `planner collects both runners
against fixed Git trees before issuing a documentation-only manifest`, at the
native `execFileSync` mock boundary. Its real full-path acceptance is still
unproven. The transformed inline-shell workflow contract and historical
`CareerTownEntry` configured mock paths also remain to be accepted.

### Historical status and next actions

Original ZIPs were recovered again and hash-verified; no rebuilt artifact was
substituted. The last published four-scenario replay used analyzer
`a7d98d43506d10041f09c52ac66604bc2382be3e`, tooling digest
`71289439eba0650adaab795bba4556a08fa892410bf970a4bcaff7e8645cf0cd`.
All four were blocked. None has been accepted with this new checkpoint:

| Scenario / original run | Original leaves | Executable after |
| --- | ---: | --- |
| Duel / 40209317278 | 387 | null / unverified |
| Black Cat / 40208621996 | 283 | null / unverified |
| Axe / 40205728833 | 350 | null / unverified |
| Mixed #406 control / 40201747033 | 283 | null / unverified |

1. Freeze this published analyzer and rerun the fixed own-plan above; the final
   edits have only subset/micro-reproduction evidence. Resolve the real next
   diagnostic and retain unknown-effect and process/lifetime boundaries.
2. Complete Black Cat planning, then all four scenarios below with one frozen
   analyzer. Compare full `(runner, file, ordinal, name)` identities and explain
   retained/added/removed cases. Blocked/partial/null is not an after-count.
3. Validate the latest PR head and its actual tested merge in official Actions:
   plan → selected runner → aggregate → typecheck/build. Inspect aggregate count,
   max leaf and slow cases. Local subsets do not substitute for this gate.
4. Keep Draft. Related aggregate stays ≤500, each leaf ≤100ms; retain Full gates.
   Do not add shards, increase timeouts, fall back to Full, weaken tests, alter
   historical sources, force-push, mark ready, or merge to bypass acceptance.

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
